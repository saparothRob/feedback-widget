# What the server has to provide

Written against the Nerva server
(`src/server/{routes,handlers,types}/feedback.fs`,
`src/database/migrations/200-domain/2067-feedback.sql`).

**Status: §1–§6 are implemented and verified against a running server.** This
document now describes what the legacy contract *does*, and is still the
reference for anyone standing the contract up elsewhere. §7 — the v1 contract —
remains unbuilt.

---

## 1. CORS on the public routes — done

Previously there was none: no `OPTIONS` handler, no `Access-Control-Allow-Origin`,
and no `UseCors`/`AddCors` anywhere in `entry.fs` or `routes/_.fs`. Only
`getWidgetJsHandler` set a header, by hand. Both ingest posts send
`Content-Type: application/json` **and** a custom `X-Feedback-Key` header, so the
browser always preflights; that preflight got nothing back and the real request
never went out. The widget had only ever been loaded onto the Nerva SPA itself,
same-origin, which is why nobody hit it.

The public routes now share one piece of plumbing in `handlers/feedback.fs`:

```fsharp
/// Reflect the caller's Origin rather than answering "*". "*" can never be
/// paired with credentials later, and reflecting is what leaves the per-project
/// domain allowlist as the thing that actually decides who may post.
let private writeCorsHeaders (ctx: HttpContext) =
  let origin = ctx.TryGetRequestHeader "Origin" |> Option.defaultValue "*"
  let requested =
    ctx.TryGetRequestHeader "Access-Control-Request-Headers"
    |> Option.defaultValue "Content-Type, X-Feedback-Key, Content-Encoding"
  ctx.SetHttpHeader("Access-Control-Allow-Origin", origin)
  ctx.SetHttpHeader("Vary", "Origin")
  ctx.SetHttpHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  ctx.SetHttpHeader("Access-Control-Allow-Headers", requested)
  ctx.SetHttpHeader("Access-Control-Max-Age", "600")

let corsPreflight : HttpHandler = fun _next ctx ->
  writeCorsHeaders ctx
  ctx.SetStatusCode 204
  ctx.WriteBytesAsync [||]

/// Wrap a public handler so every response it produces - success or failure -
/// carries CORS. A 4xx without them reaches the browser as an opaque network
/// error instead of the message it is carrying.
let withCors (inner: HttpHandler) : HttpHandler = fun next ctx ->
  writeCorsHeaders ctx
  inner next ctx
```

Two things worth keeping if you reimplement this:

- **Preflight is unauthenticated, deliberately.** Browsers strip custom headers
  from a preflight, so there is nothing there to check, and answering it exposes
  nothing an HTTP client could not already reach. The real request is gated.
- **Failures carry CORS too.** A 401 or 403 without the headers reaches the
  browser as an opaque network error rather than the message it is carrying,
  which is indistinguishable from the server being down.

### The probe route

The widget asks for the v1 config route at mount to decide which contract to
speak. Nerva does not implement v1, but it answers that path with a CORS-headed
`404 {"error":"not_found"}` anyway:

```fsharp
OPTIONS >=> routef "/v1/feedback-widgets/by-key/%s/config" (fun (_: string) -> corsPreflight)
GET     >=> routef "/v1/feedback-widgets/by-key/%s/config"
  (fun (_: string) -> withCors (RequestErrors.NOT_FOUND {| error = "not_found" |}))
```

Without it the probe falls through to a bare 404 with no CORS headers, and every
host app logs a CORS error on every page load — the widget still falls back
correctly, but it looks broken to whoever owns that console. Delete this once v1
is real and serves the route properly.

---

## 2. Reports linked to their session — done

`doIngestItem` used to pass `sessionId = None` unconditionally. `form.sessionKey`
was declared in `feedback.val`, sent by the widget, and dropped on the floor, so
`feedback_items.session_id` was always `NULL` and the admin UI could never walk
from a report to the replay of the person filing it.

```fsharp
// types/feedback.fs — selects the id alone on purpose: the session row carries
// the whole rrweb blob in `events`, and this runs on every item ingest.
let fetchSessionIdByKey (projectId: Guid) (sessionKey: string|null) (db: NervaDbContext) = task {
  match sessionKey with
  | null -> return None
  | key when String.IsNullOrWhiteSpace key -> return None
  | key ->
    let! rows =
      query<SessionIdRow>
        "SELECT id FROM feedback_sessions WHERE project_id = @p0 AND session_key = @p1"
        [| projectId :> obj; key :> obj |] db
    return rows |> List.tryHead |> Option.map (fun r -> r.id)
}
```

The widget posts the session before the item, so the row exists by the time this
runs. A report filed with replay disabled resolves to `None` and is stored
unlinked, as before.

---

## 3. `domain_whitelist` enforced — done

The column was stored, edited in the admin UI, written by `createProject` and
`updateProject` — and read by nothing. A leaked public key could be posted to
from anywhere. It is a public key shipped in client JS, so it is not a secret and
the allowlist is the only thing that scopes it.

Operators type domains (`myapp.com`, `*.example.com`, comma-separated — the admin
UI says "Leave blank to allow any domain"), but an `Origin` header is a full
origin, so both are reduced to a host before comparing. Scheme and port are
ignored; `*.example.com` covers subdomains **and** the apex.

```fsharp
/// An empty allowlist allows everything - that is the useful default for a
/// project nobody has locked down yet. A non-empty allowlist with no Origin
/// header fails: the key alone is not enough once a project has been scoped.
let private originAllowed (proj: FeedbackProjectDSO) (origin: string option) = ...
```

> **Behavioural change.** Any project with a non-empty `domain_whitelist` now
> actually rejects other origins. Whitelists set while this was dead code have
> never been exercised — check them before deploying, including that each lists
> its own app's domain.

Verified: `evil.com` 403 · `myapp.com` 200 · `sub.example.com` 200 · apex 200 ·
`myapp.com:8443` 200 · `http://myapp.com` 200 · `notmyapp.com` 403 (no naive
suffix match) · `evil.example.com.attacker.net` 403 · no Origin on a scoped
project 403 · unscoped project allows everything.

---

## 4. `itemType` validated — done

`feedback_items.type` is `CHECK (type IN ('feedback','bug','idea','praise'))`
and `doIngestItem` passed `form.itemType` straight through, so an unexpected
value was a constraint violation — a 500 — where it should be a 400. It now
answers `400 {"error":"invalid_item_type","allowed":[...]}`.

The widget already clamps unknown kinds before sending, so this is defence in
depth: the widget is not the only thing that can post to a public route.

---

## 5. Body size and gzip — done

A replay of any length is a multi-MB JSON body.

- **Body cap** raised to 33,030,144 bytes on the ingest routes, via
  `IHttpMaxRequestBodySizeFeature`. Cloud Run hard-caps at 32 MiB and **its 413
  carries no CORS headers**, so an oversized post would surface in the browser as
  a phantom CORS error rather than a readable response. Bounding it in-process
  means the 413 is ours and carries the headers.
- **`Content-Encoding: gzip` accepted.** The widget gzips any body over 64 KB via
  `CompressionStream`, no dependency involved; rrweb JSON compresses 10–20x,
  which is what keeps a full replay inside one request. The body is wrapped in a
  `GZipStream` and *that* is wrapped in a `LengthLimitingStream` bounded at
  67,108,864 bytes — an unbounded decompressor is a gzip bomb — and the now-stale
  `Content-Length` is dropped.

Distinguish the two failures. An oversized body is `413 {"error":"payload_too_large","max":N}`;
a malformed gzip stream is `400 {"error":"invalid_body"}`. Both carry CORS.

Verified: a 102 KB upload that inflates to ~100 MiB is stopped at the ceiling
with a CORS-headed 413, and the server stays healthy.

---

## 6. JSON config route — done

`GET /api/feedback-collect/config` (key in `X-Feedback-Key` or `?key=`),
`Cache-Control: public, max-age=60`, CORS headers, and **404 on an unknown key —
not 401**, so a misconfigured host app sees a clear failure and the route never
confirms which keys exist.

```json
{ "enabled": true, "accentColor": "#ef5a2a", "icon": "bug", "position": "bottom-left",
  "buttonLabel": "Report", "buttonShape": "pill", "buttonPulse": true,
  "captureConsole": true, "captureNetwork": true, "replayLookbackSeconds": 45,
  "collectEmail": true, "kinds": ["bug", "idea"] }
```

It reads the same `feedback_projects.widget_config` JSONB the served `widget.js`
interpolates, so the two cannot disagree; `replayLookbackSeconds` is clamped to
5–3600 exactly as the widget clamps it. `config.ts` probes this route after the
v1 one, which is what gives legacy deployments server-driven theming instead of
package defaults.

`GET /api/feedback/widget.js?key=` still serves the old hand-minified blob, for
embeds that already point at it. This package replaces it; nothing new should use
it.

---

## 7. What v1 would need — not built

The v1 transport is written against this contract and exercised by `npm test`,
but nothing serves it.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/feedback-widgets/by-key/{key}/config` | bootstrap; `max-age=60`; 404 on unknown key |
| GET | `/api/v1/feedback-widgets/by-key/{key}/users?q=` | user-picker options; `no-store`; **403 unless the widget declares a `user`-typed field** |
| POST | `/api/v1/feedback/ingest` | create a report; `201 { id }` |
| POST | `/api/v1/feedback/{id}/replay-chunks` | `{ seq_offset, events[] }` |
| POST | `/api/v1/feedback/{id}/replay-complete` | recompute rollups, clear `replay_pending` |
| POST | `/api/v1/feedback/{id}/attachments` | multipart, one `file` per request |

Plus `OPTIONS` on each. Error bodies are `{ error, detail? }`; the widget
special-cases exactly one code, `replay_not_pending` on `replay-complete`, which
it treats as success because it means an earlier call already finalised the
replay.

Store replay events append-only, keyed `(report_id, seq)`, with
`ON CONFLICT DO NOTHING` — that composite key is also the idempotency key, so a
retried chunk is free. Order by `seq`, never `ts`: rrweb backdates events when it
merges a snapshot.

Getting there also means the things the legacy schema has no room for: an
attachments table, a custom-field schema on the project, and append-only event
rows instead of one JSONB blob per session.

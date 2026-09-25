# What the server has to provide

Written against the Nerva server as it stands today
(`src/server/{routes,handlers,types}/feedback.fs`,
`src/database/migrations/200-domain/2067-feedback.sql`).

**Two of these are blockers.** Until they are fixed the widget works only when the
host app is served from the same origin as the Nerva server — which is to say, it
does not work as an embeddable widget at all.

---

## 1. BLOCKER — there is no CORS on the ingest routes

`routes/feedback.fs` registers:

```fsharp
subRoute "/feedback-collect" <| choose [
  POST >=> route "/session" >=> App.Handlers.Feedback.ingestSession db
  POST >=> route "/item"    >=> App.Handlers.Feedback.ingestItem db
]
```

No `OPTIONS` handler, no `Access-Control-Allow-Origin`, and there is no
`UseCors`/`AddCors` anywhere in `entry.fs` or `routes/_.fs` — only
`getWidgetJsHandler` sets a header, by hand.

Both ingest posts send `Content-Type: application/json` **and** a custom
`X-Feedback-Key` header, so the browser always issues a preflight. That preflight
gets no CORS headers, the browser refuses the real request, and the widget sees a
network failure with no status to report.

The existing embedded widget has never hit this because it is only ever loaded
onto the Nerva SPA itself, same-origin.

### Fix

Reflect the request `Origin` rather than sending `*`. `*` cannot be paired with
credentials later, and reflecting it is what makes the allowlist in §3 meaningful.
Preflight is always permissive: browsers strip custom headers from a preflight, so
there is nothing there to authenticate, and answering it exposes nothing an HTTP
client could not already reach.

```fsharp
// handlers/feedback.fs

let private writeCorsHeaders (ctx: Microsoft.AspNetCore.Http.HttpContext) =
  let origin =
    ctx.TryGetRequestHeader "Origin" |> Option.defaultValue "*"
  let requested =
    ctx.TryGetRequestHeader "Access-Control-Request-Headers"
    |> Option.defaultValue "Content-Type, X-Feedback-Key"
  ctx.SetHttpHeader("Access-Control-Allow-Origin", origin)
  ctx.SetHttpHeader("Vary", "Origin")
  ctx.SetHttpHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  ctx.SetHttpHeader("Access-Control-Allow-Headers", requested)
  ctx.SetHttpHeader("Access-Control-Max-Age", "600")

let corsPreflight : HttpHandler = fun _ ctx ->
  writeCorsHeaders ctx
  ctx.SetStatusCode 204
  ctx.WriteBytesAsync [||]

/// Wrap any public handler so its response - success or failure - carries CORS.
/// A 4xx without CORS headers reaches the browser as an opaque network error
/// instead of the message it is carrying.
let withCors (inner: HttpHandler) : HttpHandler = fun next ctx ->
  writeCorsHeaders ctx
  inner next ctx
```

```fsharp
// routes/feedback.fs
subRoute "/feedback-collect" <| choose [
  OPTIONS >=> route "/session" >=> App.Handlers.Feedback.corsPreflight
  OPTIONS >=> route "/item"    >=> App.Handlers.Feedback.corsPreflight
  POST >=> route "/session" >=> App.Handlers.Feedback.withCors (App.Handlers.Feedback.ingestSession db)
  POST >=> route "/item"    >=> App.Handlers.Feedback.withCors (App.Handlers.Feedback.ingestItem db)
]
```

---

## 2. BLOCKER — reports are never linked to their session

`doIngestItem` in `handlers/feedback.fs`:

```fsharp
App.Types.Feedback.createItem
  proj.id None form.itemType form.title form.description
  //      ^^^^ sessionId, unconditionally None
```

`form.sessionKey` is read off the wire, declared in `feedback.val`, sent by the
widget — and then dropped on the floor. `feedback_items.session_id` is always
`NULL` for widget-ingested reports, so the admin UI can never walk from a report
to the replay of the person filing it. That link is most of the value of having a
recorder at all.

### Fix

Resolve the key to a session id before inserting. `upsertSession` already runs
first, so by the time the item arrives the row exists.

```fsharp
// types/feedback.fs
let fetchSessionIdByKey (projectId: Guid) (sessionKey: string) (db: NervaDbContext) = task {
  if System.String.IsNullOrWhiteSpace sessionKey then return None
  else
    let! rows =
      query<{| id: Guid |}>
        "SELECT id FROM feedback_sessions WHERE project_id = @p0 AND session_key = @p1"
        [| projectId :> obj; sessionKey :> obj |] db
    return rows |> List.tryHead |> Option.map (fun r -> r.id)
}
```

```fsharp
// handlers/feedback.fs, in doIngestItem
let! sessionId = App.Types.Feedback.fetchSessionIdByKey proj.id form.sessionKey db
let create =
  App.Types.Feedback.createItem
    proj.id sessionId form.itemType form.title form.description
    form.pageUrl form.userEmail form.userName form.screenshotData meta
```

Until this ships the widget also writes `sessionKey` into the report's `metadata`
so the two can at least be correlated by hand.

---

## 3. `domain_whitelist` is stored, edited, and never enforced

The column exists on `feedback_projects`, the admin UI edits it, `createProject`
and `updateProject` write it — and nothing reads it. A leaked public key can be
posted to from anywhere.

It is a public key shipped in client JS, so it is not a secret and the allowlist
is the only thing that scopes it.

```fsharp
let private originAllowed (proj: FeedbackProjectDSO) (origin: string option) =
  match proj.domain_whitelist with
  // Empty allowlist allows everything - that is the useful default for a project
  // that has not been locked down yet.
  | null -> true
  | raw when System.String.IsNullOrWhiteSpace raw -> true
  | raw ->
    match origin with
    | None -> false
    | Some o ->
      raw.Split([| ','; '\n' |])
      |> Array.map (fun s -> s.Trim())
      |> Array.filter (fun s -> s <> "")
      |> Array.exists (fun allowed -> System.String.Equals(allowed, o, System.StringComparison.OrdinalIgnoreCase))
```

Check it after the key lookup and before any write, answering `403`.

---

## 4. `itemType` is not validated against its own CHECK constraint

`feedback_items.type` is `CHECK (type IN ('feedback','bug','idea','praise'))`, and
`doIngestItem` passes `form.itemType` straight through. An unexpected value is a
constraint violation — a 500 — where it should be a 400.

The widget already clamps unknown kinds to `feedback` before sending, so this is
defence in depth rather than a live fault. Validate it server-side anyway: the
widget is not the only thing that can post to a public route.

---

## 5. Body size and gzip

A replay of any length is a multi-MB JSON body. Two things follow:

- **Raise the request body cap** on the ingest routes to just under whatever the
  edge allows. Cloud Run hard-caps at 32 MiB and **its 413 carries no CORS
  headers**, so an oversized post surfaces in the browser as a phantom CORS error
  rather than a readable response. Bound it in-process so the 413 is yours and
  carries CORS.
- **Accept `Content-Encoding: gzip`.** The widget gzips any body over 64 KB via
  `CompressionStream`, no dependency involved. rrweb JSON compresses 10-20x, which
  is what keeps a full replay inside one request. Wrap the body in a
  decompressor, then wrap *that* in a length-limiting stream — an unbounded
  decompressor is a gzip bomb — and drop the now-stale `Content-Length`.

Without gzip support the server will read compressed bytes as JSON and answer
400 on every large replay.

---

## 6. Optional: a JSON config route for the legacy contract

`GET /api/feedback/widget.js?key=` serves a hand-minified widget from a string
literal in `handlers/feedback.fs`, with the config interpolated into it. That is
what this package replaces.

The config itself is still worth exposing, as JSON, so legacy deployments get
server-driven theming instead of falling back to widget defaults:

```
GET /api/feedback-collect/config    ->  { enabled, accentColor, icon, position,
                                          buttonLabel, buttonShape, buttonPulse,
                                          captureConsole, captureNetwork,
                                          replayLookbackSeconds, kinds }
```

`Cache-Control: public, max-age=60`, CORS headers, and **404 on an unknown key** —
not 401. A misconfigured host app sees a clear failure, and the route does not
confirm which keys exist.

If you add it, teach `config.ts` to probe it after the v1 route.

---

## 7. What v1 would need

The v1 transport is written against this contract and is exercised by
`npm test`, but nothing serves it yet. It needs:

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
retried chunk is free. Order by `seq`, never `ts`.

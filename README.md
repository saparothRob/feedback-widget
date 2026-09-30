# @nerva/feedback-widget

Embeddable feedback button, modal and session recorder for Nerva feedback
projects. Drop it into any browser app; reports, replays, console output and
network activity land in that app's Nerva feedback project. React Native apps
get the same pipeline minus the replay through
[`@nerva/feedback-widget/react-native`](#react-native--expo).

```
npm install @nerva/feedback-widget
```

```ts
import { mountFeedback } from "@nerva/feedback-widget";

const feedback = await mountFeedback({
  endpoint: "https://acme.nervaapp.com",
  publicKey: "your-feedback-project-api-key",
  user: { id: currentUser.id, email: currentUser.email, name: currentUser.name },
  metadata: { release: __BUILD__, tenant: org.slug },
});
```

No bundler? Use the global build, which can mount itself:

```html
<script src="https://acme.nervaapp.com/feedback-widget.global.js"
        data-endpoint="https://acme.nervaapp.com"
        data-key="your-feedback-project-api-key"></script>
```

<p align="center">
  <img src="docs/widget-light.png" width="49%" alt="The feedback dialog in light mode" />
  <img src="docs/widget-dark.png" width="49%" alt="The feedback dialog in dark mode" />
</p>

<sub>Captured by <code>npm test</code> against a host page that deliberately styles every
button lime with a red dashed border and letter-spaces all text — visible behind the
dialog, and stopping dead at the shadow boundary.</sub>

**71 KB gzipped**, rrweb and both capture plugins included. No runtime
dependencies beyond that; `html2canvas` is an optional peer used only for
screenshots.

---

## How it is put together

The server is the source of truth and the widget is deliberately dumb. Theme,
capture toggles, kind list, replay lookback and the custom-field schema are all
fetched at mount, so an operator changes how the widget behaves without anyone
redeploying the app it is embedded in. The host app supplies only what it alone
knows: who the user is, and what the build/tenant/release are.

```
src/index.ts        web conductor - composes everything, owns the lifecycle
  config.ts         bootstrap: which contract, and what the operator configured
  copy.ts           every user-facing string, shared by both faces
  limits.ts         form limits and timings, shared by both faces
  recorder.ts       rrweb behind a bounded buffer                    (web only)
  redact.ts         non-configurable capture-time redaction
  extract.ts        splits console/network back out of the replay
  screenshot.ts     optional DOM rasterisation                       (web only)
  transport/        the only code that knows what the wire looks like
    v1.ts             /api/v1/feedback/*        (snake_case)
    legacy.ts         /api/feedback-collect/*   (camelCase, mirrors feedback.val)
    http.ts           gzip, multipart, typed errors
  ui/               shadow-root shell, launcher, modal, custom fields (web only)
  react-native/     the mobile face - headless client, sheet, launcher
```

Everything above `transport/` is contract-agnostic. Adding a third server
generation means adding a file there and a branch in `selectTransport`, and
touching nothing else.

The two entry points share the core and never each other's runtime: the web
entry (`src/index.ts`) is the only path to rrweb, the shadow-DOM shell and
html2canvas; the react-native entry (`src/react-native/`) is the only path to
react and react-native, both externalised and declared as optional peers. A web
app installs and bundles exactly what it did before.

### Two server contracts, chosen at mount

At mount the widget asks for `/api/v1/feedback-widgets/by-key/{key}/config`.

- **Answered** → the v1 contract, with server-driven config, custom fields, file
  attachments and the chunked replay protocol.
- **404 / refused** → the legacy `/api/feedback-collect/*` contract, which has no
  public config route, so the widget runs on its defaults plus your options.

`handle.transport` tells you which one you got. See
[docs/server-requirements.md](docs/server-requirements.md) for what each contract
needs from the server, and which parts of it Nerva implements today.

| | legacy | v1 |
|---|---|---|
| Report + replay | yes | yes |
| Console / network capture | yes | yes |
| Server-driven theme & toggles | yes | yes |
| Custom fields | parked in `metadata` | first-class |
| File attachments | dropped (names kept in `metadata`) | yes |
| Chunked replay upload | no | yes |
| Continuous session upload | yes | no |

### The replay buffer

A widget that lives as long as a tab cannot keep every event, and a naive "drop
anything older than N seconds" queue eventually drops the full snapshot the
replay is built from, leaving an unplayable tail. So the recorder uses rrweb's
own checkout mechanism: a fresh full snapshot every `lookbackMs`, two
generations kept, the older one dropped when a third arrives. Memory stays inside
`[lookback, 2 x lookback)` and whatever gets flushed always begins with a
Meta + FullSnapshot pair.

`seq` is assigned at flush time and the server orders by it. rrweb backdates
events when it merges a snapshot, so `ts` is not a stable ordering and must never
be used as one.

---

## Privacy

This is the part to read before shipping it.

**Nothing leaves the browser unless someone files a report.** The replay lives in
a rolling in-memory buffer and is uploaded at submit time. A visitor who never
clicks the button never sends anything. (`replay.uploadMode: "continuous"` opts
into always-on session upload on the legacy contract; it is off by default.)

**Redaction happens at capture time, not at send time.** A value that was never
recorded cannot leak through a bug in the uploader or an `onBeforeSend` you
forgot to write.

- All inputs are masked by default (`replay.maskAllInputs`, default `true`).
- `authorization`, `proxy-authorization`, `cookie`, `set-cookie` and anything
  matching `x-*-token|key|secret|auth` are **never** recorded, even with
  `network.recordHeaders: true`. That list is not configurable.
- Request and response bodies are off by default.
- Sensitive query parameters (`token`, `access_token`, `api_key`, `password`,
  `secret`, `signature`, `code`, …) are blanked in every recorded URL.
- The widget never records its own ingest traffic.

**Opt out per element** — add `class="feedback-mask"` (or `data-feedback-mask`) to
mask text, `class="feedback-block"` (or `data-feedback-block`) to skip a subtree
entirely:

```html
<div class="feedback-block"><!-- never recorded at all --></div>
<span class="feedback-mask">4111 1111 1111 1111</span>
```

The modal tells the person submitting what they are about to share. Do not remove
that line without replacing it with something equally clear.

---

## Options

| Option | Default | Notes |
|---|---|---|
| `endpoint` | — | **required**, no trailing slash |
| `publicKey` | — | **required**, the feedback project's api key |
| `user` | `{}` | `{ id, email, name }` identity hints |
| `metadata` | `{}` | arbitrary JSON, stored verbatim |
| `theme` | server | `accent`, `icon`, `position`, `buttonLabel`, `buttonShape`, `buttonPulse`, `skin`, `colorScheme`, `radius`, `brandName`, `brandLogo`, `successMessage`, `loadFonts` |
| `kinds` | server | must be a subset the server accepts |
| `screenshot` | `"dom"` | `"dom"` needs the `html2canvas` peer; `"none"` hides the toggle |
| `collectEmail` | `true` | ignored when `user.email` is set |
| `attachments` | `true` | v1 only |
| `replay.enabled` | `true` | |
| `replay.lookbackMs` | server (60s) | |
| `replay.uploadMode` | `"on-submit"` | `"continuous"` is legacy-only |
| `replay.maskAllInputs` | `true` | |
| `replay.maskTextSelector` | — | added to `.feedback-mask` |
| `replay.blockSelector` | — | added to `.feedback-block` |
| `console.enabled` | server | |
| `network.enabled` | server | |
| `network.recordHeaders` | `false` | forbidden headers stripped regardless |
| `network.recordBody` | `false` | |
| `onBeforeSend` | — | return `false` to cancel, or a modified report |
| `onSubmitted` / `onError` | — | |

### Handle

```ts
feedback.open();
feedback.close();
feedback.identify({ id, email, name });   // after a login
feedback.setMetadata({ route: "/billing" });
feedback.destroy();                        // stops the recorder, removes the DOM
feedback.transport;                        // "v1" | "legacy" | "none"
```

A disabled widget mounts **no DOM at all** — not a hidden button, nothing — and
returns an inert handle whose `transport` is `"none"`.

### Styling

Everything renders inside a shadow root. The host app's stylesheet cannot reach
in and break the dialog, and none of the widget's CSS escapes to restyle the host
app. Theme it through the config, not through CSS.

The default face is the Nerva register — Archivo display heading, IBM Plex Mono
eyebrow, micro-labels and capture telemetry, the suite's light and dark
surfaces. Per app, the operator (or the host via `theme`) can override:

- `skin` — `"nerva"` (default) or `"plain"`, a quiet system-font dialog that
  disappears into the host app
- `colorScheme` — `"light"` (default), `"dark"`, or `"auto"` to follow the
  visitor's OS
- `radius` — panel corner radius in px (0–24, default 10); controls derive
- `brandName` / `brandLogo` — the eyebrow line above the heading
- `successMessage` — body text of the sent confirmation
- `loadFonts` — the nerva skin loads Archivo / IBM Plex via one document-level
  Google Fonts link; set `false` under a strict CSP and the skin rides its
  system fallbacks

---

## React Native / Expo

The same package serves mobile apps through a second entry point. It speaks the
same server contracts the web widget does - camelCase
`/api/feedback-collect/config|session|item` against today's Nerva, the v1
routes when a server grows them - so reports from an app land in the same
feedback project, session-linked, next to the web ones.

```
npm install @nerva/feedback-widget
```

`react` and `react-native` are optional peer dependencies used only by this
entry; your app already has them, and web consumers never install them.

```tsx
import { useEffect, useState } from "react";
import {
  createFeedbackClient,
  FeedbackLauncher,
  FeedbackSheet,
  type FeedbackClient,
} from "@nerva/feedback-widget/react-native";

export function FeedbackHost() {
  const [client, setClient] = useState<FeedbackClient | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live: FeedbackClient | null = null;
    void createFeedbackClient({
      endpoint: "https://acme.nervaapp.com",
      publicKey: "your-feedback-project-api-key",
      user: { id: currentUser.id, email: currentUser.email, name: currentUser.name },
      metadata: { release: appVersion },
      screenName: "home",
    }).then((c) => {
      live = c;
      setClient(c);
    });
    return () => live?.destroy();
  }, []);

  if (!client) return null;
  return (
    <>
      <FeedbackLauncher client={client} onPress={() => setOpen(true)} />
      <FeedbackSheet client={client} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

`<FeedbackSheet>` is the web modal's field set - kind chips from the server
config, title, details, optional email - over an RN `Modal`, themed from the
same server config (accent, radius, `skin`, `colorScheme` including `"auto"`
via the OS appearance). `<FeedbackLauncher>` is the optional floating button; a
settings row or a shake gesture opening the sheet works just as well.

### The PawGate / PayGate pattern

Apps that keep their API origin in Expo config feed the client the same way
they feed their axios instance - and tell it where the user is from the
navigation container, so reports say `app://settings/billing` instead of
guessing:

```ts
// src/feedback.ts
import { createFeedbackClient } from "@nerva/feedback-widget/react-native";

export const feedback = createFeedbackClient({
  endpoint: process.env.EXPO_PUBLIC_NERVA_URL ?? "http://localhost:9031",
  publicKey: process.env.EXPO_PUBLIC_NERVA_FEEDBACK_KEY ?? "",
  screenName: "root",
});
```

```tsx
// App.tsx — feed navigation state changes into the report context
<NavigationContainer
  ref={navigationRef}
  onStateChange={() => {
    const route = navigationRef.getCurrentRoute();
    if (route) void feedback.then((c) => c.setScreen(route.name));
  }}
>
```

After a login, `client.identify({ id, email, name })`; per-screen context goes
through `client.setMetadata({ ... })` - both merge, like the web handle.

### Screenshots

The package depends on no native module. If the app can rasterise itself -
`react-native-view-shot` is the usual answer - hand the client a callback and
every report carries the capture; without one, reports simply have no
screenshot:

```ts
import { captureScreen } from "react-native-view-shot";

const client = await createFeedbackClient({
  endpoint,
  publicKey,
  captureScreenshot: () =>
    captureScreen({ result: "data-uri", format: "jpg", quality: 0.8 }).catch(() => null),
});
```

### What mobile does not capture

- **No session replay.** rrweb records a DOM; there is none. The session is
  still posted - console and network breadcrumbs, viewport, duration - with an
  empty event stream, so the admin UI shows the context without a player.
- **Console and network capture still work**, without rrweb: the client patches
  the console methods and wraps `fetch` into rolling buffers (restored on
  `destroy()`), honouring the server's capture toggles and the same
  non-configurable URL redaction as the web recorder. Headers and bodies are
  never recorded on mobile.
- **No automatic screenshots** - only what your `captureScreenshot` returns.
- **No file attachments and no custom fields** (legacy contract limits, same as
  the web widget on that transport).

### Headless

Everything the sheet does goes through
`@nerva/feedback-widget/react-native/client`, which imports no react at all -
`createFeedbackClient(...)` → `submit({ kind, title, message, email?,
screenshot? })` - for apps that already have their own feedback form and just
want it to land in Nerva.

---

## Development

```
npm install
npm run typecheck   # strict; there are no warnings, only errors
npm run lint
npm run build       # dist/index.js, dist/index.cjs, dist/global.iife.js,
                    # dist/react-native{,-client}.{js,cjs}, + .d.ts
npm test            # web: real bundle, real browser, stand-in server, both
                    # contracts; then the react-native headless client in node
```

`npm test` drives the built web bundle in Chromium against a mock of both server
generations, and asserts the things a typecheck cannot: that the shadow boundary
holds against hostile host CSS, that the replay is playable, that redaction
happened at capture time, and that the right contract was chosen. Run
`npm run build` first.

`tests/rn-smoke.mjs` then exercises the shipped react-native client bundle in
node (with `react-native` stubbed): the legacy session+item pair, breadcrumb
capture and redaction, and that the bundle drags in no react and no rrweb. The
RN **UI** components have no renderer in CI and get a types-compile check only
(`npm run typecheck` covers them).

`strict` plus `noUncheckedIndexedAccess` plus `exactOptionalPropertyTypes` is
deliberate, and matches the server's `TreatWarningsAsErrors=true`. Fix the root
cause; do not suppress.

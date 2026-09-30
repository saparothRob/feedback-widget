/**
 * All widget CSS, scoped by the shadow root.
 *
 * The shadow boundary is doing real work in both directions: the host app's
 * stylesheet cannot reach in and break the modal, and none of this can leak out
 * and restyle the host. Accent, radius, skin and scheme are parameterised —
 * accent and radius as custom properties, skin and scheme as data attributes on
 * `.fb-scope`, all set at mount.
 *
 * The default face is the Nerva register: Archivo for the display heading,
 * IBM Plex Mono for the eyebrow, micro-labels and the telemetry strip, the
 * suite's angel-white and geofront surfaces. `[data-skin="plain"]` strips the
 * register back to a quiet system-font dialog for hosts that want the widget to
 * disappear into their own design.
 */

/** Geofront tokens. Emitted twice: once for [data-scheme="dark"], once inside
 *  the prefers-color-scheme media query for [data-scheme="auto"]. */
const DARK_TOKENS = `
  --fb-bg: #14181F;
  --fb-ground: #0B0E14;
  --fb-inset: #191E27;
  --fb-input: #0F131A;
  --fb-text: #E6EAF0;
  --fb-muted: rgba(230, 234, 240, 0.62);
  --fb-faint: rgba(230, 234, 240, 0.48);
  --fb-border: rgba(160, 172, 198, 0.14);
  --fb-border-strong: rgba(160, 172, 198, 0.55);
  --fb-danger: #F0564A;
  --fb-ok: #4ADE80;
  --fb-scrim: rgba(0, 0, 0, 0.62);
  --fb-shadow: 0 12px 40px rgba(0, 0, 0, 0.65);
  --fb-accent-text: color-mix(in srgb, var(--fb-accent) 55%, #E6EAF0);
`;

export const STYLES = `
/*
 * The host element is reachable from the outer tree - a host page's
 * * { letter-spacing: 3px } matches it, and normal outer-tree declarations
 * outrank :host by design. letter-spacing, color, font and friends all inherit,
 * so they would cross the shadow boundary anyway. So :host only neutralises
 * layout, and the real reset happens one level in, on .fb-scope, which nothing
 * outside the shadow root can select.
 */
:host {
  all: initial;
  display: block;
}

.fb-scope {
  /* all:initial first: it resets inherited text properties the host page may
     have set on the host element, and tokens declared after it survive. */
  all: initial;
  display: block;

  --fb-accent: #6A3AB2;
  --fb-on-accent: #ffffff;

  --fb-bg: #FFFFFF;
  --fb-ground: #F1F4F8;
  --fb-inset: #E9EDF3;
  --fb-input: #FBFCFE;
  --fb-text: #0F1725;
  --fb-muted: #44506A;
  --fb-faint: #626E86;
  --fb-border: rgba(20, 30, 48, 0.18);
  --fb-border-strong: rgba(20, 30, 48, 0.46);
  --fb-danger: #C1121F;
  --fb-ok: #1E8E52;
  --fb-scrim: rgba(16, 20, 32, 0.38);
  --fb-shadow: 0 8px 32px rgba(16, 20, 32, 0.18);
  --fb-accent-text: color-mix(in srgb, var(--fb-accent) 82%, #10131C);

  --fb-wash: color-mix(in srgb, var(--fb-accent) 9%, transparent);
  --fb-ring: color-mix(in srgb, var(--fb-accent) 22%, transparent);
  --fb-glow: 0 4px 18px color-mix(in srgb, var(--fb-accent) 38%, transparent);

  --fb-radius: 10px;
  --fb-radius-ctl: max(4px, calc(var(--fb-radius) - 3px));

  --fb-font: 'IBM Plex Sans', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --fb-display: 'Archivo', 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --fb-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;

  font-family: var(--fb-font, system-ui, sans-serif);
  font-size: 14px;
  line-height: 1.5;
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
  text-align: left;
  color: var(--fb-text);
  font-feature-settings: 'liga' 1, 'kern' 1;
}

.fb-scope[data-scheme="dark"] { ${DARK_TOKENS} }
@media (prefers-color-scheme: dark) {
  .fb-scope[data-scheme="auto"] { ${DARK_TOKENS} }
}

/* The plain skin: the register's voice turned off. System faces everywhere,
   softer geometry, no glow — the dialog recedes into the host app. */
.fb-scope[data-skin="plain"] {
  --fb-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --fb-display: var(--fb-font);
  --fb-mono: var(--fb-font);
  --fb-glow: none;
  --fb-radius: 12px;
}

*, *::before, *::after { box-sizing: border-box; }

/* Must outrank the \`display\` every component below sets. Without this an
   overlay carrying \`hidden\` still lays out at \`display: flex\`, covering the
   host page with an invisible click-eating sheet. */
[hidden] { display: none !important; }

/* ── Launcher ─────────────────────────────────────────────────────────────── */

.fb-launcher {
  position: fixed;
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  cursor: pointer;
  font: inherit;
  font-family: var(--fb-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fb-on-accent);
  background: var(--fb-accent);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.22), var(--fb-glow);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.fb-scope[data-skin="plain"] .fb-launcher {
  font-size: 14px;
  letter-spacing: normal;
  text-transform: none;
}
.fb-launcher:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(15, 23, 42, 0.28), var(--fb-glow); }
.fb-launcher:focus-visible { outline: 3px solid var(--fb-accent); outline-offset: 3px; }
.fb-launcher.circle { width: 54px; height: 54px; border-radius: 50%; justify-content: center; padding: 0; }
.fb-launcher.pill { height: 46px; border-radius: 999px; padding: 0 20px; }
.fb-launcher.circle .fb-launcher-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

.fb-launcher.bottom-right { bottom: 20px; right: 20px; }
.fb-launcher.bottom-left  { bottom: 20px; left: 20px; }
.fb-launcher.top-right    { top: 20px; right: 20px; }
.fb-launcher.top-left     { top: 20px; left: 20px; }

.fb-launcher.pulse::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 0 0 0 var(--fb-accent);
  animation: fb-pulse 2.4s infinite;
}
@keyframes fb-pulse {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--fb-accent) 70%, transparent); }
  70%  { box-shadow: 0 0 0 16px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

@media (prefers-reduced-motion: reduce) {
  .fb-launcher, .fb-panel { transition: none; }
  .fb-launcher:hover { transform: none; }
  .fb-launcher.pulse::after { animation: none; }
  .fb-tele-dot { animation: none; }
}

/* ── Overlay + panel ──────────────────────────────────────────────────────── */

.fb-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  background: var(--fb-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow-y: auto;
}

.fb-panel {
  width: 100%;
  max-width: 440px;
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  background: var(--fb-bg);
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius);
  box-shadow: var(--fb-shadow);
  overflow: hidden;
}

.fb-head {
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--fb-border);
}

.fb-brand-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.fb-brand-logo { width: 14px; height: 14px; border-radius: 3px; object-fit: contain; }
.fb-brand {
  flex: 1;
  font-family: var(--fb-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fb-accent-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fb-scope[data-skin="plain"] .fb-brand-row { position: absolute; right: 12px; top: 12px; margin: 0; }
.fb-scope[data-skin="plain"] .fb-brand, .fb-scope[data-skin="plain"] .fb-brand-logo { display: none; }
.fb-scope[data-skin="plain"] .fb-head { position: relative; padding: 16px 44px 12px 18px; }

.fb-title {
  margin: 0;
  font-family: var(--fb-display);
  font-size: 19px;
  font-weight: 650;
  letter-spacing: normal;
  line-height: 1.25;
}
.fb-scope[data-skin="plain"] .fb-title { font-size: 15px; }

.fb-close {
  border: 0; background: transparent; color: var(--fb-muted);
  cursor: pointer; padding: 6px; border-radius: var(--fb-radius-ctl); line-height: 0;
}
.fb-close:hover { background: var(--fb-inset); color: var(--fb-text); }
.fb-close:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 1px; }

.fb-body { padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }

/* ── Kind picker ──────────────────────────────────────────────────────────── */

.fb-kinds { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; }
.fb-kind {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 10px 6px; cursor: pointer;
  font-family: var(--fb-mono);
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--fb-muted); background: transparent;
  border: 1px solid var(--fb-border); border-radius: var(--fb-radius-ctl);
}
.fb-scope[data-skin="plain"] .fb-kind { font-size: 12px; letter-spacing: normal; text-transform: none; background: var(--fb-ground); }
.fb-kind:hover { border-color: var(--fb-border-strong); color: var(--fb-text); }
.fb-kind:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 1px; }
.fb-kind[aria-pressed="true"] {
  color: var(--fb-accent-text);
  border-color: color-mix(in srgb, var(--fb-accent) 55%, transparent);
  background: var(--fb-wash);
}

/* ── Fields ───────────────────────────────────────────────────────────────── */

.fb-field { display: flex; flex-direction: column; gap: 6px; }
.fb-label {
  font-family: var(--fb-mono);
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--fb-faint);
}
.fb-scope[data-skin="plain"] .fb-label { font-size: 12px; letter-spacing: normal; text-transform: none; color: var(--fb-muted); }
.fb-req { color: var(--fb-danger); margin-left: 2px; }

.fb-input, .fb-textarea, .fb-select {
  width: 100%; font: inherit; font-size: 14px;
  color: var(--fb-text); background: var(--fb-input);
  border: 1px solid var(--fb-border); border-radius: var(--fb-radius-ctl); padding: 9px 11px;
}
.fb-textarea { min-height: 96px; resize: vertical; }
.fb-input:focus, .fb-textarea:focus, .fb-select:focus {
  outline: none; border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-ring);
}
.fb-input[aria-invalid="true"], .fb-textarea[aria-invalid="true"], .fb-select[aria-invalid="true"] {
  border-color: var(--fb-danger);
}
.fb-input::placeholder, .fb-textarea::placeholder { color: var(--fb-faint); }

.fb-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--fb-text); cursor: pointer; }
.fb-check input { accent-color: var(--fb-accent); width: 16px; height: 16px; }

.fb-hint { font-size: 11px; color: var(--fb-faint); margin: 0; }
.fb-error { font-size: 12px; color: var(--fb-danger); margin: 0; }

/* ── Attachments ──────────────────────────────────────────────────────────── */

.fb-files { display: flex; flex-direction: column; gap: 6px; }
.fb-file {
  display: flex; align-items: center; gap: 8px; font-size: 12px;
  padding: 6px 9px; background: var(--fb-ground);
  border: 1px solid var(--fb-border); border-radius: var(--fb-radius-ctl);
}
.fb-file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-file .fb-hint { font-family: var(--fb-mono); font-variant-numeric: tabular-nums; }
.fb-file-drop { border-color: var(--fb-accent); }

.fb-shot { max-width: 100%; border-radius: var(--fb-radius-ctl); border: 1px solid var(--fb-border); }

/* ── Buttons ──────────────────────────────────────────────────────────────── */

.fb-btn {
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  border-radius: var(--fb-radius-ctl); padding: 8px 16px; border: 1px solid transparent;
  white-space: nowrap;
}
.fb-btn:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 2px; }
.fb-btn[disabled] { opacity: 0.55; cursor: not-allowed; }
.fb-btn-primary { background: var(--fb-accent); color: var(--fb-on-accent); box-shadow: var(--fb-glow); }
.fb-btn-primary:hover:not([disabled]) { filter: brightness(1.07); }
.fb-btn-ghost { background: transparent; color: var(--fb-muted); border-color: var(--fb-border); }
.fb-btn-ghost:hover { color: var(--fb-text); border-color: var(--fb-border-strong); }

.fb-link {
  border: 0; background: none; padding: 0; font: inherit; font-size: 12px; font-weight: 600;
  color: var(--fb-accent-text); cursor: pointer; text-align: left;
}
.fb-link:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 2px; }

/* ── Foot: telemetry strip + actions ─────────────────────────────────────── */

.fb-foot {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 18px; border-top: 1px solid var(--fb-border); background: var(--fb-ground);
}

.fb-telemetry {
  flex: 1;
  display: flex; align-items: center; gap: 10px;
  min-width: 0; overflow: hidden;
  font-family: var(--fb-mono);
  font-size: 9.5px; font-weight: 500;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--fb-faint);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.fb-scope[data-skin="plain"] .fb-telemetry { visibility: hidden; }
.fb-tele { display: inline-flex; align-items: center; gap: 5px; }
.fb-tele-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--fb-accent);
  animation: fb-rec 2s ease-in-out infinite;
}
@keyframes fb-rec {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* ── Done state ───────────────────────────────────────────────────────────── */

.fb-done { padding: 38px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.fb-done-mark {
  width: 56px; height: 56px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--fb-accent-text); background: var(--fb-wash);
  border: 1px solid color-mix(in srgb, var(--fb-accent) 35%, transparent);
}
.fb-done-title { font-family: var(--fb-display); font-size: 18px; font-weight: 650; margin: 0; }
.fb-done-text { font-size: 13px; color: var(--fb-muted); margin: 0; }
.fb-done-ref {
  font-family: var(--fb-mono);
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--fb-faint);
  margin: 4px 0 0;
}

.fb-privacy { font-size: 11px; color: var(--fb-faint); line-height: 1.5; margin: 0; }
`;

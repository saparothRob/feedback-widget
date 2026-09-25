/**
 * All widget CSS, scoped by the shadow root.
 *
 * The shadow boundary is doing real work in both directions: the host app's
 * stylesheet cannot reach in and break the modal, and none of this can leak out
 * and restyle the host. Only the accent and a handful of geometry values are
 * parameterised, as custom properties set on `:host` at mount.
 */
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

  --fb-accent: #7c3aed;
  --fb-on-accent: #ffffff;
  --fb-bg: #ffffff;
  --fb-surface: #f8fafc;
  --fb-text: #0f172a;
  --fb-muted: #64748b;
  --fb-border: #e2e8f0;
  --fb-danger: #dc2626;
  --fb-radius: 14px;
  --fb-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
  --fb-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;

  font-family: var(--fb-font, system-ui, sans-serif);
  font-size: 14px;
  line-height: 1.5;
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
  text-align: left;
  color: var(--fb-text);
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
  font-size: 14px;
  font-weight: 600;
  color: var(--fb-on-accent);
  background: var(--fb-accent);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.22);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.fb-launcher:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(15, 23, 42, 0.28); }
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
}

/* ── Overlay + panel ──────────────────────────────────────────────────────── */

.fb-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  background: rgba(15, 23, 42, 0.45);
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
  border-radius: var(--fb-radius);
  box-shadow: var(--fb-shadow);
  overflow: hidden;
}

.fb-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--fb-border);
}
.fb-title { margin: 0; font-size: 15px; font-weight: 650; flex: 1; }
.fb-close {
  border: 0; background: transparent; color: var(--fb-muted);
  cursor: pointer; padding: 6px; border-radius: 8px; line-height: 0;
}
.fb-close:hover { background: var(--fb-surface); color: var(--fb-text); }
.fb-close:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 1px; }

.fb-body { padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }

.fb-foot {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 14px 18px; border-top: 1px solid var(--fb-border); background: var(--fb-surface);
}

/* ── Kind picker ──────────────────────────────────────────────────────────── */

.fb-kinds { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; }
.fb-kind {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 10px 6px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
  color: var(--fb-muted); background: var(--fb-surface);
  border: 1.5px solid var(--fb-border); border-radius: 10px;
}
.fb-kind:hover { border-color: var(--fb-accent); color: var(--fb-text); }
.fb-kind:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 1px; }
.fb-kind[aria-pressed="true"] {
  color: var(--fb-accent);
  border-color: var(--fb-accent);
  background: color-mix(in srgb, var(--fb-accent) 10%, var(--fb-bg));
}

/* ── Fields ───────────────────────────────────────────────────────────────── */

.fb-field { display: flex; flex-direction: column; gap: 5px; }
.fb-label { font-size: 12px; font-weight: 600; color: var(--fb-muted); }
.fb-req { color: var(--fb-danger); margin-left: 2px; }

.fb-input, .fb-textarea, .fb-select {
  width: 100%; font: inherit; font-size: 14px;
  color: var(--fb-text); background: var(--fb-bg);
  border: 1.5px solid var(--fb-border); border-radius: 9px; padding: 9px 11px;
}
.fb-textarea { min-height: 96px; resize: vertical; }
.fb-input:focus, .fb-textarea:focus, .fb-select:focus {
  outline: none; border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--fb-accent) 22%, transparent);
}
.fb-input[aria-invalid="true"], .fb-textarea[aria-invalid="true"], .fb-select[aria-invalid="true"] {
  border-color: var(--fb-danger);
}

.fb-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--fb-text); cursor: pointer; }
.fb-check input { accent-color: var(--fb-accent); width: 16px; height: 16px; }

.fb-hint { font-size: 11px; color: var(--fb-muted); }
.fb-error { font-size: 12px; color: var(--fb-danger); }

/* ── Attachments ──────────────────────────────────────────────────────────── */

.fb-files { display: flex; flex-direction: column; gap: 6px; }
.fb-file {
  display: flex; align-items: center; gap: 8px; font-size: 12px;
  padding: 6px 9px; background: var(--fb-surface);
  border: 1px solid var(--fb-border); border-radius: 8px;
}
.fb-file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-file-drop { border-color: var(--fb-accent); }

.fb-shot { max-width: 100%; border-radius: 9px; border: 1px solid var(--fb-border); }

/* ── Buttons ──────────────────────────────────────────────────────────────── */

.fb-btn {
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  border-radius: 9px; padding: 9px 18px; border: 1.5px solid transparent;
}
.fb-btn:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 2px; }
.fb-btn[disabled] { opacity: 0.55; cursor: not-allowed; }
.fb-btn-primary { background: var(--fb-accent); color: var(--fb-on-accent); }
.fb-btn-ghost { background: transparent; color: var(--fb-muted); border-color: var(--fb-border); }
.fb-btn-ghost:hover { color: var(--fb-text); }

.fb-link {
  border: 0; background: none; padding: 0; font: inherit; font-size: 12px; font-weight: 600;
  color: var(--fb-accent); cursor: pointer; text-align: left;
}

/* ── Done state ───────────────────────────────────────────────────────────── */

.fb-done { padding: 34px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.fb-done-mark { color: var(--fb-accent); }
.fb-done-title { font-size: 16px; font-weight: 650; margin: 0; }
.fb-done-text { font-size: 13px; color: var(--fb-muted); margin: 0; }

.fb-privacy { font-size: 11px; color: var(--fb-muted); line-height: 1.5; }
`;

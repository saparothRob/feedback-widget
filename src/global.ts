/**
 * IIFE entry for host apps with no bundler:
 *
 *   <script src="https://cdn.example/feedback-widget.global.js"></script>
 *   <script>NervaFeedback.mount({ endpoint: "...", publicKey: "..." })</script>
 *
 * Also supports the declarative form, so a page can embed the widget without
 * writing any JavaScript at all:
 *
 *   <script src="..." data-endpoint="https://acme.nervaapp.com" data-key="..."></script>
 */
import { mountFeedback } from "./index.js";
import type { FeedbackHandle, FeedbackOptions, ThemeOptions, UserHint } from "./types.js";

declare global {
  interface Window {
    NervaFeedback?: {
      mount(opts: FeedbackOptions): Promise<FeedbackHandle>;
      setTheme(theme: Partial<ThemeOptions>): void;
      identify(user: UserHint | null): void;
    };
  }
}

const mounted = new Map<FeedbackHandle, UserHint>();
let signedIn: UserHint = {};

function applyUser(handle: FeedbackHandle, base: UserHint): void {
  handle.clearUser();
  handle.identify({ ...base, ...signedIn });
}

async function mount(opts: FeedbackOptions): Promise<FeedbackHandle> {
  const base: UserHint = { ...(opts.user ?? {}) };
  const handle = await mountFeedback(opts);
  const tracked: FeedbackHandle = {
    ...handle,
    destroy: () => {
      mounted.delete(tracked);
      handle.destroy();
    },
  };
  mounted.set(tracked, base);
  applyUser(tracked, base);
  return tracked;
}

function identify(user: UserHint | null): void {
  signedIn = { ...(user ?? {}) };
  mounted.forEach((base, handle) => applyUser(handle, base));
}

window.NervaFeedback = {
  mount,
  identify,
  setTheme: (theme: Partial<ThemeOptions>) => {
    for (const handle of mounted.keys()) handle.setTheme(theme);
  },
};

const current = document.currentScript;
if (current instanceof HTMLScriptElement) {
  const endpoint = current.dataset.endpoint;
  const publicKey = current.dataset.key;
  if (endpoint && publicKey) {
    void mount({ endpoint, publicKey }).catch((error: unknown) => {
      console.error("[feedback-widget] mount failed", error);
    });
  }
}

export { mountFeedback };

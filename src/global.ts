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
import type { FeedbackHandle, FeedbackOptions } from "./types.js";

declare global {
  interface Window {
    NervaFeedback?: { mount(opts: FeedbackOptions): Promise<FeedbackHandle> };
  }
}

window.NervaFeedback = { mount: mountFeedback };

const current = document.currentScript;
if (current instanceof HTMLScriptElement) {
  const endpoint = current.dataset.endpoint;
  const publicKey = current.dataset.key;
  if (endpoint && publicKey) {
    void mountFeedback({ endpoint, publicKey }).catch((error: unknown) => {
      console.error("[feedback-widget] mount failed", error);
    });
  }
}

export { mountFeedback };

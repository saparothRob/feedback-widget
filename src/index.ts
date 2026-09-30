/**
 * @nerva/feedback-widget
 *
 * The conductor. Mirrors the server's `routes/_.fs`: this file composes the
 * pieces and owns the lifecycle, and holds no logic of its own worth testing.
 *
 *   bootstrap  -> which server contract, and what the operator configured
 *   recorder   -> rrweb behind a bounded buffer, started immediately
 *   shell      -> one host element, one shadow root
 *   modal      -> the form
 *   transport  -> the only code that knows what the wire looks like
 */
import type { FeedbackHandle, FeedbackOptions, OutgoingReport, UserHint } from "./types.js";
import type { Draft, SubmitContext, SubmitResult } from "./transport/index.js";
import { bootstrap, normaliseEndpoint } from "./config.js";
import { startRecorder, type Recorder } from "./recorder.js";
import { selectTransport } from "./transport/index.js";
import { createShell } from "./ui/shell.js";
import { createModal } from "./ui/modal.js";

declare const __WIDGET_VERSION__: string;
const VERSION: string = typeof __WIDGET_VERSION__ === "string" ? __WIDGET_VERSION__ : "0.0.0";

const MIN_FLUSH_MS = 5_000;
const DEFAULT_FLUSH_MS = 30_000;

function inertHandle(reason: string): FeedbackHandle {
  return {
    open: () => undefined,
    close: () => undefined,
    identify: () => undefined,
    setMetadata: () => undefined,
    destroy: () => undefined,
    transport: reason,
    version: VERSION,
  };
}

export async function mountFeedback(opts: FeedbackOptions): Promise<FeedbackHandle> {
  if (typeof document === "undefined") return inertHandle("none");
  if (!opts.publicKey) throw new Error("feedback-widget: publicKey is required");
  if (!opts.endpoint) throw new Error("feedback-widget: endpoint is required");

  const endpoint = normaliseEndpoint(opts.endpoint);
  const { transport: kind, config } = await bootstrap({ ...opts, endpoint });

  // A disabled widget mounts no DOM at all - not a hidden button, nothing. An
  // operator switching it off should be indistinguishable from never having
  // embedded it.
  if (!config.enabled) return inertHandle("none");

  let user: UserHint = { ...(opts.user ?? {}) };
  let metadata: Record<string, unknown> = { ...(opts.metadata ?? {}) };

  const transport = selectTransport(kind, { endpoint, publicKey: opts.publicKey });

  let recorder: Recorder | null = null;
  if (config.replay.enabled) {
    recorder = startRecorder({
      lookbackMs: config.replay.lookbackMs,
      endpoint,
      replay: opts.replay ?? {},
      console: { ...(opts.console ?? {}), enabled: config.capture.console },
      network: { ...(opts.network ?? {}), enabled: config.capture.network },
    });
  }

  const context = (): SubmitContext => ({
    sessionId: recorder?.sessionId ?? "",
    replayStartedAt: recorder?.startedAt() ?? null,
    events: recorder?.flush() ?? [],
    user,
    metadata,
    pageUrl: location.href,
    referrer: document.referrer,
    userAgent: navigator.userAgent,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    config,
  });

  const toReport = (draft: Draft, ctx: SubmitContext): OutgoingReport => ({
    kind: draft.kind,
    title: draft.title,
    message: draft.message,
    email: draft.email,
    user: ctx.user,
    pageUrl: ctx.pageUrl,
    userAgent: ctx.userAgent,
    viewportWidth: ctx.viewportWidth,
    viewportHeight: ctx.viewportHeight,
    screenshot: draft.screenshot,
    metadata: ctx.metadata,
    customFields: draft.answers,
    sessionId: ctx.sessionId,
    replayStartedAt: ctx.replayStartedAt,
    replayEventCount: ctx.events.length,
    attachmentCount: draft.files.length,
  });

  const shell = createShell(config, () => modal.open());

  const modal = createModal({
    config,
    fieldsHost: { endpoint, publicKey: opts.publicKey },
    hostElement: shell.host,
    screenshotMode: opts.screenshot ?? "dom",
    knownEmail: user.email ?? null,
    async submit(draft: Draft): Promise<SubmitResult> {
      const ctx = context();

      // `onBeforeSend` is the host app's last word. It sees a normalised report
      // regardless of which contract is about to carry it, and returning `false`
      // cancels the send outright.
      const edited = opts.onBeforeSend ? opts.onBeforeSend(toReport(draft, ctx)) : undefined;
      if (edited === false) return { id: null };

      const finalDraft: Draft = edited
        ? { ...draft, kind: edited.kind, title: edited.title, message: edited.message, email: edited.email, answers: edited.customFields, screenshot: edited.screenshot }
        : draft;
      const finalCtx: SubmitContext = edited ? { ...ctx, metadata: edited.metadata, user: edited.user } : ctx;

      try {
        const result = await transport.submit(finalDraft, finalCtx);
        opts.onSubmitted?.(result);
        return result;
      } catch (error) {
        opts.onError?.(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },
  });
  shell.mount.append(modal.root);

  // Continuous session upload, where the contract supports it. Default is
  // on-submit: nothing about a visitor who never files a report leaves their
  // browser.
  let timer: number | undefined;
  let unloadHandler: (() => void) | undefined;
  if (opts.replay?.uploadMode === "continuous" && transport.flushSession) {
    const flush = transport.flushSession.bind(transport);
    const interval = Math.max(MIN_FLUSH_MS, opts.replay.flushIntervalMs ?? DEFAULT_FLUSH_MS);
    timer = window.setInterval(() => flush(context(), false), interval);
    unloadHandler = () => flush(context(), true);
    // `pagehide` fires on the bfcache path where `beforeunload` does not.
    window.addEventListener("pagehide", unloadHandler);
  }

  return {
    open: () => modal.open(),
    close: () => modal.close(),
    identify: (next: UserHint) => {
      user = { ...user, ...next };
    },
    setMetadata: (next: Record<string, unknown>) => {
      metadata = { ...metadata, ...next };
    },
    destroy: () => {
      if (timer !== undefined) window.clearInterval(timer);
      if (unloadHandler) window.removeEventListener("pagehide", unloadHandler);
      recorder?.stop();
      modal.close();
      shell.destroy();
    },
    transport: transport.kind,
    version: VERSION,
  };
}

export type {
  FeedbackOptions,
  FeedbackHandle,
  OutgoingReport,
  UserHint,
  ThemeOptions,
  WidgetSkin,
  WidgetColorScheme,
  ReplayOptions,
  ConsoleOptions,
  NetworkOptions,
  ResolvedConfig,
} from "./types.js";
export { FeedbackApiError } from "./transport/http.js";
export { extractConsoleAndNetwork, playableEvents } from "./extract.js";
export { MASK_CLASS, BLOCK_CLASS } from "./redact.js";
export type { WireEvent, ConsoleEntry, NetworkEntry } from "./wire.js";

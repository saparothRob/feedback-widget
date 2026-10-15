/**
 * @nerva/feedback-widget
 *
 * The conductor. Mirrors the server's `routes/_.fs`: this file composes the
 * pieces and owns the lifecycle, and holds no logic of its own worth testing.
 *
 *   bootstrap  -> which server contract, and what the operator configured
 *   recorder   -> rrweb behind a bounded buffer, started immediately
 *   trail      -> pages, clicks, errors and failed requests, kept per tab
 *   shell      -> one host element, one shadow root
 *   modal      -> the form
 *   transport  -> the only code that knows what the wire looks like
 */
import type { FeedbackHandle, FeedbackOptions, OutgoingReport, ThemeOptions, UserHint } from "./types.js";
import type { Draft, SubmitContext, SubmitResult } from "./transport/index.js";
import type { ShareWindow } from "./share.js";
import { bootstrap, mergeTheme, normaliseEndpoint } from "./config.js";
import { startRecorder, type Recorder } from "./recorder.js";
import { startTrail } from "./trail-web.js";
import { momentAt, within } from "./trail.js";
import { fullWindow, summarise } from "./share.js";
import { SLOTS, claimTabSession, clearSlot } from "./tab.js";
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
    clearUser: () => undefined,
    setMetadata: () => undefined,
    setTheme: () => undefined,
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
  const [{ transport: kind, config }, tab] = await Promise.all([bootstrap({ ...opts, endpoint }), claimTabSession(opts.publicKey)]);

  // A disabled widget mounts no DOM at all - not a hidden button, nothing. An
  // operator switching it off should be indistinguishable from never having
  // embedded it.
  if (!config.enabled) {
    tab.release();
    return inertHandle("none");
  }

  let user: UserHint = { ...(opts.user ?? {}) };
  let metadata: Record<string, unknown> = { ...(opts.metadata ?? {}) };

  const transport = selectTransport(kind, { endpoint, publicKey: opts.publicKey });

  const sessionId = tab.id;
  const retentionMs = Math.max(config.trailMs, config.replay.lookbackMs);

  let recorder: Recorder | null = null;
  if (config.replay.enabled) {
    recorder = startRecorder({
      publicKey: opts.publicKey,
      lookbackMs: config.replay.lookbackMs,
      retentionMs,
      sessionId,
      endpoint,
      replay: opts.replay ?? {},
      console: { ...(opts.console ?? {}), enabled: config.capture.console },
      network: { ...(opts.network ?? {}), enabled: config.capture.network },
    });
  }

  const trail = startTrail({
    publicKey: opts.publicKey,
    endpoint,
    ttlMs: config.trailMs,
    ignoreUrls: opts.network?.ignoreUrls ?? [],
    ...(opts.replay?.maskTextSelector === undefined ? {} : { maskTextSelector: opts.replay.maskTextSelector }),
    ...(opts.replay?.blockSelector === undefined ? {} : { blockSelector: opts.replay.blockSelector }),
  });

  const context = (span: ShareWindow): SubmitContext => {
    const now = Date.now();
    const entries = trail.entries();
    const events = recorder?.flush(span.replayMs) ?? [];
    return {
      sessionId,
      replayStartedAt: events[0]?.ts ?? null,
      events,
      trail: within(entries, span.trailMs, now),
      momentAt: momentAt(entries, span.replayMs, now),
      user,
      metadata,
      pageUrl: location.href,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      config,
    };
  };

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
    momentAt: ctx.momentAt,
    trailEntryCount: ctx.trail.length,
  });

  const shell = createShell(config, () => modal.open());

  const modal = createModal({
    config,
    fieldsHost: { endpoint, publicKey: opts.publicKey },
    hostElement: shell.host,
    screenshotMode: opts.screenshot ?? "dom",
    knownEmail: () => user.email ?? null,
    summarise: (span: ShareWindow) => {
      const now = Date.now();
      const started = recorder?.startedAt() ?? null;
      return summarise(trail.entries(), span, now, started === null ? null : now - started);
    },
    async submit(draft: Draft): Promise<SubmitResult> {
      const ctx = context(draft.shareWindow);

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
    timer = window.setInterval(() => flush(context(fullWindow(config)), false), interval);
    unloadHandler = () => flush(context(fullWindow(config)), true);
    // `pagehide` fires on the bfcache path where `beforeunload` does not.
    window.addEventListener("pagehide", unloadHandler);
  }

  return {
    open: () => modal.open(),
    close: () => modal.close(),
    identify: (next: UserHint) => {
      user = { ...user, ...next };
    },
    clearUser: () => {
      user = {};
    },
    setMetadata: (next: Record<string, unknown>) => {
      metadata = { ...metadata, ...next };
    },
    setTheme: (theme: Partial<ThemeOptions>) => {
      config.theme = mergeTheme(config.theme, theme);
      shell.applyTheme(config.theme);
      modal.applyTheme();
    },
    destroy: () => {
      if (timer !== undefined) window.clearInterval(timer);
      if (unloadHandler) window.removeEventListener("pagehide", unloadHandler);
      trail.stop();
      recorder?.stop();
      tab.release();
      clearSlot(opts.publicKey, SLOTS.session);
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
export type { WireEvent, ConsoleEntry, NetworkEntry, TrailEntry, TrailKind } from "./wire.js";

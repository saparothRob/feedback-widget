/**
 * Headless Nerva feedback client for React Native / Expo.
 *
 * The react-native face of `mountFeedback`, minus everything a mobile runtime
 * cannot do: no rrweb replay, no shadow-DOM shell, no html2canvas. What is left
 * is exactly the shared core - the bootstrap probe (v1 config route, 404 →
 * legacy), the resolved server config, and the same transports posting the
 * same wire shapes - plus console/network taps standing in for the recorder.
 *
 * This module imports react (and react-native's UI) not at all; the ready-made
 * `<FeedbackSheet>` / `<FeedbackLauncher>` sit on top of it in `sheet.tsx` and
 * `launcher.tsx`.
 */
import type { FeedbackOptions, ResolvedConfig, UserHint } from "../types.js";
import type { Draft, SubmitContext, SubmitResult } from "../transport/index.js";
import type { WireEvent } from "../wire.js";
import type { Tap } from "./taps.js";
import { bootstrap, normaliseEndpoint } from "../config.js";
import { selectTransport } from "../transport/index.js";
import { tapConsole, tapFetch } from "./taps.js";
import { DEFAULT_SCREEN_NAME, newSessionId, pageUrlFor, userAgent, viewport } from "./environment.js";

declare const __WIDGET_VERSION__: string;
const VERSION: string = typeof __WIDGET_VERSION__ === "string" ? __WIDGET_VERSION__ : "0.0.0";

/**
 * The host's rasteriser, e.g. react-native-view-shot's `captureScreen` wrapped
 * to return a data URL. The package depends on no native module; without this
 * callback, reports simply carry no screenshot.
 */
export type ScreenshotCapture = () => Promise<string | null>;

export interface FeedbackClientOptions
  extends Pick<
    FeedbackOptions,
    "endpoint" | "publicKey" | "user" | "metadata" | "theme" | "kinds" | "collectEmail" | "console" | "network"
  > {
  /** Name of the screen the person is on; reported as `app://{screenName}`. */
  screenName?: string;
  captureScreenshot?: ScreenshotCapture;
}

/** What the sheet (or the host's own UI) collects. No files: the legacy
 *  contract drops attachments, and mobile has no `File` to offer anyway. */
export interface FeedbackDraft {
  kind: string;
  title: string;
  message: string;
  email?: string | null;
  /** A data URL. Overrides the client-level `captureScreenshot` callback. */
  screenshot?: string | null;
}

export interface FeedbackClient {
  submit(draft: FeedbackDraft): Promise<SubmitResult>;
  identify(user: UserHint): void;
  setMetadata(metadata: Record<string, unknown>): void;
  /** Feed navigation changes here so reports name the right screen. */
  setScreen(name: string): void;
  /** Restores the patched console and fetch. The client is inert afterwards. */
  destroy(): void;
  readonly config: ResolvedConfig;
  /** `"v1"`, `"legacy"`, or `"none"` when the operator disabled the project. */
  readonly transport: string;
  readonly user: UserHint;
  readonly version: string;
}

const DISABLED_TRANSPORT = "none";

/** Parity with the web widget: a disabled project yields an inert client, so
 *  the host app never has to branch on whether feedback is switched on. */
function inertClient(config: ResolvedConfig, user: UserHint): FeedbackClient {
  return {
    submit: () => Promise.resolve({ id: null }),
    identify: () => undefined,
    setMetadata: () => undefined,
    setScreen: () => undefined,
    destroy: () => undefined,
    config,
    transport: DISABLED_TRANSPORT,
    user,
    version: VERSION,
  };
}

async function guardedScreenshot(capture: ScreenshotCapture): Promise<string | null> {
  try {
    return (await capture()) ?? null;
  } catch {
    /* a failed screenshot must not cost the report */
    return null;
  }
}

export async function createFeedbackClient(options: FeedbackClientOptions): Promise<FeedbackClient> {
  if (!options.publicKey) throw new Error("feedback-widget: publicKey is required");
  if (!options.endpoint) throw new Error("feedback-widget: endpoint is required");

  const endpoint = normaliseEndpoint(options.endpoint);
  const { transport: kind, config } = await bootstrap({ ...options, endpoint });

  let user: UserHint = { ...(options.user ?? {}) };
  let metadata: Record<string, unknown> = { ...(options.metadata ?? {}) };
  let screen = options.screenName ?? DEFAULT_SCREEN_NAME;

  if (!config.enabled) return inertClient(config, user);

  const transport = selectTransport(kind, { endpoint, publicKey: options.publicKey });
  const sessionId = newSessionId();
  const startedAt = Date.now();

  // The taps install after the bootstrap fetches, so the widget's own config
  // probes never appear in the breadcrumbs - and the ignore list keeps its
  // ingest traffic out from here on.
  const taps: Tap[] = [
    ...(config.capture.console ? [tapConsole(config.replay.lookbackMs)] : []),
    ...(config.capture.network
      ? [tapFetch({ endpoint, ignoreUrls: options.network?.ignoreUrls ?? [], lookbackMs: config.replay.lookbackMs })]
      : []),
  ];

  /** Merged, time-ordered, densely re-sequenced - the contract `seq` makes. */
  const breadcrumbs = (): WireEvent[] =>
    taps
      .flatMap((tap) => tap.events())
      .sort((a, b) => a.ts - b.ts)
      .map((event, seq) => ({ ...event, seq }));

  const context = (): SubmitContext => {
    const { width, height } = viewport();
    return {
      sessionId,
      replayStartedAt: startedAt,
      events: breadcrumbs(),
      user,
      metadata,
      pageUrl: pageUrlFor(screen),
      referrer: "",
      userAgent: userAgent(),
      viewportWidth: width,
      viewportHeight: height,
      config,
    };
  };

  return {
    async submit(draft: FeedbackDraft): Promise<SubmitResult> {
      const screenshot =
        draft.screenshot ?? (options.captureScreenshot ? await guardedScreenshot(options.captureScreenshot) : null);
      const wireDraft: Draft = {
        kind: draft.kind,
        title: draft.title,
        message: draft.message,
        email: draft.email ?? null,
        answers: {},
        files: [],
        screenshot,
      };
      return transport.submit(wireDraft, context());
    },
    identify(next: UserHint): void {
      user = { ...user, ...next };
    },
    setMetadata(next: Record<string, unknown>): void {
      metadata = { ...metadata, ...next };
    },
    setScreen(name: string): void {
      screen = name;
    },
    destroy(): void {
      for (const tap of taps) tap.restore();
      taps.length = 0;
    },
    config,
    transport: transport.kind,
    get user() {
      return user;
    },
    version: VERSION,
  };
}

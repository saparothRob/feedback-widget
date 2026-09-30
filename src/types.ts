/** Public surface of `@nerva/feedback-widget`. */
import type { V1CustomField } from "./wire.js";

export type ButtonPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export type ButtonShape = "circle" | "pill";
export type ButtonIcon = "chat" | "megaphone" | "bug" | "star" | "lightbulb" | "life-ring";

/**
 * `"nerva"` is the full Nerva register: Archivo display heading, IBM Plex Mono
 * eyebrow and telemetry, the suite's light/dark surfaces. `"plain"` strips the
 * brand voice back to a quiet system-font dialog for host apps that want the
 * widget to disappear into their own design.
 */
export type WidgetSkin = "nerva" | "plain";

/** `"auto"` follows the visitor's OS via `prefers-color-scheme`. */
export type WidgetColorScheme = "light" | "dark" | "auto";

export interface ThemeOptions {
  accent?: string;
  icon?: ButtonIcon;
  position?: ButtonPosition;
  buttonLabel?: string;
  buttonShape?: ButtonShape;
  buttonPulse?: boolean;
  skin?: WidgetSkin;
  colorScheme?: WidgetColorScheme;
  /** Panel corner radius in px, clamped to 0–24. Controls derive from it. */
  radius?: number;
  /** Eyebrow text above the dialog heading. Rendered uppercase by the skin. */
  brandName?: string;
  /** Small logo URL shown beside the eyebrow. Empty string for none. */
  brandLogo?: string;
  /** Body text of the sent confirmation. */
  successMessage?: string;
  /**
   * The `"nerva"` skin loads Archivo / IBM Plex from Google Fonts with a single
   * document-level stylesheet link. Set false on hosts whose CSP forbids it;
   * the skin then falls back to system faces.
   */
  loadFonts?: boolean;
}

export interface UserHint {
  /** The host app's own stable id for this person. */
  id?: string;
  email?: string;
  name?: string;
}

export interface ReplayOptions {
  enabled?: boolean;
  /**
   * `"on-submit"` (default) keeps the replay in a rolling in-memory buffer and
   * uploads it only when someone actually files a report - nothing about a
   * visitor who never clicks the button ever leaves their browser.
   *
   * `"continuous"` also flushes the session periodically and on unload, which is
   * what fills `feedback_sessions` for visitors who never submit. It is only
   * honoured on the legacy transport, because the v1 contract has nowhere to put
   * a session that has no report attached.
   */
  uploadMode?: "on-submit" | "continuous";
  /** Flush interval for `uploadMode: "continuous"`. Default 30s, floor 5s. */
  flushIntervalMs?: number;
  /** Rolling buffer length. Server config wins unless this is set. */
  lookbackMs?: number;
  maskAllInputs?: boolean;
  /** Extra CSS selector whose text is masked, on top of `.feedback-mask`. */
  maskTextSelector?: string;
  /** CSS selector whose subtree is not recorded at all. */
  blockSelector?: string;
  /** rrweb mousemove/scroll sampling. */
  sampling?: Record<string, unknown>;
}

export interface ConsoleOptions {
  enabled?: boolean;
  levels?: string[];
  lengthThreshold?: number;
  stringLengthLimit?: number;
}

export interface NetworkOptions {
  enabled?: boolean;
  ignoreUrls?: (string | RegExp)[];
  /**
   * Off by default and worth leaving off. Even when on, the recorder strips
   * `authorization`, `cookie`, `set-cookie` and any `x-*-token` header — see
   * `recorder.ts`. That stripping is not configurable.
   */
  recordHeaders?: boolean;
  /** Off by default. Request/response bodies are where the PII actually is. */
  recordBody?: boolean;
  recordInitialRequests?: boolean;
}

/** The payload handed to `onBeforeSend`, normalised across both transports. */
export interface OutgoingReport {
  kind: string;
  title: string;
  message: string;
  email: string | null;
  user: UserHint;
  pageUrl: string;
  userAgent: string;
  viewportWidth: number;
  viewportHeight: number;
  screenshot: string | null;
  metadata: Record<string, unknown>;
  customFields: Record<string, unknown>;
  sessionId: string;
  replayStartedAt: number | null;
  replayEventCount: number;
  attachmentCount: number;
}

export interface FeedbackOptions {
  /** Origin of the Nerva server, e.g. `https://acme.nervaapp.com`. No trailing slash. */
  endpoint: string;
  /** The feedback project's public key (`feedback_projects.api_key`). */
  publicKey: string;

  user?: UserHint;
  /** Arbitrary JSON stored verbatim alongside the report. */
  metadata?: Record<string, unknown>;

  theme?: ThemeOptions;
  replay?: ReplayOptions;
  console?: ConsoleOptions;
  network?: NetworkOptions;

  /** Overrides the server's kind list. Must be a subset the server accepts. */
  kinds?: string[];
  /** `"dom"` needs the optional `html2canvas` peer; without it, manual attach only. */
  screenshot?: "dom" | "none";
  /** Show the email input for anonymous submitters. Ignored when `user.email` is set. */
  collectEmail?: boolean;
  /** Allow file attachments. Only reaches the server on the v1 transport. */
  attachments?: boolean;

  /** Return `false` to cancel the send, or a modified report to alter it. */
  onBeforeSend?: (report: OutgoingReport) => OutgoingReport | false;
  onSubmitted?: (result: { id: string | null }) => void;
  onError?: (error: Error) => void;
}

export interface FeedbackHandle {
  open(): void;
  close(): void;
  identify(user: UserHint): void;
  setMetadata(metadata: Record<string, unknown>): void;
  destroy(): void;
  /** `"v1"`, `"legacy"`, or `"none"` when the widget mounted nothing. */
  readonly transport: string;
  readonly version: string;
}

/** Resolved runtime config: server bootstrap merged with host options. */
export interface ResolvedConfig {
  enabled: boolean;
  theme: Required<ThemeOptions>;
  capture: { console: boolean; network: boolean };
  replay: { enabled: boolean; lookbackMs: number };
  kinds: string[];
  customFields: V1CustomField[];
  collectEmail: boolean;
  attachments: boolean;
  supportsChunks: boolean;
}

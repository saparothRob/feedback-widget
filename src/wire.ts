/**
 * Wire contracts.
 *
 * Nerva ideal #1: shapes are mirrored on the wire, never re-invented at the call
 * site. Two contracts live here because the widget talks to two generations of
 * the server (see `transport/`):
 *
 *  - `legacy`  mirrors `src/server/vals/feedback.val` in the Nerva repo. camelCase
 *              on the wire, because that is what parsegen emits from the `.val`.
 *              KEEP IN SYNC BY HAND — this package is deliberately outside the
 *              parsegen build, so a `.val` edit will not break this file at
 *              compile time. It will break at runtime.
 *
 *  - `v1`      the newer public contract. snake_case on the wire.
 *
 * Nothing below is a DB row type. Rows stay on the server.
 */

// ── Shared primitives ────────────────────────────────────────────────────────

/** One rrweb event, flattened to the shape both contracts transport. */
export interface WireEvent {
  seq: number;
  ts: number;
  type: number;
  data: unknown;
}

export interface ConsoleEntry {
  ts: number;
  level: string;
  args: string[];
  trace: string[];
}

export interface NetworkEntry {
  ts: number;
  url: string;
  method: string;
  status: number | null;
  duration: number | null;
  initiator: string | null;
}

// ── legacy: POST /api/feedback-collect/session  (@SessionIngest) ─────────────

export interface LegacySessionIngest {
  sessionKey: string;
  userIdExt: string;
  userEmail: string;
  userName: string;
  pageUrl: string;
  referrer: string;
  viewportWidth: number | null;
  viewportHeight: number | null;
  userAgent: string;
  /** JSON-encoded `WireEvent[]`. The column is jsonb but the `.val` field is a string. */
  events: string;
  /** JSON-encoded `ConsoleEntry[]`. */
  consoleLogs: string;
  /** JSON-encoded `NetworkEntry[]`. */
  networkLogs: string;
  durationSeconds: number | null;
}

// ── legacy: POST /api/feedback-collect/item  (@FeedbackItemCreate) ───────────

/** `feedback_items.type` CHECK constraint. */
export const LEGACY_KINDS = ["feedback", "bug", "idea", "praise"] as const;
export type LegacyKind = (typeof LEGACY_KINDS)[number];

export interface LegacyItemCreate {
  sessionKey: string;
  itemType: string;
  title: string;
  description: string;
  pageUrl: string;
  userEmail: string;
  userName: string;
  /** Data URL, or "" for none. */
  screenshotData: string;
  /** JSON-encoded object. */
  metadata: string;
}

// ── legacy: GET /api/feedback-collect/config ─────────────────────────────────

/** camelCase, like the rest of the legacy contract. 404 on an unknown key. */
export interface LegacyWidgetConfig {
  enabled: boolean;
  accentColor: string;
  icon: string;
  position: string;
  buttonLabel: string;
  buttonShape: string;
  buttonPulse: boolean;
  captureConsole: boolean;
  captureNetwork: boolean;
  replayLookbackSeconds: number;
  collectEmail: boolean;
  kinds: string[];
}

// ── v1: GET /api/v1/feedback-widgets/by-key/{key}/config ─────────────────────

export const V1_KINDS = ["bug", "idea", "question", "praise"] as const;
export type V1Kind = (typeof V1_KINDS)[number];

export const FIELD_TYPES = ["text", "number", "select", "user", "bool", "date"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface V1CustomField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  /** Empty means "applies to every kind". */
  kinds: string[];
  options_source?: string;
  jira_field_id?: string;
}

export interface V1WidgetConfig {
  enabled: boolean;
  accent_color: string;
  icon: string;
  position: string;
  button_label: string;
  button_shape: string;
  button_pulse: boolean;
  capture_console: boolean;
  capture_network: boolean;
  replay_lookback_seconds: number;
  custom_fields: V1CustomField[];
  supports_replay_chunks?: boolean;
  kinds?: string[];
}

// ── v1: POST /api/v1/feedback/ingest ─────────────────────────────────────────

export interface V1Submission {
  kind: string;
  title: string;
  message: string;
  submitter_name: string | null;
  submitter_email: string | null;
  submitter_id: string | null;
  page_url: string;
  user_agent: string;
  viewport_width: number;
  viewport_height: number;
  screenshot: string | null;
  metadata: Record<string, unknown>;
  session_id: string;
  replay_started_at: string | null;
  custom_fields: Record<string, unknown>;
  replay_pending?: boolean;
  replay_events: WireEvent[];
}

export interface V1IngestResponse {
  id: string;
}

export interface V1ReplayChunk {
  seq_offset: number;
  events: WireEvent[];
}

/** `{ error, detail? }` — the shared error body on every public route. */
export interface WireError {
  error?: string;
  detail?: string;
  max?: number;
}

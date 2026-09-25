/**
 * Bootstrap.
 *
 * Nerva ideal #8: behaviour is data-driven from the server, not compiled into
 * the host app. Theme, capture toggles, kind list and the custom-field schema
 * are fetched at mount so an operator can change the widget without anyone
 * redeploying the app it is embedded in. Host options still win per-field -
 * they are the things only the host app knows.
 *
 * The probe also decides which wire contract is in play. A server that answers
 * the v1 config route speaks v1; anything else (404, 501, network refusal) is
 * assumed to be the legacy `/api/feedback-collect/*` generation, which has no
 * public config route at all and therefore runs on defaults plus host options.
 */
import type { FeedbackOptions, ResolvedConfig } from "./types.js";
import type { V1CustomField, V1WidgetConfig } from "./wire.js";
import { LEGACY_KINDS, V1_KINDS } from "./wire.js";
import { getJsonOrNull } from "./transport/http.js";

export type TransportKind = "v1" | "legacy";

export interface Bootstrap {
  transport: TransportKind;
  config: ResolvedConfig;
}

const POSITIONS = new Set(["bottom-right", "bottom-left", "top-right", "top-left"]);
const ICONS = new Set(["chat", "megaphone", "bug", "star", "lightbulb", "life-ring"]);
const SHAPES = new Set(["circle", "pill"]);
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const DEFAULTS = {
  accent: "#7c3aed",
  icon: "chat",
  position: "bottom-right",
  buttonLabel: "Feedback",
  buttonShape: "circle",
  buttonPulse: false,
  lookbackSeconds: 60,
} as const;

/** Clamped the same way the server clamps it, so the two cannot disagree. */
function lookbackMs(seconds: number | undefined): number {
  const s = typeof seconds === "number" && seconds > 0 ? Math.min(3600, seconds) : DEFAULTS.lookbackSeconds;
  return s * 1000;
}

function pick<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === "string" && allowed.has(value) ? (value as T) : fallback;
}

function legacyConfig(opts: FeedbackOptions): ResolvedConfig {
  const theme = opts.theme ?? {};
  return {
    enabled: true,
    theme: {
      accent: theme.accent && HEX.test(theme.accent) ? theme.accent : DEFAULTS.accent,
      icon: pick(theme.icon, ICONS, DEFAULTS.icon),
      position: pick(theme.position, POSITIONS, DEFAULTS.position),
      buttonLabel: (theme.buttonLabel ?? DEFAULTS.buttonLabel).slice(0, 32),
      buttonShape: pick(theme.buttonShape, SHAPES, DEFAULTS.buttonShape),
      buttonPulse: theme.buttonPulse ?? DEFAULTS.buttonPulse,
    },
    capture: {
      console: opts.console?.enabled ?? true,
      network: opts.network?.enabled ?? true,
    },
    replay: {
      enabled: opts.replay?.enabled ?? true,
      lookbackMs: opts.replay?.lookbackMs ?? lookbackMs(undefined),
    },
    kinds: opts.kinds ?? [...LEGACY_KINDS],
    // The legacy server has no custom-field schema, so there is nothing to
    // render and nothing that would survive the round trip if there were.
    customFields: [],
    collectEmail: opts.collectEmail ?? true,
    // `feedback_items` has no attachment table; files would have nowhere to land.
    attachments: false,
    supportsChunks: false,
  };
}

function sanitiseFields(raw: unknown): V1CustomField[] {
  if (!Array.isArray(raw)) return [];
  const out: V1CustomField[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const f = item as Partial<V1CustomField>;
    if (typeof f.key !== "string" || typeof f.label !== "string" || typeof f.type !== "string") continue;
    out.push({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required === true,
      options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === "string") : [],
      kinds: Array.isArray(f.kinds) ? f.kinds.filter((k): k is string => typeof k === "string") : [],
    });
  }
  return out;
}

function v1Config(remote: V1WidgetConfig, opts: FeedbackOptions): ResolvedConfig {
  const theme = opts.theme ?? {};
  return {
    enabled: remote.enabled !== false,
    theme: {
      accent: theme.accent ?? (HEX.test(remote.accent_color ?? "") ? remote.accent_color : DEFAULTS.accent),
      icon: theme.icon ?? pick(remote.icon, ICONS, DEFAULTS.icon),
      position: theme.position ?? pick(remote.position, POSITIONS, DEFAULTS.position),
      buttonLabel: (theme.buttonLabel ?? remote.button_label ?? DEFAULTS.buttonLabel).slice(0, 32),
      buttonShape: theme.buttonShape ?? pick(remote.button_shape, SHAPES, DEFAULTS.buttonShape),
      buttonPulse: theme.buttonPulse ?? remote.button_pulse === true,
    },
    capture: {
      console: opts.console?.enabled ?? remote.capture_console !== false,
      network: opts.network?.enabled ?? remote.capture_network !== false,
    },
    replay: {
      enabled: opts.replay?.enabled ?? true,
      lookbackMs: opts.replay?.lookbackMs ?? lookbackMs(remote.replay_lookback_seconds),
    },
    kinds: opts.kinds ?? (Array.isArray(remote.kinds) && remote.kinds.length > 0 ? remote.kinds : [...V1_KINDS]),
    customFields: sanitiseFields(remote.custom_fields),
    collectEmail: opts.collectEmail ?? true,
    attachments: opts.attachments ?? true,
    supportsChunks: remote.supports_replay_chunks === true,
  };
}

export async function bootstrap(opts: FeedbackOptions): Promise<Bootstrap> {
  const url = `${opts.endpoint}/api/v1/feedback-widgets/by-key/${encodeURIComponent(opts.publicKey)}/config`;
  const remote = await getJsonOrNull<V1WidgetConfig>(url, opts.publicKey);
  return remote === null
    ? { transport: "legacy", config: legacyConfig(opts) }
    : { transport: "v1", config: v1Config(remote, opts) };
}

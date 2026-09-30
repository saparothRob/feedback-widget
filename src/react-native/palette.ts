/**
 * The web widget's surface tokens (`ui/styles.ts`), mirrored as flat colour
 * tables for react-native. KEEP IN SYNC BY HAND - there is no build step
 * joining the two, and the dialog should read as the same product on both.
 *
 * Skins and shapes are trait tables, not branches: rendering looks traits up
 * and never dispatches per skin.
 */
import type { ButtonPosition, ButtonShape, WidgetColorScheme, WidgetSkin } from "../types.js";

export interface Palette {
  bg: string;
  ground: string;
  input: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  borderStrong: string;
  danger: string;
  ok: string;
  scrim: string;
  onAccent: string;
}

export const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    bg: "#FFFFFF",
    ground: "#F1F4F8",
    input: "#FBFCFE",
    text: "#0F1725",
    muted: "#44506A",
    faint: "#626E86",
    border: "rgba(20, 30, 48, 0.18)",
    borderStrong: "rgba(20, 30, 48, 0.46)",
    danger: "#C1121F",
    ok: "#1E8E52",
    scrim: "rgba(16, 20, 32, 0.38)",
    onAccent: "#FFFFFF",
  },
  dark: {
    bg: "#14181F",
    ground: "#191E27",
    input: "#0F131A",
    text: "#E6EAF0",
    muted: "rgba(230, 234, 240, 0.62)",
    faint: "rgba(230, 234, 240, 0.48)",
    border: "rgba(160, 172, 198, 0.14)",
    borderStrong: "rgba(160, 172, 198, 0.55)",
    danger: "#F0564A",
    ok: "#4ADE80",
    scrim: "rgba(0, 0, 0, 0.62)",
    onAccent: "#FFFFFF",
  },
};

const SCHEME_FALLBACK = "light";

/** `auto` follows the OS; the caller passes what `useColorScheme` reported. */
export function resolveScheme(
  configured: WidgetColorScheme,
  system: string | null | undefined,
): "light" | "dark" {
  const wanted = configured === "auto" ? (system ?? SCHEME_FALLBACK) : configured;
  return wanted === "dark" ? "dark" : SCHEME_FALLBACK;
}

export interface SkinTraits {
  /** The brand eyebrow line above the heading. */
  eyebrow: boolean;
  /** Micro-label treatment on field labels; the register's voice. */
  labelTransform: "uppercase" | "none";
  labelSpacing: number;
  /** Monospace eyebrow, standing in for IBM Plex Mono. */
  eyebrowMono: boolean;
}

export const SKIN_TRAITS: Record<WidgetSkin, SkinTraits> = {
  nerva: { eyebrow: true, labelTransform: "uppercase", labelSpacing: 1.1, eyebrowMono: true },
  plain: { eyebrow: false, labelTransform: "none", labelSpacing: 0, eyebrowMono: false },
};

export interface ShapeTraits {
  /** Pills carry the button label; circles carry the icon glyph alone. */
  showLabel: boolean;
}

export const SHAPE_TRAITS: Record<ButtonShape, ShapeTraits> = {
  circle: { showLabel: false },
  pill: { showLabel: true },
};

/** Text stand-ins for the web's SVG launcher glyphs; no icon dependency. */
export const ICON_GLYPHS: Record<string, string> = {
  chat: "💬",
  megaphone: "📣",
  bug: "🐞",
  star: "⭐",
  lightbulb: "💡",
  "life-ring": "🛟",
};

export const LAUNCHER_MARGIN = 24;

export const POSITION_STYLES: Record<ButtonPosition, { top?: number; bottom?: number; left?: number; right?: number }> = {
  "bottom-right": { bottom: LAUNCHER_MARGIN, right: LAUNCHER_MARGIN },
  "bottom-left": { bottom: LAUNCHER_MARGIN, left: LAUNCHER_MARGIN },
  "top-right": { top: LAUNCHER_MARGIN, right: LAUNCHER_MARGIN },
  "top-left": { top: LAUNCHER_MARGIN, left: LAUNCHER_MARGIN },
};

/** Controls derive from the panel radius the same way the CSS does:
 *  `max(4px, radius - 3px)`. */
const CONTROL_RADIUS_MIN = 4;
const CONTROL_RADIUS_DELTA = 3;

export function controlRadius(panelRadius: number): number {
  return Math.max(CONTROL_RADIUS_MIN, panelRadius - CONTROL_RADIUS_DELTA);
}

const SHORT_HEX_LENGTH = 4;
const LONG_HEX_LENGTH = 7;
const HEX_BASE = 16;
const HEX_PAIR = 2;

/** The accent wash behind a selected chip: 9% accent, like the CSS `--fb-wash`. */
export const WASH_ALPHA = 0x18;

/** react-native has no `color-mix()`; append an alpha byte to the accent hex. */
export function withAlpha(hex: string, alpha: number): string {
  const long =
    hex.length === SHORT_HEX_LENGTH
      ? `#${[...hex.slice(1)].map((c) => c + c).join("")}`
      : hex.slice(0, LONG_HEX_LENGTH);
  return `${long}${alpha.toString(HEX_BASE).padStart(HEX_PAIR, "0")}`;
}

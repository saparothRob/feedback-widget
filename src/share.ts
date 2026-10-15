import type { ResolvedConfig } from "./types.js";
import type { TrailEntry, TrailKind } from "./wire.js";
import { TRAIL_KINDS } from "./wire.js";
import { MAX_TITLE_LENGTH, TRIM_STEPS_MS } from "./limits.js";
import { latestMoment, within } from "./trail.js";

export interface ShareWindow {
  replayMs: number;
  trailMs: number;
}

export interface ShareSummary {
  replayMs: number | null;
  pages: number;
  errors: number;
  failed: number;
  moment: TrailEntry | null;
}

export function shareWindows(config: ResolvedConfig): [ShareWindow, ...ShareWindow[]] {
  const full: ShareWindow = { replayMs: config.replay.lookbackMs, trailMs: config.trailMs };
  return [
    full,
    ...TRIM_STEPS_MS.filter((ms) => ms < full.replayMs).map((ms) => ({ replayMs: ms, trailMs: ms })),
  ];
}

export const fullWindow = (config: ResolvedConfig): ShareWindow => shareWindows(config)[0];

const zeroCounts = (): Record<TrailKind, number> =>
  Object.fromEntries(TRAIL_KINDS.map((kind) => [kind, 0])) as Record<TrailKind, number>;

const countKinds = (entries: TrailEntry[]): Record<TrailKind, number> =>
  entries.reduce((counts, entry) => ({ ...counts, [entry.kind]: counts[entry.kind] + 1 }), zeroCounts());

export function summarise(entries: TrailEntry[], span: ShareWindow, now: number, recordedMs: number | null): ShareSummary {
  const sent = within(entries, span.trailMs, now);
  const counts = countKinds(sent);
  return {
    replayMs: recordedMs === null ? null : Math.min(span.replayMs, recordedMs),
    pages: Math.max(1, new Set(sent.filter((entry) => entry.kind === "nav").map((entry) => entry.label)).size),
    errors: counts.error,
    failed: counts["failed-request"],
    moment: latestMoment(within(entries, span.replayMs, now)),
  };
}

export function titleFor(title: string, message: string): string {
  const firstLine = message.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? "";
  return (title.trim() || firstLine).slice(0, MAX_TITLE_LENGTH);
}

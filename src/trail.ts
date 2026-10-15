import type { TrailEntry, TrailKind } from "./wire.js";
import { TRAIL_KINDS } from "./wire.js";
import { COPY, FORMAT } from "./copy.js";
import { SERVER_ERROR_MIN, TRAIL_DEDUPE_MS, TRAIL_LABEL_MAX, TRAIL_MAX_ENTRIES } from "./limits.js";
import { redactUrl, redactedPath } from "./redact.js";

export type TrailSink = (entry: TrailEntry) => void;

export const MOMENT_RANK: Record<TrailKind, number> = {
  nav: 0,
  click: 0,
  "rage-click": 1,
  error: 2,
  "failed-request": 2,
};

export const capLabel = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, TRAIL_LABEL_MAX);

export const isFailedStatus = (status: number | null): boolean => status === null || status >= SERVER_ERROR_MIN;

export function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export const errorEntry = (ts: number, message: string): TrailEntry => ({ ts, kind: "error", label: capLabel(message) });

export const failedRequestEntry = (ts: number, method: string, url: string, status: number | null): TrailEntry => ({
  ts,
  kind: "failed-request",
  label: capLabel(FORMAT.failedRequest(method, redactedPath(url, false), String(status ?? COPY.trailNetworkFailed))),
  detail: redactUrl(url),
});

export const within = (entries: TrailEntry[], windowMs: number, now: number): TrailEntry[] =>
  entries.filter((entry) => entry.ts >= now - windowMs && entry.ts <= now);

const outranks = (entry: TrailEntry, best: TrailEntry | null): boolean =>
  best === null
    ? MOMENT_RANK[entry.kind] > 0
    : MOMENT_RANK[entry.kind] > MOMENT_RANK[best.kind] ||
      (MOMENT_RANK[entry.kind] === MOMENT_RANK[best.kind] && entry.ts >= best.ts);

export const latestMoment = (entries: TrailEntry[]): TrailEntry | null =>
  entries.reduce<TrailEntry | null>((best, entry) => (outranks(entry, best) ? entry : best), null);

export const momentAt = (entries: TrailEntry[], windowMs: number, now: number): number =>
  latestMoment(within(entries, windowMs, now))?.ts ?? now;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const TRAIL_KIND_SET: ReadonlySet<string> = new Set<string>(TRAIL_KINDS);

export function isTrailEntry(value: unknown): value is TrailEntry {
  return (
    isRecord(value) &&
    typeof value.ts === "number" &&
    typeof value.label === "string" &&
    typeof value.kind === "string" &&
    TRAIL_KIND_SET.has(value.kind) &&
    (value.detail === undefined || typeof value.detail === "string")
  );
}

export interface TrailBuffer {
  push(entry: TrailEntry): void;
  entries(): TrailEntry[];
  clear(): void;
}

export function createTrailBuffer(ttlMs: number, initial: TrailEntry[] = [], onChange: () => void = () => undefined): TrailBuffer {
  const fresh = (list: TrailEntry[]): TrailEntry[] => {
    const cutoff = Date.now() - ttlMs;
    return list.filter((entry) => entry.ts >= cutoff).slice(-TRAIL_MAX_ENTRIES);
  };
  let items = fresh(initial);

  return {
    push(entry: TrailEntry): void {
      const last = items[items.length - 1];
      const repeat =
        last !== undefined && last.kind === entry.kind && last.label === entry.label && entry.ts - last.ts < TRAIL_DEDUPE_MS;
      if (repeat) return;
      items = fresh([...items, entry]);
      onChange();
    },
    entries: () => fresh(items),
    clear(): void {
      items = [];
      onChange();
    },
  };
}

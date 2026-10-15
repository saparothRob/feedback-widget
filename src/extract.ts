/**
 * Console and network entries ride inside the replay as rrweb plugin events
 * (`type: 6`), keyed by `data.plugin`. Splitting them out client-side keeps them
 * off the wire as separate fields on the v1 contract - and lets the legacy
 * transport, whose server does want separate `consoleLogs` / `networkLogs`
 * columns, fill them from the same single source.
 *
 * The admin replay viewer should use this same function so the two never
 * disagree about what counts as a console line.
 */
import type { ConsoleEntry, NetworkEntry, WireEvent } from "./wire.js";
import { DEFAULT_METHOD } from "./requests.js";

/** Plugin identifiers as rrweb writes them into `event.data.plugin`. Exported
 *  so the react-native taps, which synthesise these events without rrweb, can
 *  never drift from what this extractor matches. */
export const CONSOLE_PLUGIN = "rrweb/console@1";
export const NETWORK_PLUGIN = "rrweb/network@1";

/** rrweb's `EventType.Plugin`, mirrored as a literal so this module - and the
 *  react-native entry that shares it - never has to import rrweb for one enum. */
export const PLUGIN_EVENT_TYPE = 6;

const DEFAULT_LEVEL = "log";
const EPOCH_FLOOR_MS = Date.UTC(2001, 0, 1);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v) ?? String(v)));
}

function num(value: unknown, fallback: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function epoch(value: unknown, fallback: number): number {
  const stamp = num(value, null);
  return stamp !== null && stamp >= EPOCH_FLOOR_MS ? stamp : fallback;
}

function span(start: unknown, end: unknown): number | null {
  const from = num(start, null);
  const to = num(end, null);
  return from === null || to === null ? null : to - from;
}

export interface Extracted {
  console: ConsoleEntry[];
  network: NetworkEntry[];
}

export function extractConsoleAndNetwork(events: WireEvent[]): Extracted {
  const consoleEntries: ConsoleEntry[] = [];
  const networkEntries: NetworkEntry[] = [];

  for (const event of events) {
    if (!isRecord(event.data)) continue;
    const plugin = str(event.data.plugin, "");
    if (plugin === "") continue;
    const payload = isRecord(event.data.payload) ? event.data.payload : {};

    if (plugin === CONSOLE_PLUGIN) {
      consoleEntries.push({
        ts: event.ts,
        level: str(payload.level, DEFAULT_LEVEL),
        args: toStringArray(payload.payload),
        trace: toStringArray(payload.trace),
      });
      continue;
    }

    if (plugin === NETWORK_PLUGIN) {
      const requests = Array.isArray(payload.requests) ? payload.requests : [];
      for (const raw of requests) {
        if (!isRecord(raw)) continue;
        networkEntries.push({
          ts: epoch(raw.startTime, event.ts),
          url: str(raw.name, ""),
          method: str(raw.method, DEFAULT_METHOD).toUpperCase(),
          status: num(raw.status, null),
          duration: num(raw.duration, span(raw.startTime, raw.endTime)),
          initiator: typeof raw.initiatorType === "string" ? raw.initiatorType : null,
        });
      }
    }
  }

  return { console: consoleEntries, network: networkEntries };
}

/** Events the replayer can actually render. Plugin events are data, not DOM. */
export function playableEvents(events: WireEvent[]): WireEvent[] {
  return events.filter((e) => e.type !== PLUGIN_EVENT_TYPE);
}

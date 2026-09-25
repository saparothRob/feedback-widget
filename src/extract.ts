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

const CONSOLE_PLUGIN = "rrweb/console@1";
const NETWORK_PLUGIN = "rrweb/network@1";

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
        level: str(payload.level, "log"),
        args: toStringArray(payload.payload),
        trace: toStringArray(payload.trace),
      });
      continue;
    }

    if (plugin === NETWORK_PLUGIN) {
      const requests = Array.isArray(payload.requests) ? payload.requests : [];
      for (const raw of requests) {
        if (!isRecord(raw)) continue;
        const start = num(raw.startTime, event.ts) ?? event.ts;
        const end = num(raw.endTime, null);
        networkEntries.push({
          ts: start,
          url: str(raw.name, ""),
          method: str(raw.method, "GET").toUpperCase(),
          status: num(raw.status, null),
          duration: num(raw.duration, end === null ? null : end - start),
          initiator: typeof raw.initiatorType === "string" ? raw.initiatorType : null,
        });
      }
    }
  }

  return { console: consoleEntries, network: networkEntries };
}

/** Events the replayer can actually render. Plugin events are data, not DOM. */
export function playableEvents(events: WireEvent[]): WireEvent[] {
  return events.filter((e) => e.type !== 6);
}

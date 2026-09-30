/**
 * Capture without rrweb.
 *
 * React Native has no DOM to record, so there is no replay - but console
 * output and network activity are still worth attaching to a report. Each tap
 * keeps a rolling buffer and emits it in the same rrweb plugin-event shape the
 * web recorder produces, so the transports and `extract.ts` split them into
 * the session's `consoleLogs` / `networkLogs` columns identically on both
 * platforms - and the playable-event filter leaves the `events` column empty,
 * which is the truth: mobile sends no replay.
 *
 * Nothing in a tap may ever break the host app: wrappers always call through
 * to the original, and recording failures are swallowed.
 */
import type { WireEvent } from "../wire.js";
import { ingestIgnoreList } from "../wire.js";
import { CONSOLE_PLUGIN, NETWORK_PLUGIN, PLUGIN_EVENT_TYPE } from "../extract.js";
import { redactUrl } from "../redact.js";

export interface Tap {
  /** Snapshot the buffer as plugin events. `seq` is assigned by the caller. */
  events(): WireEvent[];
  /** Put the patched global back exactly as it was found. */
  restore(): void;
}

/** Mirrors the web console plugin's default record cap and string limit. */
const CONSOLE_BUFFER_LIMIT = 200;
const CONSOLE_ARG_LIMIT = 1_000;
const NETWORK_BUFFER_LIMIT = 200;
const DEFAULT_METHOD = "GET";

/** What the rrweb network plugin reports for fetch traffic; mirrored on the wire. */
const FETCH_INITIATOR = "fetch";

const PLACEHOLDER_SEQ = 0;

interface Stamped {
  ts: number;
}

/** Bounded by count here and by the lookback window at snapshot time, so the
 *  buffer honours the same "recent activity only" promise the web replay makes. */
function ringBuffer<T extends Stamped>(limit: number, lookbackMs: number) {
  let items: T[] = [];
  return {
    push(item: T): void {
      items.push(item);
      if (items.length > limit) items = items.slice(-limit);
    },
    snapshot(): T[] {
      const cutoff = Date.now() - lookbackMs;
      return items.filter((item) => item.ts >= cutoff);
    },
  };
}

// ── Console ──────────────────────────────────────────────────────────────────

const CONSOLE_LEVELS = ["log", "info", "warn", "error"] as const;
type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];
type ConsoleMethod = (...args: unknown[]) => void;

interface ConsoleRecord extends Stamped {
  level: string;
  args: string[];
}

function stringifyArg(value: unknown): string {
  if (typeof value === "string") return value.slice(0, CONSOLE_ARG_LIMIT);
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, CONSOLE_ARG_LIMIT);
  } catch {
    return String(value).slice(0, CONSOLE_ARG_LIMIT);
  }
}

const consoleEvent = (record: ConsoleRecord): WireEvent => ({
  seq: PLACEHOLDER_SEQ,
  ts: record.ts,
  type: PLUGIN_EVENT_TYPE,
  data: {
    plugin: CONSOLE_PLUGIN,
    payload: { level: record.level, payload: record.args, trace: [] },
  },
});

export function tapConsole(lookbackMs: number): Tap {
  const buffer = ringBuffer<ConsoleRecord>(CONSOLE_BUFFER_LIMIT, lookbackMs);
  const host: Record<ConsoleLevel, ConsoleMethod> = console;
  const originals = new Map<ConsoleLevel, ConsoleMethod>();

  for (const level of CONSOLE_LEVELS) {
    const original = host[level];
    originals.set(level, original);
    host[level] = (...args: unknown[]): void => {
      try {
        buffer.push({ ts: Date.now(), level, args: args.map(stringifyArg) });
      } catch {
        /* a full or hostile arg must not cost the app its console */
      }
      original.apply(console, args);
    };
  }

  return {
    events: () => buffer.snapshot().map(consoleEvent),
    restore: () => {
      for (const [level, original] of originals) host[level] = original;
    },
  };
}

// ── Network ──────────────────────────────────────────────────────────────────

interface NetworkRecord extends Stamped {
  url: string;
  method: string;
  status: number | null;
  duration: number;
}

export interface FetchTapOptions {
  endpoint: string;
  ignoreUrls: (string | RegExp)[];
  lookbackMs: number;
}

const matchesAny = (url: string, patterns: (string | RegExp)[]): boolean =>
  patterns.some((p) => (typeof p === "string" ? url.includes(p) : p.test(url)));

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const methodOf = (input: RequestInfo | URL, init: RequestInit | undefined): string =>
  (init?.method ?? (typeof input === "object" && "method" in input ? input.method : DEFAULT_METHOD)).toUpperCase();

const networkEvent = (record: NetworkRecord): WireEvent => ({
  seq: PLACEHOLDER_SEQ,
  ts: record.ts,
  type: PLUGIN_EVENT_TYPE,
  data: {
    plugin: NETWORK_PLUGIN,
    payload: {
      requests: [
        {
          name: record.url,
          method: record.method,
          status: record.status,
          startTime: record.ts,
          endTime: record.ts + record.duration,
          duration: record.duration,
          initiatorType: FETCH_INITIATOR,
        },
      ],
    },
  },
});

export function tapFetch(opts: FetchTapOptions): Tap {
  const ignore = ingestIgnoreList(opts.endpoint, opts.ignoreUrls);
  const buffer = ringBuffer<NetworkRecord>(NETWORK_BUFFER_LIMIT, opts.lookbackMs);
  const original = globalThis.fetch;

  const push = (ts: number, url: string, method: string, status: number | null): void => {
    try {
      if (url === "" || matchesAny(url, ignore)) return;
      buffer.push({ ts, url: redactUrl(url), method, status, duration: Date.now() - ts });
    } catch {
      /* a recording fault must never surface as a network error */
    }
  };

  const wrapped: typeof fetch = async (input, init) => {
    const started = Date.now();
    const url = urlOf(input);
    const method = methodOf(input, init);
    try {
      const response = await original(input, init);
      push(started, url, method, response.status);
      return response;
    } catch (error) {
      push(started, url, method, null);
      throw error;
    }
  };

  globalThis.fetch = wrapped;

  return {
    events: () => buffer.snapshot().map(networkEvent),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

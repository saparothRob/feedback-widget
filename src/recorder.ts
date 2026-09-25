/**
 * Session recorder: rrweb behind a bounded buffer.
 *
 * The buffer is the whole design. A widget that lives for the life of a tab
 * cannot keep every event, and a naive "drop events older than N seconds" queue
 * eventually drops the full snapshot the replay is built from, leaving an
 * unplayable tail. So this uses rrweb's own checkout mechanism: ask rrweb to
 * emit a fresh full snapshot every `lookbackMs`, keep exactly two generations,
 * and drop the older one when a third arrives. Memory stays inside
 * [lookback, 2 x lookback), and whatever is flushed always begins with a
 * Meta + FullSnapshot pair.
 */
import { record, EventType } from "rrweb";
import type { eventWithTime } from "rrweb";
import { getRecordConsolePlugin } from "@rrweb/rrweb-plugin-console-record";
import { getRecordNetworkPlugin } from "@rrweb/rrweb-plugin-network-record";
import type { RecordPlugin, NetworkRequest } from "@rrweb/types";
import type { LogLevel } from "@rrweb/rrweb-plugin-console-record";
import type { ConsoleOptions, NetworkOptions, ReplayOptions } from "./types.js";
import type { WireEvent } from "./wire.js";
import { blockSelector, isForbiddenHeader, maskTextSelector, redactUrl } from "./redact.js";

export interface RecorderConfig {
  lookbackMs: number;
  /** Requests to this origin are never recorded, whatever the host configures. */
  endpoint: string;
  replay: ReplayOptions;
  console: ConsoleOptions & { enabled: boolean };
  network: NetworkOptions & { enabled: boolean };
}

export interface Recorder {
  /** Snapshot the buffer as wire events. Does not stop or clear the recorder. */
  flush(): WireEvent[];
  /** Timestamp of the oldest buffered event, or null when empty. */
  startedAt(): number | null;
  readonly sessionId: string;
  stop(): void;
}

/** Enough entropy to key a session without pulling in a uuid dependency. */
function newSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function matchesAny(url: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((p) => (typeof p === "string" ? url.includes(p) : p.test(url)));
}

function buildNetworkPlugin(cfg: RecorderConfig): RecordPlugin {
  const ignore: (string | RegExp)[] = [
    // Never record our own traffic. Without this the ingest POST - which carries
    // the entire replay - shows up inside the next replay, and each report is
    // meaningfully larger than the one before it.
    //
    // Match the feedback PATHS, not the endpoint origin. The host app and the
    // Nerva server are frequently the same origin (they are for Nerva's own
    // SPA), and ignoring the whole origin there would silently suppress every
    // request worth recording.
    `${cfg.endpoint}/api/feedback-collect/`,
    `${cfg.endpoint}/api/v1/feedback`,
    "/api/feedback-collect/",
    "/api/v1/feedback",
    ...(cfg.network.ignoreUrls ?? []),
  ];

  const wantHeaders = cfg.network.recordHeaders === true;

  return getRecordNetworkPlugin({
    recordHeaders: wantHeaders,
    recordBody: cfg.network.recordBody === true,
    recordInitialRequests: cfg.network.recordInitialRequests ?? false,
    /**
     * The single choke point every recorded request passes through. Returning
     * `undefined` drops the request entirely.
     */
    transformRequestFn: (request: NetworkRequest): NetworkRequest | undefined => {
      const url = typeof request.name === "string" ? request.name : "";
      if (url !== "" && matchesAny(url, ignore)) return undefined;

      const out: NetworkRequest = { ...request, name: redactUrl(url) };

      if (wantHeaders) {
        for (const slot of ["requestHeaders", "responseHeaders"] as const) {
          const headers = out[slot];
          if (!headers) continue;
          const kept: Record<string, string> = {};
          for (const [name, value] of Object.entries(headers)) {
            if (!isForbiddenHeader(name)) kept[name] = value;
          }
          out[slot] = kept;
        }
      } else {
        delete out.requestHeaders;
        delete out.responseHeaders;
      }

      if (cfg.network.recordBody !== true) {
        delete out.requestBody;
        delete out.responseBody;
      }
      return out;
    },
  });
}

export function startRecorder(cfg: RecorderConfig): Recorder {
  const sessionId = newSessionId();

  // Two generations of events. rrweb pushes a checkout every `lookbackMs`, at
  // which point the previous generation becomes droppable.
  let generations: eventWithTime[][] = [[]];

  const plugins: RecordPlugin[] = [];
  if (cfg.console.enabled) {
    plugins.push(
      getRecordConsolePlugin({
        level: (cfg.console.levels ?? ["log", "info", "warn", "error"]) as LogLevel[],
        lengthThreshold: cfg.console.lengthThreshold ?? 10_000,
        stringifyOptions: {
          stringLengthLimit: cfg.console.stringLengthLimit ?? 1_000,
          numOfKeysLimit: 50,
          depthOfLimit: 4,
        },
      }),
    );
  }
  if (cfg.network.enabled) plugins.push(buildNetworkPlugin(cfg));

  // `listenerHandler` is internal to rrweb, so the stop handle is typed by
  // what `record` actually returns.
  const stopFn: ReturnType<typeof record> = record({
    emit(event: eventWithTime, isCheckout?: boolean) {
      if (isCheckout === true) {
        generations.push([]);
        if (generations.length > 2) generations = generations.slice(-2);
      }
      const current = generations[generations.length - 1];
      if (current) current.push(event);
    },
    checkoutEveryNms: cfg.lookbackMs,
    maskAllInputs: cfg.replay.maskAllInputs ?? true,
    maskTextSelector: maskTextSelector(cfg.replay.maskTextSelector),
    blockSelector: blockSelector(cfg.replay.blockSelector),
    recordCanvas: false,
    collectFonts: false,
    inlineImages: false,
    sampling: { mousemove: 50, scroll: 150, media: 800, ...(cfg.replay.sampling ?? {}) },
    errorHandler: () => true, // a recorder fault must never break the host page
    ...(plugins.length > 0 ? { plugins } : {}),
  });

  const all = (): eventWithTime[] => generations.flat();

  return {
    sessionId,
    flush(): WireEvent[] {
      // `seq` is assigned here, at flush time, and the server orders by it.
      // rrweb backdates events when it merges a snapshot, so `ts` is not a
      // stable ordering and must never be used as one.
      return all().map((event, seq) => ({
        seq,
        ts: event.timestamp,
        type: event.type,
        data: event.data,
      }));
    },
    startedAt(): number | null {
      const first = all()[0];
      return first ? first.timestamp : null;
    },
    stop(): void {
      if (stopFn) stopFn();
      generations = [[]];
    },
  };
}

/** Re-exported so the transports and the admin UI agree on what "not playable" means. */
export const PLUGIN_EVENT_TYPE: number = EventType.Plugin;

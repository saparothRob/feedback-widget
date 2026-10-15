/**
 * Session recorder: rrweb behind a bounded, persistent buffer.
 *
 * The buffer is the whole design. A widget that lives for the life of a tab
 * cannot keep every event, and a naive "drop events older than N seconds" queue
 * eventually drops the full snapshot the replay is built from, leaving an
 * unplayable tail. So this uses rrweb's own checkout mechanism: ask rrweb to
 * emit a fresh full snapshot every checkout interval, keep enough generations
 * to cover the lookback, and drop the oldest first - by count, by age and by a
 * byte cap. Generations are mirrored into IndexedDB under the tab's session id,
 * in throttled batches, so a reload in the same tab resumes the history; with
 * no IndexedDB the buffer simply stays in memory. Whatever is flushed always
 * begins with a Meta + FullSnapshot pair.
 */
import { EventType, record } from "rrweb";
import type { eventWithTime } from "rrweb";
import { getRecordConsolePlugin } from "@rrweb/rrweb-plugin-console-record";
import { getRecordNetworkPlugin } from "@rrweb/rrweb-plugin-network-record";
import type { RecordPlugin, NetworkRequest } from "@rrweb/types";
import type { LogLevel } from "@rrweb/rrweb-plugin-console-record";
import type { ConsoleOptions, NetworkOptions, ReplayOptions } from "./types.js";
import type { WireEvent } from "./wire.js";
import { ingestIgnoreList } from "./wire.js";
import { blockSelector, isForbiddenHeader, maskTextSelector, redactUrl } from "./redact.js";
import { matchesAny } from "./requests.js";
import { CHECKOUT_EVERY_MS, PERSIST_THROTTLE_MS, REPLAY_BYTE_CAP } from "./limits.js";
import { openStore, type DroppedGeneration, type ReplayStore, type StoredChunk } from "./persist.js";

export interface RecorderConfig {
  lookbackMs: number;
  retentionMs: number;
  sessionId: string;
  /** Requests to this origin are never recorded, whatever the host configures. */
  endpoint: string;
  replay: ReplayOptions;
  console: ConsoleOptions & { enabled: boolean };
  network: NetworkOptions & { enabled: boolean };
}

export interface Recorder {
  /** Snapshot the buffer as wire events. Does not stop or clear the recorder. */
  flush(windowMs?: number): WireEvent[];
  /** Timestamp of the oldest buffered event, or null when empty. */
  startedAt(): number | null;
  readonly sessionId: string;
  stop(): void;
}

interface Generation {
  id: number;
  events: eventWithTime[];
  saved: number;
  parts: number;
  bytes: number;
}

function buildNetworkPlugin(cfg: RecorderConfig): RecordPlugin {
  // Never record our own traffic. Without this the ingest POST - which carries
  // the entire replay - shows up inside the next replay, and each report is
  // meaningfully larger than the one before it. The path-not-origin reasoning
  // lives with the list builder in `wire.ts`, shared with the react-native tap.
  const ignore = ingestIgnoreList(cfg.endpoint, cfg.network.ignoreUrls ?? []);

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

const startOf = (generation: Generation | undefined): number =>
  generation?.events[0]?.timestamp ?? Number.POSITIVE_INFINITY;

function restoredGenerations(chunks: StoredChunk[]): Generation[] {
  const byGen = new Map<number, StoredChunk[]>();
  for (const chunk of chunks) byGen.set(chunk.gen, [...(byGen.get(chunk.gen) ?? []), chunk]);
  return [...byGen].map(([id, parts]) => {
    const events = parts.flatMap((part) => part.events);
    return {
      id,
      events,
      saved: events.length,
      parts: Math.max(...parts.map((part) => part.part)),
      bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
    };
  });
}

export function startRecorder(cfg: RecorderConfig): Recorder {
  const { sessionId } = cfg;
  const checkoutMs = Math.min(CHECKOUT_EVERY_MS, cfg.lookbackMs);
  const keep = Math.ceil(cfg.lookbackMs / checkoutMs) + 1;

  let lastId = 0;
  const newGeneration = (): Generation => {
    lastId = Math.max(Date.now(), lastId + 1);
    return { id: lastId, events: [], saved: 0, parts: 0, bytes: 0 };
  };

  let generations: Generation[] = [newGeneration()];
  let dropped: number[] = [];
  let store: ReplayStore | null = null;
  let timer: number | undefined;
  let stopped = false;

  const totalBytes = (): number => generations.reduce((sum, g) => sum + g.bytes, 0);
  const overBudget = (now: number): boolean =>
    generations.length > 1 &&
    (generations.length > keep ||
      totalBytes() > REPLAY_BYTE_CAP ||
      startOf(generations[1]) < now - cfg.lookbackMs);

  const prune = (): void => {
    const now = Date.now();
    while (overBudget(now)) {
      const [oldest, ...rest] = generations;
      generations = rest;
      dropped = oldest === undefined ? dropped : [...dropped, oldest.id];
    }
  };

  const persist = (): void => {
    window.clearTimeout(timer);
    timer = undefined;
    const chunks: StoredChunk[] = [];
    const at = Date.now();
    for (const generation of generations.filter((g) => g.events.length > g.saved)) {
      const events = generation.events.slice(generation.saved);
      const bytes = JSON.stringify(events).length;
      generation.saved = generation.events.length;
      generation.parts += 1;
      generation.bytes += bytes;
      chunks.push({ tab: sessionId, gen: generation.id, part: generation.parts, at, bytes, events });
    }
    prune();
    const live = new Set(generations.map((g) => g.id));
    const drops: DroppedGeneration[] = dropped.map((gen) => ({ tab: sessionId, gen }));
    dropped = [];
    void store?.write(chunks.filter((chunk) => live.has(chunk.gen)), drops).catch(() => {
      store = null;
    });
  };

  const schedule = (): void => {
    if (timer === undefined && !stopped) timer = window.setTimeout(persist, PERSIST_THROTTLE_MS);
  };

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
        generations.push(newGeneration());
        prune();
      }
      generations[generations.length - 1]?.events.push(event);
      schedule();
    },
    checkoutEveryNms: checkoutMs,
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

  const restore = (chunks: StoredChunk[]): void => {
    const firstLive = generations[0]?.id ?? Number.POSITIVE_INFINITY;
    const restored = restoredGenerations(chunks);
    const playable = restored.filter((g) => g.events[0]?.type === EventType.Meta && g.id < firstLive);
    dropped = [...dropped, ...restored.filter((g) => !playable.includes(g)).map((g) => g.id)];
    generations = [...playable, ...generations];
    prune();
    schedule();
  };

  const attach = async (): Promise<void> => {
    const opened = await openStore();
    if (opened === null) return;
    await opened.purge(Date.now() - cfg.retentionMs);
    const chunks = await opened.load(sessionId);
    if (stopped) return opened.clear(sessionId);
    store = opened;
    restore(chunks);
  };
  void attach().catch(() => {
    store = null;
  });

  window.addEventListener("pagehide", persist);

  const filled = (): Generation[] => generations.filter((g) => g.events.length > 0);

  return {
    sessionId,
    flush(windowMs: number = Number.POSITIVE_INFINITY): WireEvent[] {
      // `seq` is assigned here, at flush time, and the server orders by it.
      // rrweb backdates events when it merges a snapshot, so `ts` is not a
      // stable ordering and must never be used as one.
      const cut = Date.now() - windowMs;
      const kept = filled();
      const from = kept.reduce((index, generation, i) => (startOf(generation) <= cut ? i : index), 0);
      return kept
        .slice(from)
        .flatMap((generation) => generation.events)
        .map((event, seq) => ({
          seq,
          ts: event.timestamp,
          type: event.type,
          data: event.data,
        }));
    },
    startedAt(): number | null {
      const first = filled()[0];
      return first ? startOf(first) : null;
    },
    stop(): void {
      stopped = true;
      if (stopFn) stopFn();
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", persist);
      generations = [newGeneration()];
      void store?.clear(sessionId).catch(() => undefined);
      store = null;
    },
  };
}

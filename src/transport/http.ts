/**
 * The one place that talks to the network.
 *
 * Unlike the Nerva client shim there is no camel/snake transform here: the two
 * server contracts disagree about casing (legacy is camelCase, v1 is snake_case)
 * and `wire.ts` already spells each one correctly. A global transform would only
 * be able to be right about one of them.
 */
import type { WireError } from "../wire.js";

export class FeedbackApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: WireError;

  constructor(message: string, status: number, body: WireError) {
    super(message);
    this.name = "FeedbackApiError";
    this.status = status;
    this.code = body.error ?? "";
    this.body = body;
  }
}

/** Below this, gzip costs more than it saves. */
const GZIP_THRESHOLD_BYTES = 64 * 1024;

const canGzip = (): boolean => typeof CompressionStream === "function";

async function gzipBytes(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function parseError(res: Response): Promise<FeedbackApiError> {
  let body: WireError = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed !== null && typeof parsed === "object") body = parsed;
  } catch {
    /* a non-JSON error body is still an error; the status carries the meaning */
  }
  const message = body.detail ?? body.error ?? `request failed (${res.status})`;
  return new FeedbackApiError(message, res.status, body);
}

export interface PostOptions {
  /** Skip compression even above the threshold (used for the small chunk posts). */
  noGzip?: boolean;
  signal?: AbortSignal;
}

/**
 * POST JSON, gzipping large bodies. rrweb JSON compresses 10-20x, which is what
 * keeps a full replay inside one request instead of the chunked protocol.
 */
export async function postJson<T>(
  url: string,
  key: string,
  body: unknown,
  opts: PostOptions = {},
): Promise<T> {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Feedback-Key": key,
  };

  // `string | ArrayBuffer` rather than the DOM-lib `BodyInit`: this module is
  // shared with the react-native entry, whose consumers may compile without
  // `lib.dom`, and both members are valid fetch bodies everywhere.
  let payload: string | ArrayBuffer = json;
  if (!opts.noGzip && json.length > GZIP_THRESHOLD_BYTES && canGzip()) {
    const bytes = await gzipBytes(json);
    // Copy into a fresh ArrayBuffer so the BodyInit type is exact regardless of
    // whether the view is backed by a SharedArrayBuffer.
    payload = bytes.slice().buffer;
    headers["Content-Encoding"] = "gzip";
  }

  const init: RequestInit = { method: "POST", headers, body: payload, credentials: "omit" };
  if (opts.signal) init.signal = opts.signal;

  const res = await fetch(url, init);
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A web `File`, typed structurally so no DOM-only name leaks into the
 *  declarations the react-native entry drags in. */
export type NamedBlob = Blob & { name: string };

/** POST one file as `multipart/form-data`, field name `file`. */
export async function postFile<T>(url: string, key: string, file: NamedBlob): Promise<T> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Feedback-Key": key },
    body: form,
    credentials: "omit",
  });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** GET JSON. Resolves to `null` on any non-2xx — callers treat that as "absent". */
export async function getJsonOrNull<T>(url: string, key: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-Feedback-Key": key },
      credentials: "omit",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * POST during page teardown.
 *
 * Deliberately NOT `navigator.sendBeacon`: a beacon cannot set request headers,
 * so it cannot carry `X-Feedback-Key` and the server rejects it as unkeyed.
 * `fetch` with `keepalive` survives unload and does carry headers, at the cost
 * of a ~64KB body cap - past that we fall back to a normal fetch and accept that
 * an unload may cut it short.
 */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

export function postOnUnload(url: string, key: string, body: unknown): void {
  const json = JSON.stringify(body);
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Feedback-Key": key },
    body: json,
    credentials: "omit",
  };
  if (json.length <= KEEPALIVE_MAX_BYTES) init.keepalive = true;
  void fetch(url, init).catch(() => {
    /* the page is going away; there is nobody left to tell */
  });
}

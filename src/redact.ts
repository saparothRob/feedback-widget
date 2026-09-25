/**
 * Redaction rules that are not configurable.
 *
 * These run at capture time, not at send time. A value that was never recorded
 * cannot leak through a bug in the uploader, a `onBeforeSend` the host forgot to
 * write, or an operator reading the replay later.
 */

/** Never recorded, even with `network.recordHeaders: true`. */
const FORBIDDEN_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-feedback-key",
  "x-csrf-token",
  "x-xsrf-token",
]);

/** Matches `x-…-token`, `x-…-key`, `x-…-secret` in any casing. */
const FORBIDDEN_HEADER_PATTERN = /^x-.*-(token|key|secret|auth)$/i;

export function isForbiddenHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return FORBIDDEN_HEADERS.has(lower) || FORBIDDEN_HEADER_PATTERN.test(lower);
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!isForbiddenHeader(name)) out[name] = value;
  }
  return out;
}

/**
 * Query-string values that carry credentials often enough to be worth blanking
 * wherever a URL is recorded.
 */
const SENSITIVE_QUERY_KEYS = /^(token|access_token|id_token|refresh_token|key|api_key|apikey|password|secret|signature|sig|code)$/i;

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw, typeof location !== "undefined" ? location.href : undefined);
    let touched = false;
    for (const name of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.test(name)) {
        url.searchParams.set(name, "[redacted]");
        touched = true;
      }
    }
    return touched ? url.toString() : raw;
  } catch {
    return raw;
  }
}

/** The opt-in class a host app puts on anything that must not be recorded. */
export const MASK_CLASS = "feedback-mask";
export const BLOCK_CLASS = "feedback-block";

/**
 * Default masking selector. `.feedback-mask` is the documented opt-in; the
 * `[data-feedback-mask]` attribute form exists for templates where adding a
 * class is awkward. Password inputs are handled by rrweb's `maskAllInputs`.
 */
export function maskTextSelector(extra?: string): string {
  const base = `.${MASK_CLASS},[data-feedback-mask]`;
  return extra && extra.trim() !== "" ? `${base},${extra}` : base;
}

export function blockSelector(extra?: string): string {
  const base = `.${BLOCK_CLASS},[data-feedback-block]`;
  return extra && extra.trim() !== "" ? `${base},${extra}` : base;
}

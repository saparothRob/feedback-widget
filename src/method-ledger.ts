import { DEFAULT_METHOD, methodOf, urlOf } from "./requests.js";

export interface MethodLedger {
  take(url: string, startedAt: number): string;
  stop(): void;
}

interface Sighting {
  url: string;
  at: number;
  method: string;
}

type XhrOpen = (this: XMLHttpRequest, ...args: [string, string | URL, ...unknown[]]) => void;
type XhrSend = (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;

const LEDGER_LIMIT = 200;

const absolute = (url: string): string => {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
};

const nearest = (sightings: Sighting[], url: string, at: number): Sighting | undefined =>
  sightings
    .filter((s) => s.url === url)
    .reduce<Sighting | undefined>((best, s) => (best === undefined || Math.abs(s.at - at) < Math.abs(best.at - at) ? s : best), undefined);

export function startMethodLedger(): MethodLedger {
  let sightings: Sighting[] = [];

  const note = (url: string, method: string): void => {
    try {
      sightings = [...sightings, { url: absolute(url), at: performance.now(), method }].slice(-LEDGER_LIMIT);
    } catch {
      return;
    }
  };

  const originalFetch = globalThis.fetch;
  const wrappedFetch: typeof fetch = (input, init) => {
    note(urlOf(input), methodOf(input, init));
    return originalFetch(input, init);
  };
  globalThis.fetch = wrappedFetch;

  const proto: { open: XhrOpen; send: XhrSend } = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const opened = new WeakMap<XMLHttpRequest, { url: string; method: string }>();

  const wrappedOpen: XhrOpen = function (...args) {
    opened.set(this, { url: String(args[1]), method: args[0].toUpperCase() });
    Reflect.apply(originalOpen, this, args);
  };
  const wrappedSend: XhrSend = function (body) {
    const request = opened.get(this);
    if (request !== undefined) note(request.url, request.method);
    originalSend.call(this, body);
  };
  proto.open = wrappedOpen;
  proto.send = wrappedSend;

  return {
    take(url: string, startedAt: number): string {
      const match = nearest(sightings, absolute(url), startedAt);
      sightings = sightings.filter((s) => s !== match);
      return match?.method ?? DEFAULT_METHOD;
    },
    stop(): void {
      if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
      if (proto.open === wrappedOpen) proto.open = originalOpen;
      if (proto.send === wrappedSend) proto.send = originalSend;
      sightings = [];
    },
  };
}

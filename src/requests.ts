export const DEFAULT_METHOD = "GET";

export const matchesAny = (url: string, patterns: (string | RegExp)[]): boolean =>
  patterns.some((p) => (typeof p === "string" ? url.includes(p) : p.test(url)));

export const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

export const methodOf = (input: RequestInfo | URL, init: RequestInit | undefined): string =>
  (init?.method ?? (typeof input === "object" && "method" in input ? input.method : DEFAULT_METHOD)).toUpperCase();

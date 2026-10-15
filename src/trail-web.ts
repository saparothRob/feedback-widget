import type { TrailEntry } from "./wire.js";
import { ingestIgnoreList } from "./wire.js";
import { COPY } from "./copy.js";
import { PERSIST_THROTTLE_MS, RAGE_CLICK_COUNT, RAGE_CLICK_WINDOW_MS, TRAIL_LABEL_MAX } from "./limits.js";
import { blockSelector, maskTextSelector, redactedPath } from "./redact.js";
import { matchesAny, methodOf, urlOf } from "./requests.js";
import { SLOTS, clearSlot, readSlot, writeSlot } from "./tab.js";
import {
  capLabel,
  createTrailBuffer,
  errorEntry,
  failedRequestEntry,
  isFailedStatus,
  isTrailEntry,
  messageOf,
} from "./trail.js";

export interface TrailConfig {
  publicKey: string;
  endpoint: string;
  ttlMs: number;
  ignoreUrls: (string | RegExp)[];
  maskTextSelector?: string;
  blockSelector?: string;
}

export interface TrailCapture {
  entries(): TrailEntry[];
  stop(): void;
}

type Uninstall = () => void;

interface SourceContext {
  record: (entry: TrailEntry) => void;
  privateSelector: string;
  ignore: (string | RegExp)[];
}

type Source = (ctx: SourceContext) => Uninstall;

const WIDGET_HOST = "[data-nerva-feedback]";
const CLICK_TARGETS =
  "button,a,summary,label,input,select,textarea,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=option]";
const FIELD_TAGS: ReadonlySet<string> = new Set(["INPUT", "SELECT", "TEXTAREA"]);
const PASSWORD_FIELDS = "input[type=password]";
const TEXT_SAMPLE = TRAIL_LABEL_MAX * 4;

const NAV_TRIGGERS = { load: "load", push: "push", replace: "replace", pop: "pop", hash: "hash" } as const;
type NavTrigger = (typeof NAV_TRIGGERS)[keyof typeof NAV_TRIGGERS];

type HistoryName = "pushState" | "replaceState";
type HistoryMethod = (this: History, ...args: Parameters<History["pushState"]>) => void;
type ConsoleMethod = (...args: unknown[]) => void;
type XhrOpen = (this: XMLHttpRequest, ...args: [string, string | URL, ...unknown[]]) => void;
type XhrSend = (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;

const HISTORY_METHODS: Record<HistoryName, NavTrigger> = {
  pushState: NAV_TRIGGERS.push,
  replaceState: NAV_TRIGGERS.replace,
};

const NAV_EVENTS: Record<"popstate" | "hashchange", NavTrigger> = {
  popstate: NAV_TRIGGERS.pop,
  hashchange: NAV_TRIGGERS.hash,
};

const XHR_OUTCOMES: Record<"load" | "error" | "timeout", (xhr: XMLHttpRequest) => number | null> = {
  load: (xhr) => xhr.status,
  error: () => null,
  timeout: () => null,
};

const guarded =
  <A extends unknown[]>(fn: (...args: A) => void) =>
  (...args: A): void => {
    try {
      fn(...args);
    } catch {
      return;
    }
  };


type LabelSource = (node: Element) => string;

const attr =
  (name: string): LabelSource =>
  (node) =>
    node.getAttribute(name) ?? "";

const textOf: LabelSource = (node) => (node.textContent ?? "").slice(0, TEXT_SAMPLE);

const fieldLabel: LabelSource = (node) =>
  (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement
    ? node.labels?.[0]?.textContent ?? ""
    : ""
  ).slice(0, TEXT_SAMPLE);

const isPrivate = (node: Element, selector: string): boolean =>
  node.closest(selector) !== null || node.querySelector(selector) !== null;

const isField = (node: Element): boolean =>
  FIELD_TAGS.has(node.tagName) || (node instanceof HTMLElement && node.isContentEditable);

const LABEL_CHAINS: { applies: (node: Element, privateSelector: string) => boolean; sources: LabelSource[] }[] = [
  { applies: isPrivate, sources: [() => COPY.trailMasked] },
  { applies: isField, sources: [attr("aria-label"), fieldLabel, attr("placeholder"), attr("name"), attr("type")] },
  { applies: () => true, sources: [attr("aria-label"), textOf, attr("title"), attr("alt")] },
];

function clickLabel(node: Element, privateSelector: string): string {
  const chain = LABEL_CHAINS.find((c) => c.applies(node, privateSelector))?.sources ?? [];
  const tagName: LabelSource = (n) => n.tagName.toLowerCase();
  return [...chain, tagName].map((source) => capLabel(source(node))).find((label) => label !== "") ?? "";
}

const navigation: Source = ({ record }) => {
  const recordNav = (trigger: NavTrigger): void =>
    record({ ts: Date.now(), kind: "nav", label: redactedPath(location.href, true), detail: trigger });
  recordNav(NAV_TRIGGERS.load);

  const host: Record<HistoryName, HistoryMethod> = history;
  const names = Object.keys(HISTORY_METHODS) as HistoryName[];
  const originals = Object.fromEntries(names.map((name) => [name, host[name]])) as Record<HistoryName, HistoryMethod>;
  const wrapped = Object.fromEntries(
    names.map((name) => [
      name,
      function (this: History, ...args: Parameters<History["pushState"]>): void {
        originals[name].apply(this, args);
        guarded(recordNav)(HISTORY_METHODS[name]);
      },
    ]),
  ) as Record<HistoryName, HistoryMethod>;
  for (const name of names) host[name] = wrapped[name];

  const listeners = Object.entries(NAV_EVENTS).map(([type, trigger]) => {
    const handler = guarded(() => recordNav(trigger));
    window.addEventListener(type, handler);
    return () => window.removeEventListener(type, handler);
  });

  return () => {
    for (const name of names) {
      if (host[name] === wrapped[name]) host[name] = originals[name];
    }
    for (const remove of listeners) remove();
  };
};

const clicks: Source = ({ record, privateSelector }) => {
  let streak: { node: Element | null; times: number[] } = { node: null, times: [] };

  const onClick = guarded((event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(WIDGET_HOST) !== null) return;
    const node = target.closest(CLICK_TARGETS) ?? target;
    const now = Date.now();
    const label = clickLabel(node, privateSelector);
    const times = [...(streak.node === node ? streak.times : []), now].filter((t) => now - t < RAGE_CLICK_WINDOW_MS);
    const raging = times.length >= RAGE_CLICK_COUNT;
    streak = { node, times: raging ? [] : times };
    record({ ts: now, kind: "click", label });
    if (raging) record({ ts: now, kind: "rage-click", label });
  });

  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
};

const errors: Source = ({ record }) => {
  const onError = guarded((event: ErrorEvent) => record(errorEntry(Date.now(), event.message || messageOf(event.error))));
  const onRejection = guarded((event: PromiseRejectionEvent) => record(errorEntry(Date.now(), messageOf(event.reason))));
  const host: { error: ConsoleMethod } = console;
  const original = host.error;
  const wrapped = (...args: unknown[]): void => {
    guarded(() => record(errorEntry(Date.now(), args.map(messageOf).join(" "))))();
    original.apply(console, args);
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  host.error = wrapped;

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    if (host.error === wrapped) host.error = original;
  };
};

const requests: Source = ({ record, ignore }) => {
  const report = guarded((started: number, method: string, url: string, status: number | null) => {
    if (url === "" || !isFailedStatus(status) || matchesAny(url, ignore)) return;
    record(failedRequestEntry(started, method, url, status));
  });

  const originalFetch = globalThis.fetch;
  const wrappedFetch: typeof fetch = async (input, init) => {
    const started = Date.now();
    const url = urlOf(input);
    const method = methodOf(input, init);
    try {
      const response = await originalFetch(input, init);
      report(started, method, url, response.status);
      return response;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) report(started, method, url, null);
      throw error;
    }
  };
  globalThis.fetch = wrappedFetch;

  const proto: { open: XhrOpen; send: XhrSend } = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const finishers = new WeakMap<XMLHttpRequest, (status: number | null) => void>();
  const ignoreOutcome = (): void => undefined;

  const wrappedOpen: XhrOpen = function (...args) {
    const started = Date.now();
    const method = args[0].toUpperCase();
    const url = String(args[1]);
    finishers.set(this, (status) => report(started, method, url, status));
    Reflect.apply(originalOpen, this, args);
  };
  const wrappedSend: XhrSend = function (body) {
    const finish = finishers.get(this) ?? ignoreOutcome;
    for (const [type, outcome] of Object.entries(XHR_OUTCOMES)) {
      this.addEventListener(type, () => finish(outcome(this)), { once: true });
    }
    originalSend.call(this, body);
  };
  proto.open = wrappedOpen;
  proto.send = wrappedSend;

  return () => {
    if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
    if (proto.open === wrappedOpen) proto.open = originalOpen;
    if (proto.send === wrappedSend) proto.send = originalSend;
  };
};

const SOURCES: Source[] = [navigation, clicks, errors, requests];


function restored(publicKey: string): TrailEntry[] {
  try {
    const parsed: unknown = JSON.parse(readSlot(publicKey, SLOTS.trail) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isTrailEntry) : [];
  } catch {
    return [];
  }
}

export function startTrail(cfg: TrailConfig): TrailCapture {
  let timer: number | undefined;
  let stopped = false;

  const save = (): void => {
    window.clearTimeout(timer);
    timer = undefined;
    if (!stopped) writeSlot(cfg.publicKey, SLOTS.trail, JSON.stringify(buffer.entries()));
  };
  const schedule = (): void => {
    if (timer === undefined && !stopped) timer = window.setTimeout(save, PERSIST_THROTTLE_MS);
  };

  const buffer = createTrailBuffer(cfg.ttlMs, restored(cfg.publicKey), schedule);

  const ctx: SourceContext = {
    record: (entry) => buffer.push(entry),
    privateSelector: [maskTextSelector(cfg.maskTextSelector), blockSelector(cfg.blockSelector), PASSWORD_FIELDS].join(","),
    ignore: ingestIgnoreList(cfg.endpoint, cfg.ignoreUrls),
  };

  const uninstall = SOURCES.flatMap((source) => {
    try {
      return [source(ctx)];
    } catch {
      return [];
    }
  });
  window.addEventListener("pagehide", save);

  return {
    entries: () => buffer.entries(),
    stop(): void {
      stopped = true;
      for (const remove of uninstall) guarded(remove)();
      window.removeEventListener("pagehide", save);
      window.clearTimeout(timer);
      buffer.clear();
      clearSlot(cfg.publicKey, SLOTS.trail);
    },
  };
}

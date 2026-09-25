/**
 * The transport seam.
 *
 * Everything above this line - recorder, modal, theme - is contract-agnostic.
 * Everything below knows exactly one server generation. Adding a third contract
 * means adding a file here and a branch in `selectTransport`, and touching
 * nothing else.
 */
import type { ResolvedConfig, UserHint } from "../types.js";
import type { WireEvent } from "../wire.js";
import type { TransportKind } from "../config.js";
import { createV1Transport } from "./v1.js";
import { createLegacyTransport } from "./legacy.js";

/** What the modal produced, before any contract has had an opinion about it. */
export interface Draft {
  kind: string;
  title: string;
  message: string;
  email: string | null;
  answers: Record<string, unknown>;
  files: File[];
  screenshot: string | null;
}

/** What the page and the recorder contribute. */
export interface SubmitContext {
  sessionId: string;
  replayStartedAt: number | null;
  events: WireEvent[];
  user: UserHint;
  metadata: Record<string, unknown>;
  pageUrl: string;
  referrer: string;
  userAgent: string;
  viewportWidth: number;
  viewportHeight: number;
  config: ResolvedConfig;
}

export interface SubmitResult {
  /** The created report id, when the contract returns one. */
  id: string | null;
}

export interface Transport {
  readonly kind: TransportKind;
  submit(draft: Draft, ctx: SubmitContext): Promise<SubmitResult>;
  /**
   * Periodic / unload session upload. Only the legacy contract has somewhere to
   * put a session with no report attached; v1 leaves this undefined.
   */
  flushSession?(ctx: SubmitContext, onUnload: boolean): void;
}

export interface TransportDeps {
  endpoint: string;
  publicKey: string;
}

export function selectTransport(kind: TransportKind, deps: TransportDeps): Transport {
  return kind === "v1" ? createV1Transport(deps) : createLegacyTransport(deps);
}

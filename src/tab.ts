const STORAGE_PREFIX = "nerva-feedback";
const SESSION_ID_BYTES = 16;
const HEX_RADIX = 16;
const HEX_WIDTH = 2;

export const SLOTS = { session: "session", trail: "trail", spill: "replay-spill" } as const;
export type Slot = (typeof SLOTS)[keyof typeof SLOTS];

const keyOf = (publicKey: string, slot: Slot): string => `${STORAGE_PREFIX}:${publicKey}:${slot}`;

export function readSlot(publicKey: string, slot: Slot): string | null {
  try {
    return sessionStorage.getItem(keyOf(publicKey, slot));
  } catch {
    return null;
  }
}

export function writeSlot(publicKey: string, slot: Slot, value: string): boolean {
  try {
    sessionStorage.setItem(keyOf(publicKey, slot), value);
    return true;
  } catch {
    return false;
  }
}

export function clearSlot(publicKey: string, slot: Slot): boolean {
  try {
    sessionStorage.removeItem(keyOf(publicKey, slot));
    return true;
  } catch {
    return false;
  }
}

function newSessionId(): string {
  const bytes = new Uint8Array(SESSION_ID_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(HEX_RADIX).padStart(HEX_WIDTH, "0")).join("");
}

const CLAIM_CHANNEL = "tabs";
const CLAIM_WAIT_MS = 150;

const CLAIM = { probe: "probe", held: "held" } as const;
type ClaimKind = (typeof CLAIM)[keyof typeof CLAIM];

interface ClaimMessage {
  kind: ClaimKind;
  id: string;
  nonce: string;
}

type ClaimHandlers = Record<ClaimKind, (message: ClaimMessage) => void>;

export interface TabClaim {
  readonly id: string;
  release(): void;
}

const claimKinds: ReadonlySet<string> = new Set(Object.values(CLAIM));

function asClaim(data: unknown): ClaimMessage | null {
  const candidate = data as Partial<ClaimMessage> | null;
  const valid =
    typeof candidate === "object" &&
    candidate !== null &&
    claimKinds.has(String(candidate.kind)) &&
    typeof candidate.id === "string" &&
    typeof candidate.nonce === "string";
  return valid ? (candidate as ClaimMessage) : null;
}

function openChannel(publicKey: string): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "function" ? new BroadcastChannel(`${STORAGE_PREFIX}:${publicKey}:${CLAIM_CHANNEL}`) : null;
  } catch {
    return null;
  }
}

function post(channel: BroadcastChannel, message: ClaimMessage): void {
  try {
    channel.postMessage(message);
  } catch {
    return;
  }
}

function listen(channel: BroadcastChannel, id: string, handlers: ClaimHandlers): () => void {
  const onMessage = (event: MessageEvent<unknown>): void => {
    const message = asClaim(event.data);
    if (message === null || message.id !== id) return;
    handlers[message.kind](message);
  };
  channel.addEventListener("message", onMessage);
  return () => channel.removeEventListener("message", onMessage);
}

function heldElsewhere(channel: BroadcastChannel, id: string, nonce: string): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (held: boolean): void => {
      window.clearTimeout(timer);
      stop();
      resolve(held);
    };
    const stop = listen(channel, id, {
      probe: (message) => {
        if (message.nonce > nonce) post(channel, { kind: CLAIM.held, id, nonce: message.nonce });
      },
      held: (message) => {
        if (message.nonce === nonce) finish(true);
      },
    });
    const timer = window.setTimeout(() => finish(false), CLAIM_WAIT_MS);
    post(channel, { kind: CLAIM.probe, id, nonce });
  });
}

export async function claimTabSession(publicKey: string): Promise<TabClaim> {
  const channel = openChannel(publicKey);
  const inherited = readSlot(publicKey, SLOTS.session) || null;
  const taken = inherited !== null && channel !== null && (await heldElsewhere(channel, inherited, newSessionId()));
  const id = inherited !== null && !taken ? inherited : newSessionId();
  writeSlot(publicKey, SLOTS.session, id);
  const stop =
    channel === null
      ? () => undefined
      : listen(channel, id, {
          probe: (message) => post(channel, { kind: CLAIM.held, id, nonce: message.nonce }),
          held: () => undefined,
        });
  return {
    id,
    release: () => {
      stop();
      channel?.close();
    },
  };
}

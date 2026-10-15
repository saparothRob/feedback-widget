import type { eventWithTime } from "rrweb";
import { SLOTS, clearSlot, readSlot, writeSlot } from "./tab.js";

export interface StoredChunk {
  tab: string;
  gen: number;
  part: number;
  at: number;
  bytes: number;
  events: eventWithTime[];
}

export interface DroppedGeneration {
  tab: string;
  gen: number;
}

export interface ReplayStore {
  load(tab: string): Promise<StoredChunk[]>;
  write(chunks: StoredChunk[], dropped: DroppedGeneration[]): Promise<void>;
  clear(tab: string): Promise<void>;
  purge(before: number): Promise<void>;
}

const DB_NAME = "nerva-feedback";
const DB_VERSION = 1;
const STORE = "replay";
const KEY_PATH = ["tab", "gen", "part"];
const ABOVE_ALL_NUMBERS: never[] = [];
const STORE_FAILED = "feedback-widget: replay store failed";

const failure = (error: DOMException | null): Error => error ?? new Error(STORE_FAILED);

const settle = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(failure(request.error));
  });

const completion = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure(tx.error));
    tx.onabort = () => reject(failure(tx.error));
  });

const tabRange = (tab: string): IDBKeyRange => IDBKeyRange.bound([tab], [tab, ABOVE_ALL_NUMBERS]);
const genRange = (tab: string, gen: number): IDBKeyRange => IDBKeyRange.bound([tab, gen], [tab, gen, ABOVE_ALL_NUMBERS]);

function storeOver(db: IDBDatabase): ReplayStore {
  const objects = (mode: IDBTransactionMode): { tx: IDBTransaction; store: IDBObjectStore } => {
    const tx = db.transaction(STORE, mode);
    return { tx, store: tx.objectStore(STORE) };
  };

  return {
    async load(tab: string): Promise<StoredChunk[]> {
      const { store } = objects("readonly");
      return (await settle(store.getAll(tabRange(tab)))) as StoredChunk[];
    },
    write(chunks: StoredChunk[], dropped: DroppedGeneration[]): Promise<void> {
      const { tx, store } = objects("readwrite");
      for (const chunk of chunks) store.put(chunk);
      for (const { tab, gen } of dropped) store.delete(genRange(tab, gen));
      return completion(tx);
    },
    clear(tab: string): Promise<void> {
      const { tx, store } = objects("readwrite");
      store.delete(tabRange(tab));
      return completion(tx);
    },
    purge(before: number): Promise<void> {
      const { tx, store } = objects("readwrite");
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (current === null) return;
        const stale = (current.value as StoredChunk).at < before;
        if (stale) current.delete();
        current.continue();
      };
      return completion(tx);
    },
  };
}

export async function openStore(): Promise<ReplayStore | null> {
  try {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: KEY_PATH });
    };
    return storeOver(await settle(request));
  } catch {
    return null;
  }
}

const isStoredChunk = (value: unknown): value is StoredChunk => {
  const chunk = value as Partial<StoredChunk> | null;
  return (
    typeof chunk === "object" &&
    chunk !== null &&
    typeof chunk.tab === "string" &&
    typeof chunk.gen === "number" &&
    typeof chunk.part === "number" &&
    typeof chunk.at === "number" &&
    typeof chunk.bytes === "number" &&
    Array.isArray(chunk.events)
  );
};

export const spill = (publicKey: string, chunks: StoredChunk[]): boolean =>
  writeSlot(publicKey, SLOTS.spill, JSON.stringify([...readSpill(publicKey), ...chunks]));

export function readSpill(publicKey: string): StoredChunk[] {
  try {
    const parsed: unknown = JSON.parse(readSlot(publicKey, SLOTS.spill) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isStoredChunk) : [];
  } catch {
    return [];
  }
}

export const clearSpill = (publicKey: string): boolean => clearSlot(publicKey, SLOTS.spill);

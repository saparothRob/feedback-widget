/**
 * The react-native analogues of the web globals the shared core is built
 * around. Everything that touches the `react-native` module from the headless
 * side lives here, so the client itself stays a pure composition of the shared
 * bootstrap, taps and transport.
 */
import { Dimensions, Platform } from "react-native";

/** There is no `location.href` in an app; the current screen name stands in. */
export const PAGE_URL_SCHEME = "app://";

/** Used until the host feeds a real screen name (option or `setScreen`). */
export const DEFAULT_SCREEN_NAME = "root";

const SESSION_ID_BYTES = 16;
const BYTE_MAX = 256;

export function pageUrlFor(screen: string): string {
  return `${PAGE_URL_SCHEME}${screen}`;
}

export function viewport(): { width: number; height: number } {
  const { width, height } = Dimensions.get("window");
  return { width: Math.round(width), height: Math.round(height) };
}

/** Apps have no `navigator.userAgent`; say what the runtime actually is. */
export function userAgent(): string {
  return `ReactNative/${Platform.OS} ${String(Platform.Version)}`;
}

/**
 * Same shape as the web recorder's session id. Hermes ships no `crypto` by
 * default, so entropy degrades to `Math.random` rather than demanding a
 * polyfill - this keys a feedback session, it guards nothing.
 */
export function newSessionId(): string {
  const bytes = new Uint8Array(SESSION_ID_BYTES);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * BYTE_MAX);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

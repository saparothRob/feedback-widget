/** Form limits and timings shared by the web modal and the react-native sheet. */

export const MAX_TITLE_LENGTH = 200;

/** How long the sent confirmation stays up before the dialog closes itself. */
export const DONE_DISMISS_MS = 2600;

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

export const CHECKOUT_EVERY_MS = MS_PER_MINUTE;
export const REPLAY_BYTE_CAP = 5 * 1024 * 1024;
export const PERSIST_THROTTLE_MS = 2_000;

export const LOOKBACK_SECONDS = { min: 5, max: 3600, fallback: 600 } as const;
export const TRAIL_SECONDS = { min: 60, max: 7200, fallback: 1800 } as const;

export const TRAIL_LABEL_MAX = 80;
export const TRAIL_MAX_ENTRIES = 400;
export const TRAIL_DEDUPE_MS = 1_000;
export const RAGE_CLICK_COUNT = 3;
export const RAGE_CLICK_WINDOW_MS = 1_000;
export const SERVER_ERROR_MIN = 500;

export const TRIM_STEPS_MS = [5 * MS_PER_MINUTE, 2 * MS_PER_MINUTE] as const;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

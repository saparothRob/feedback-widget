/**
 * @nerva/feedback-widget/react-native
 *
 * The mobile face of the package: the headless client plus a ready-made UI.
 * Everything here posts to the same Nerva server contracts as the web widget -
 * the shared bootstrap, wire types and transports are one codebase - but pulls
 * in none of the web-only machinery (rrweb, the shadow-DOM shell, html2canvas,
 * the CSS). Hosts that want the client without react can import
 * `@nerva/feedback-widget/react-native/client` instead.
 */
export {
  createFeedbackClient,
  type FeedbackClient,
  type FeedbackClientOptions,
  type FeedbackDraft,
  type ScreenshotCapture,
} from "./client.js";
export { FeedbackSheet, type FeedbackSheetProps } from "./sheet.js";
export { FeedbackLauncher, type FeedbackLauncherProps } from "./launcher.js";

export type { SubmitResult } from "../transport/index.js";
export type {
  ResolvedConfig,
  ThemeOptions,
  UserHint,
  WidgetColorScheme,
  WidgetSkin,
} from "../types.js";
export type { ConsoleEntry, NetworkEntry, WireEvent } from "../wire.js";
export { FeedbackApiError } from "../transport/http.js";

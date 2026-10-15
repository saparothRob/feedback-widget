/**
 * Every user-facing string the widget renders. One home, no inline copy.
 *
 * Lives in the shared core (not `ui/`) because both faces of the package - the
 * web modal and the react-native sheet - render the same words.
 */

import type { TrailKind } from "./wire.js";
import { MS_PER_MINUTE, MS_PER_SECOND } from "./limits.js";

export const COPY = {
  kindGroupLabel: "What kind of feedback?",
  titleLabel: "Title (optional)",
  titlePlaceholder: "Defaults to the first line of your message",
  detailsLabel: "Details",
  messagePlaceholder: "What happened? What did you expect instead?",
  emailLabel: "Email (optional)",
  emailPlaceholder: "you@example.com",
  emailHint: "Only so someone can follow up with you.",
  emailRequiredLabel: "Email",
  emailRequiredHint: "So we can tell you when it's fixed.",
  missingEmail: "Add your email so we can tell you when it's fixed.",
  screenshotLabel: "Include a screenshot of this page",
  screenshotAlt: "Screenshot preview",
  attachLabel: "+ Attach a file",
  removeLabel: "Remove",
  closeLabel: "Close",
  send: "Send",
  sending: "Sending…",
  cancel: "Cancel",
  doneTitle: "Thanks — that's sent.",
  doneRefPrefix: "REF",
  missingMessage: "Tell us what happened before sending.",
  requiredSuffix: "is required.",
  sendFailed: "That didn't send. Try again?",
  oversizeSuffix: "is larger than 10 MB.",
  noticedLabel: "We noticed",
  sharingLabel: "Sharing",
  windowLabel: "Send the last",
  maskNote: "Passwords and anything marked private are never recorded.",
  trailMasked: "[private]",
  trailNetworkFailed: "failed",
  /** Mobile captures no replay, so the web line would over-claim. */
  privacyMobile:
    "Sending this shares recent console and network activity from the app, along with what you wrote here.",
  teleReplay: "REPLAY",
  teleConsole: "CONSOLE",
  teleNetwork: "NETWORK",
} as const;

const PLURAL = new Intl.PluralRules("en");

type Forms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const counted = (forms: Forms) => (n: number): string => `${n} ${forms[PLURAL.select(n)] ?? forms.other}`;

interface DurationUnit {
  ms: number;
  suffix: string;
}

const LONG_UNITS: DurationUnit[] = [
  { ms: MS_PER_MINUTE, suffix: " min" },
  { ms: MS_PER_SECOND, suffix: " s" },
];

const SHORT_UNITS: DurationUnit[] = [
  { ms: MS_PER_MINUTE, suffix: "M" },
  { ms: MS_PER_SECOND, suffix: "S" },
];

const duration = (units: DurationUnit[]) => (ms: number): string => {
  const unit = units.find((u) => ms >= u.ms) ?? units[units.length - 1] ?? { ms: 1, suffix: "" };
  return `${Math.max(1, Math.round(ms / unit.ms))}${unit.suffix}`;
};

export const FORMAT = {
  duration: duration(LONG_UNITS),
  teleDuration: duration(SHORT_UNITS),
  ago: (ms: number): string => (ms < MS_PER_MINUTE ? "just now" : `${duration(LONG_UNITS)(ms)} ago`),
  replay: (ms: number): string => `${duration(LONG_UNITS)(ms)} replay`,
  pages: counted({ one: "page", other: "pages" }),
  errors: counted({ one: "error", other: "errors" }),
  failed: counted({ one: "failed request", other: "failed requests" }),
  factSeparator: " · ",
  noticed: (label: string, ago: string): string => `${label}, ${ago}`,
  failedRequest: (method: string, path: string, outcome: string): string => `${method} ${path} → ${outcome}`,
};

export type EmailMode = "required" | "optional";

export const emailMode = (requireEmail: boolean): EmailMode => (requireEmail ? "required" : "optional");

export const EMAIL_COPY: Record<EmailMode, { label: string; hint: string }> = {
  required: { label: COPY.emailRequiredLabel, hint: COPY.emailRequiredHint },
  optional: { label: COPY.emailLabel, hint: COPY.emailHint },
};

export const MOMENT_TEXT: Record<TrailKind, (label: string) => string> = {
  nav: (label) => label,
  click: (label) => label,
  error: (label) => label,
  "failed-request": (label) => label,
  "rage-click": (label) => `Repeated clicks on ${label}`,
};

export const KIND_LABELS: Record<string, string> = {
  bug: "Bug",
  idea: "Idea",
  question: "Question",
  praise: "Praise",
  feedback: "Feedback",
};

export const KIND_HINTS: Record<string, string> = {
  bug: "Something is broken",
  idea: "Something could be better",
  question: "Something is unclear",
  praise: "Something works well",
  feedback: "Anything else",
};

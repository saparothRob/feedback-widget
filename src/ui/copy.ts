/** Every user-facing string the widget renders. One home, no inline copy. */

export const COPY = {
  kindGroupLabel: "What kind of feedback?",
  titleLabel: "Title",
  titlePlaceholder: "Short summary",
  detailsLabel: "Details",
  messagePlaceholder: "What happened? What did you expect instead?",
  emailLabel: "Email (optional)",
  emailPlaceholder: "you@example.com",
  emailHint: "Only so someone can follow up with you.",
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
  privacy:
    "Sending this shares a recording of your recent activity on this page, including console and network " +
    "activity. Password fields and anything marked private are never recorded.",
  teleReplay: "REPLAY",
  teleConsole: "CONSOLE",
  teleNetwork: "NETWORK",
} as const;

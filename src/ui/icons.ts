/** Button glyphs. Names match the server's `icon` CHECK constraint. */
export const ICON_PATHS: Record<string, string[]> = {
  chat: ["M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.9-.8L3 21l1.9-4.6A8.4 8.4 0 1 1 21 11.5z"],
  megaphone: ["M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z", "M16 8a5 5 0 0 1 0 8", "M19 5a9 9 0 0 1 0 14"],
  bug: [
    "M8 6a4 4 0 0 1 8 0",
    "M6 10h12v4a6 6 0 0 1-12 0z",
    "M3 12h3M18 12h3M4 7l2 2M20 7l-2 2M4 18l2-2M20 18l-2-2",
  ],
  star: ["M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"],
  lightbulb: ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6h5.4c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z"],
  "life-ring": [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
    "M5.6 5.6l3.9 3.9M18.4 5.6l-3.9 3.9M5.6 18.4l3.9-3.9M18.4 18.4l-3.9-3.9",
  ],
};

/** Per-kind glyph in the kind picker. Falls back to the chat bubble. */
export const KIND_ICONS: Record<string, string> = {
  bug: "bug",
  idea: "lightbulb",
  question: "life-ring",
  praise: "star",
  feedback: "chat",
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

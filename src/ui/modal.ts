/** The feedback dialog. */
import type { ResolvedConfig } from "../types.js";
import type { Draft, SubmitResult } from "../transport/index.js";
import type { ShareSummary, ShareWindow } from "../share.js";
import { shareWindows, titleFor } from "../share.js";
import { capture, screenshotAvailable } from "../screenshot.js";
import { createFieldSet, type FieldsHost } from "./fields.js";
import { COPY, EMAIL_COPY, FORMAT, KIND_HINTS, KIND_LABELS, MOMENT_TEXT, emailMode } from "../copy.js";
import { DONE_DISMISS_MS, EMAIL_PATTERN, MAX_TITLE_LENGTH } from "../limits.js";
import { el, svg, trapFocus } from "./dom.js";
import { ICON_PATHS, KIND_ICONS } from "./icons.js";

export interface ModalDeps {
  config: ResolvedConfig;
  fieldsHost: FieldsHost;
  /** The widget's own host element, hidden while the page is rasterised. */
  hostElement: HTMLElement;
  screenshotMode: "dom" | "none";
  knownEmail(): string | null;
  summarise(span: ShareWindow): ShareSummary;
  submit(draft: Draft): Promise<SubmitResult>;
}

export interface Modal {
  readonly root: HTMLElement;
  open(): void;
  close(): void;
  applyTheme(): void;
  readonly isOpen: boolean;
}

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const REF_LENGTH = 8;
const KIND_ICON_SIZE = 14;

const requiredMark = (): HTMLElement => el("span", { class: "fb-req", text: "*", "aria-hidden": true });

function facts(summary: ShareSummary): string {
  return [
    ...(summary.replayMs === null ? [] : [FORMAT.replay(summary.replayMs)]),
    FORMAT.pages(summary.pages),
    FORMAT.errors(summary.errors),
    FORMAT.failed(summary.failed),
  ].join(FORMAT.factSeparator);
}

/** The telemetry strip: what the widget is actually capturing, in the
 *  register's voice. Entries are data; rendering never branches per entry. */
function telemetryEntries(config: ResolvedConfig): { text: string; dot: boolean }[] {
  return [
    { on: config.replay.enabled, text: `${COPY.teleReplay} ${FORMAT.teleDuration(config.replay.lookbackMs)}`, dot: true },
    { on: config.capture.console, text: COPY.teleConsole, dot: false },
    { on: config.capture.network, text: COPY.teleNetwork, dot: false },
  ]
    .filter((entry) => entry.on)
    .map(({ text, dot }) => ({ text, dot }));
}

export function createModal(deps: ModalDeps): Modal {
  const { config } = deps;
  const fields = createFieldSet(config.customFields, deps.fieldsHost);
  const windows = shareWindows(config);
  const emailCopy = EMAIL_COPY[emailMode(config.requireEmail)];
  const emailShown = config.collectEmail || config.requireEmail;

  let kind = config.kinds[0] ?? "feedback";
  let files: File[] = [];
  let shot: string | null = null;
  let open = false;
  let sending = false;
  let restoreFocus: Element | null = null;

  // ── Nodes ────────────────────────────────────────────────────────────────

  const kindRow = el("div", { class: "fb-kinds", role: "group", "aria-label": COPY.kindGroupLabel });

  const titleInput = el("input", {
    class: "fb-input",
    id: "fb-title",
    type: "text",
    maxlength: MAX_TITLE_LENGTH,
    placeholder: COPY.titlePlaceholder,
  });

  const messageInput = el("textarea", {
    class: "fb-textarea",
    id: "fb-message",
    placeholder: COPY.messagePlaceholder,
    "aria-required": "true",
    "aria-describedby": "fb-error",
  });

  const emailInput = el("input", {
    class: "fb-input",
    id: "fb-email",
    type: "email",
    autocomplete: "email",
    placeholder: COPY.emailPlaceholder,
    "aria-required": String(config.requireEmail),
    "aria-describedby": "fb-email-hint fb-error",
  });
  const emailField = el("div", { class: "fb-field" }, [
    el("label", { class: "fb-label", for: "fb-email" }, [
      emailCopy.label,
      ...(config.requireEmail ? [requiredMark()] : []),
    ]),
    emailInput,
    el("p", { class: "fb-hint", id: "fb-email-hint", text: emailCopy.hint }),
  ]);

  const shotCheck = el("input", { type: "checkbox", id: "fb-shot", checked: !config.replay.enabled });
  const shotPreview = el("img", { class: "fb-shot", alt: COPY.screenshotAlt, hidden: true });
  const shotField = el("div", { class: "fb-field" }, [
    el("label", { class: "fb-check", for: "fb-shot" }, [shotCheck, COPY.screenshotLabel]),
    shotPreview,
  ]);

  const fileInput = el("input", { type: "file", multiple: true, hidden: true });
  const fileList = el("div", { class: "fb-files" });
  const fileButton = el("button", { class: "fb-link", type: "button", text: COPY.attachLabel });
  const fileField = el("div", { class: "fb-field" }, [fileButton, fileList]);

  const errorLine = el("p", { class: "fb-error", id: "fb-error", role: "alert", "aria-live": "assertive", hidden: true });

  const noticedText = el("span", { class: "fb-noticed-text" });
  const noticed = el("p", { class: "fb-noticed", hidden: true }, [
    el("span", { class: "fb-noticed-label", text: COPY.noticedLabel }),
    noticedText,
  ]);

  const shareFacts = el("span", { class: "fb-share-facts", "aria-live": "polite" });
  const windowSelect = el(
    "select",
    { class: "fb-select fb-select-inline", id: "fb-window" },
    windows.map((option, index) => el("option", { value: index, text: FORMAT.duration(option.replayMs) })),
  );
  const share = el("div", { class: "fb-share" }, [
    el("p", { class: "fb-share-line" }, [el("span", { class: "fb-share-label", text: COPY.sharingLabel }), shareFacts]),
    el("div", { class: "fb-share-row", hidden: windows.length < 2 }, [
      el("label", { class: "fb-share-window", for: "fb-window", text: COPY.windowLabel }),
      windowSelect,
    ]),
    el("p", { class: "fb-privacy", text: COPY.maskNote }),
  ]);

  const selectedWindow = (): ShareWindow => windows[windowSelect.selectedIndex] ?? windows[0];

  const submitButton = el("button", { class: "fb-btn fb-btn-primary", type: "submit", text: COPY.send });
  const cancelButton = el("button", { class: "fb-btn fb-btn-ghost", type: "button", text: COPY.cancel });

  const telemetry = el(
    "div",
    { class: "fb-telemetry", "aria-hidden": "true" },
    telemetryEntries(config).map(({ text, dot }) =>
      el("span", { class: "fb-tele" }, [
        ...(dot ? [el("i", { class: "fb-tele-dot" })] : []),
        text,
      ]),
    ),
  );

  const body = el("div", { class: "fb-body" });
  const foot = el("div", { class: "fb-foot" }, [telemetry, cancelButton, submitButton]);

  const closeButton = el("button", { class: "fb-close", type: "button", "aria-label": COPY.closeLabel }, [
    svg(["M6 6l12 12M18 6L6 18"], 18),
  ]);
  const brandNodes = (): Node[] => [
    ...(config.theme.brandLogo === "" ? [] : [el("img", { class: "fb-brand-logo", src: config.theme.brandLogo, alt: "" })]),
    el("span", { class: "fb-brand", text: config.theme.brandName }),
    closeButton,
  ];
  const brandRow = el("div", { class: "fb-brand-row" }, brandNodes());
  const heading = el("h2", { class: "fb-title", id: "fb-heading", text: config.theme.buttonLabel });
  const head = el("div", { class: "fb-head" }, [brandRow, heading]);

  const form = el("form", { class: "fb-form", novalidate: true }, [body, foot]);
  const panel = el("div", {
    class: "fb-panel",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "fb-heading",
  }, [head, form]);
  const overlay = el("div", { class: "fb-overlay", hidden: true }, [panel, fileInput]);

  // ── Rendering ────────────────────────────────────────────────────────────

  function renderKinds(): void {
    kindRow.replaceChildren();
    for (const value of config.kinds) {
      const button = el(
        "button",
        {
          class: "fb-kind",
          type: "button",
          "aria-pressed": String(value === kind),
          "data-kind": value,
          title: KIND_HINTS[value] ?? "",
        },
        [svg(ICON_PATHS[KIND_ICONS[value] ?? "chat"] ?? ICON_PATHS.chat ?? [], KIND_ICON_SIZE), KIND_LABELS[value] ?? value],
      );
      button.addEventListener("click", () => {
        kind = value;
        renderKinds();
        fields.render(kind);
      });
      kindRow.append(button);
    }
  }

  function renderFiles(): void {
    fileList.replaceChildren();
    for (const [index, file] of files.entries()) {
      const remove = el("button", { class: "fb-link", type: "button", "aria-label": `${COPY.removeLabel} ${file.name}` }, [COPY.removeLabel]);
      remove.addEventListener("click", () => {
        files = files.filter((_, i) => i !== index);
        renderFiles();
      });
      fileList.append(
        el("div", { class: "fb-file" }, [
          el("span", { class: "fb-file-name", text: file.name }),
          el("span", { class: "fb-hint", text: `${Math.ceil(file.size / 1024)} KB` }),
          remove,
        ]),
      );
    }
    fileButton.hidden = files.length >= MAX_FILES;
  }

  function showError(message: string | null): void {
    errorLine.textContent = message ?? "";
    errorLine.hidden = message === null;
  }

  function renderShare(): void {
    const now = Date.now();
    const summary = deps.summarise(selectedWindow());
    const moment = summary.moment;
    shareFacts.textContent = facts(summary);
    noticedText.textContent =
      moment === null ? "" : FORMAT.noticed(MOMENT_TEXT[moment.kind](moment.label), FORMAT.ago(now - moment.ts));
    noticed.hidden = moment === null;
  }

  function buildBody(): void {
    const rows: (Node | string)[] = [];
    if (config.kinds.length > 1) rows.push(kindRow);
    rows.push(
      el("div", { class: "fb-field" }, [
        el("label", { class: "fb-label", for: "fb-message" }, [COPY.detailsLabel, requiredMark()]),
        messageInput,
      ]),
      el("div", { class: "fb-field" }, [
        el("label", { class: "fb-label", for: "fb-title", text: COPY.titleLabel }),
        titleInput,
      ]),
    );
    if (emailShown) rows.push(emailField);
    rows.push(fields.container);
    if (deps.screenshotMode === "dom") rows.push(shotField);
    if (config.attachments) rows.push(fileField);
    rows.push(noticed, share, errorLine);
    body.replaceChildren(...rows);
  }

  function showDone(id: string | null): void {
    head.hidden = true;
    const ref = id === null ? [] : [
      el("p", { class: "fb-done-ref", text: `${COPY.doneRefPrefix} ${id.replace(/-/g, "").slice(0, REF_LENGTH)}` }),
    ];
    form.replaceChildren(
      el("div", { class: "fb-done" }, [
        el("div", { class: "fb-done-mark" }, [svg(["M20 6L9 17l-5-5"], 28)]),
        el("h2", { class: "fb-done-title", text: COPY.doneTitle }),
        el("p", { class: "fb-done-text", text: config.theme.successMessage }),
        ...ref,
      ]),
    );
    window.setTimeout(() => {
      if (open) close();
    }, DONE_DISMISS_MS);
  }

  function reset(): void {
    titleInput.value = "";
    messageInput.value = "";
    emailInput.value = deps.knownEmail() ?? "";
    messageInput.setAttribute("aria-invalid", "false");
    emailInput.setAttribute("aria-invalid", "false");
    windowSelect.selectedIndex = 0;
    files = [];
    shot = null;
    sending = false;
    shotPreview.hidden = true;
    shotCheck.checked = !config.replay.enabled;
    submitButton.disabled = false;
    submitButton.textContent = COPY.send;
    head.hidden = false;
    kind = config.kinds[0] ?? "feedback";
    showError(null);
    renderKinds();
    renderFiles();
    fields.render(kind);
    form.replaceChildren(body, foot);
    buildBody();
    renderShare();
  }

  // ── Behaviour ────────────────────────────────────────────────────────────

  function close(): void {
    if (!open) return;
    open = false;
    overlay.hidden = true;
    if (restoreFocus instanceof HTMLElement) restoreFocus.focus();
    restoreFocus = null;
  }

  function openModal(): void {
    if (open) return;
    restoreFocus = document.activeElement;
    reset();
    open = true;
    overlay.hidden = false;
    window.setTimeout(() => messageInput.focus(), 40);
  }

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay && !sending) close();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sending) {
      event.stopPropagation();
      close();
      return;
    }
    trapFocus(panel, event);
  });
  closeButton.addEventListener("click", close);
  cancelButton.addEventListener("click", close);

  fileButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const picked = [...(fileInput.files ?? [])];
    const oversize = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (oversize) {
      showError(`${oversize.name} ${COPY.oversizeSuffix}`);
    } else {
      showError(null);
      files = [...files, ...picked].slice(0, MAX_FILES);
    }
    fileInput.value = "";
    renderFiles();
  });

  windowSelect.addEventListener("change", renderShare);

  const checks: { input: HTMLInputElement | HTMLTextAreaElement; valid: () => boolean; message: string }[] = [
    { input: messageInput, valid: () => messageInput.value.trim() !== "", message: COPY.missingMessage },
    {
      input: emailInput,
      valid: () => !config.requireEmail || EMAIL_PATTERN.test(emailInput.value.trim()),
      message: COPY.missingEmail,
    },
  ];

  shotCheck.addEventListener("change", () => {
    if (!shotCheck.checked) {
      shot = null;
      shotPreview.hidden = true;
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (sending) return;

    const failed = checks.find((check) => !check.valid());
    for (const check of checks) check.input.setAttribute("aria-invalid", String(check === failed));
    if (failed !== undefined) {
      showError(failed.message);
      failed.input.focus();
      return;
    }
    const message = messageInput.value.trim();

    const missing = fields.validate(kind);
    if (missing !== null) {
      showError(`${missing} ${COPY.requiredSuffix}`);
      return;
    }

    showError(null);
    sending = true;
    submitButton.disabled = true;
    submitButton.textContent = COPY.sending;

    const send = async (): Promise<SubmitResult> => {
      if (deps.screenshotMode === "dom" && shotCheck.checked && shot === null) {
        // Captured at submit time, not at open time: the dialog is in the way
        // until the moment it is hidden for the capture.
        close();
        shot = await capture(deps.hostElement);
        open = true;
        overlay.hidden = false;
      }
      return deps.submit({
        kind,
        title: titleFor(titleInput.value, message),
        message,
        email: (emailShown ? emailInput.value.trim() : deps.knownEmail()) || null,
        answers: fields.collect(kind),
        files,
        screenshot: shot,
        shareWindow: selectedWindow(),
      });
    };

    void send().then(
      (result) => showDone(result.id),
      (error: unknown) => {
        sending = false;
        submitButton.disabled = false;
        submitButton.textContent = COPY.send;
        showError(error instanceof Error ? error.message : COPY.sendFailed);
      },
    );
  });

  // The screenshot toggle is pointless when nothing can rasterise the page.
  if (deps.screenshotMode === "dom") {
    void screenshotAvailable().then((ok) => {
      if (!ok) shotField.hidden = true;
    });
  }

  renderKinds();
  fields.render(kind);
  buildBody();

  return {
    root: overlay,
    open: openModal,
    close,
    applyTheme(): void {
      brandRow.replaceChildren(...brandNodes());
      heading.textContent = config.theme.buttonLabel;
    },
    get isOpen() {
      return open;
    },
  };
}

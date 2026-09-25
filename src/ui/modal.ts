/** The feedback dialog. */
import type { ResolvedConfig } from "../types.js";
import type { Draft } from "../transport/index.js";
import { capture, screenshotAvailable } from "../screenshot.js";
import { createFieldSet, type FieldsHost } from "./fields.js";
import { el, svg, trapFocus } from "./dom.js";
import { ICON_PATHS, KIND_HINTS, KIND_ICONS, KIND_LABELS } from "./icons.js";

export interface ModalDeps {
  config: ResolvedConfig;
  fieldsHost: FieldsHost;
  /** The widget's own host element, hidden while the page is rasterised. */
  hostElement: HTMLElement;
  screenshotMode: "dom" | "none";
  knownEmail: string | null;
  submit(draft: Draft): Promise<void>;
}

export interface Modal {
  readonly root: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TITLE = 200;

export function createModal(deps: ModalDeps): Modal {
  const { config } = deps;
  const fields = createFieldSet(config.customFields, deps.fieldsHost);

  let kind = config.kinds[0] ?? "feedback";
  let files: File[] = [];
  let shot: string | null = null;
  let open = false;
  let sending = false;
  let restoreFocus: Element | null = null;

  // ── Nodes ────────────────────────────────────────────────────────────────

  const kindRow = el("div", { class: "fb-kinds", role: "group", "aria-label": "What kind of feedback?" });

  const titleInput = el("input", {
    class: "fb-input",
    id: "fb-title",
    type: "text",
    maxlength: MAX_TITLE,
    placeholder: "Short summary",
  });

  const messageInput = el("textarea", {
    class: "fb-textarea",
    id: "fb-message",
    placeholder: "What happened? What did you expect instead?",
  });

  const emailInput = el("input", {
    class: "fb-input",
    id: "fb-email",
    type: "email",
    autocomplete: "email",
    placeholder: "you@example.com",
  });
  const emailField = el("div", { class: "fb-field" }, [
    el("label", { class: "fb-label", for: "fb-email", text: "Email (optional)" }),
    emailInput,
    el("p", { class: "fb-hint", text: "Only so someone can follow up with you." }),
  ]);

  const shotCheck = el("input", { type: "checkbox", id: "fb-shot", checked: true });
  const shotPreview = el("img", { class: "fb-shot", alt: "Screenshot preview", hidden: true });
  const shotField = el("div", { class: "fb-field" }, [
    el("label", { class: "fb-check", for: "fb-shot" }, [shotCheck, "Include a screenshot of this page"]),
    shotPreview,
  ]);

  const fileInput = el("input", { type: "file", multiple: true, hidden: true });
  const fileList = el("div", { class: "fb-files" });
  const fileButton = el("button", { class: "fb-link", type: "button", text: "+ Attach a file" });
  const fileField = el("div", { class: "fb-field" }, [fileButton, fileList]);

  const errorLine = el("p", { class: "fb-error", role: "alert", hidden: true });

  const privacy = el("p", {
    class: "fb-privacy",
    text:
      "Sending this shares a recording of your recent activity on this page, including console and network " +
      "activity. Password fields and anything marked private are never recorded.",
  });

  const submitButton = el("button", { class: "fb-btn fb-btn-primary", type: "submit", text: "Send" });
  const cancelButton = el("button", { class: "fb-btn fb-btn-ghost", type: "button", text: "Cancel" });

  const body = el("div", { class: "fb-body" });
  const foot = el("div", { class: "fb-foot" }, [cancelButton, submitButton]);

  const closeButton = el("button", { class: "fb-close", type: "button", "aria-label": "Close" }, [
    svg(["M6 6l12 12M18 6L6 18"], 18),
  ]);
  const heading = el("h2", { class: "fb-title", id: "fb-heading", text: config.theme.buttonLabel });
  const head = el("div", { class: "fb-head" }, [heading, closeButton]);

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
        [svg(ICON_PATHS[KIND_ICONS[value] ?? "chat"] ?? ICON_PATHS.chat ?? [], 18), KIND_LABELS[value] ?? value],
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
      const remove = el("button", { class: "fb-link", type: "button", "aria-label": `Remove ${file.name}` }, ["Remove"]);
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

  function buildBody(): void {
    const rows: (Node | string)[] = [];
    if (config.kinds.length > 1) rows.push(kindRow);
    rows.push(
      el("div", { class: "fb-field" }, [
        el("label", { class: "fb-label", for: "fb-title", text: "Title" }),
        titleInput,
      ]),
      el("div", { class: "fb-field" }, [
        el("label", { class: "fb-label", for: "fb-message" }, [
          "Details",
          el("span", { class: "fb-req", text: "*", "aria-hidden": true }),
        ]),
        messageInput,
      ]),
      fields.container,
    );
    if (config.collectEmail && deps.knownEmail === null) rows.push(emailField);
    if (deps.screenshotMode === "dom") rows.push(shotField);
    if (config.attachments) rows.push(fileField);
    rows.push(errorLine, privacy);
    body.replaceChildren(...rows);
  }

  function showDone(): void {
    head.hidden = true;
    form.replaceChildren(
      el("div", { class: "fb-done" }, [
        el("div", { class: "fb-done-mark" }, [svg(["M20 6L9 17l-5-5"], 40)]),
        el("h2", { class: "fb-done-title", text: "Thanks — that's sent." }),
        el("p", { class: "fb-done-text", text: "Someone will take a look at it." }),
      ]),
    );
    window.setTimeout(() => {
      if (open) close();
    }, 2600);
  }

  function reset(): void {
    titleInput.value = "";
    messageInput.value = "";
    emailInput.value = "";
    files = [];
    shot = null;
    sending = false;
    shotPreview.hidden = true;
    shotCheck.checked = true;
    submitButton.disabled = false;
    submitButton.textContent = "Send";
    head.hidden = false;
    kind = config.kinds[0] ?? "feedback";
    showError(null);
    renderKinds();
    renderFiles();
    fields.render(kind);
    form.replaceChildren(body, foot);
    buildBody();
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
      showError(`${oversize.name} is larger than 10 MB.`);
    } else {
      showError(null);
      files = [...files, ...picked].slice(0, MAX_FILES);
    }
    fileInput.value = "";
    renderFiles();
  });

  shotCheck.addEventListener("change", () => {
    if (!shotCheck.checked) {
      shot = null;
      shotPreview.hidden = true;
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (sending) return;

    const message = messageInput.value.trim();
    if (message === "") {
      showError("Tell us what happened before sending.");
      messageInput.setAttribute("aria-invalid", "true");
      messageInput.focus();
      return;
    }
    messageInput.setAttribute("aria-invalid", "false");

    const missing = fields.validate(kind);
    if (missing !== null) {
      showError(`${missing} is required.`);
      return;
    }

    showError(null);
    sending = true;
    submitButton.disabled = true;
    submitButton.textContent = "Sending…";

    const send = async (): Promise<void> => {
      if (deps.screenshotMode === "dom" && shotCheck.checked && shot === null) {
        // Captured at submit time, not at open time: the dialog is in the way
        // until the moment it is hidden for the capture.
        close();
        shot = await capture(deps.hostElement);
        open = true;
        overlay.hidden = false;
      }
      await deps.submit({
        kind,
        title: titleInput.value.trim().slice(0, MAX_TITLE),
        message,
        email: (deps.knownEmail ?? emailInput.value.trim()) || null,
        answers: fields.collect(kind),
        files,
        screenshot: shot,
      });
    };

    void send().then(
      () => showDone(),
      (error: unknown) => {
        sending = false;
        submitButton.disabled = false;
        submitButton.textContent = "Send";
        showError(error instanceof Error ? error.message : "That didn't send. Try again?");
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
    get isOpen() {
      return open;
    },
  };
}

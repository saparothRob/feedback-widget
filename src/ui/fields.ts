/**
 * Operator-declared custom fields.
 *
 * The schema comes from the server, so the widget renders whatever an operator
 * configured without anyone shipping widget code. Validation here is for the
 * person filling the form; the server re-validates everything on ingest and is
 * the only side whose opinion counts.
 */
import type { V1CustomField } from "../wire.js";
import { getJsonOrNull } from "../transport/http.js";
import { el } from "./dom.js";

export interface FieldsHost {
  endpoint: string;
  publicKey: string;
}

interface Bound {
  def: V1CustomField;
  row: HTMLElement;
  read(): unknown;
  markInvalid(invalid: boolean): void;
}

interface DirectoryUser {
  id: string;
  name: string;
}

/** Empty `kinds` means the field applies to every kind. */
export function appliesTo(def: V1CustomField, kind: string): boolean {
  return def.kinds.length === 0 || def.kinds.includes(kind);
}

function labelFor(def: V1CustomField): HTMLElement {
  const label = el("label", { class: "fb-label", for: `fb-cf-${def.key}`, text: def.label });
  if (def.required) label.append(el("span", { class: "fb-req", text: "*", "aria-hidden": true }));
  return label;
}

function buildUserPicker(def: V1CustomField, host: FieldsHost): Bound {
  const listId = `fb-cf-${def.key}-list`;
  const input = el("input", {
    class: "fb-input",
    id: `fb-cf-${def.key}`,
    list: listId,
    type: "text",
    autocomplete: "off",
    placeholder: "Search people…",
  });
  const list = el("datalist", { id: listId });
  const byName = new Map<string, string>();

  let timer: number | undefined;
  const search = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const url = `${host.endpoint}/api/v1/feedback-widgets/by-key/${encodeURIComponent(host.publicKey)}/users?q=${encodeURIComponent(input.value)}`;
      void getJsonOrNull<DirectoryUser[]>(url, host.publicKey).then((users) => {
        if (!Array.isArray(users)) return;
        byName.clear();
        list.replaceChildren();
        for (const user of users) {
          if (typeof user.id !== "string" || typeof user.name !== "string") continue;
          byName.set(user.name, user.id);
          list.append(el("option", { value: user.name }));
        }
      });
    }, 220);
  };
  input.addEventListener("input", search);
  input.addEventListener("focus", search);

  const row = el("div", { class: "fb-field" }, [labelFor(def), input, list]);
  return {
    def,
    row,
    // The server wants the user's id, not their name. A typed-but-unmatched name
    // resolves to nothing, which reads as "left blank".
    read: () => byName.get(input.value.trim()) ?? "",
    markInvalid: (invalid) => input.setAttribute("aria-invalid", String(invalid)),
  };
}

function buildField(def: V1CustomField, host: FieldsHost): Bound {
  const id = `fb-cf-${def.key}`;

  if (def.type === "user") return buildUserPicker(def, host);

  if (def.type === "bool") {
    const input = el("input", { type: "checkbox", id });
    const row = el("div", { class: "fb-field" }, [
      el("label", { class: "fb-check", for: id }, [input, def.label]),
    ]);
    return { def, row, read: () => input.checked, markInvalid: () => undefined };
  }

  if (def.type === "select") {
    const select = el("select", { class: "fb-select", id });
    select.append(el("option", { value: "", text: def.required ? "Choose…" : "—" }));
    for (const option of def.options) select.append(el("option", { value: option, text: option }));
    const row = el("div", { class: "fb-field" }, [labelFor(def), select]);
    return {
      def,
      row,
      read: () => select.value,
      markInvalid: (invalid) => select.setAttribute("aria-invalid", String(invalid)),
    };
  }

  const type = def.type === "number" ? "number" : def.type === "date" ? "date" : "text";
  const input = el("input", { class: "fb-input", id, type });
  const row = el("div", { class: "fb-field" }, [labelFor(def), input]);
  return {
    def,
    row,
    read: () => {
      const raw = input.value.trim();
      if (raw === "") return "";
      if (def.type === "number") {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : raw;
      }
      return raw;
    },
    markInvalid: (invalid) => input.setAttribute("aria-invalid", String(invalid)),
  };
}

const isBlank = (value: unknown): boolean =>
  value === "" || value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));

export interface FieldSet {
  /** Re-render for a different kind. Answers to fields that still apply survive. */
  render(kind: string): void;
  /** Non-blank answers only; blank optional fields are dropped, not sent as "". */
  collect(kind: string): Record<string, unknown>;
  /** Marks offenders and returns the first missing field's label. */
  validate(kind: string): string | null;
  readonly container: HTMLElement;
}

export function createFieldSet(defs: V1CustomField[], host: FieldsHost): FieldSet {
  const container = el("div", { class: "fb-fields" });
  const bounds = new Map<string, Bound>();

  const boundFor = (def: V1CustomField): Bound => {
    const existing = bounds.get(def.key);
    if (existing) return existing;
    const created = buildField(def, host);
    bounds.set(def.key, created);
    return created;
  };

  const applicable = (kind: string): V1CustomField[] => defs.filter((d) => appliesTo(d, kind));

  return {
    container,
    render(kind: string): void {
      // Reuse the bound nodes rather than rebuilding them: switching kind and
      // switching back must not wipe what someone already typed.
      container.replaceChildren(...applicable(kind).map((def) => boundFor(def).row));
    },
    collect(kind: string): Record<string, unknown> {
      const answers: Record<string, unknown> = {};
      for (const def of applicable(kind)) {
        const value = boundFor(def).read();
        if (!isBlank(value) && value !== false) answers[def.key] = value;
      }
      return answers;
    },
    validate(kind: string): string | null {
      let firstMissing: string | null = null;
      for (const def of applicable(kind)) {
        const bound = boundFor(def);
        const missing = def.required && isBlank(bound.read());
        bound.markInvalid(missing);
        if (missing && firstMissing === null) firstMissing = def.label;
      }
      return firstMissing;
    },
  };
}

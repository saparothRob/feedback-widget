/** Minimal DOM helpers. No framework: the widget has to be small and it has to
 *  survive being embedded in a host app that already has its own. */

type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") node.className = String(value);
    else if (name === "text") node.textContent = String(value);
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

/** SVG needs the namespaced constructor; `createElement` yields an unknown element. */
export function svg(paths: string[], size = 20): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const root = document.createElementNS(ns, "svg");
  root.setAttribute("viewBox", "0 0 24 24");
  root.setAttribute("width", String(size));
  root.setAttribute("height", String(size));
  root.setAttribute("fill", "none");
  root.setAttribute("stroke", "currentColor");
  root.setAttribute("stroke-width", "1.8");
  root.setAttribute("stroke-linecap", "round");
  root.setAttribute("stroke-linejoin", "round");
  root.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    root.append(path);
  }
  return root;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab inside the dialog. Without this, tabbing walks out of the shadow root
 * and into the host page behind the overlay.
 */
export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === container.ownerDocument.activeElement,
  );
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;

  const active = (container.getRootNode() as ShadowRoot).activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Readable foreground for an arbitrary accent, so a pale accent still reads. */
export function contrastOn(hex: string): string {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw.slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return "#ffffff";
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  // Rec. 601 luma; the threshold is where white text stops being comfortable.
  return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? "#111827" : "#ffffff";
}

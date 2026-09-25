/**
 * The widget's own piece of the page: one host element, one shadow root.
 *
 * Everything the widget renders lives inside that shadow root. The host app's
 * stylesheet cannot reach in and break the dialog, and none of the widget's CSS
 * can escape and restyle the app it is embedded in. This is the single most
 * important difference between a widget that survives arbitrary host apps and
 * one that works only on the page it was written against.
 */
import type { ResolvedConfig } from "../types.js";
import { contrastOn, el, svg } from "./dom.js";
import { ICON_PATHS } from "./icons.js";
import { STYLES } from "./styles.js";

export interface Shell {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  /** Where widget UI goes. Carries the reset and the design tokens. */
  readonly mount: HTMLElement;
  readonly launcher: HTMLButtonElement;
  destroy(): void;
}

export function createShell(config: ResolvedConfig, onLaunch: () => void): Shell {
  const host = el("div", { "data-nerva-feedback": "" });
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.append(style);

  const mount = el("div", { class: "fb-scope" });
  shadow.append(mount);

  // Only the accent goes inline, and it goes on .fb-scope rather than the host
  // element - an inline declaration outranks the stylesheet, so this survives
  // the all:initial that .fb-scope carries.
  const accent = config.theme.accent;
  mount.style.setProperty("--fb-accent", accent);
  mount.style.setProperty("--fb-on-accent", contrastOn(accent));

  const shape = config.theme.buttonShape;
  const launcher = el("button", {
    class: `fb-launcher ${shape} ${config.theme.position}${config.theme.buttonPulse ? " pulse" : ""}`,
    type: "button",
    "aria-haspopup": "dialog",
    "aria-label": config.theme.buttonLabel,
  }, [
    svg(ICON_PATHS[config.theme.icon] ?? ICON_PATHS.chat ?? [], shape === "circle" ? 22 : 18),
    el("span", { class: "fb-launcher-label", text: config.theme.buttonLabel }),
  ]);
  launcher.addEventListener("click", onLaunch);
  mount.append(launcher);

  document.body.append(host);

  return {
    host,
    shadow,
    mount,
    launcher,
    destroy(): void {
      host.remove();
    },
  };
}

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

const FONTS_LINK_ID = "nerva-feedback-fonts";
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap";

/**
 * The register's faces. @font-face cannot live inside a shadow root, so the
 * one document-level link goes into the host page's head — id-guarded, once,
 * and only when the nerva skin wants it. Hosts that forbid the request set
 * `theme.loadFonts: false` and the skin rides its system fallbacks.
 */
function ensureFonts(config: ResolvedConfig): void {
  const wanted = config.theme.skin === "nerva" && config.theme.loadFonts;
  if (!wanted || document.getElementById(FONTS_LINK_ID) !== null) return;
  document.head.append(
    el("link", { id: FONTS_LINK_ID, rel: "stylesheet", href: FONTS_HREF }),
  );
}

export function createShell(config: ResolvedConfig, onLaunch: () => void): Shell {
  const host = el("div", { "data-nerva-feedback": "" });
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.append(style);

  const mount = el("div", {
    class: "fb-scope",
    "data-skin": config.theme.skin,
    "data-scheme": config.theme.colorScheme,
  });
  shadow.append(mount);

  ensureFonts(config);

  // Only the accent and geometry go inline, and they go on .fb-scope rather
  // than the host element - an inline declaration outranks the stylesheet, so
  // this survives the all:initial that .fb-scope carries.
  const accent = config.theme.accent;
  mount.style.setProperty("--fb-accent", accent);
  mount.style.setProperty("--fb-on-accent", contrastOn(accent));
  mount.style.setProperty("--fb-radius", `${config.theme.radius}px`);

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

/**
 * The widget's own piece of the page: one host element, one shadow root.
 *
 * Everything the widget renders lives inside that shadow root. The host app's
 * stylesheet cannot reach in and break the dialog, and none of the widget's CSS
 * can escape and restyle the app it is embedded in. This is the single most
 * important difference between a widget that survives arbitrary host apps and
 * one that works only on the page it was written against.
 */
import type { ButtonShape, ResolvedConfig, ThemeOptions } from "../types.js";
import { contrastOn, el, svg } from "./dom.js";
import { ICON_PATHS } from "./icons.js";
import { STYLES } from "./styles.js";

export interface Shell {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  /** Where widget UI goes. Carries the reset and the design tokens. */
  readonly mount: HTMLElement;
  readonly launcher: HTMLButtonElement;
  applyTheme(theme: Required<ThemeOptions>): void;
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
function ensureFonts(theme: Required<ThemeOptions>): void {
  const wanted = theme.skin === "nerva" && theme.loadFonts;
  if (!wanted || document.getElementById(FONTS_LINK_ID) !== null) return;
  document.head.append(
    el("link", { id: FONTS_LINK_ID, rel: "stylesheet", href: FONTS_HREF }),
  );
}

const CIRCLE_ICON_SIZE = 22;
const PILL_ICON_SIZE = 18;
const ICON_SIZES: Record<ButtonShape, number> = {
  circle: CIRCLE_ICON_SIZE,
  pill: PILL_ICON_SIZE,
};

export function createShell(config: ResolvedConfig, onLaunch: () => void): Shell {
  const host = el("div", { "data-nerva-feedback": "" });
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.append(style);

  const mount = el("div", { class: "fb-scope" });
  shadow.append(mount);

  const launcher = el("button", { type: "button", "aria-haspopup": "dialog" });
  launcher.addEventListener("click", onLaunch);
  mount.append(launcher);

  function applyTheme(theme: Required<ThemeOptions>): void {
    mount.setAttribute("data-skin", theme.skin);
    mount.setAttribute("data-scheme", theme.colorScheme);
    ensureFonts(theme);

    // Only the accent and geometry go inline, and they go on .fb-scope rather
    // than the host element - an inline declaration outranks the stylesheet, so
    // this survives the all:initial that .fb-scope carries.
    mount.style.setProperty("--fb-accent", theme.accent);
    mount.style.setProperty("--fb-on-accent", contrastOn(theme.accent));
    mount.style.setProperty("--fb-radius", `${theme.radius}px`);

    launcher.className = ["fb-launcher", theme.buttonShape, theme.position, ...(theme.buttonPulse ? ["pulse"] : [])].join(" ");
    launcher.setAttribute("aria-label", theme.buttonLabel);
    launcher.replaceChildren(
      svg(ICON_PATHS[theme.icon] ?? ICON_PATHS.chat ?? [], ICON_SIZES[theme.buttonShape]),
      el("span", { class: "fb-launcher-label", text: theme.buttonLabel }),
    );
  }

  applyTheme(config.theme);
  document.body.append(host);

  return {
    host,
    shadow,
    mount,
    launcher,
    applyTheme,
    destroy(): void {
      host.remove();
    },
  };
}

/**
 * Optional DOM rasterisation.
 *
 * `html2canvas` is an optional peer, reached only through a dynamic import, for
 * three reasons: it is ~200KB, plenty of host apps already ship it, and a widget
 * whose screenshot support is absent should still mount and still let someone
 * attach a file by hand.
 */

interface Html2CanvasOptions {
  backgroundColor: string | null;
  logging: boolean;
  scale: number;
  useCORS: boolean;
  ignoreElements?: (element: Element) => boolean;
}

type Html2Canvas = (element: HTMLElement, options: Html2CanvasOptions) => Promise<HTMLCanvasElement>;

let cached: Html2Canvas | null | undefined;

async function loadHtml2Canvas(): Promise<Html2Canvas | null> {
  if (cached !== undefined) return cached;
  try {
    const mod = await import(/* @vite-ignore */ "html2canvas");
    const candidate: unknown = mod.default ?? mod;
    cached = typeof candidate === "function" ? (candidate as Html2Canvas) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function screenshotAvailable(): Promise<boolean> {
  return loadHtml2Canvas().then((fn) => fn !== null);
}

/**
 * Rasterise the page to a JPEG data URL.
 *
 * `hide` is the widget's own host element: it is taken out of the layout for the
 * duration so the capture shows the page someone is complaining about rather
 * than the form they are complaining in.
 */
export async function capture(hide: HTMLElement | null): Promise<string | null> {
  const html2canvas = await loadHtml2Canvas();
  if (!html2canvas) return null;

  const previous = hide?.style.display ?? "";
  if (hide) hide.style.display = "none";
  try {
    const canvas = await html2canvas(document.body, {
      backgroundColor: null,
      logging: false,
      // Half scale: a retina-resolution full-page PNG is several MB, and the
      // screenshot rides inside the report body.
      scale: Math.min(1, window.devicePixelRatio || 1) * 0.5,
      useCORS: true,
      ignoreElements: (element) => element === hide,
    });
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  } finally {
    if (hide) hide.style.display = previous;
  }
}

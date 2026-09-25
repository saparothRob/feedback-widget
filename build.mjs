// Bundler for @nerva/feedback-widget.
//
// Three artefacts, one source tree:
//   dist/index.js         ESM  — `import { mountFeedback } from "@nerva/feedback-widget"`
//   dist/index.cjs        CJS  — `require("@nerva/feedback-widget")`
//   dist/global.iife.js   IIFE — `<script src=...>` for bundler-less host apps
//
// rrweb is bundled, not externalised: the recorder must be running before the
// user hits the button, so there is no point at which a lazy chunk could load
// in time to capture the lookback window.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/** html2canvas is an optional peer, reached only through a dynamic import. */
const external = ["html2canvas"];

const shared = {
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["es2020", "chrome90", "firefox90", "safari15", "edge90"],
  legalComments: "none",
  define: { __WIDGET_VERSION__: JSON.stringify(pkg.version) },
  logLevel: "info",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    format: "esm",
    platform: "browser",
    external,
  }),
  build({
    ...shared,
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.cjs",
    format: "cjs",
    platform: "browser",
    external,
  }),
  build({
    ...shared,
    entryPoints: ["src/global.ts"],
    outfile: "dist/global.iife.js",
    format: "iife",
    platform: "browser",
    // The IIFE build is for pages with no bundler, so nothing may stay external:
    // html2canvas is simply absent there and screenshot capture degrades to
    // manual file attach.
    external,
  }),
]);

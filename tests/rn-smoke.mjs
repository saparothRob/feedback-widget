/**
 * React-native smoke test, node edition.
 *
 * Playwright cannot run a react-native app, so this exercises the HEADLESS
 * client - the shipped `dist/react-native-client.js` artefact - against the
 * same stand-in server the web suite uses, in legacy mode (which is what Nerva
 * serves today). It asserts the things the RN entry exists for: that the
 * bundle imports no react and no rrweb, that bootstrap resolves the legacy
 * config, and that submit posts a valid camelCase session+item pair with the
 * console/network breadcrumbs in the session and the sessionKey linking the
 * two. `react-native` itself is aliased to `tests/rn-stub.mjs`; the UI
 * components get a types-compile check only (`npm run typecheck`).
 *
 *   node tests/rn-smoke.mjs   (after `npm run build`)
 */
import { build } from "esbuild";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMockServer } from "./mock-server.mjs";

let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}

const SCREENSHOT_DATA_URL = "data:image/png;base64,AAAA";
const clientBundle = fileURLToPath(new URL("../dist/react-native-client.js", import.meta.url));

console.log("\nreact-native headless client (legacy transport)");

// ── The shipped artefact pulls in nothing web- or react-shaped ───────────────

const bundleText = await readFile(clientBundle, "utf8");
check("client bundle imports no react", !bundleText.includes('"react"') && !bundleText.includes("'react'"));
check("client bundle contains no rrweb code", !bundleText.includes("rrweb-plugin") && !bundleText.includes("checkoutEveryNms"));
check("client bundle contains no html2canvas", !bundleText.includes("html2canvas"));

// ── Make it importable in node: alias react-native to the stub ───────────────

const outfile = join(await mkdtemp(join(tmpdir(), "rn-smoke-")), "client.node.mjs");
await build({
  entryPoints: [clientBundle],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  alias: { "react-native": fileURLToPath(new URL("./rn-stub.mjs", import.meta.url)) },
  logLevel: "silent",
});
const { createFeedbackClient } = await import(pathToFileURL(outfile).href);

const server = await startMockServer("legacy");
const untappedFetch = globalThis.fetch;
const untappedLog = console.log;

try {
  const client = await createFeedbackClient({
    endpoint: server.origin,
    publicKey: "test_key_123",
    user: { id: "u-9", email: "mob@example.com", name: "Mob" },
    metadata: { release: "9.9.9" },
    screenName: "settings/profile",
    captureScreenshot: () => Promise.resolve(SCREENSHOT_DATA_URL),
  });

  check("probe fell back to the legacy contract", client.transport === "legacy", client.transport);
  check("server config drives the theme", client.config.theme.buttonLabel === "Tell us", client.config.theme.buttonLabel);
  check("server config drives the kind list", client.config.kinds.length === 3, JSON.stringify(client.config.kinds));
  check("server config drives the lookback", client.config.replay.lookbackMs === 30_000, client.config.replay.lookbackMs);
  check("console tap is installed", console.log !== untappedLog);
  check("fetch tap is installed", globalThis.fetch !== untappedFetch);

  // Activity the breadcrumbs should catch - and one URL that must be redacted.
  console.log("mobile log line", { detail: 7 });
  await fetch(`${server.origin}/tests/fixture.html`);
  await fetch(`${server.origin}/anything?token=SHOULD_BE_REDACTED`);

  client.identify({ name: "Mobbed" });
  client.setMetadata({ tab: "billing" });
  client.setScreen("settings/billing");

  const result = await client.submit({ kind: "bug", title: "Broken on mobile", message: "It fell over." });
  check("submit resolved with the created id", result.id === "item-1", JSON.stringify(result));

  const session = server.received.find((p) => p.path === "/api/feedback-collect/session");
  const item = server.received.find((p) => p.path === "/api/feedback-collect/item");
  check("posted a legacy session", session !== undefined);
  check("posted a legacy item", item !== undefined);
  check("every post carried the widget key", server.received.every((p) => p.key === "test_key_123"));

  // The camelCase legacy contract, exactly as the web widget speaks it.
  check("session is camelCase", session?.body?.sessionKey !== undefined && session?.body?.pageUrl !== undefined);
  check("item is camelCase", item?.body?.itemType !== undefined && item?.body?.pageUrl !== undefined);
  check("sessionKey links item to session", item?.body?.sessionKey === session?.body?.sessionKey);
  check("sessionKey parked in item metadata too", JSON.parse(item?.body?.metadata ?? "{}").sessionKey === session?.body?.sessionKey);

  // Mobile sends no replay: the events column is an empty JSON array, while
  // the console/network breadcrumbs ride in their own columns.
  check("session events are empty (no replay on mobile)", session?.body?.events === "[]", session?.body?.events?.slice(0, 40));
  const consoleLogs = JSON.parse(session?.body?.consoleLogs ?? "[]");
  const networkLogs = JSON.parse(session?.body?.networkLogs ?? "[]");
  check("console buffer captured", consoleLogs.some((entry) => entry.level === "log" && entry.args.some((a) => a.includes("mobile log line"))), JSON.stringify(consoleLogs).slice(0, 200));
  check("console args are stringified", consoleLogs.some((entry) => entry.args.some((a) => a.includes('"detail":7'))));
  check("network breadcrumbs captured", networkLogs.some((entry) => entry.url.includes("/tests/fixture.html") && entry.method === "GET"), JSON.stringify(networkLogs).slice(0, 200));
  check("network breadcrumbs carry status", networkLogs.every((entry) => entry.status === null || typeof entry.status === "number"));
  check("redacted the token query param", !JSON.stringify(networkLogs).includes("SHOULD_BE_REDACTED"));
  check("never recorded its own ingest traffic", !networkLogs.some((entry) => entry.url.includes("/api/feedback-collect")), JSON.stringify(networkLogs.map((e) => e.url)));

  // What the host app and the environment contribute.
  check("pageUrl follows the screen name", item?.body?.pageUrl === "app://settings/billing", item?.body?.pageUrl);
  check("viewport comes from Dimensions", session?.body?.viewportWidth === 390 && session?.body?.viewportHeight === 844);
  check("userAgent names the runtime", session?.body?.userAgent?.startsWith("ReactNative/"), session?.body?.userAgent);
  check("identity hints reach the session", session?.body?.userEmail === "mob@example.com" && session?.body?.userName === "Mobbed");
  check("host metadata reaches the item", JSON.parse(item?.body?.metadata ?? "{}").release === "9.9.9" && JSON.parse(item?.body?.metadata ?? "{}").tab === "billing");
  check("host-captured screenshot reaches the item", item?.body?.screenshotData === SCREENSHOT_DATA_URL);

  // A kind outside the legacy CHECK constraint must fall back, not 500.
  await client.submit({ kind: "nonsense", title: "", message: "Kind fallback check." });
  const second = server.received.filter((p) => p.path === "/api/feedback-collect/item")[1];
  check("unknown kind falls back to a value the CHECK accepts", second?.body?.itemType === "feedback", second?.body?.itemType);

  client.destroy();
  check("destroy restores console", console.log === untappedLog);
  check("destroy restores fetch", globalThis.fetch === untappedFetch);
} finally {
  globalThis.fetch = untappedFetch;
  console.log = untappedLog;
  server.close();
}

console.log(failures === 0 ? "\nall react-native checks passed" : `\n${failures} react-native check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

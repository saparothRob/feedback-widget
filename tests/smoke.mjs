/**
 * End-to-end smoke test.
 *
 * Runs the real bundle in a real browser against a stand-in server, in both
 * transport modes. It is asserting the things that a typecheck cannot: that the
 * widget mounts, that the shadow boundary holds against hostile host CSS, that
 * the recorder actually produced a playable replay, that redaction happened at
 * capture time, and that the right contract was chosen.
 *
 *   node tests/smoke.mjs
 */
import { chromium } from "playwright";
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

const TRAIL_KEY = "nerva-feedback:test_key_123:trail";
const SESSION_KEY = "nerva-feedback:test_key_123:session";
const SEEDED_AGE_MS = 7 * 60_000;
const PERSIST_WAIT_MS = 2_600;
const PREFILLED_EMAIL = "pre@example.com";
const TYPED_EMAIL = "rep@example.com";
const META = 4;
const FULL_SNAPSHOT = 2;
const PLUGIN = 6;
const BEFORE_RELOAD_MARK = "logged before the reload";
const CLOCK_TOLERANCE_MS = 5_000;
const NETWORK_SETTLE_MS = 1_200;
const WIDGET_MARKERS = ["fb-scope", "fb-launcher", "fb-panel", "data-nerva-feedback"];
const HOST_MARKER = "host-button";
const LOOKBACK_MS = 600_000;

const ready = (page) => page.waitForFunction(() => window.__ready === true, null, { timeout: 20_000 });
const errorCount = (text) => Number((/(\d+) errors?/.exec(text ?? "") ?? [])[1] ?? NaN);
const widgetLeaks = (events) => WIDGET_MARKERS.filter((marker) => JSON.stringify(events).includes(marker));
const snapshotOf = (events) => events.find((e) => e.type === FULL_SNAPSHOT);
const isIso = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)) && value.endsWith("Z");

async function run(mode) {
  console.log(`\n${mode} transport`);
  const server = await startMockServer(mode);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    if (mode === "legacy") {
      await page.addInitScript(
        ({ key, age }) => {
          if (sessionStorage.getItem(key) === null) {
            sessionStorage.setItem(key, JSON.stringify([{ ts: Date.now() - age, kind: "error", label: "seeded old error" }]));
          }
        },
        { key: TRAIL_KEY, age: SEEDED_AGE_MS },
      );
    }

    const entry = mode === "v1" ? `${server.origin}/?email=${PREFILLED_EMAIL}` : server.origin;
    await page.goto(entry, { waitUntil: "networkidle" });
    await ready(page);

    let sessionBeforeReload = null;
    let postedAt = 0;
    if (mode === "legacy") {
      await page.waitForTimeout(PERSIST_WAIT_MS);
      sessionBeforeReload = await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
      await page.evaluate((mark) => console.error(mark), BEFORE_RELOAD_MARK);
      await page.reload({ waitUntil: "networkidle" });
      await ready(page);
      const after = await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
      check("session id survives a reload in the same tab", sessionBeforeReload !== null && after === sessionBeforeReload, `${sessionBeforeReload} -> ${after}`);
      postedAt = await page.evaluate(async () => {
        const at = Date.now();
        await fetch("/boom", { method: "POST", body: "{}" }).catch(() => undefined);
        return at;
      });
      await page.waitForTimeout(NETWORK_SETTLE_MS);
    }

    const transport = await page.evaluate(() => window.__transport);
    check("chose the right contract", transport === mode, `got ${transport}`);

    const launcher = page.locator(".fb-launcher");
    await launcher.waitFor({ state: "visible", timeout: 10_000 });

    // The host page styles every button lime, 40px, with a red dashed border.
    // If any of that reached the launcher, the shadow root leaked.
    const styles = await launcher.evaluate((node) => {
      const s = getComputedStyle(node);
      return { bg: s.backgroundColor, size: s.fontSize, border: s.borderTopStyle };
    });
    check("host CSS does not reach the widget", styles.bg !== "rgb(0, 255, 0)" && styles.size !== "40px", JSON.stringify(styles));

    if (mode === "v1") {
      const label = await launcher.getAttribute("aria-label");
      check("server config drives the theme", label === "Report", `label=${label}`);
      check("server config drives the position", (await launcher.getAttribute("class")).includes("bottom-left"));
    } else {
      // The legacy contract gained its own config route; without it the widget
      // would silently fall back to package defaults ("Feedback", bottom-right).
      const label = await launcher.getAttribute("aria-label");
      check("legacy config route drives the theme", label === "Tell us", `label=${label}`);
      check("legacy config route drives the position", (await launcher.getAttribute("class")).includes("top-right"));
      const kinds = await page.locator(".fb-kind").count();
      check("legacy config route drives the kind list", kinds === 3, `${kinds} kinds`);
    }

    check("global entry exposes setTheme", await page.evaluate(() => typeof window.NervaFeedback.setTheme === "function"));
    check("mounted handle exposes setTheme", await page.evaluate(() => typeof window.__handle.setTheme === "function"));

    let themedAt = 0;
    if (mode === "v1") {
      themedAt = await page.evaluate(() => {
        const at = Date.now();
        window.__handle.setTheme({ colorScheme: "dark", buttonLabel: "Report it", skin: "plain" });
        return at;
      });
      const scope = await page.evaluate(() => {
        const node = document.querySelector("[data-nerva-feedback]").shadowRoot.querySelector(".fb-scope");
        return { scheme: node.getAttribute("data-scheme"), skin: node.getAttribute("data-skin") };
      });
      check("setTheme re-skins in place", scope.scheme === "dark" && scope.skin === "plain", JSON.stringify(scope));
      check("setTheme relabels the launcher", (await launcher.getAttribute("aria-label")) === "Report it");
      check("setTheme keeps a single widget host", (await page.locator("[data-nerva-feedback]").count()) === 1);
    }

    await launcher.click();
    await page.locator(".fb-panel").waitFor({ state: "visible", timeout: 5_000 });

    const noticed = page.locator(".fb-noticed");
    check("we-noticed line names the latest moment", (await noticed.isVisible()) && /boom|fixture failure/.test(await noticed.textContent()), await noticed.textContent());
    const facts = await page.locator(".fb-share-facts").textContent();
    check("sharing line counts pages, errors and failed requests", /page/.test(facts) && /error/.test(facts) && /failed request/.test(facts), facts);

    // Inherited properties cross the shadow boundary: the host page sets
    // `* { letter-spacing: 3px }`, which matches the widget's own host element
    // and inherits inwards. Outer-tree rules outrank `:host`, so the reset has
    // to live on a wrapper inside the shadow root. Check text inside the dialog,
    // not just the launcher.
    const inner = await page.locator(".fb-title").evaluate((node) => {
      const s = getComputedStyle(node);
      return { spacing: s.letterSpacing, font: s.fontFamily, color: s.color };
    });
    check("inherited host CSS does not cross the shadow boundary", inner.spacing === "normal", JSON.stringify(inner));
    check("widget keeps its own font stack", !inner.font.includes("serif") || inner.font.includes("sans-serif"), inner.font);

    if (mode === "v1") {
      // "team" is declared for the bug kind only, so it must appear after the
      // kind switch and not before.
      check("kind-filtered field is hidden for the default kind", (await page.locator("#fb-cf-team").count()) === 0);
      await page.locator('.fb-kind[data-kind="idea"]').click();
      check("kind-filtered field appears for its kind", (await page.locator("#fb-cf-team").count()) === 1);
      check("unfiltered field is always present", (await page.locator("#fb-cf-steps").count()) === 1);

      // Required custom field blocks the send.
      await page.locator("#fb-message").fill("Something broke on this page.");
      await page.locator(".fb-btn-primary").click();
      await page.locator(".fb-error").waitFor({ state: "visible", timeout: 3_000 });
      check("required custom field blocks submit", (await page.locator(".fb-error").textContent()).includes("Team"));
      await page.locator("#fb-cf-team").selectOption("Backend");

      check("email is prefilled from the host's user", (await page.locator("#fb-email").inputValue()) === PREFILLED_EMAIL);
      check("a lookback under the trim steps hides the trim select", !(await page.locator(".fb-share-row").isVisible()));
      await page.locator("#fb-title").fill("Broken thing");
    } else {
      check("replay on leaves the trim select visible", await page.locator(".fb-share-row").isVisible());
      check("seeded trail entry is counted in the full window", errorCount(facts) >= 2, facts);
      await page.locator("#fb-window").selectOption({ label: "2 min" });
      const trimmed = await page.locator(".fb-share-facts").textContent();
      check("trimming recounts the sharing line", errorCount(trimmed) === errorCount(facts) - 1, `${facts} -> ${trimmed}`);

      await page.locator("#fb-message").fill("Something broke on this page.\nSecond line with detail.");
      check("email field is shown when required", await page.locator("#fb-email").isVisible());
      await page.locator(".fb-btn-primary").click();
      await page.locator(".fb-error").waitFor({ state: "visible", timeout: 3_000 });
      check("required email blocks send", /email/i.test(await page.locator(".fb-error").textContent()));
      check("required email marks the input invalid", (await page.locator("#fb-email").getAttribute("aria-invalid")) === "true");
      check("nothing was posted while email was missing", !server.received.some((p) => p.path === "/api/feedback-collect/item"));
      await page.locator("#fb-email").fill(TYPED_EMAIL);
    }

    await page.locator(".fb-btn-primary").click();
    await page.locator(".fb-done").waitFor({ state: "visible", timeout: 15_000 });
    check("submit reaches the done state", true);

    const posts = server.received;
    check("posted something", posts.length > 0);
    check("every post carried the widget key", posts.every((p) => p.key === "test_key_123"), JSON.stringify(posts.map((p) => p.key)));

    if (mode === "v1") {
      const ingest = posts.find((p) => p.path === "/api/v1/feedback/ingest");
      check("hit the v1 ingest route", ingest !== undefined);
      check("sent snake_case", ingest?.body?.page_url !== undefined);
      check("sent the custom field answers", ingest?.body?.custom_fields?.team === "Backend", JSON.stringify(ingest?.body?.custom_fields));
      check("sent host metadata verbatim", ingest?.body?.metadata?.release === "1.2.3");
      check("sent the identity hint", ingest?.body?.submitter_id === "u-1");

      const events = ingest?.body?.replay_events ?? [];
      check("recorded a replay", events.length > 2, `${events.length} events`);
      check("seq is dense and ordered", events.every((e, i) => e.seq === i));
      check("replay opens with a full snapshot", events[0]?.type === 4 && events[1]?.type === 2, `types ${events[0]?.type},${events[1]?.type}`);
      check("full snapshot still records the host page", JSON.stringify(snapshotOf(events) ?? {}).includes(HOST_MARKER));
      check("replay records none of the widget's own UI", widgetLeaks(events.filter((e) => e.type !== PLUGIN)).length === 0, JSON.stringify(widgetLeaks(events)));

      const plugins = events.filter((e) => e.type === 6);
      const consoleEvents = plugins.filter((e) => e.data?.plugin === "rrweb/console@1");
      const networkEvents = plugins.filter((e) => e.data?.plugin === "rrweb/network@1");
      check("captured console output", consoleEvents.length > 0);
      check("captured network activity", networkEvents.length > 0);

      const urls = networkEvents.flatMap((e) => (e.data?.payload?.requests ?? []).map((r) => r.name ?? ""));
      check("never recorded its own ingest POST", !urls.some((u) => u.includes("/api/v1/feedback")), JSON.stringify(urls));
      check("redacted the token query param", !urls.some((u) => u.includes("SHOULD_BE_REDACTED")), JSON.stringify(urls));

      check("setTheme did not restart the replay", events[0]?.ts < themedAt, `first ${events[0]?.ts} vs setTheme ${themedAt}`);
      check("prefilled email reaches the submission", ingest?.body?.submitter_email === PREFILLED_EMAIL, ingest?.body?.submitter_email);
      const trail = ingest?.body?.trail ?? [];
      check("v1 carries the trail", Array.isArray(trail) && trail.length > 0, JSON.stringify(trail).slice(0, 200));
      check("v1 carries moment_at", isIso(ingest?.body?.moment_at), ingest?.body?.moment_at);
    } else {
      const session = posts.find((p) => p.path === "/api/feedback-collect/session");
      const item = posts.find((p) => p.path === "/api/feedback-collect/item");
      check("hit the legacy session route", session !== undefined);
      check("hit the legacy item route", item !== undefined);
      check("sent camelCase", item?.body?.pageUrl !== undefined);
      check("kind fell back to a value the CHECK accepts", ["feedback", "bug", "idea", "praise"].includes(item?.body?.itemType));
      check("session columns are JSON strings", typeof session?.body?.events === "string");

      const events = JSON.parse(session?.body?.events ?? "[]");
      const consoleLogs = JSON.parse(session?.body?.consoleLogs ?? "[]");
      const network = JSON.parse(session?.body?.networkLogs ?? "[]");
      check("recorded a replay", events.length > 2, `${events.length} events`);
      check("split console out of the replay", consoleLogs.length > 0);
      check("split network out of the replay", network.length > 0);
      check("dropped plugin events from the playable stream", events.every((e) => e.type !== 6));
      check("full snapshot still records the host page", JSON.stringify(snapshotOf(events) ?? {}).includes(HOST_MARKER));
      check("replay records none of the widget's own UI", widgetLeaks(events).length === 0, JSON.stringify(widgetLeaks(events)));

      const marked = consoleLogs.filter((e) => e.args.some((arg) => arg.includes(BEFORE_RELOAD_MARK)));
      check("console output from before the reload reaches consoleLogs exactly once", marked.length === 1, `${marked.length} entries`);
      check("console entries carry epoch-ms timestamps", consoleLogs.every((e) => Math.abs(e.ts - postedAt) < LOOKBACK_MS), JSON.stringify(consoleLogs.map((e) => e.ts)));
      const posted = network.filter((e) => e.url.includes("/boom") && e.method === "POST");
      check("network log records the real method of a failing POST", posted.length === 1, JSON.stringify(network.map((e) => `${e.method} ${e.url}`)));
      check("network entry ts is epoch ms on the wall clock", posted.length === 1 && Math.abs(posted[0].ts - postedAt) < CLOCK_TOLERANCE_MS, `${posted[0]?.ts} vs ${postedAt}`);
      check("every network entry ts is epoch ms", network.every((e) => Math.abs(e.ts - postedAt) < LOOKBACK_MS), JSON.stringify(network.map((e) => e.ts)));
      check("GET requests keep their method", network.some((e) => e.url.includes("/another/host/call") && e.method === "GET"), JSON.stringify(network.map((e) => `${e.method} ${e.url}`)));
      check("carried the session key into the item", item?.body?.sessionKey === session?.body?.sessionKey);
      check("parked the session key in metadata too", JSON.parse(item?.body?.metadata ?? "{}").sessionKey === session?.body?.sessionKey);

      check("session key is the tab's persisted id", session?.body?.sessionKey === sessionBeforeReload, session?.body?.sessionKey);
      check("replay survives the reload (two full snapshots)", events.filter((e) => e.type === META).length >= 2, `${events.filter((e) => e.type === META).length} meta events`);
      check("trimmed replay still opens with a full snapshot", events[0]?.type === META, `type ${events[0]?.type}`);
      check("blank title derives from the message's first line", item?.body?.title === "Something broke on this page.", item?.body?.title);
      check("typed email reaches the item", item?.body?.userEmail === TYPED_EMAIL, item?.body?.userEmail);

      check("session trail is a JSON string", typeof session?.body?.trail === "string");
      const trail = JSON.parse(session?.body?.trail ?? "[]");
      const kinds = new Set(trail.map((e) => e.kind));
      check("trail records navigation", kinds.has("nav"), JSON.stringify([...kinds]));
      check("trail records clicks", trail.some((e) => e.kind === "click" && e.label.includes("A host button")), JSON.stringify(trail.filter((e) => e.kind === "click")));
      check("trail records console errors", trail.some((e) => e.kind === "error" && e.label.includes("fixture failure")));
      check("trail records failed requests", trail.some((e) => e.kind === "failed-request" && e.label === "GET /boom → 500"), JSON.stringify(trail.filter((e) => e.kind === "failed-request")));
      check("trail survives the reload", trail.filter((e) => e.kind === "nav" && e.detail === "load").length >= 2);
      check("trail urls are redacted", !JSON.stringify(trail).includes("SHOULD_BE_REDACTED"));
      check("trail never records the widget's own posts", !trail.some((e) => (e.detail ?? "").includes("/api/feedback-collect")));
      check("trim filters the trail to the window", !trail.some((e) => e.label === "seeded old error"));

      check("item carries momentAt as ISO", isIso(item?.body?.momentAt), item?.body?.momentAt);
      const momentTs = Date.parse(item?.body?.momentAt ?? "");
      check("momentAt is the latest error or failed request", trail.some((e) => ["error", "failed-request"].includes(e.kind) && e.ts === momentTs) && trail.filter((e) => ["error", "failed-request"].includes(e.kind)).every((e) => e.ts <= momentTs), item?.body?.momentAt);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function runWithoutStorage() {
  console.log("\nlegacy transport, storage blocked");
  const server = await startMockServer("legacy");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    await page.addInitScript(() => {
      const blocked = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      Object.defineProperty(window, "indexedDB", { configurable: true, get: blocked });
      Object.defineProperty(window, "sessionStorage", { configurable: true, get: blocked });
    });
    await page.goto(server.origin, { waitUntil: "networkidle" });
    await ready(page);

    await page.locator(".fb-launcher").click();
    await page.locator("#fb-message").fill("Storage is blocked here.");
    await page.locator("#fb-email").fill(TYPED_EMAIL);
    await page.locator(".fb-btn-primary").click();
    await page.locator(".fb-done").waitFor({ state: "visible", timeout: 15_000 });

    const session = server.received.find((p) => p.path === "/api/feedback-collect/session");
    const events = JSON.parse(session?.body?.events ?? "[]");
    const trail = JSON.parse(session?.body?.trail ?? "[]");
    check("mounts and records with no IndexedDB or sessionStorage", events.length > 2 && events[0]?.type === META, `${events.length} events`);
    check("trail still works in memory", trail.some((e) => e.kind === "failed-request"));
    check("no uncaught page errors from the widget", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }
}

const sessionKeyOf = (page) => page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
const copyStorage = (page) => page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
const seedStorage = (entries) => {
  if (sessionStorage.length > 0) return;
  for (const [key, value] of Object.entries(entries)) sessionStorage.setItem(key, value);
};

async function openDuplicate(context, origin, entries) {
  const copy = await context.newPage();
  await copy.addInitScript(seedStorage, entries);
  await copy.goto(origin, { waitUntil: "networkidle" });
  await ready(copy);
  return copy;
}

async function runDuplicateTab() {
  console.log("\nlegacy transport, duplicated tab");
  const server = await startMockServer("legacy");
  const browser = await chromium.launch();
  const context = await browser.newContext();

  try {
    const original = await context.newPage();
    await original.goto(server.origin, { waitUntil: "networkidle" });
    await ready(original);
    await original.waitForTimeout(PERSIST_WAIT_MS);
    const originalKey = await sessionKeyOf(original);

    const copy = await openDuplicate(context, server.origin, await copyStorage(original));
    const copyKey = await sessionKeyOf(copy);
    check("the duplicate starts from the original's copied session key", originalKey !== null);
    check("the duplicate mints its own session key", copyKey !== null && copyKey !== originalKey, `${originalKey} / ${copyKey}`);

    await original.reload({ waitUntil: "networkidle" });
    await ready(original);
    check("a reload of the original keeps its key", (await sessionKeyOf(original)) === originalKey, await sessionKeyOf(original));

    await copy.reload({ waitUntil: "networkidle" });
    await ready(copy);
    check("a reload of the duplicate keeps its new key", (await sessionKeyOf(copy)) === copyKey, await sessionKeyOf(copy));

    const report = async (page, message) => {
      await page.locator(".fb-launcher").click();
      await page.locator("#fb-message").fill(message);
      await page.locator("#fb-email").fill(TYPED_EMAIL);
      await page.locator(".fb-btn-primary").click();
      await page.locator(".fb-done").waitFor({ state: "visible", timeout: 15_000 });
    };
    await report(original, "From the original tab.");
    await report(copy, "From the duplicated tab.");
    const sessions = server.received.filter((p) => p.path === "/api/feedback-collect/session").map((p) => p.body?.sessionKey);
    check("the two tabs upload under different session keys", sessions.length === 2 && sessions[0] === originalKey && sessions[1] === copyKey, JSON.stringify(sessions));
  } finally {
    await browser.close();
    server.close();
  }
}

async function runDuplicateWithoutBroadcast() {
  console.log("\nlegacy transport, duplicated tab without BroadcastChannel");
  const server = await startMockServer("legacy");
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const pageErrors = [];
  context.on("weberror", (error) => pageErrors.push(String(error.error())));

  try {
    await context.addInitScript(() => {
      Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: undefined });
    });
    const original = await context.newPage();
    await original.goto(server.origin, { waitUntil: "networkidle" });
    await ready(original);
    const originalKey = await sessionKeyOf(original);
    const copy = await openDuplicate(context, server.origin, await copyStorage(original));
    check("mounts with no BroadcastChannel", (await copy.locator(".fb-launcher").count()) === 1);
    check("falls back to the inherited key", (await sessionKeyOf(copy)) === originalKey, await sessionKeyOf(copy));
    check("no uncaught page errors without BroadcastChannel", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }
}

const EARLY_EMAIL = "early@example.com";
const LATE_USER = { id: "u-late", email: "late@example.com", name: "Late Arrival" };

async function runIdentify() {
  console.log("\nv1 transport, auto-mounted embed with NervaFeedback.identify");
  const server = await startMockServer("v1");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const launcher = page.locator(".fb-launcher");
  const email = page.locator("#fb-email");
  const openForm = async () => {
    await launcher.click();
    await page.locator(".fb-panel").waitFor({ state: "visible", timeout: 5_000 });
  };
  const closeForm = () => page.locator(".fb-close").click();

  try {
    await page.goto(`${server.origin}/tests/fixture-auto.html`, { waitUntil: "networkidle" });
    await launcher.waitFor({ state: "visible", timeout: 10_000 });
    check("global entry exposes identify", await page.evaluate(() => typeof window.NervaFeedback.identify === "function"));

    await openForm();
    check("identify before the mount resolved prefills the email", (await email.inputValue()) === EARLY_EMAIL, await email.inputValue());
    await closeForm();

    await page.evaluate(() => window.NervaFeedback.identify(null));
    await openForm();
    check("identify(null) empties the prefilled email", (await email.inputValue()) === "", await email.inputValue());
    await closeForm();

    await page.evaluate((user) => window.NervaFeedback.identify(user), LATE_USER);
    await openForm();
    check("identify after mount and after an open prefills the email", (await email.inputValue()) === LATE_USER.email, await email.inputValue());

    await page.locator("#fb-message").fill("Signed in after the widget mounted.");
    await page.locator(".fb-btn-primary").click();
    await page.locator(".fb-done").waitFor({ state: "visible", timeout: 15_000 });
    const ingest = server.received.find((p) => p.path === "/api/v1/feedback/ingest");
    check("the identified user reaches the submission", ingest?.body?.submitter_id === LATE_USER.id && ingest?.body?.submitter_name === LATE_USER.name, JSON.stringify({ id: ingest?.body?.submitter_id, name: ingest?.body?.submitter_name }));
    check("identify replaces rather than merges", ingest?.body?.submitter_email === LATE_USER.email);

    await page.evaluate(() => window.NervaFeedback.identify({ id: "u-no-email" }));
    await openForm();
    check("a replacing identify drops the previous email", (await email.inputValue()) === "", await email.inputValue());
  } finally {
    await browser.close();
    server.close();
  }
}

await run("v1");
await run("legacy");
await runWithoutStorage();
await runDuplicateTab();
await runDuplicateWithoutBroadcast();
await runIdentify();

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

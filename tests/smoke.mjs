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

async function run(mode) {
  console.log(`\n${mode} transport`);
  const server = await startMockServer(mode);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(server.origin, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20_000 });

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

    await launcher.click();
    await page.locator(".fb-panel").waitFor({ state: "visible", timeout: 5_000 });

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
    } else {
      await page.locator("#fb-message").fill("Something broke on this page.");
    }

    await page.locator("#fb-title").fill("Broken thing");
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

      const plugins = events.filter((e) => e.type === 6);
      const consoleEvents = plugins.filter((e) => e.data?.plugin === "rrweb/console@1");
      const networkEvents = plugins.filter((e) => e.data?.plugin === "rrweb/network@1");
      check("captured console output", consoleEvents.length > 0);
      check("captured network activity", networkEvents.length > 0);

      const urls = networkEvents.flatMap((e) => (e.data?.payload?.requests ?? []).map((r) => r.name ?? ""));
      check("never recorded its own ingest POST", !urls.some((u) => u.includes("/api/v1/feedback")), JSON.stringify(urls));
      check("redacted the token query param", !urls.some((u) => u.includes("SHOULD_BE_REDACTED")), JSON.stringify(urls));
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
      check("carried the session key into the item", item?.body?.sessionKey === session?.body?.sessionKey);
      check("parked the session key in metadata too", JSON.parse(item?.body?.metadata ?? "{}").sessionKey === session?.body?.sessionKey);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

await run("v1");
await run("legacy");

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

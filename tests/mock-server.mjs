/**
 * A stand-in for the Nerva server, in both generations.
 *
 * `MODE=v1` answers the config route and the v1 ingest route; `MODE=legacy`
 * 404s the config route, which is exactly how the widget is meant to work out
 * that it is talking to the older contract.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".js": "text/javascript", ".html": "text/html", ".map": "application/json" };

export function startMockServer(mode) {
  const received = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(body));
    };

    const readBody = () =>
      new Promise((resolve) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });

    if (path === "/api/v1/feedback-widgets/by-key/test_key_123/config") {
      if (mode !== "v1") return json(404, { error: "not_found" });
      return json(200, {
        enabled: true,
        accent_color: "#ef5a2a",
        icon: "bug",
        position: "bottom-left",
        button_label: "Report",
        button_shape: "pill",
        button_pulse: true,
        capture_console: true,
        capture_network: true,
        replay_lookback_seconds: 45,
        supports_replay_chunks: true,
        custom_fields: [
          { key: "team", label: "Team", type: "select", required: true, options: ["Backend", "Frontend"], kinds: ["idea"] },
          { key: "steps", label: "Steps", type: "text", required: false, options: [], kinds: [] },
        ],
      });
    }

    if (path === "/api/feedback-collect/config") {
      if (mode !== "legacy") return json(404, { error: "not_found" });
      return json(200, {
        enabled: true,
        accentColor: "#2a7aef",
        icon: "megaphone",
        position: "top-right",
        buttonLabel: "Tell us",
        buttonShape: "pill",
        buttonPulse: false,
        captureConsole: true,
        captureNetwork: true,
        replayLookbackSeconds: 30,
        collectEmail: true,
        kinds: ["bug", "idea", "praise"],
      });
    }

    if (req.method === "POST") {
      return void readBody().then((raw) => {
        let parsed = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* keep the raw text */
        }
        received.push({ path, key: req.headers["x-feedback-key"], body: parsed, bytes: raw.length });
        if (path === "/api/v1/feedback/ingest") return json(201, { id: "report-1" });
        return json(200, { id: "item-1" });
      });
    }

    // Static: the fixture page and the built bundle.
    const file = path === "/" ? "/tests/fixture.html" : path;
    const safe = join(ROOT, normalize(file).replace(/^(\.\.[/\\])+/, ""));
    return void readFile(safe).then(
      (buf) => {
        res.writeHead(200, { "Content-Type": TYPES[extname(safe)] ?? "text/plain" });
        res.end(buf);
      },
      () => {
        res.writeHead(404);
        res.end("not found");
      },
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ port, origin: `http://127.0.0.1:${port}`, received, close: () => server.close() });
    });
  });
}

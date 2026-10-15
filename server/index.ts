import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import {
  WorkspaceSchema,
  attachmentsIn,
  type Workspace,
  type Kind,
} from "../src/model.ts";
import { attachments, validId } from "./attachments.ts";
import { seedWorkspace } from "../src/seed.ts";
import { tripCalendar, calendarName } from "../src/calendar.ts";
import { lookups } from "./lookup.ts";
import { mailbox } from "./mailbox.ts";
import { locator } from "./locator.ts";
import { maps } from "./maps.ts";
import { LinkError, resolveMapsLink } from "./mapslink.ts";
import { agent, toolList, mcpReply, llmsText, AgentError } from "./agent.ts";
const dataDir = process.env.DATA_DIR || "./data";
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "fieldnotes.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)",
);
if (!db.prepare("SELECT id FROM workspace WHERE id=1").get())
  db.prepare("INSERT INTO workspace VALUES(1,1,?,?)").run(
    JSON.stringify(seedWorkspace()),
    new Date().toISOString(),
  );
const mapData = maps(dataDir);
const lookup = lookups(db, mapData);
const mail = mailbox(dataDir);
const get = () => {
  const row = db
    .prepare("SELECT revision,data FROM workspace WHERE id=1")
    .get() as { revision: number; data: string };
  return { revision: row.revision, data: JSON.parse(row.data) };
};
const files = attachments(dataDir);
const sweepFiles = () => {
  try {
    files.sweep(new Set(attachmentsIn(get().data).map((a) => a.id)));
  } catch (e) {
    console.error(
      "Attachment cleanup failed:",
      e instanceof Error ? e.message : "unknown",
    );
  }
};
sweepFiles();
setInterval(sweepFiles, 86400000).unref();
const locations = locator(db, lookup.geocode, () => get().data.places);
void locations.run();
setInterval(() => void locations.run(), 10 * 60000).unref();
const agentTools = agent(
  {
    read: get,
    write(data, revision) {
      const result = db
        .prepare(
          "UPDATE workspace SET data=?, revision=revision+1,updated_at=? WHERE id=1 AND revision=?",
        )
        .run(JSON.stringify(data), new Date().toISOString(), revision);
      return result.changes ? revision + 1 : null;
    },
  },
  lookup,
  () => void locations.run(),
);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const root = resolve("dist");
// Compressed copies of the built files, made once per file and encoding.
const packed = new Map<string, Buffer>();
const compressible = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".webmanifest",
  ".svg",
]);
type Encoding = "br" | "gzip";
const compress = (data: Buffer, encoding: Encoding, best: boolean) =>
  encoding === "br"
    ? brotliCompressSync(data, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: best ? 11 : 4,
          [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
        },
      })
    : gzipSync(data, { level: best ? 9 : 6 });
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  const accepted = String(req.headers["accept-encoding"] || "");
  const encoding: Encoding | undefined = /\bbr\b/.test(accepted)
    ? "br"
    : /\bgzip\b/.test(accepted)
      ? "gzip"
      : undefined;
  const json = (status: number, value: unknown) => {
    let body: Buffer = Buffer.from(JSON.stringify(value));
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Accept-Encoding",
    };
    if (encoding && body.length > 1024) {
      body = compress(body, encoding, false);
      headers["Content-Encoding"] = encoding;
    }
    res.writeHead(status, headers);
    res.end(body);
  };
  // Writes must come from this app, not another site.
  const sameOrigin = (binary = false) => {
    if (req.headers["sec-fetch-site"] === "cross-site") {
      json(403, { error: "Cross-site write denied" });
      return false;
    }
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (
        origin.host !== req.headers.host &&
        !(
          process.env.NODE_ENV !== "production" &&
          origin.hostname === "localhost"
        )
      ) {
        json(403, { error: "Origin mismatch" });
        return false;
      }
    }
    if (
      !binary &&
      req.method !== "DELETE" &&
      !req.headers["content-type"]?.startsWith("application/json")
    ) {
      json(415, { error: "Use JSON" });
      return false;
    }
    return true;
  };
  const body = async (limit: number) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/api/health") {
      json(200, { ok: true });
      return;
    }
    if (url.pathname === "/api/geocode" && req.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 300);
      const cc = (url.searchParams.get("cc") || "").toLowerCase();
      const [lat, lng] = (url.searchParams.get("near") || "")
        .split(",")
        .map(Number);
      const near =
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180 &&
        url.searchParams.has("near")
          ? { lat, lng }
          : undefined;
      if (!q || !/^[a-z]{0,2}$/.test(cc)) {
        json(400, { error: "Enter a place to look up" });
        return;
      }
      try {
        json(200, { results: await lookup.geocode(q, cc, near) });
      } catch {
        json(502, { error: "Location service unavailable" });
      }
      return;
    }
    if (url.pathname === "/api/nearby" && req.method === "GET") {
      const lat = Number(url.searchParams.get("lat")),
        lng = Number(url.searchParams.get("lng")),
        radius = Number(url.searchParams.get("radius") || 1000);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180 ||
        !(radius >= 50 && radius <= 50000)
      ) {
        json(400, { error: "Invalid location" });
        return;
      }
      try {
        json(200, {
          results: await lookup.nearby(
            lat,
            lng,
            Math.round(radius),
            url.searchParams.get("halal") === "1",
          ),
        });
      } catch {
        json(502, {
          error: "Restaurant search unavailable. Try again shortly.",
        });
      }
      return;
    }
    if (url.pathname === "/api/outdoors" && req.method === "GET") {
      const lat = Number(url.searchParams.get("lat")),
        lng = Number(url.searchParams.get("lng")),
        radius = Number(url.searchParams.get("radius") || 10),
        kind = url.searchParams.get("kind");
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180 ||
        !(radius >= 0.5 && radius <= 100) ||
        (kind !== "hiking" && kind !== "cycling")
      ) {
        json(400, { error: "Invalid search" });
        return;
      }
      try {
        json(200, {
          results: await lookup.outdoors(
            lat,
            lng,
            Math.round(radius * 10) / 10,
            kind,
          ),
        });
      } catch {
        json(502, { error: "Trail search unavailable. Try again shortly." });
      }
      return;
    }
    if (url.pathname === "/api/route-shape" && req.method === "GET") {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id) || id <= 0) {
        json(400, { error: "Invalid route" });
        return;
      }
      try {
        json(200, { lines: await lookup.routeShape(id) });
      } catch {
        json(502, { error: "Route map unavailable. Try again shortly." });
      }
      return;
    }
    if (url.pathname === "/api/rail-path" && req.method === "GET") {
      const point = (name: string) => {
        const [lat, lng] = (url.searchParams.get(name) || "")
          .split(",")
          .map(Number);
        return Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lng) <= 180
          ? ([lat, lng] as [number, number])
          : null;
      };
      const from = point("from"),
        to = point("to");
      if (!from || !to) {
        json(400, { error: "Invalid request" });
        return;
      }
      try {
        json(200, { path: await lookup.railPath(from, to) });
      } catch {
        json(502, { error: "Rail routing unavailable" });
      }
      return;
    }
    if (url.pathname === "/api/weather" && req.method === "GET") {
      const lat = Number(url.searchParams.get("lat")),
        lng = Number(url.searchParams.get("lng")),
        date = url.searchParams.get("date") || "";
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        isNaN(Date.parse(date))
      ) {
        json(400, { error: "Invalid request" });
        return;
      }
      try {
        json(200, await lookup.weather(lat, lng, date));
      } catch {
        json(502, { error: "Weather unavailable" });
      }
      return;
    }
    if (url.pathname === "/api/rates" && req.method === "GET") {
      const base = (url.searchParams.get("base") || "SAR").toUpperCase();
      if (!/^[A-Z]{3}$/.test(base)) {
        json(400, { error: "Invalid currency" });
        return;
      }
      try {
        json(200, await lookup.rates(base));
      } catch {
        json(502, { error: "Exchange rates unavailable" });
      }
      return;
    }
    if (url.pathname === "/api/maps-link" && req.method === "GET") {
      const link = (url.searchParams.get("url") || "").slice(0, 2000);
      try {
        json(200, {
          place: await resolveMapsLink(link, {
            fetch,
            geocode: lookup.geocode,
            reverse: lookup.reverse,
            google: mapData.hasGoogle() ? mapData : null,
          }),
        });
      } catch (e) {
        json(e instanceof LinkError ? 400 : 502, {
          error:
            e instanceof LinkError
              ? e.message
              : "Couldn't read this link right now. Try again shortly.",
        });
      }
      return;
    }
    if (url.pathname === "/api/maps") {
      if (req.method === "GET") {
        json(200, mapData.status());
        return;
      }
      if (req.method !== "PUT") {
        json(405, { error: "Method not allowed" });
        return;
      }
      if (!sameOrigin()) return;
      let change;
      try {
        change = JSON.parse((await body(10000)) || "");
      } catch {
        json(400, { error: "Invalid JSON" });
        return;
      }
      const provider = change.provider;
      const key = change.googleKey;
      if (
        (provider !== undefined &&
          provider !== "osm" &&
          provider !== "google") ||
        (key !== undefined &&
          key !== null &&
          !/^[\w-]{20,200}$/.test(String(key).trim()))
      ) {
        json(400, { error: "That doesn't look like a Google Maps API key" });
        return;
      }
      try {
        await mapData.update({
          provider,
          googleKey: typeof key === "string" ? key.trim() : key,
        });
        json(200, mapData.status());
      } catch (e) {
        json(400, {
          error: e instanceof Error ? e.message : "Couldn't save the setting",
        });
      }
      return;
    }
    const attachment = url.pathname.match(/^\/api\/attachments\/([^/]+)$/);
    if (attachment) {
      const id = attachment[1];
      if (!validId(id)) {
        json(400, { error: "Invalid attachment" });
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        if (!files.send(id, req, res)) json(404, { error: "Not found" });
        return;
      }
      if (req.method !== "PUT") {
        json(405, { error: "Method not allowed" });
        return;
      }
      if (!sameOrigin(true)) return;
      // IDs are unique per file, so a repeated upload is already done.
      if (files.has(id)) {
        req.resume();
        json(200, { ok: true });
        return;
      }
      if ((await files.save(id, req)) === "too-large") {
        json(413, { error: "Files can be up to 25 MB" });
        return;
      }
      json(201, { ok: true });
      return;
    }
    if (url.pathname === "/api/locations" && req.method === "GET") {
      json(200, locations.all());
      return;
    }
    if (url.pathname === "/api/mailbox") {
      if (req.method === "GET") {
        json(200, mail.status());
        return;
      }
      if (!sameOrigin()) return;
      if (req.method === "DELETE") {
        mail.remove();
        json(200, mail.status());
        return;
      }
      if (req.method !== "PUT") {
        json(405, { error: "Method not allowed" });
        return;
      }
      let config;
      try {
        config = JSON.parse((await body(10000)) || "");
      } catch {
        json(400, { error: "Invalid JSON" });
        return;
      }
      const host = String(config.host || "").trim(),
        user = String(config.user || "").trim(),
        password = String(config.password || "").replace(/\s/g, ""),
        port = Number(config.port || 993);
      if (!/^[a-z0-9.-]+$/i.test(host) || !user || !password || !(port > 0)) {
        json(400, { error: "Enter the mail server, address and app password" });
        return;
      }
      try {
        await mail.save({ host, port, user, password });
        json(200, mail.status());
      } catch (e) {
        const detail = e as {
          authenticationFailed?: boolean;
          responseText?: string;
          message?: string;
        };
        json(400, {
          error: detail.authenticationFailed
            ? `The mail server rejected this address or app password${detail.responseText ? ` (${detail.responseText})` : ""}.`
            : `Could not reach the mail server: ${detail.responseText || detail.message || "unknown error"}`,
        });
      }
      return;
    }
    if (url.pathname === "/api/mailbox/scan") {
      if (req.method !== "POST") {
        json(405, { error: "Method not allowed" });
        return;
      }
      if (!sameOrigin()) return;
      let since = new Date(Date.now() - 365 * 86400000);
      try {
        const value = JSON.parse((await body(1000)) || "{}");
        if (value.since && !isNaN(Date.parse(value.since)))
          since = new Date(value.since);
      } catch {
        json(400, { error: "Invalid JSON" });
        return;
      }
      try {
        json(200, { emails: await mail.scan(since) });
      } catch (e) {
        json(502, {
          error: `Mailbox check failed: ${e instanceof Error ? e.message : "unknown error"}`,
        });
      }
      return;
    }
    // Agent interface: MCP, a JSON tool API and a plain-text guide.
    if (url.pathname === "/mcp") {
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" });
        res.end();
        return;
      }
      if (!sameOrigin()) return;
      const text = await body(1024 * 1024);
      let msg;
      try {
        msg = JSON.parse(text ?? "");
      } catch {
        json(400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        return;
      }
      const messages = Array.isArray(msg) ? msg : [msg];
      const replies = [];
      for (const m of messages)
        if (m?.method && m.id !== undefined)
          replies.push(await mcpReply(agentTools, m, version));
      if (!replies.length) {
        res.writeHead(202);
        res.end();
      } else json(200, Array.isArray(msg) ? replies : replies[0]);
      return;
    }
    if (url.pathname === "/api/agent" && req.method === "GET") {
      json(200, { tools: toolList() });
      return;
    }
    const tool = url.pathname.match(/^\/api\/agent\/([a-z_]+)$/);
    if (tool) {
      if (req.method !== "POST") {
        json(405, { error: "Use POST with JSON arguments" });
        return;
      }
      if (!sameOrigin()) return;
      const text = await body(1024 * 1024);
      let args;
      try {
        args = text ? JSON.parse(text) : {};
      } catch {
        json(400, { error: "Invalid JSON" });
        return;
      }
      try {
        json(200, { result: await agentTools.call(tool[1], args) });
      } catch (e) {
        if (!(e instanceof AgentError)) console.error("Agent tool failed:", e);
        json(e instanceof AgentError ? 400 : 500, {
          error:
            e instanceof AgentError
              ? e.message
              : "The tool failed unexpectedly.",
        });
      }
      return;
    }
    if (url.pathname === "/llms.txt" && req.method === "GET") {
      const proto =
        req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(llmsText(`${proto}://${req.headers.host}`));
      return;
    }
    // The itinerary as a calendar file: opened once to import it, or
    // subscribed to (webcal://) so the calendar app keeps it up to date.
    if (url.pathname === "/api/calendar.ics" && req.method === "GET") {
      const data = get().data as Workspace;
      const trip =
        data.trips.find((t) => t.id === url.searchParams.get("trip")) ||
        data.trips.find((t) => t.id === data.activeTripId) ||
        data.trips[0];
      const scenario =
        trip.scenarios.find((x) => x.id === url.searchParams.get("scenario")) ||
        trip.scenarios.find((x) => x.id === trip.activeScenarioId) ||
        trip.scenarios[0];
      const kinds = ["stay", "activity", "food", "transport", "local", "note"];
      const hide = (url.searchParams.get("hide") || "")
        .split(",")
        .filter((k): k is Kind => kinds.includes(k));
      const body = Buffer.from(
        tripCalendar(trip, scenario, data.places, {
          hide,
          ideas: url.searchParams.get("ideas") === "1",
          deadlines: url.searchParams.get("deadlines") !== "0",
        }),
      );
      res.writeHead(200, {
        "Content-Type": "text/calendar; charset=utf-8",
        // Inline lets iPhones offer "Add All" to Calendar; other browsers
        // save it as a file with this name.
        "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(calendarName(trip))}`,
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }
    if (url.pathname === "/api/workspace") {
      if (req.method === "GET") {
        // Devices checking for changes send the revision they have; the whole
        // workspace is only sent when it differs.
        const since = url.searchParams.get("since");
        if (since && /^\d+$/.test(since)) {
          const row = db
            .prepare("SELECT revision FROM workspace WHERE id=1")
            .get() as { revision: number };
          if (row.revision === Number(since)) {
            json(200, { revision: row.revision, unchanged: true });
            return;
          }
        }
        json(200, get());
        return;
      }
      if (req.method !== "PUT") {
        json(405, { error: "Method not allowed" });
        return;
      }
      if (!sameOrigin()) return;
      const match = req.headers["if-match"];
      if (typeof match !== "string" || !/^\d+$/.test(match)) {
        json(428, { error: "Revision required" });
        return;
      }
      const text = await body(5 * 1024 * 1024);
      if (text === null) {
        json(413, { error: "Workspace too large" });
        return;
      }
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        json(400, { error: "Invalid JSON" });
        return;
      }
      const parsed = WorkspaceSchema.safeParse(value.data);
      if (!parsed.success) {
        json(400, { error: parsed.error.issues[0].message });
        return;
      }
      const result = db
        .prepare(
          "UPDATE workspace SET data=?, revision=revision+1,updated_at=? WHERE id=1 AND revision=?",
        )
        .run(
          JSON.stringify(parsed.data),
          new Date().toISOString(),
          Number(match),
        );
      if (!result.changes) {
        json(409, get());
        return;
      }
      json(200, { revision: get().revision });
      void locations.run();
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      json(404, { error: "Not found" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      json(405, { error: "Method not allowed" });
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    let file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + "/")) {
      json(403, { error: "Forbidden" });
      return;
    }
    if (pathname === "/" || (!extname(file) && !existsSync(file)))
      file = join(root, "index.html");
    if (!existsSync(file)) {
      json(404, { error: "Not found" });
      return;
    }
    let data: Buffer = readFileSync(file);
    const headers: Record<string, string> = {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Cache-Control": file.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      Vary: "Accept-Encoding",
    };
    if (encoding && compressible.has(extname(file)) && data.length > 1024) {
      const { mtimeMs } = statSync(file);
      const key = `${encoding}:${file}:${mtimeMs}:${data.length}`;
      let found = packed.get(key);
      if (!found) {
        found = compress(data, encoding, true);
        packed.set(key, found);
      }
      data = found;
      headers["Content-Encoding"] = encoding;
    }
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    console.error(
      "Request failed:",
      error instanceof Error ? error.message : "unknown",
    );
    if (!res.headersSent) json(500, { error: "Request failed" });
    else res.end();
  }
});
server.listen(
  Number(process.env.PORT || 3096),
  process.env.HOST || "127.0.0.1",
  () => {
    const address = server.address();
    console.log(
      "Fieldnotes listening on",
      typeof address === "object" && address
        ? address.port
        : process.env.PORT || 3096,
    );
  },
);
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

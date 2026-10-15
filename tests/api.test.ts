import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
let child: ChildProcess, base: string, temp: string;
before(async () => {
  temp = await mkdtemp(join(tmpdir(), "fieldnotes-test-"));
  child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      DATA_DIR: temp,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Test server did not start")),
      10000,
    );
    child.stdout!.on("data", (chunk) => {
      const m = String(chunk).match(/Fieldnotes listening on (\d+)/);
      if (m) {
        clearTimeout(timer);
        base = `http://127.0.0.1:${m[1]}`;
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`Server exited ${code}`));
    });
  });
});
after(async () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
  if (temp) await rm(temp, { recursive: true, force: true });
});
test("server validates writes and atomically rejects stale revisions", async () => {
  const original = await fetch(base + "/api/workspace").then((r) => r.json());
  const data = structuredClone(original.data);
  data.trips[0].name = "Updated";
  const write = () =>
    fetch(base + "/api/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(original.revision),
      },
      body: JSON.stringify({ data }),
    });
  const results = await Promise.all([write(), write()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const conflict = await results.find((r) => r.status === 409)!.json();
  assert.equal(conflict.data.trips[0].name, "Updated");
  assert.equal(conflict.revision, original.revision + 1);
  const missing = await fetch(base + "/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  assert.equal(missing.status, 428);
  const invalid = await fetch(base + "/api/workspace", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": String(conflict.revision),
    },
    body: JSON.stringify({ data: {} }),
  });
  assert.equal(invalid.status, 400);
});
test("cross-site browser writes and unsafe content types are rejected", async () => {
  const state = await fetch(base + "/api/workspace").then((r) => r.json());
  const init = { method: "PUT", body: JSON.stringify({ data: state.data }) };
  const cross = await fetch(base + "/api/workspace", {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "If-Match": String(state.revision),
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    },
  });
  assert.equal(cross.status, 403);
  const wrong = await fetch(base + "/api/workspace", {
    ...init,
    headers: {
      "Content-Type": "text/plain",
      "If-Match": String(state.revision),
    },
  });
  assert.equal(wrong.status, 415);
  assert.equal((await fetch(base + "/api/no-such-endpoint")).status, 404);
});
test("multibyte local-language addresses survive chunk boundaries", async () => {
  const state = await fetch(base + "/api/workspace").then((r) => r.json());
  state.data.trips[0].name = "東京計画";
  const body = Buffer.from(JSON.stringify({ data: state.data }));
  const offset = body.indexOf(Buffer.from("東")) + 1;
  await new Promise<void>((resolve, reject) => {
    const req = request(
      base + "/api/workspace",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(state.revision),
        },
      },
      (res) => {
        assert.equal(res.statusCode, 200);
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("error", reject);
    req.write(body.subarray(0, offset));
    setTimeout(() => req.end(body.subarray(offset)), 30);
  });
  const saved = await fetch(base + "/api/workspace").then((r) => r.json());
  assert.equal(saved.data.trips[0].name, "東京計画");
});
test("stores and serves attachment files safely", async () => {
  const id = "a1b2c3d4-test-pdf";
  const pdf = Buffer.from("%PDF-1.4 ticket");
  const put = (id: string, type: string, body: Buffer, origin = base) =>
    fetch(`${base}/api/attachments/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": type,
        "X-File-Name": encodeURIComponent("Shinkansen ticket.pdf"),
        Origin: origin,
      },
      body,
    });
  assert.equal((await put(id, "application/pdf", pdf)).status, 201);
  // Repeating an upload (a retry from an offline device) is harmless.
  assert.equal((await put(id, "application/pdf", pdf)).status, 200);
  const got = await fetch(`${base}/api/attachments/${id}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "application/pdf");
  assert.match(got.headers.get("content-disposition")!, /inline/);
  assert.match(got.headers.get("content-security-policy")!, /sandbox/);
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), pdf);
  // Uploaded HTML must never render as a page of this app.
  await put("html-attack-1", "text/html", Buffer.from("<script>1</script>"));
  const html = await fetch(`${base}/api/attachments/html-attack-1`);
  assert.equal(html.headers.get("content-type"), "application/octet-stream");
  assert.match(html.headers.get("content-disposition")!, /^attachment/);
  assert.equal(
    (await put("other-site-1", "image/png", pdf, "https://evil.example"))
      .status,
    403,
  );
  assert.equal(
    (await fetch(`${base}/api/attachments/missing-123`)).status,
    404,
  );
  assert.equal((await fetch(`${base}/api/attachments/..%2Fx`)).status, 400);
});
const tool = (name: string, args: unknown) =>
  fetch(`${base}/api/agent/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const rpc = (message: unknown) =>
  fetch(base + "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(message),
  });
test("agent tools add, change and remove plan entries with sensible defaults", async () => {
  const overview = (await tool("get_overview", {})).result;
  const trip = overview.trips[0];
  const before = (await fetch(base + "/api/workspace").then((r) => r.json()))
    .revision;
  const added = await tool("add_entry", {
    type: "food",
    title: "Dinner in Seoul",
    date: trip.start,
    startTime: "19:30",
    city: "Seoul",
    country: "Korea",
  });
  assert.equal(added.status, 200);
  assert.equal(added.result.revision, before + 1);
  const id = added.result.added.id;
  const entry = (await tool("get_entry", { id })).result.entry;
  assert.equal(entry.timezone, "Asia/Seoul");
  assert.equal(entry.currency, "KRW");
  assert.equal(entry.endTime, "21:00");
  assert.equal(
    (await tool("update_entry", { id, status: "booked" })).result.updated
      .status,
    "booked",
  );
  const days = (
    await tool("get_itinerary", { from: trip.start, to: trip.start })
  ).result.days;
  assert.ok(days[0].entries.some((e: { id: string }) => e.id === id));
  assert.equal((await tool("delete_entry", { id })).status, 200);
  assert.equal((await tool("get_entry", { id })).status, 400);
  // Invalid input is explained and nothing is saved.
  const bad = await tool("add_entry", {
    type: "stay",
    title: "x",
    date: trip.start,
    endDate: trip.start,
  });
  assert.equal(bad.status, 400);
  assert.match(bad.error, /Checkout/);
  assert.match(
    (
      await tool("add_entry", {
        type: "note",
        title: "x",
        date: trip.start,
        colour: "red",
      })
    ).error,
    /colour/,
  );
  const place = await tool("add_place", {
    name: "Test Ramen",
    kind: "restaurant",
    city: "Tokyo",
  });
  const linked = await tool("add_entry", {
    type: "food",
    title: "Ramen",
    date: trip.start,
    place: "Test Ramen",
  });
  assert.match(linked.result.added.place, /Test Ramen/);
  assert.equal(
    (await tool("delete_place", { id: place.result.added.id })).status,
    400,
  );
  assert.equal(
    (await tool("delete_place", { id: "Test Ramen", unlink: true })).result
      .unlinked,
    1,
  );
});
test("agent tools preserve an explicit local scope for nearby cities", async () => {
  const added = await tool("add_entry", {
    type: "transport",
    title: "Tokyo to Makuhari",
    date: "2026-10-31",
    city: "Tokyo",
    toCity: "Chiba",
    scope: "local",
  });
  assert.equal(added.status, 200);
  const id = added.result.added.id;
  assert.equal((await tool("get_entry", { id })).result.entry.scope, "local");
  await tool("update_entry", { id, toCity: "Yokohama", scope: "local" });
  assert.equal((await tool("get_entry", { id })).result.entry.scope, "local");
  await tool("update_entry", { id, toCity: "Nagoya" });
  assert.equal(
    (await tool("get_entry", { id })).result.entry.scope,
    "intercity",
  );
  await tool("delete_entry", { id });
});
test("MCP endpoint lists and calls the agent tools", async () => {
  const init = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  }).then((r) => r.json());
  assert.equal(init.result.serverInfo.name, "fieldnotes");
  assert.equal(
    (await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status,
    202,
  );
  const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }).then(
    (r) => r.json(),
  );
  assert.ok(
    list.result.tools.some((t: { name: string }) => t.name === "add_entry"),
  );
  const call = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "add_task", arguments: { title: "Buy rail pass" } },
  }).then((r) => r.json());
  assert.match(call.result.content[0].text, /Buy rail pass/);
  const error = await rpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "delete_task", arguments: { id: "missing" } },
  }).then((r) => r.json());
  assert.equal(error.result.isError, true);
  const cross = await fetch(base + "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://attacker.example",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "ping" }),
  });
  assert.equal(cross.status, 403);
  assert.match(
    await fetch(base + "/llms.txt").then((r) => r.text()),
    /add_entry/,
  );
});

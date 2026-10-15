#!/usr/bin/env node
// Command-line client for the Fieldnotes agent tools. Needs only Node 18+.
//   node scripts/fieldnotes.mjs tools                   list tools and arguments
//   node scripts/fieldnotes.mjs get_itinerary from=2026-11-01 to=2026-11-03
//   node scripts/fieldnotes.mjs add_entry '{"type":"food","title":"Ramen","date":"2026-11-02"}'
// key=value arguments follow the tool's schema: numbers and true/false where the
// field expects them, text otherwise. FIELDNOTES_URL selects the server.
const base = (process.env.FIELDNOTES_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const [name, ...rest] = process.argv.slice(2);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (!name || name === "help" || name === "--help" || name === "tools") {
  const res = await fetch(`${base}/llms.txt`).catch(() =>
    fail(`Cannot reach ${base}`),
  );
  console.log(await res.text());
  process.exit(0);
}
// Argument types from the tool's schema, so bookingRef=4821 stays text.
const listing = await fetch(`${base}/api/agent`)
  .then((r) => r.json())
  .catch(() => fail(`Cannot reach ${base}`));
const tool = listing.tools.find((t) => t.name === name);
if (!tool) fail(`Unknown tool "${name}". Run with "tools" to list them.`);
const typeOf = (key) => {
  const p = tool.inputSchema.properties?.[key] || {};
  return [p.type, ...(p.anyOf || []).map((a) => a.type)].flat().filter(Boolean);
};
let args = {};
for (const part of rest) {
  if (part.trim().startsWith("{")) {
    try {
      Object.assign(args, JSON.parse(part));
    } catch {
      fail(`Invalid JSON: ${part}`);
    }
    continue;
  }
  const at = part.indexOf("=");
  if (at < 1) fail(`Expected key=value or a JSON object, got "${part}"`);
  const key = part.slice(0, at),
    raw = part.slice(at + 1);
  const types = typeOf(key);
  let value = raw;
  if (
    /^(-?\d+(\.\d+)?|true|false|null)$/.test(raw) &&
    !(types.includes("string") && !(raw === "null" && types.includes("null")))
  )
    value = JSON.parse(raw);
  args[key] = value;
}
const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(args),
}).catch(() => fail(`Cannot reach ${base}`));
const reply = await res
  .json()
  .catch(() => ({ error: `Server returned ${res.status}` }));
if (reply.error) fail(reply.error);
console.log(JSON.stringify(reply.result, null, 2));

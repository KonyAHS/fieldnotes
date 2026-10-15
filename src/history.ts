// Undo and redo for workspace edits. Each step keeps the workspace before and
// after one edit. Undoing applies only what that edit changed to the current
// workspace, so later changes from other devices or agents are kept.
import type { Workspace } from "./model";
type Json = unknown;
type Item = { id: string };
const isObject = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const hasIds = (v: Json): v is Item[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((x) => isObject(x) && typeof x.id === "string");
export const same = (a: Json, b: Json) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);
// The value `current` takes when the change from `from` to `to` is applied.
// Lists of items with IDs are merged item by item; other values are replaced
// only where `current` still matches `from`.
export function apply(current: Json, from: Json, to: Json): Json {
  if (same(from, to)) return current;
  if (isObject(current) && isObject(from) && isObject(to)) {
    const out: Record<string, Json> = { ...current };
    for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
      const v = apply(current[key], from[key], to[key]);
      if (v === undefined) delete out[key];
      else out[key] = v;
    }
    return out;
  }
  const list = (v: Json) => Array.isArray(v) && (v.length === 0 || hasIds(v));
  if (list(current) && list(from) && list(to)) {
    const c = current as Item[],
      f = from as Item[],
      t = to as Item[];
    const fromIds = new Map(f.map((x) => [x.id, x]));
    const toIds = new Set(t.map((x) => x.id));
    const out: Item[] = [];
    for (const item of c) {
      const before = fromIds.get(item.id);
      if (!before) {
        out.push(item);
        continue;
      }
      // Removed by the change.
      if (!toIds.has(item.id)) continue;
      out.push(
        apply(
          item,
          before,
          t.find((x) => x.id === item.id),
        ) as Item,
      );
    }
    // Added by the change: placed after the item that precedes it in `to`.
    t.forEach((item, i) => {
      if (fromIds.has(item.id) || out.some((x) => x.id === item.id)) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const k = out.findIndex((x) => x.id === t[j].id);
        if (k >= 0) {
          at = k + 1;
          break;
        }
      }
      out.splice(at, 0, item);
    });
    return out;
  }
  return same(current, from) ? to : current;
}
type Named = { kind: string; name: string; body: string };
// Every named thing in a workspace, without its nested lists.
function things(w: Workspace) {
  const map = new Map<string, Named>();
  const add = (id: string, kind: string, name: string, value: object) =>
    map.set(id, { kind, name, body: JSON.stringify(value) });
  for (const p of w.places) add(p.id, "place", p.name, p);
  for (const t of w.trips) {
    const { scenarios, tasks, activeScenarioId, ...rest } = t;
    void activeScenarioId;
    add(t.id, "trip", t.name, rest);
    for (const a of tasks) add(a.id, "task", a.title, a);
    for (const s of scenarios) {
      const { entries, ...info } = s;
      add(s.id, "scenario", s.name, info);
      for (const e of entries)
        add(e.id, e.type === "stay" ? "stay" : "plan", e.title, e);
    }
  }
  return map;
}
// A short description such as "Delete “Ramen”", or null when only the
// selected trip or scenario changed (navigation, not an edit).
export function describe(before: Workspace, after: Workspace) {
  const a = things(before),
    b = things(after);
  const added: Named[] = [],
    removed: Named[] = [],
    changed: Named[] = [];
  for (const [id, x] of b)
    if (!a.has(id)) added.push(x);
    else if (a.get(id)!.body !== x.body) changed.push(x);
  for (const [id, x] of a) if (!b.has(id)) removed.push(x);
  const name = (list: Named[], verb: string) =>
    list.length === 1
      ? `${verb} “${list[0].name}”`
      : `${verb} ${list.length} ${list.every((x) => x.kind === list[0].kind) ? list[0].kind + "s" : "items"}`;
  // Name the main action; cascading edits (unlinked plans) are implied.
  if (removed.length) return name(removed, "Delete");
  if (added.length) return name(added, "Add");
  if (changed.length) return name(changed, "Change");
  return null;
}
export type Step = {
  before: Workspace;
  after: Workspace;
  label: string;
  at: number;
};

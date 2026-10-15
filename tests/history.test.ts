import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed.ts";
import { apply, describe } from "../src/history.ts";
import { WorkspaceSchema, type Workspace } from "../src/model.ts";
const entries = (w: Workspace) => w.trips[0].scenarios[0].entries;
test("undoing a deletion restores the plan in place and keeps later edits from elsewhere", () => {
  const before = seedWorkspace();
  const victim = entries(before)[1];
  const after = structuredClone(before);
  entries(after).splice(1, 1);
  assert.equal(describe(before, after), `Delete “${victim.title}”`);
  // Another device renames a different plan and adds a place afterwards.
  const current = structuredClone(after);
  entries(current)[0].title = "Renamed elsewhere";
  current.places.push({ ...current.places[0], id: "new-place", name: "New" });
  const undone = apply(current, after, before) as Workspace;
  assert.equal(entries(undone)[1].id, victim.id);
  assert.equal(entries(undone)[0].title, "Renamed elsewhere");
  assert.ok(undone.places.some((p) => p.id === "new-place"));
  WorkspaceSchema.parse(undone);
  // Redo removes it again.
  const redone = apply(undone, before, after) as Workspace;
  assert.ok(!entries(redone).some((e) => e.id === victim.id));
});
test("undoing an edit leaves fields changed later untouched", () => {
  const before = seedWorkspace();
  const after = structuredClone(before);
  entries(after)[0].notes = "first";
  assert.match(describe(before, after)!, /^Change/);
  const current = structuredClone(after);
  entries(current)[0].bookingRef = "ABC123";
  const undone = apply(current, after, before) as Workspace;
  assert.equal(entries(undone)[0].notes, entries(before)[0].notes);
  assert.equal(entries(undone)[0].bookingRef, "ABC123");
});
test("switching trips or scenarios is not an undoable edit", () => {
  const before = seedWorkspace();
  const after = structuredClone(before);
  after.trips[0].scenarios.push({
    ...structuredClone(after.trips[0].scenarios[0]),
    id: "s2",
    entries: [],
  });
  assert.equal(
    describe(before, after),
    "Add “" + after.trips[0].scenarios[0].name + "”",
  );
  const switched = structuredClone(after);
  switched.trips[0].activeScenarioId = "s2";
  assert.equal(describe(after, switched), null);
});

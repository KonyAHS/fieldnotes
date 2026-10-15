import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyEntry, type Entry } from "../src/model.ts";
import { layout } from "../src/timelineLayout.ts";
const plan = (id: string, start: string, end: string): Entry => ({
  ...emptyEntry("2026-10-31"),
  id,
  title: id,
  startTime: start,
  endTime: end,
});
const run = (...e: Entry[]) =>
  Object.fromEntries(layout(e, "2026-10-31", 6).map((x) => [x.entry.id, x]));
test("short plans inside a long one are drawn on top of it", () => {
  const r = run(
    plan("festival", "09:00", "21:00"),
    plan("lunch", "12:00", "13:00"),
    plan("dinner", "18:00", "19:00"),
  );
  assert.equal(r.lunch.host, r.festival);
  assert.equal(r.dinner.host, r.festival);
  assert.equal(r.festival.lanes, 1);
  assert.equal(r.lunch.lanes, 1);
  assert.equal(r.lunch.group, r.festival.group);
});
test("plans starting together stay side by side", () => {
  const r = run(
    plan("festival", "09:00", "21:00"),
    plan("coffee", "09:15", "10:00"),
  );
  assert.equal(r.coffee.host, null);
  assert.equal(r.festival.lanes, 2);
  assert.equal(r.coffee.lane, 1);
});
test("overlapping plans on a backdrop share its space", () => {
  const r = run(
    plan("festival", "09:00", "21:00"),
    plan("panel", "13:00", "15:00"),
    plan("snack", "14:00", "14:30"),
  );
  assert.equal(r.snack.host, r.festival);
  assert.equal(r.panel.host, r.festival);
  assert.equal(r.panel.lanes, 2);
  assert.notEqual(r.panel.lane, r.snack.lane);
});
test("short plans don't host others", () => {
  const r = run(
    plan("museum", "10:00", "11:30"),
    plan("cafe", "11:00", "12:00"),
  );
  assert.equal(r.cafe.host, null);
  assert.equal(r.museum.lanes, 2);
});

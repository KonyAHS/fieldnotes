import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed.ts";
import {
  emptyEntry,
  emptyPlace,
  renamedAttachment,
  type Place,
} from "../src/model.ts";
import {
  mapListCsv,
  mapListFileName,
  mapListHeader,
  mapListRows,
} from "../src/mapsList.ts";
function setup() {
  const w = seedWorkspace();
  const t = w.trips[0];
  const place = (id: string, kind: Place["kind"], extra: Partial<Place> = {}) =>
    ({
      ...emptyPlace(),
      id,
      name: id,
      kind,
      country: "Japan",
      city: "Tokyo",
      ...extra,
    }) as Place;
  w.places = [
    place("hostel", "hotel", { lat: 35.69, lng: 139.79 }),
    place("ramen", "restaurant", { address: "1-2-3 Ginza" }),
    place("tower", "attraction", { lat: -33.8568, lng: 151.2153 }),
    place("elsewhere", "restaurant", { country: "Peru" }),
  ];
  const stay = {
    ...emptyEntry("2026-10-29", "stay"),
    id: "stay1",
    title: "Hostel",
    endDate: "2026-11-02",
    placeId: "hostel",
    country: "Japan",
  };
  const unsaved = {
    ...emptyEntry("2026-11-02", "stay"),
    id: "stay2",
    title: "Lake inn",
    endDate: "2026-11-03",
    city: "Yamanakako",
    country: "Japan",
  };
  const lunch = {
    ...emptyEntry("2026-10-30", "food"),
    id: "lunch",
    title: "Ramen",
    placeId: "ramen",
    country: "Japan",
  };
  t.scenarios = [
    { id: "s", name: "Test", description: "", entries: [stay, unsaved, lunch] },
  ];
  return { w, t, s: t.scenarios[0] };
}
test("hotel list follows the stays in order, with dates", () => {
  const { w, t, s } = setup();
  const { rows, unplaced } = mapListRows(w, t, s, "hotels", true);
  assert.deepEqual(
    rows.map((r) => r[1]),
    ["1. hostel", "2. Lake inn"],
  );
  assert.equal(rows[0][0], "hostel");
  assert.equal(rows[0][2], "35.690000, 139.790000");
  assert.match(rows[0][4], /29 Oct – 2 Nov \(4 nights\)/);
  assert.equal(rows[1][2], "Yamanakako, Japan");
  assert.deepEqual(unplaced, ["2. Lake inn"]);
  assert.equal(rows[0].length, mapListHeader.length);
});
test("restaurant list keeps to the trip's countries", () => {
  const { w, t, s } = setup();
  const all = mapListRows(w, t, s, "food", false).rows.map((r) => r[0]);
  assert.deepEqual(all, ["ramen"]);
  const planned = mapListRows(w, t, s, "food", true).rows;
  assert.equal(planned[0][2], "1-2-3 Ginza");
  assert.match(planned[0][4], /30 Oct/);
});
test("csv keeps negative coordinates and guards formulas", () => {
  const { w, t, s } = setup();
  const text = mapListCsv(mapListRows(w, t, s, "sights", false).rows);
  assert.match(text, /"-33\.856800, 151\.215300"/);
  assert.match(mapListCsv([["x", "=SUM(A1)"]]), /"'=SUM\(A1\)"/);
  assert.equal(
    mapListFileName({ ...t, name: "East/Asia" }, "food"),
    "East Asia - Restaurants.csv",
  );
});
test("renaming an attachment keeps its extension", () => {
  const a = {
    id: "abcdefgh",
    name: "Expedia — flight.txt",
    type: "text/plain",
    size: 1,
    added: "",
  };
  assert.equal(renamedAttachment(a, "Flight to Japan"), "Flight to Japan.txt");
  assert.equal(renamedAttachment(a, "Flight.TXT"), "Flight.TXT");
  assert.equal(renamedAttachment(a, "  "), a.name);
  assert.equal(renamedAttachment(a, "a/b"), "ab.txt");
});
test("phone numbers and saved Google links stay usable", () => {
  const { w, t, s } = setup();
  w.places[0].phone = "+81 3-5839-2778";
  w.places[0].notes = "Google Maps: https://maps.google.com/?cid=123&x=1";
  const row = mapListRows(w, t, s, "hotels", true).rows[0];
  assert.equal(row[10], "https://maps.google.com/?cid=123");
  assert.match(mapListCsv([row]), /"\+81 3-5839-2778"/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyEntry, type Entry, type Scenario } from "../src/model.ts";
import { tripRoute, greatCircle, km, simplify } from "../src/tripRoute.ts";
const entry = (e: Partial<Entry>): Entry => ({
  ...emptyEntry(e.date || "2026-10-28"),
  country: "Japan",
  ...e,
});
const stay = (id: string, city: string, date: string, endDate: string) =>
  entry({ id, type: "stay", title: id, city, date, endDate });
const go = (
  id: string,
  city: string,
  toCity: string,
  date: string,
  mode: string,
  extra: Partial<Entry> = {},
) =>
  entry({
    id,
    type: "transport",
    title: id,
    city,
    toCity,
    date,
    endDate: date,
    startTime: "10:00",
    endTime: "12:00",
    mode,
    ...extra,
  });
const scenario = (...entries: Entry[]) =>
  ({ id: "s", name: "s", entries }) as unknown as Scenario;
test("visits cities in order with the transport between them", () => {
  const r = tripRoute(
    scenario(
      go("fly", "Doha", "Tokyo", "2026-10-28", "Flight", {
        country: "Qatar",
        toCountry: "Japan",
      }),
      stay("tokyo", "Tokyo", "2026-10-29", "2026-11-02"),
      // Arrives before check-in time, but on the check-in day.
      go("bus", "Tokyo", "Nagoya", "2026-11-02", "Bus", { startTime: "18:00" }),
      stay("nagoya", "Nagoya", "2026-11-02", "2026-11-05"),
      go("day1", "Nagoya", "Shirakawa-go", "2026-11-03", "Bus"),
      go("day2", "Shirakawa-go", "Nagoya", "2026-11-03", "Bus", {
        startTime: "16:00",
      }),
      stay("busan", "Busan", "2026-11-05", "2026-11-08"),
      go("idea", "Nagoya", "Osaka", "2026-11-04", "Train", { status: "idea" }),
    ),
  );
  assert.deepEqual(
    r.stops.map((s) => `${s.n}.${s.city}`),
    [
      "1.Doha",
      "2.Tokyo",
      "3.Nagoya",
      "4.Shirakawa-go",
      "5.Nagoya",
      "6.Busan",
    ],
  );
  assert.deepEqual(
    r.hops.map((h) => h.mode),
    ["Flight", "Bus", "Bus", "Bus", ""],
  );
  assert.equal(r.stops[2].stay?.id, "nagoya");
  assert.equal(r.stops[3].stay, null);
});
test("connecting journeys and local transfers fill the route", () => {
  const r = tripRoute(
    scenario(
      go("a", "Nagoya", "Osaka", "2026-11-06", "Shinkansen"),
      go("b", "Osaka", "Toyonaka", "2026-11-06", "Metro", {
        scope: "local",
        startTime: "13:00",
      }),
      go("c", "Toyonaka", "Kagoshima", "2026-11-06", "Flight", {
        startTime: "15:00",
      }),
    ),
  );
  assert.deepEqual(
    r.hops.map((h) => `${h.from.city}-${h.to.city}:${h.mode}`),
    [
      "Nagoya-Osaka:Shinkansen",
      "Osaka-Toyonaka:Metro",
      "Toyonaka-Kagoshima:Flight",
    ],
  );
});
test("flight arcs follow the great circle across the date line", () => {
  const arc = greatCircle([35.5, 139.8], [37.6, -122.4]);
  assert.deepEqual(arc[0].map(Math.round), [36, 140]);
  assert.ok(arc.every((p, i) => !i || Math.abs(p[1] - arc[i - 1][1]) < 20));
  assert.ok(Math.max(...arc.map((p) => p[0])) > 45);
  assert.equal(Math.round(arc.at(-1)![1]), 238);
});
test("rail tracks are simplified without losing their bends", () => {
  assert.equal(Math.round(km([35.681, 139.767], [34.733, 135.5])), 402);
  const track: [number, number][] = [
    [0, 0],
    [0.0001, 1],
    [0, 2],
    [1, 2],
    [1.5, 2.00005],
    [2, 2],
  ];
  assert.deepEqual(simplify(track, 0.001), [
    [0, 0],
    [0, 2],
    [2, 2],
  ]);
  assert.deepEqual(simplify(track, 0.00001), track);
});

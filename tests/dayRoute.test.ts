import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyEntry,
  emptyPlace,
  type Entry,
  type Place,
  type Scenario,
} from "../src/model.ts";
import { dayRoute, legMode, legWhen } from "../src/dayRoute.ts";
import type { Point } from "../src/tripRoute.ts";
import { viaLabel, viaStops } from "../src/via.ts";
import { decodePolyline, toTransitRoute } from "../server/transit.ts";
const D = "2026-11-03";
const place = (id: string, lat: number, lng: number): Place => ({
  ...emptyPlace(),
  id,
  name: id,
  lat,
  lng,
});
const places = [
  place("hotelA", 35.68, 139.76),
  place("hotelB", 35.0, 135.76),
  place("temple", 35.71, 139.79),
  place("cafe", 35.66, 139.7),
  place("station", 35.69, 139.7),
];
const entry = (e: Partial<Entry>): Entry => ({
  ...emptyEntry(e.date || D, e.type),
  id: e.title || "x",
  ...e,
});
const stay = (title: string, placeId: string, date: string, endDate: string) =>
  entry({ type: "stay", title, placeId, date, endDate });
const plan = (title: string, placeId: string, start: string, end: string) =>
  entry({ title, placeId, startTime: start, endTime: end });
const scenario = (...entries: Entry[]) =>
  ({ id: "s", name: "s", description: "", entries }) as Scenario;
test("routes from the morning hotel through plans to the night's hotel", () => {
  const r = dayRoute(
    scenario(
      stay("A", "hotelA", "2026-11-01", "2026-11-05"),
      plan("cafe", "cafe", "13:00", "14:00"),
      plan("temple", "temple", "09:30", "11:00"),
    ),
    places,
    D,
  );
  assert.deepEqual(
    r.stops.map((s) => `${s.n}:${s.name}`),
    ["1:hotelA", "2:temple", "3:cafe", "4:hotelA"],
  );
  assert.deepEqual(
    r.legs.map((l) => l.when && `${l.when.by} ${l.when.time}`),
    ["arrive 09:30", "depart 11:00", "depart 14:00"],
  );
  // Tokyo is UTC+9.
  assert.deepEqual(legWhen(r.legs[0]), {
    by: "arrive",
    at: "2026-11-03T00:30:00.000Z",
  });
});
test("keeps planned transport and leaves out ideas and unplaced plans", () => {
  const r = dayRoute(
    scenario(
      stay("A", "hotelA", "2026-11-01", D),
      stay("B", "hotelB", D, "2026-11-06"),
      plan("temple", "temple", "09:00", "10:00"),
      entry({
        type: "transport",
        title: "metro",
        placeId: "station",
        mode: "Metro",
        startTime: "10:20",
        endTime: "10:40",
      }),
      entry({
        type: "transport",
        title: "shinkansen",
        mode: "Shinkansen",
        startTime: "11:00",
        endTime: "13:15",
      }),
      plan("coffee", "cafe", "10:45", "10:55"),
      { ...plan("idea", "cafe", "16:00", "17:00"), status: "idea" },
      plan("nowhere", "", "18:00", "19:00"),
    ),
    places,
    D,
  );
  assert.deepEqual(
    r.stops.map((s) => s.name),
    ["hotelA", "temple", "station", "cafe", "hotelB"],
  );
  assert.equal(r.legs[1].planned[0].title, "metro");
  assert.equal(r.legs[1].when, null);
  assert.equal(r.legs[2].planned.length, 0);
  // Into the new city on the train: planned, not looked up.
  assert.equal(r.legs[3].planned[0].title, "shinkansen");
  assert.deepEqual(
    r.unplaced.map((e) => e.title),
    ["nowhere"],
  );
});
test("decodes Google polylines and merges walking steps", () => {
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
  const r = toTransitRoute({
    duration: "1500s",
    distanceMeters: 5000,
    localizedValues: { transitFare: { text: "¥210" } },
    legs: [
      {
        steps: [
          { travelMode: "WALK", staticDuration: "120s", distanceMeters: 100 },
          { travelMode: "WALK", staticDuration: "60s", distanceMeters: 50 },
          {
            travelMode: "TRANSIT",
            staticDuration: "900s",
            distanceMeters: 4800,
            transitDetails: {
              stopDetails: {
                departureStop: { name: "Asakusa" },
                arrivalStop: { name: "Ueno" },
              },
              stopCount: 3,
              transitLine: { name: "Ginza Line", nameShort: "G" },
            },
          },
        ],
      },
    ],
  });
  assert.ok(r.found);
  assert.equal(r.fare, "¥210");
  assert.deepEqual(
    r.steps.map((s) => [s.mode, s.minutes, s.meters]),
    [
      ["walk", 3, 150],
      ["transit", 15, 4800],
    ],
  );
  assert.equal(r.steps[1].line?.short, "G");
  assert.deepEqual(toTransitRoute(undefined), { found: false });
});
test("places marked as located but without a position are located again", async () => {
  const { needsLocation } = await import("../src/locate.ts");
  const p = place("x", 0, 0);
  assert.equal(
    needsLocation({ ...p, lat: null, lng: null, geo: "auto" }),
    true,
  );
  assert.equal(needsLocation({ ...p, lat: null, lng: null }), true);
  assert.equal(
    needsLocation({ ...p, lat: null, lng: null, geo: "failed" }),
    false,
  );
  assert.equal(needsLocation({ ...p, geo: "auto" }), false);
});
test("journeys with no saved place run between the cities they connect", () => {
  const cities: Record<string, Point> = {
    Kagoshima: [31.58, 130.54],
    Kirishima: [31.8, 130.72],
    Yakushima: [30.36, 130.53],
  };
  const r = dayRoute(
    scenario(
      stay("A", "hotelB", "2026-11-01", D),
      stay("B", "temple", D, "2026-11-05"),
      entry({
        type: "transport",
        title: "Kyoto → Kagoshima-Chuo · Shinkansen",
        mode: "Shinkansen",
        scope: "intercity",
        city: "Kyoto",
        toCity: "Kagoshima",
        startTime: "07:00",
        endTime: "12:30",
      }),
      entry({
        type: "transport",
        title: "Kagoshima-Chuo → Kagoshima Airport · airport bus",
        mode: "Bus",
        scope: "local",
        city: "Kagoshima",
        toCity: "Kirishima",
        startTime: "13:00",
        endTime: "13:45",
      }),
      entry({
        type: "transport",
        title: "Kagoshima → Yakushima · XX101",
        mode: "Flight",
        scope: "intercity",
        city: "Kagoshima",
        toCity: "Yakushima",
        startTime: "15:25",
        endTime: "16:05",
      }),
    ),
    places,
    D,
    (city) => cities[city] || null,
  );
  assert.deepEqual(
    r.stops.map((s) => `${s.name}${s.approx ? "~" : ""}`),
    [
      "hotelB",
      "Kagoshima-Chuo~",
      "Kagoshima Airport~",
      "Yakushima~",
      "temple",
    ],
  );
  assert.deepEqual(r.legs.map(legMode), ["Shinkansen", "Bus", "Flight", ""]);
  // Only city centres are known, so nothing is looked up.
  assert.ok(r.legs.every((l) => l.when === null));
});
test("a city reached and then a place in it are one stop", () => {
  const r = dayRoute(
    scenario(
      stay("A", "hotelB", "2026-11-01", D),
      stay("B", "hotelA", D, "2026-11-05"),
      entry({
        type: "transport",
        title: "Kyoto → Tokyo",
        mode: "Shinkansen",
        scope: "intercity",
        city: "Kyoto",
        toCity: "Tokyo",
        startTime: "08:00",
        endTime: "10:15",
      }),
      plan("temple", "temple", "11:00", "12:00"),
    ),
    places,
    D,
    (city) => (city === "Tokyo" ? [35.68, 139.77] : null),
  );
  assert.deepEqual(
    r.stops.map((s) => `${s.n}:${s.name}`),
    ["1:hotelB", "2:temple", "3:hotelA"],
  );
  assert.equal(r.legs[0].planned.length, 1);
  assert.equal(r.legs[0].to.name, "temple");
});
test("planned local rides by train are looked up at their time", () => {
  const r = dayRoute(
    scenario(
      stay("A", "hotelA", "2026-11-01", "2026-11-05"),
      entry({
        type: "transport",
        title: "to the temple",
        mode: "Metro",
        scope: "local",
        placeId: "temple",
        startTime: "09:10",
        endTime: "09:30",
      }),
      entry({
        type: "transport",
        title: "taxi back",
        mode: "Taxi",
        scope: "local",
        placeId: "hotelA",
        startTime: "12:00",
        endTime: "12:20",
      }),
    ),
    places,
    D,
  );
  assert.deepEqual(
    r.legs.map((l) => l.when && `${l.when.by} ${l.when.time}`),
    ["depart 09:10", null],
  );
});
test("stops on the way: stated, assumed from hub airlines, or set", () => {
  const flight = (e: Partial<Entry>) =>
    entry({
      type: "transport",
      mode: "Flight",
      scope: "intercity",
      city: "Kuwait",
      toCity: "Tokyo",
      title: "Kuwait → Tokyo Narita",
      ...e,
    });
  const names = (e: Entry) =>
    viaStops(e).map((s) => `${viaLabel(s)} ${s.source}`);
  assert.deepEqual(
    names(
      flight({
        notes:
          "Apr2 EK1001 KWI08:35 → DXB10:55; EK1002 DXB12:55 → CMB18:45; UL1003 CMB20:30 → NRT08:10 Apr3.",
      }),
    ),
    [
      "Dubai (DXB) 10:55–12:55 (2 h) stated",
      "Colombo (CMB) 18:45–20:30 (1 h 45) stated",
    ],
  );
  assert.deepEqual(names(flight({ provider: "Emirates EK1004" })), [
    "Dubai (DXB) assumed",
  ]);
  assert.deepEqual(
    names(flight({ provider: "Emirates", notes: "Direct flight" })),
    [],
  );
  assert.deepEqual(
    names(flight({ provider: "Emirates", via: ["direct"] })),
    [],
  );
  assert.deepEqual(names(flight({ via: ["DOH 03:10–07:40"] })), [
    "Doha (DOH) 03:10–07:40 (4 h 30) set",
  ]);
  // Notes about a whole ticket add nothing to its first flight.
  assert.deepEqual(
    names(
      flight({
        city: "Seoul",
        toCity: "Beijing",
        title: "Seoul → Beijing Daxing · XX202",
        notes: "First part of one ICN→PKX→LHR ticket.",
      }),
    ),
    [],
  );
  assert.deepEqual(
    names(
      flight({
        mode: "Shinkansen",
        city: "Kyoto",
        toCity: "Kagoshima",
        title: "Kyoto → Kagoshima-Chuo",
        option: "Kyoto–Kagoshima-Chuo via Shin-Osaka or Hakata",
        notes: "Book via SmartEX.",
      }),
    ),
    ["Shin-Osaka stated"],
  );
});

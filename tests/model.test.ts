import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed.ts";
import {
  emptyEntry,
  emptyPlace,
  WorkspaceSchema,
  EntrySchema,
  issuesFor,
  occupies,
  instant,
  visaRows,
  type VisaCategory,
  cloneScenario,
  distance,
  csv,
  uid,
  isWeekend,
  mondayOf,
  type Entry,
  type Trip,
  type Scenario,
  bookingState,
} from "../src/model.ts";
function setup(entries: Entry[]) {
  const w = seedWorkspace();
  const t = w.trips[0];
  t.start = "2026-10-27";
  t.end = "2026-11-03";
  t.scenarios = [{ id: "s", name: "Test", description: "", entries }];
  t.activeScenarioId = "s";
  return { trip: t, scenario: t.scenarios[0] };
}
const stay = (
  date: string,
  endDate: string,
  city: string,
  country = "Japan",
) => ({ ...emptyEntry(date, "stay"), title: city, city, country, endDate });
const transport = (
  date: string,
  city: string,
  toCity: string,
  more: Partial<Entry> = {},
) => ({
  ...emptyEntry(date, "transport"),
  title: `${city} to ${toCity}`,
  city,
  toCity,
  toCountry: "Japan",
  startTime: "09:00",
  endTime: "11:00",
  ...more,
});
test("seed is valid, IDs unique and alternatives independently editable", () => {
  const w = seedWorkspace();
  assert.equal(WorkspaceSchema.safeParse(w).success, true);
  const s = w.trips[0].scenarios[0],
    copy = cloneScenario(s, "copy");
  copy.entries[0].title = "New";
  assert.notEqual(s.entries[0].title, "New");
  assert.notEqual(s.entries[0].id, copy.entries[0].id);
});
test("hotel checkout is exclusive and at least one night", () => {
  const e = stay("2026-10-28", "2026-10-30", "Tokyo");
  assert.equal(occupies(e, "2026-10-29"), true);
  assert.equal(occupies(e, "2026-10-30"), false);
  e.endDate = e.date;
  assert.equal(EntrySchema.safeParse(e).success, false);
});
test("missing intercity transfer is resolved by matching direction and date", () => {
  const es = [
    stay("2026-10-28", "2026-10-30", "Tokyo"),
    stay("2026-10-30", "2026-11-03", "Nagoya"),
  ];
  const { trip, scenario } = setup(es);
  assert.equal(
    issuesFor(trip, scenario, []).filter((i) => i.kind === "transfer").length,
    1,
  );
  scenario.entries.push(transport("2026-10-29", "Tokyo", "Nagoya"));
  assert.equal(
    issuesFor(trip, scenario, []).filter((i) => i.kind === "transfer").length,
    1,
  );
  scenario.entries.push(transport("2026-10-30", "Tokyo", "Nagoya"));
  assert.equal(
    issuesFor(trip, scenario, []).filter((i) => i.kind === "transfer").length,
    0,
  );
});
test("multi-leg travel counts as connected only in chronological order", () => {
  const es = [
    stay("2026-10-28", "2026-10-30", "Tokyo"),
    stay("2026-10-30", "2026-11-03", "Yakushima"),
    transport("2026-10-30", "Tokyo", "Kagoshima", {
      startTime: "07:00",
      endTime: "09:00",
    }),
    transport("2026-10-30", "Kagoshima", "Yakushima", {
      startTime: "10:00",
      endTime: "11:00",
    }),
  ];
  const { trip, scenario } = setup(es);
  assert.equal(
    issuesFor(trip, scenario, []).filter((i) => i.kind === "transfer").length,
    0,
  );
  scenario.entries[3].startTime = "08:00";
  assert.equal(
    issuesFor(trip, scenario, []).filter((i) => i.kind === "transfer").length,
    1,
  );
});
test("same city hotel change is resolved only by its linked transport, ideas do not resolve it", () => {
  const es = [
    stay("2026-10-28", "2026-10-30", "Tokyo"),
    { ...stay("2026-10-30", "2026-11-03", "Tokyo"), title: "New hotel" },
  ];
  const { trip, scenario } = setup(es);
  assert.equal(
    issuesFor(trip, scenario, []).filter((i) => i.kind === "stay-transfer")
      .length,
    1,
  );
  scenario.entries.push(
    transport("2026-10-30", "Tokyo", "Tokyo", {
      scope: "local",
      status: "idea",
      fromStayId: es[0].id,
      toStayId: es[1].id,
    }),
  );
  assert.equal(
    issuesFor(trip, scenario, []).filter((i) => i.kind === "stay-transfer")
      .length,
    1,
  );
  scenario.entries[2].status = "planned";
  scenario.entries[2].toStayId = "";
  assert.equal(
    issuesFor(trip, scenario, []).filter((i) => i.kind === "stay-transfer")
      .length,
    1,
  );
  scenario.entries[2].toStayId = es[1].id;
  assert.equal(
    issuesFor(trip, scenario, []).filter((i) => i.kind === "stay-transfer")
      .length,
    0,
  );
  const cloned = cloneScenario(scenario, "Alternate");
  assert.equal(cloned.entries[2].toStayId, cloned.entries[1].id);
});
test("overnight transport fills night without requiring a hotel", () => {
  const { trip, scenario } = setup([
    transport("2026-10-27", "Doha", "Tokyo", {
      endDate: "2026-10-28",
      startTime: "21:00",
      endTime: "18:00",
      country: "Qatar",
      timezone: "Asia/Qatar",
    }),
  ]);
  assert.equal(
    issuesFor(trip, scenario, []).some(
      (i) => i.kind === "night" && i.date === "2026-10-27",
    ),
    false,
  );
});
test("local times become correct instants across countries", () => {
  assert.equal(
    new Date(instant("2026-10-28", "18:00", "Asia/Tokyo")).toISOString(),
    "2026-10-28T09:00:00.000Z",
  );
  assert.equal(
    instant("2026-10-28", "15:00", "Asia/Qatar"),
    instant("2026-10-28", "21:00", "Asia/Tokyo"),
  );
});
test("schedule conflicts use actual instants and warn on invalid journey end", () => {
  const a = {
      ...emptyEntry("2026-10-28"),
      title: "First",
      startTime: "09:00",
      endTime: "12:00",
    },
    b = {
      ...emptyEntry("2026-10-28"),
      title: "Second",
      startTime: "11:00",
      endTime: "13:00",
    };
  const { trip, scenario } = setup([a, b]);
  assert.equal(
    issuesFor(trip, scenario, []).filter((i) => i.kind === "overlap").length,
    1,
  );
  b.endTime = "10:00";
  assert.equal(
    issuesFor(trip, scenario, []).some((i) => i.kind === "timing"),
    true,
  );
});
test("Japan export begins with Japan arrival, excludes foreign days, flags missing hotel contact", () => {
  const w = seedWorkspace(),
    t = w.trips[0],
    s = t.scenarios[0];
  const rows = visaRows(t, s, w.places);
  assert.equal(rows[0].date, "2027-04-02");
  assert.equal(rows.at(-1)!.date, "2027-04-12");
  assert.ok(rows[0].missing.includes("contact number"));
  assert.equal(
    rows.some((r) => r.date === "2026-11-10"),
    false,
  );
});
test("visa export uses real accommodation address/contact and omits ideas", () => {
  const hotel = {
    ...emptyPlace(),
    name: "Tokyo hotel",
    kind: "hotel" as const,
    address: "1-2 Tokyo",
    phone: "+81 123",
  };
  const museum = {
    ...emptyPlace(),
    name: "Ghibli Museum",
    kind: "attraction" as const,
    phone: "+81 456",
  };
  const a = {
      ...emptyEntry("2026-10-28"),
      title: "Museum",
      placeId: museum.id,
    },
    idea = {
      ...emptyEntry("2026-10-28"),
      title: "Unchosen",
      status: "idea" as const,
    };
  const { trip, scenario } = setup([
    { ...stay("2026-10-28", "2026-10-29", "Tokyo"), placeId: hotel.id },
    a,
    idea,
  ]);
  const row = visaRows(trip, scenario, [hotel, museum])[0];
  // Each number says which place it belongs to, hotel first.
  assert.equal(row.contact, "Tokyo hotel: +81 123\nGhibli Museum: +81 456");
  assert.ok(row.accommodation.includes(hotel.address));
  assert.equal(row.activity.includes("Unchosen"), false);
});
test("visa uses local place details consistently, including checkout and native-only addresses", () => {
  const hotel = {
    ...emptyPlace(),
    name: "Nagoya hotel",
    nativeName: "三交イン名古屋新幹線口ANNEX",
    country: "Japan",
    nativeAddress: "愛知県名古屋市中村区椿町7-4",
    phone: "+81 52-756-3541",
  };
  const museum = {
    ...emptyPlace(),
    name: "Toyota Museum",
    nativeName: "トヨタ産業技術記念館",
    country: "Japan",
    address: "English museum address",
    nativeAddress: "名古屋市西区則武新町4-1-35",
    phone: "+81 52-551-6115",
  };
  const { trip, scenario } = setup([
    { ...stay("2026-10-28", "2026-10-29", "Nagoya"), placeId: hotel.id },
    { ...emptyEntry("2026-10-28"), title: "Visit museum", placeId: museum.id },
    transport("2026-10-29", "Nagoya", "Shanghai", { toCountry: "China" }),
  ]);
  const rows = visaRows(trip, scenario, [hotel, museum]);
  assert.equal(
    rows[0].accommodation,
    `${hotel.nativeName}\n${hotel.nativeAddress}`,
  );
  assert.equal(
    rows[0].contact,
    `${hotel.nativeName}: 052-756-3541\n${museum.nativeName}: 052-551-6115`,
  );
  assert.ok(
    rows[0].items.some(
      (i) => i.title === museum.nativeName && i.detail === museum.nativeAddress,
    ),
  );
  assert.ok(rows[0].activity.includes(`Check in to ${hotel.nativeName}`));
  assert.ok(rows[1].activity.includes(`Check out of ${hotel.nativeName}`));
  assert.equal(rows[0].missing.includes("hotel address"), false);
  assert.equal(rows[0].activity.includes(museum.address), false);
});
test("validation rejects impossible calendar dates, dangling places and invalid time zones", () => {
  const w = seedWorkspace();
  w.trips[0].start = "2026-02-30";
  assert.equal(WorkspaceSchema.safeParse(w).success, false);
  w.trips[0].start = "2026-10-27";
  w.trips[0].scenarios[0].entries[0].placeId = "missing";
  assert.equal(WorkspaceSchema.safeParse(w).success, false);
  assert.equal(
    EntrySchema.safeParse({
      ...emptyEntry("2026-10-28"),
      title: "Test",
      timezone: "not-a-zone",
    }).success,
    false,
  );
});
test("distances are absent without coordinates; CSV safely escapes formulas", () => {
  assert.equal(distance({ lat: null, lng: null }, { lat: 1, lng: 2 }), null);
  assert.ok(
    (distance({ lat: 35, lng: 139 }, { lat: 35, lng: 139.01 }) || 0) < 1,
  );
  assert.ok(csv([["=cmd", 'He said "hi"']]).includes("'=cmd"));
  assert.ok(csv([['He said "hi"']]).includes('""hi""'));
});
test("visa day lists several plans in time order, hotel change and transit", () => {
  const a = {
    ...emptyPlace(),
    name: "Hotel A",
    kind: "hotel" as const,
    address: "1 A St",
    phone: "+81 1",
  };
  const b = {
    ...emptyPlace(),
    name: "Hotel B",
    kind: "hotel" as const,
    address: "2 B St",
    phone: "+81 2",
  };
  const { trip, scenario } = setup([
    { ...stay("2026-10-28", "2026-10-30", "Tokyo"), placeId: a.id },
    { ...stay("2026-10-30", "2026-11-01", "Kyoto"), placeId: b.id },
    {
      ...emptyEntry("2026-10-30"),
      title: "Lunch",
      city: "Kyoto",
      startTime: "13:00",
      endTime: "14:00",
    },
    {
      ...emptyEntry("2026-10-30"),
      title: "Breakfast",
      city: "Tokyo",
      startTime: "07:00",
      endTime: "08:00",
    },
    transport("2026-10-30", "Tokyo", "Kyoto", {
      mode: "Train",
      startTime: "09:00",
      endTime: "11:15",
    }),
  ]);
  const row = visaRows(trip, scenario, [a, b]).find(
    (r) => r.date === "2026-10-30",
  )!;
  const lines = row.activity.split("\n");
  assert.equal(lines[0], "Check out of Hotel A");
  assert.ok(lines[1].includes("Breakfast"));
  assert.ok(lines[2].includes("Train Tokyo → Kyoto"));
  assert.ok(lines[3].includes("Lunch"));
  assert.equal(lines.at(-1), "Check in to Hotel B");
  assert.ok(row.accommodation.includes("Hotel B"));
  assert.deepEqual(row.missing, []);
});
test("visa itinerary leaves out hidden kinds of plan but keeps arrival and departure", () => {
  const { trip, scenario } = setup([
    transport("2026-10-28", "Doha", "Tokyo", {
      country: "Qatar",
      timezone: "Asia/Qatar",
      startTime: "01:00",
      endTime: "18:00",
    }),
    stay("2026-10-28", "2026-10-30", "Tokyo"),
    {
      ...emptyEntry("2026-10-29", "food"),
      title: "Sushi dinner",
      city: "Tokyo",
    },
    { ...emptyEntry("2026-10-29"), title: "Senso-ji", city: "Tokyo" },
    {
      ...emptyEntry("2026-10-29", "note"),
      title: "Buy Suica",
      allDay: true,
    },
    transport("2026-10-30", "Tokyo", "Seoul", {
      toCountry: "Korea",
      endTimezone: "Asia/Seoul",
      startTime: "10:00",
      endTime: "12:30",
    }),
  ]);
  const text = (hidden?: VisaCategory[]) =>
    visaRows(trip, scenario, [], "Japan", hidden)
      .map((r) => r.activity)
      .join("\n");
  const standard = text();
  assert.ok(standard.includes("Sushi dinner") && standard.includes("Senso-ji"));
  assert.ok(!standard.includes("Buy Suica"), "notes are hidden by default");
  const hidden = text(["food", "transport", "note"]);
  assert.ok(!hidden.includes("Sushi dinner"));
  assert.ok(hidden.includes("Senso-ji"));
  assert.ok(hidden.includes("Arrive in Japan 18:00"));
  assert.ok(hidden.includes("Depart from Japan 10:00"));
  assert.ok(text([]).includes("Buy Suica"));
  // A day whose plans are all hidden is accounted for, not missing.
  const quiet = visaRows(trip, scenario, [], "Japan", [
    "food",
    "activity",
    "note",
  ]).find((r) => r.date === "2026-10-29")!;
  assert.equal(quiet.activity, "Stay in Tokyo");
  assert.ok(!quiet.missing.includes("activity plan"));
});
test("overnight transport and other countries produce separate itineraries", () => {
  const { trip, scenario } = setup([
    stay("2026-10-28", "2026-10-30", "Tokyo"),
    transport("2026-10-30", "Fukuoka", "Busan", {
      title: "Ferry",
      mode: "Ferry",
      toCountry: "Korea",
      endDate: "2026-10-31",
      startTime: "22:00",
      endTime: "07:00",
      endTimezone: "Asia/Seoul",
    }),
    stay("2026-10-31", "2026-11-02", "Busan", "Korea"),
  ]);
  const japan = visaRows(trip, scenario, [], "Japan");
  const korea = visaRows(trip, scenario, [], "Korea");
  assert.equal(japan.at(-1)!.date, "2026-10-30");
  assert.ok(japan.at(-1)!.activity.includes("Depart from Japan 22:00"));
  assert.equal(korea[0].date, "2026-10-31");
  assert.ok(korea[0].activity.startsWith("Arrive in Korea 07:00"));
  assert.equal(visaRows(trip, scenario, [], "China").length, 0);
});
test("IDs work without randomUUID (plain-HTTP pages) and weeks start on Monday", () => {
  const original = crypto.randomUUID;
  try {
    // @ts-expect-error simulate an insecure browser context
    crypto.randomUUID = undefined;
    const id = uid();
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.notEqual(uid(), id);
  } finally {
    crypto.randomUUID = original;
  }
  assert.equal(mondayOf("2026-10-27"), "2026-10-26");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26");
  assert.equal(mondayOf("2026-11-02"), "2026-11-02");
  assert.equal(isWeekend("2026-10-31"), true);
  assert.equal(isWeekend("2026-11-02"), false);
});
test("automatic location prefers the place's city and rejects far-away namesakes", async () => {
  const { locatePlace } = await import("../src/locate.ts");
  const place = {
    ...emptyPlace(),
    name: "Forest museum + bus tour",
    city: "Yakushima",
  };
  const calls: string[] = [];
  const geocode = async (q: string) => {
    calls.push(q);
    if (q === "Forest museum + bus tour")
      return [
        {
          lat: 34.6,
          lng: 133.5,
          name: "Elsewhere",
          address: "Okayama",
          kind: "",
        },
      ];
    if (q === "Yakushima")
      return [
        {
          lat: 30.6,
          lng: 131.0,
          name: "Yakushima",
          address: "Yakushima",
          kind: "",
        },
      ];
    return [];
  };
  const found = await locatePlace(place, geocode);
  assert.equal(found.geo, "approx");
  assert.equal(found.lat, 30.6);
  assert.ok(calls.includes("Forest museum, Yakushima"));
});
test("GPX export escapes names and keeps every segment", async () => {
  const { gpx } = await import("../src/gpx.ts");
  const out = gpx('Ridge & "Falls" <loop>', 42, [
    [
      [35.1, 139.1],
      [35.2, 139.2],
    ],
    [[35.3, 139.3]],
  ]);
  assert.ok(
    out.includes("<name>Ridge &amp; &quot;Falls&quot; &lt;loop&gt;</name>"),
  );
  assert.equal(out.match(/<trkseg>/g)?.length, 2);
  assert.equal(out.match(/<trkpt /g)?.length, 3);
  assert.ok(out.includes("openstreetmap.org/relation/42"));
});
test("stay handles keep at least one night inside the trip", async () => {
  const { shiftStay } = await import("../src/model.ts");
  const trip = { start: "2026-10-27", end: "2026-11-21" };
  const s = { date: "2026-10-28", endDate: "2026-11-01" };
  assert.deepEqual(shiftStay(s, "end", 2, trip), {
    date: "2026-10-28",
    endDate: "2026-11-03",
  });
  assert.deepEqual(shiftStay(s, "end", -9, trip), {
    date: "2026-10-28",
    endDate: "2026-10-29",
  });
  assert.deepEqual(shiftStay(s, "start", 5, trip), {
    date: "2026-10-31",
    endDate: "2026-11-01",
  });
  assert.deepEqual(shiftStay(s, "start", -5, trip), {
    date: "2026-10-27",
    endDate: "2026-11-01",
  });
  assert.deepEqual(shiftStay(s, "move", 3, trip), {
    date: "2026-10-31",
    endDate: "2026-11-04",
  });
  assert.deepEqual(shiftStay(s, "move", 40, trip), {
    date: "2026-11-17",
    endDate: "2026-11-21",
  });
});
test("transport legs group alternatives and connecting segments between stays", async () => {
  const { transportLegs, durationText, arrivalDate } =
    await import("../src/transport.ts");
  const { trip, scenario } = setup([
    stay("2026-10-28", "2026-11-01", "Tokyo"),
    stay("2026-11-01", "2026-11-03", "Fukuoka"),
    // Chosen route: train to Osaka, then a connecting flight.
    transport("2026-11-01", "Tokyo", "Osaka", {
      mode: "Train",
      startTime: "08:00",
      endTime: "10:30",
      cost: 14000,
      currency: "JPY",
    }),
    transport("2026-11-01", "Osaka", "Fukuoka", {
      mode: "Flight",
      startTime: "12:00",
      endTime: "13:15",
      cost: 9000,
      currency: "JPY",
    }),
    // Alternative: direct flight, not chosen.
    transport("2026-11-01", "Tokyo", "Fukuoka", {
      mode: "Flight",
      startTime: "09:00",
      endTime: "11:00",
      status: "idea",
      option: "alt",
      cost: 12000,
      currency: "JPY",
    }),
    // A journey outside the stays.
    transport("2026-10-27", "Doha", "Tokyo", {
      mode: "Flight",
      country: "Qatar",
      timezone: "Asia/Qatar",
      startTime: "21:00",
      endDate: "2026-10-28",
      endTime: "13:00",
    }),
  ]);
  const legs = transportLegs(trip, scenario);
  assert.equal(legs.length, 2);
  assert.equal(legs[0].from, "Doha");
  const leg = legs[1];
  assert.equal(`${leg.from}→${leg.to}`, "Tokyo→Fukuoka");
  assert.equal(leg.options.length, 2);
  const chosen = leg.options.find((o) => o.status === "chosen")!;
  assert.equal(chosen.segments.length, 2);
  assert.deepEqual(chosen.modes, ["Train", "Flight"]);
  assert.equal(chosen.minutes, 315);
  assert.deepEqual(chosen.waits, [90]);
  assert.deepEqual(chosen.costs, { JPY: 23000 });
  assert.equal(durationText(chosen.minutes), "5 h 15");
  const alt = leg.options.find((o) => o.status === "alternative")!;
  assert.equal(alt.minutes, 120);
  // Doha 21:00 → Tokyo 13:00 next day is 10 h.
  assert.equal(legs[0].options[0].minutes, 600);
  assert.equal(
    arrivalDate({ ...scenario.entries[2], startTime: "22:00" }, "06:00"),
    "2026-11-02",
  );
});

test("local journeys across municipalities cover stays and activities without intercity cards", async () => {
  const { transportLegs } = await import("../src/transport.ts");
  const { trip, scenario } = setup([
    stay("2026-10-28", "2026-10-30", "Tokyo"),
    stay("2026-10-30", "2026-11-03", "Chiba"),
    transport("2026-10-30", "Tokyo", "Chiba", { scope: "local" }),
    {
      ...emptyEntry("2026-10-30", "activity"),
      city: "Tokyo",
      startTime: "08:00",
      endTime: "08:30",
    },
    {
      ...emptyEntry("2026-10-30", "activity"),
      city: "Chiba",
      startTime: "12:00",
      endTime: "14:00",
    },
  ]);
  assert.deepEqual(transportLegs(trip, scenario), []);
  assert.equal(
    issuesFor(trip, scenario, []).some((i) => i.kind === "transfer"),
    false,
  );
  scenario.entries[2].status = "idea";
  assert.equal(transportLegs(trip, scenario).length, 1);
  assert.equal(
    issuesFor(trip, scenario, []).some((i) => i.kind === "transfer"),
    true,
  );
  scenario.entries[2].status = "planned";
  scenario.entries[2].toCountry = "Korea";
  assert.equal(transportLegs(trip, scenario).length, 1);
});

test("separately grouped city connections do not create an extra empty stay journey", async () => {
  const { transportLegs } = await import("../src/transport.ts");
  const { trip, scenario } = setup([
    stay("2026-10-28", "2026-11-01", "Yamanakako"),
    stay("2026-11-01", "2026-11-03", "Nagoya"),
    transport("2026-11-01", "Yamanakako", "Mishima", { option: "lake-bus" }),
    transport("2026-11-01", "Mishima", "Nagoya", {
      option: "nagoya-train",
      startTime: "11:30",
      endTime: "13:00",
    }),
  ]);
  assert.deepEqual(
    transportLegs(trip, scenario).map((l) => [l.from, l.to]),
    [
      ["Yamanakako", "Mishima"],
      ["Mishima", "Nagoya"],
    ],
  );
  scenario.entries.pop();
  assert.ok(
    transportLegs(trip, scenario).some(
      (l) => l.from === "Yamanakako" && l.to === "Nagoya" && !l.options.length,
    ),
  );
});
test("ticket links accept plain text and phone numbers dial", async () => {
  const { webLink, phoneLink } = await import("../src/model.ts");
  assert.equal(webLink(" jrpass.com/buy "), "https://jrpass.com/buy");
  assert.equal(webLink("http://x.jp"), "http://x.jp");
  assert.equal(phoneLink("+81 3-1234-5678"), "tel:+81312345678");
});
test("tasks show the trip day their title names, and due dates read clearly", async () => {
  const { taskTripDate, dueText } = await import("../src/model.ts");
  const trip = { start: "2026-10-28", end: "2026-11-21" };
  assert.equal(
    taskTripDate("Book Nov2 Shinjuku → Yamanakako bus", trip),
    "2026-11-02",
  );
  assert.equal(taskTripDate("Arrange 8 Nov taxi", trip), "2026-11-08");
  assert.equal(taskTripDate("Tokyo stays Oct29–Nov2", trip), "2026-10-29");
  assert.equal(taskTripDate("buy a prayer mat", trip), "");
  assert.equal(taskTripDate("Reserve Nov 30 thing", trip), "");
  assert.equal(
    dueText("2026-10-27", "2026-10-05"),
    "Due Tue 27 Oct · in 22 days",
  );
  assert.equal(dueText("2026-10-05", "2026-10-05"), "Due today");
  assert.equal(dueText("2026-10-02", "2026-10-05"), "3 days overdue");
});

test("reservation marks: reserved, not reserved yet, or nothing", () => {
  const base = emptyEntry("2026-11-01");
  const train: Entry = { ...base, type: "transport", scope: "intercity" };
  assert.equal(bookingState(train), "todo");
  assert.equal(bookingState({ ...train, needsBooking: false }), null);
  assert.equal(bookingState({ ...train, status: "booked" }), "booked");
  assert.equal(bookingState({ ...train, scope: "local" }), null);
  assert.equal(bookingState({ ...base, type: "activity" }), null);
  assert.equal(
    bookingState({ ...base, type: "activity", needsBooking: true }),
    "todo",
  );
  assert.equal(bookingState({ ...train, status: "idea" }), null);
});
test("plans inside a long activity aren't overlap warnings, inside a flight they are", () => {
  const fest = {
      ...emptyEntry("2026-10-28"),
      title: "Festival",
      startTime: "09:00",
      endTime: "21:00",
    },
    lunch = {
      ...emptyEntry("2026-10-28", "food"),
      title: "Lunch",
      startTime: "12:00",
      endTime: "13:00",
    };
  const overlaps = (...e: Entry[]) => {
    const { trip, scenario } = setup(e);
    return issuesFor(trip, scenario, []).filter((i) => i.kind === "overlap")
      .length;
  };
  assert.equal(overlaps(fest, lunch), 0);
  assert.equal(overlaps({ ...fest, type: "transport" }, lunch), 1);
  assert.equal(overlaps(fest, { ...lunch, endTime: "22:00" }), 1);
});

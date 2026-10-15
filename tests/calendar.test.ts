import { test } from "node:test";
import assert from "node:assert/strict";
import ICAL from "ical.js";
import { tripCalendar } from "../src/calendar.ts";
import { seedWorkspace } from "../src/seed.ts";
import { emptyEntry, type Entry } from "../src/model.ts";
function setup(entries: Entry[]) {
  const ws = seedWorkspace();
  const trip = ws.trips[0];
  const scenario = { ...trip.scenarios[0], entries };
  return { ws, trip: { ...trip, tasks: [] }, scenario };
}
const events = (ics: string) =>
  new ICAL.Component(ICAL.parse(ics))
    .getAllSubcomponents("vevent")
    .map((v) => new ICAL.Event(v));
test("timed plans are written in UTC from their own time zone", () => {
  const visit: Entry = {
    ...emptyEntry("2026-10-30"),
    title: "Museum; tickets, notes",
    startTime: "09:00",
    endTime: "11:30",
    timezone: "Asia/Tokyo",
    notes: "Line one\nLine two",
  };
  const { ws, trip, scenario } = setup([visit]);
  const ics = tripCalendar(trip, scenario, ws.places, {
    hide: [],
    ideas: false,
    deadlines: false,
  });
  assert.match(ics, /DTSTART:20261030T000000Z/);
  assert.match(ics, /DTEND:20261030T023000Z/);
  const [e] = events(ics);
  assert.equal(e.summary, "Museum; tickets, notes");
  assert.match(e.description, /Line one\nLine two/);
  assert.equal(e.uid, `${visit.id}@fieldnotes`);
  for (const line of ics.split("\r\n"))
    assert.ok(new TextEncoder().encode(line).length <= 75, line);
});
test("stays are whole days ending on checkout, filters and ideas apply", () => {
  const stay: Entry = {
    ...emptyEntry("2026-10-29", "stay"),
    title: "Hostel",
    endDate: "2026-11-02",
  };
  const food: Entry = { ...emptyEntry("2026-10-30", "food"), title: "Lunch" };
  const idea: Entry = {
    ...emptyEntry("2026-10-31"),
    title: "Maybe",
    status: "idea",
  };
  const { ws, trip, scenario } = setup([stay, food, idea]);
  const ics = tripCalendar(trip, scenario, ws.places, {
    hide: ["food"],
    ideas: false,
    deadlines: false,
  });
  const list = events(ics);
  assert.deepEqual(
    list.map((e) => e.summary),
    ["🛏 Hostel"],
  );
  assert.match(ics, /DTSTART;VALUE=DATE:20261029/);
  assert.match(ics, /DTEND;VALUE=DATE:20261102/);
  const withIdeas = tripCalendar(trip, scenario, ws.places, {
    hide: [],
    ideas: true,
    deadlines: false,
  });
  assert.equal(events(withIdeas).length, 3);
  assert.match(withIdeas, /STATUS:TENTATIVE/);
});
test("deadlines become all-day reminders", () => {
  const booked: Entry = {
    ...emptyEntry("2026-11-01", "stay"),
    title: "Ryokan",
    endDate: "2026-11-02",
    status: "booked",
    refundDeadline: "2026-10-25",
  };
  const { ws, trip, scenario } = setup([booked]);
  const withTask = {
    ...trip,
    tasks: [
      {
        id: "t1",
        title: "Apply for visa",
        due: "2026-10-10",
        done: false,
        country: "",
        url: "",
      },
      {
        id: "t2",
        title: "Done already",
        due: "2026-10-11",
        done: true,
        country: "",
        url: "",
      },
    ],
  };
  const titles = events(
    tripCalendar(withTask, scenario, ws.places, {
      hide: [],
      ideas: false,
      deadlines: true,
    }),
  ).map((e) => e.summary);
  assert.deepEqual(titles, [
    "🛏 Ryokan",
    "☐ Apply for visa",
    "Last day to cancel: Ryokan",
  ]);
});

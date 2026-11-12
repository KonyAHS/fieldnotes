// A day's movements for the day map: from the hotel slept in, through the
// day's plans in time order, to the night's hotel. Journeys already planned
// as transport are kept as they are; the gaps between them are looked up as
// public transport (Google, cached on the server).
import {
  type Entry,
  type Place,
  type Scenario,
  entriesOn,
  instant,
} from "./model";
import { type Point, km } from "./tripRoute";
export type TransitWhen = { by: "depart" | "arrive"; at: string };
export type TransitStep = {
  mode: "walk" | "transit";
  minutes: number;
  meters: number;
  points: Point[];
  line?: {
    name: string;
    short: string;
    color: string;
    textColor: string;
    vehicle: string;
    vehicleType: string;
    agency: string;
    headsign: string;
  };
  from?: string;
  to?: string;
  depart?: string;
  arrive?: string;
  stops?: number;
};
export type TransitRoute =
  | {
      found: true;
      minutes: number;
      meters: number;
      fare: string;
      steps: TransitStep[];
      /** Set when the trip's date had no timetable yet: the same weekday
       * and time in another week whose timetable was used instead. */
      sample?: string;
    }
  | { found: false };
export type DayStop = {
  n: number;
  name: string;
  point: Point;
  kind: "hotel" | "plan" | "arrival";
  entry: Entry;
  /** Only the city is known (a journey with no saved place): its centre. */
  approx?: boolean;
  /** Local times the stop starts and ends, where known. */
  arrive: string;
  leave: string;
  timezone: string;
};
export type DayLeg = {
  from: DayStop;
  to: DayStop;
  /** Transport already in the plan for this stretch (not looked up). */
  planned: Entry[];
  /** When to look up public transport: for gaps, and for planned local
   * rides by train, bus and the like; null otherwise or when unknown. */
  when: {
    by: "depart" | "arrive";
    date: string;
    time: string;
    tz: string;
  } | null;
};
export type DayRoute = {
  stops: DayStop[];
  legs: DayLeg[];
  /** Plans on the day that have no saved position. */
  unplaced: Entry[];
};
const near = (a: Point, b: Point) => km(a, b) < 0.05;
// A city centre stands in for a place in that city up to this far away.
const sameCity = (a: Point, b: Point) => km(a, b) < 25;
// Rides Google can show as public transport (not taxis, walks or flights).
const transitModes = /Train|Metro|Subway|Tube|Tram|Bus|Monorail|Rail/;
const lookedUp = (planned: Entry[]) =>
  planned.length > 0 &&
  planned.every((e) => e.scope === "local") &&
  planned.some((e) => transitModes.test(e.mode));
// The mode a stretch is drawn in: its journey between cities, if any, else
// its first ride.
export const legMode = (leg: DayLeg) =>
  (leg.planned.find((e) => e.scope === "intercity") || leg.planned[0])?.mode ||
  "";
// "Kagoshima → Yakushima · JL1234" ends at "Yakushima".
const destination = (e: Entry) =>
  e.title
    .split("→")
    .at(-1)!
    .split(/\s+·\s+|;/)[0]
    .trim() || e.toCity;
export function dayRoute(
  scenario: Scenario,
  places: Place[],
  d: string,
  // City centres, for journeys with no saved place; null while unknown.
  cityAt: (city: string, country: string) => Point | null = () => null,
): DayRoute {
  const point = (id: string): Point | null => {
    const p = places.find((x) => x.id === id);
    return p && p.lat !== null && p.lng !== null ? [p.lat, p.lng] : null;
  };
  const name = (e: Entry) =>
    places.find((p) => p.id === e.placeId)?.name || e.title;
  // Proposals are left out; they are often alternatives to each other.
  const firm = scenario.entries.filter((e) => e.status !== "idea");
  const stays = firm.filter((e) => e.type === "stay");
  const slept = stays.find((s) => s.date < d && s.endDate >= d);
  const tonight = stays.find((s) => s.date <= d && s.endDate > d);
  const day = entriesOn({ ...scenario, entries: firm }, d)
    .filter(
      (e) =>
        e.type !== "stay" &&
        e.type !== "note" &&
        !e.allDay &&
        // Plans running over several days are placed on their first.
        (e.date === d || e.type === "transport"),
    )
    .sort(
      (a, b) =>
        (a.date === d ? a.startTime : "00:00").localeCompare(
          b.date === d ? b.startTime : "00:00",
        ) || a.endTime.localeCompare(b.endTime),
    );
  const stops: DayStop[] = [];
  const legs: DayLeg[] = [];
  const unplaced: Entry[] = [];
  let planned: Entry[] = [];
  // When to look up a stretch: planned local rides at their departure, gaps
  // from the time the last place is left, else to arrive at the next.
  const timing = (
    from: DayStop,
    to: DayStop,
    planned: Entry[],
  ): DayLeg["when"] => {
    if (from.approx || to.approx) return null;
    if (lookedUp(planned) && planned[0].date === d)
      return {
        by: "depart",
        date: d,
        time: planned[0].startTime,
        tz: planned[0].timezone,
      };
    if (planned.length) return null;
    if (from.leave)
      return { by: "depart", date: d, time: from.leave, tz: from.timezone };
    if (to.arrive)
      return { by: "arrive", date: d, time: to.arrive, tz: to.timezone };
    return null;
  };
  const visit = (stop: Omit<DayStop, "n">) => {
    const prev = stops.at(-1);
    if (
      prev?.approx &&
      !stop.approx &&
      !planned.length &&
      sameCity(prev.point, stop.point)
    ) {
      // Arrived in a city, then went on to a place there: the place is
      // where the journey really ends.
      const s = { ...stop, n: prev.n };
      stops[stops.length - 1] = s;
      const into = legs.at(-1);
      if (into?.to === prev) {
        into.to = s;
        into.when = timing(into.from, s, into.planned);
      }
      return;
    }
    if (prev && near(prev.point, stop.point) && !planned.length) {
      // Same place again (a meal at the hotel, say): one stop.
      if (stop.leave) prev.leave = stop.leave;
      return;
    }
    const s = { ...stop, n: stops.length + 1 };
    if (prev) {
      legs.push({ from: prev, to: s, planned, when: timing(prev, s, planned) });
    }
    planned = [];
    stops.push(s);
  };
  const sleptAt = slept && point(slept.placeId);
  if (slept && sleptAt)
    visit({
      name: name(slept),
      point: sleptAt,
      kind: "hotel",
      entry: slept,
      arrive: "",
      // Moving hotel: leave at checkout, unless plans come first.
      leave: slept.endDate === d && !day.length ? slept.endTime : "",
      timezone: slept.timezone,
    });
  for (const e of day) {
    const at = point(e.placeId);
    if (e.type === "transport") {
      // Starting the day on the move: from the city the journey leaves.
      const from = !stops.length && cityAt(e.city, e.country);
      if (from)
        visit({
          name: e.city,
          point: from,
          kind: "arrival",
          approx: true,
          entry: e,
          arrive: "",
          leave: "",
          timezone: e.timezone,
        });
      planned.push(e);
      // A transport plan's place is where it goes; without one, a journey
      // to another city ends at that city.
      const to =
        at ||
        (e.toCity && e.toCity !== e.city
          ? cityAt(e.toCity, e.toCountry || e.country)
          : null);
      const ends = e.endDate === d ? e.endTime : "";
      if (to)
        visit({
          name: at ? name(e) : destination(e),
          point: to,
          kind: "arrival",
          approx: !at,
          entry: e,
          arrive: ends,
          leave: ends,
          timezone: e.endTimezone,
        });
      continue;
    }
    if (!at) {
      unplaced.push(e);
      continue;
    }
    visit({
      name: name(e),
      point: at,
      kind: "plan",
      entry: e,
      arrive: e.startTime,
      leave: e.endTime,
      timezone: e.timezone,
    });
  }
  const tonightAt = tonight && point(tonight.placeId);
  if (tonight && tonightAt)
    visit({
      name: name(tonight),
      point: tonightAt,
      kind: "hotel",
      entry: tonight,
      // Arriving in a new city: check in from the hotel's time.
      arrive: tonight.date === d && stops.length === 0 ? tonight.startTime : "",
      leave: "",
      timezone: tonight.timezone,
    });
  return { stops, legs, unplaced };
}
// The leg's lookup time as an instant, for the server.
export const legWhen = (leg: DayLeg): TransitWhen | null =>
  leg.when && {
    by: leg.when.by,
    at: new Date(
      instant(leg.when.date, leg.when.time, leg.when.tz),
    ).toISOString(),
  };
export const directionsUrl = (from: Point, to: Point) =>
  "https://www.google.com/maps/dir/?" +
  new URLSearchParams({
    api: "1",
    origin: `${from[0]},${from[1]}`,
    destination: `${to[0]},${to[1]}`,
    travelmode: "transit",
  });
export class TransitError extends Error {
  constructor(
    message: string,
    readonly code = "",
  ) {
    super(message);
  }
}
// Kept for the browser session; the server keeps found routes for good.
const session = new Map<string, Promise<TransitRoute>>();
export function fetchTransit(from: Point, to: Point, when: TransitWhen) {
  const params = new URLSearchParams({
    from: `${from[0].toFixed(5)},${from[1].toFixed(5)}`,
    to: `${to[0].toFixed(5)},${to[1].toFixed(5)}`,
    [when.by]: when.at,
  });
  const key = params.toString();
  let hit = session.get(key);
  if (!hit) {
    hit = fetch("/api/transit?" + params, {
      signal: AbortSignal.timeout(40000),
    }).then(async (res) => {
      const json = await res.json().catch(() => null);
      if (!res.ok)
        throw new TransitError(
          json?.error || "Public transport directions unavailable",
          json?.code || "",
        );
      return json as TransitRoute;
    });
    // Failures (offline, quota) are tried again next time.
    hit.catch(() => session.delete(key));
    session.set(key, hit);
  }
  return hit;
}

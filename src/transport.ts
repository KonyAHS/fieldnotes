// Intercity journeys grouped into legs (the gaps between stays in different
// cities) with alternative route options to compare. An option is one or more
// transport entries sharing `option`; idea entries are alternatives, planned
// or booked ones are the chosen route.
import {
  type Entry,
  type Scenario,
  type Trip,
  addDays,
  instant,
  uid,
  hasTransportConnection,
} from "./model";
export type RouteOption = {
  id: string;
  // Stored option ID, or null for planned legs not grouped yet.
  group: string | null;
  segments: Entry[];
  from: string;
  fromCountry: string;
  to: string;
  toCountry: string;
  date: string;
  depart: number;
  arrive: number;
  minutes: number;
  // Connection times between segments, in minutes.
  waits: number[];
  modes: string[];
  costs: Record<string, number>;
  priced: boolean;
  status: "booked" | "chosen" | "alternative";
};
export type Leg = {
  key: string;
  from: string;
  fromCountry: string;
  to: string;
  toCountry: string;
  earliest: string;
  latest: string;
  fromStay?: Entry;
  toStay?: Entry;
  options: RouteOption[];
};
const norm = (s: string) => s.trim().toLocaleLowerCase();
const departs = (e: Entry) => instant(e.date, e.startTime, e.timezone);
const arrives = (e: Entry) => instant(e.endDate, e.endTime, e.endTimezone);
export function routeOption(
  segments: Entry[],
  group: string | null,
): RouteOption {
  const s = [...segments].sort((a, b) => departs(a) - departs(b));
  const first = s[0],
    last = s.at(-1)!;
  const costs: Record<string, number> = {};
  for (const e of s)
    if (e.cost !== null) costs[e.currency] = (costs[e.currency] || 0) + e.cost;
  return {
    id: group || "route-" + first.id,
    group,
    segments: s,
    from: first.city,
    fromCountry: first.country,
    to: last.toCity,
    toCountry: last.toCountry || last.country,
    date: first.date,
    depart: departs(first),
    arrive: arrives(last),
    minutes: Math.round((arrives(last) - departs(first)) / 60000),
    waits: s
      .slice(1)
      .map((e, i) => Math.round((departs(e) - arrives(s[i])) / 60000)),
    modes: [...new Set(s.map((e) => e.mode || "Other"))],
    costs,
    priced: s.every((e) => e.cost !== null),
    status: s.some((e) => e.status === "booked")
      ? "booked"
      : s.every((e) => e.status !== "idea")
        ? "chosen"
        : "alternative",
  };
}
export function transportLegs(trip: Trip, scenario: Scenario) {
  const transport = scenario.entries.filter(
    (e) => e.type === "transport" && e.scope === "intercity",
  );
  const options: RouteOption[] = [];
  const groups = new Map<string, Entry[]>();
  for (const e of transport)
    if (e.option) groups.set(e.option, [...(groups.get(e.option) || []), e]);
  for (const [id, segments] of groups) options.push(routeOption(segments, id));
  // Ungrouped planned journeys: connecting legs (same city, within a day)
  // form one route; ungrouped ideas stand alone.
  const loose = transport
    .filter((e) => !e.option)
    .sort((a, b) => departs(a) - departs(b));
  const used = new Set<string>();
  for (const e of loose) {
    if (used.has(e.id)) continue;
    used.add(e.id);
    const chain = [e];
    if (e.status !== "idea")
      for (;;) {
        const last = chain.at(-1)!;
        const next = loose.find(
          (f) =>
            !used.has(f.id) &&
            f.status !== "idea" &&
            norm(f.city) === norm(last.toCity) &&
            departs(f) >= arrives(last) &&
            departs(f) - arrives(last) <= 86400000,
        );
        if (!next) break;
        used.add(next.id);
        chain.push(next);
      }
    options.push(routeOption(chain, null));
  }
  const stays = scenario.entries
    .filter((e) => e.type === "stay" && e.status !== "idea" && e.city)
    .sort((a, b) => a.date.localeCompare(b.date));
  const legs: Leg[] = [];
  for (let i = 1; i < stays.length; i++) {
    const a = stays[i - 1],
      b = stays[i];
    if (norm(a.city) === norm(b.city) && norm(a.country) === norm(b.country))
      continue;
    legs.push({
      key: `stay-${a.id}-${b.id}`,
      from: a.city,
      fromCountry: a.country,
      to: b.city,
      toCountry: b.country,
      earliest: a.endDate < b.date ? a.endDate : b.date,
      latest: b.date,
      fromStay: a,
      toStay: b,
      options: [],
    });
  }
  const other = new Map<string, Leg>();
  for (const o of options) {
    const leg = legs.find(
      (l) =>
        norm(l.from) === norm(o.from) &&
        norm(l.to) === norm(o.to) &&
        o.date >= addDays(l.earliest, -1) &&
        o.date <= addDays(l.latest, 1),
    );
    if (leg) {
      leg.options.push(o);
      continue;
    }
    const key = `journey-${norm(o.from)}-${norm(o.to)}`;
    const l = other.get(key);
    if (l) {
      l.options.push(o);
      if (o.date < l.earliest) l.earliest = o.date;
      if (o.date > l.latest) l.latest = o.date;
    } else
      other.set(key, {
        key,
        from: o.from,
        fromCountry: o.fromCountry,
        to: o.to,
        toCountry: o.toCountry,
        earliest: o.date,
        latest: o.date,
        options: [o],
      });
  }
  // Separate city-to-city options may already cover a stay change via a
  // connection. Local airport/hotel transfers also cover a change of city.
  // Keep missing journeys visible, but omit redundant empty comparison cards.
  const missingOrCompared = legs.filter(
    (l) =>
      l.options.length ||
      !hasTransportConnection(
        scenario.entries,
        l.from,
        l.to,
        l.fromCountry,
        l.toCountry,
        l.earliest,
        l.latest,
      ),
  );
  return [...missingOrCompared, ...other.values()].sort(
    (a, b) =>
      a.earliest.localeCompare(b.earliest) ||
      Math.min(...a.options.map((o) => o.depart)) -
        Math.min(...b.options.map((o) => o.depart)) ||
      a.key.localeCompare(b.key),
  );
}
// Wall-clock arithmetic for retiming, independent of the device time zone.
export function shiftTime(date: string, time: string, minutes: number) {
  const d = new Date(Date.parse(`${date}T${time}:00Z`) + minutes * 60000);
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 16),
  };
}
// The arrival date for an arrival time: the first one after departure.
export function arrivalDate(e: Entry, time: string) {
  let date = e.date;
  for (let i = 0; i < 3; i++) {
    if (instant(date, time, e.endTimezone) > departs(e)) return date;
    date = addDays(date, 1);
  }
  return date;
}
// Give planned routes that were never grouped a stored option ID.
export function ensureOption(o: RouteOption, entries: Entry[]) {
  const id = o.group || uid();
  for (const s of o.segments) {
    const e = entries.find((x) => x.id === s.id);
    if (e) e.option = id;
  }
  return id;
}
export const durationText = (minutes: number) =>
  minutes < 0
    ? "check times"
    : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;

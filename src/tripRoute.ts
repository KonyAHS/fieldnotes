// The trip as a route on a map: the cities in the order they are visited
// (stays and the ends of journeys between cities) and the hops between them.
import { type Entry, type Scenario, instant } from "./model";
export type Stop = {
  key: string;
  city: string;
  country: string;
  // Order of the visit, from 1. A city visited twice has two stops.
  n: number;
  arrive: string;
  // The night's stay in this city on this visit, if any.
  stay: Entry | null;
};
export type Hop = {
  from: Stop;
  to: Stop;
  // Journeys making this hop; empty when no transport is planned yet.
  journeys: Entry[];
  mode: string;
};
export const stopKey = (city: string, country: string) =>
  `${country.trim().toLocaleLowerCase()}|${city.trim().toLocaleLowerCase()}`;
export function tripRoute(scenario: Scenario) {
  const departs = (e: Entry) => instant(e.date, e.startTime, e.timezone);
  type Event = { at: number; entry: Entry };
  const events: Event[] = [];
  for (const e of scenario.entries) {
    if (e.status === "idea" || !e.city) continue;
    if (e.type === "stay")
      // Arriving journeys on the check-in day come first, whatever their times.
      events.push({ at: instant(e.date, "23:59", e.timezone), entry: e });
    else if (e.type === "transport" && e.scope === "intercity" && e.toCity)
      events.push({ at: departs(e), entry: e });
  }
  events.sort((a, b) => a.at - b.at || a.entry.id.localeCompare(b.entry.id));
  const stops: Stop[] = [];
  const hops: Hop[] = [];
  const visit = (city: string, country: string, date: string) => {
    const key = stopKey(city, country);
    const last = stops.at(-1);
    if (last?.key === key) return last;
    const stop: Stop = {
      key,
      city: city.trim(),
      country,
      n: stops.length + 1,
      arrive: date,
      stay: null,
    };
    stops.push(stop);
    if (last) hops.push({ from: last, to: stop, journeys: [], mode: "" });
    return stop;
  };
  for (const { entry: e } of events)
    if (e.type === "stay") {
      const s = visit(e.city, e.country, e.date);
      s.stay ??= e;
    } else {
      visit(e.city, e.country, e.date);
      // A same-city journey (e.g. a transfer) adds nothing to the route.
      const to = visit(e.toCity, e.toCountry || e.country, e.endDate);
      const hop = hops.at(-1);
      if (hop?.to === to && hop.from.key === stopKey(e.city, e.country))
        hop.journeys.push(e);
    }
  // Gaps between journeys (such as a station to an airport in the next town)
  // may be covered by local transport.
  for (const h of hops)
    if (!h.journeys.length)
      h.journeys = scenario.entries.filter(
        (e) =>
          e.type === "transport" &&
          e.scope === "local" &&
          e.status !== "idea" &&
          stopKey(e.city, e.country) === h.from.key &&
          stopKey(e.toCity, e.toCountry || e.country) === h.to.key,
      );
  for (const h of hops) {
    const modes = [...new Set(h.journeys.map((j) => j.mode || "Other"))];
    h.mode = modes.length > 1 ? modes.join(" + ") : modes[0] || "";
  }
  return { stops, hops };
}
// Points along the great circle between two positions, for flights. Each
// longitude continues from the previous one, so routes over the date line
// stay unbroken.
export function greatCircle(
  a: [number, number],
  b: [number, number],
  steps = 48,
): [number, number][] {
  const rad = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a[0] * rad, a[1] * rad, b[0] * rad, b[1] * rad];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((la2 - la1) / 2) ** 2 +
          Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2,
      ),
    );
  if (d < 1e-6) return [a, b];
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d),
      B = Math.sin(f * d) / Math.sin(d);
    const x =
      A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y =
      A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    let lng = Math.atan2(y, x) / rad;
    const prev = out.at(-1);
    if (prev) lng += Math.round((prev[1] - lng) / 360) * 360;
    else lng += Math.round((a[1] - lng) / 360) * 360;
    out.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / rad, lng]);
  }
  return out;
}
export type Point = [number, number];
// Great-circle distance in kilometres.
export function km(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 +
    Math.cos(a[0] * rad) *
      Math.cos(b[0] * rad) *
      Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
// Drops points closer than `tolerance` degrees to the line through their
// neighbours (Douglas–Peucker), so long tracks stay small to send and draw.
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [y1, x1] = points[i],
      [y2, x2] = points[j];
    const len = Math.hypot(x2 - x1, y2 - y1);
    let far = -1,
      best = tolerance;
    for (let k = i + 1; k < j; k++) {
      const [y, x] = points[k];
      const d = len
        ? Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / len
        : Math.hypot(x - x1, y - y1);
      if (d > best) [far, best] = [k, d];
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([i, far], [far, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

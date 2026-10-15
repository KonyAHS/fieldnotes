// Where cities are and how journeys between them are drawn, shared by the
// route map and the small previews on each journey. City positions and rail
// tracks are looked up once per browser and shared by every map that shows them.
import { useSyncExternalStore } from "react";
import { cityPoint } from "./geo";
import { type Point, greatCircle, stopKey } from "./tripRoute";
export type { Point };
// Line styles: flights dashed as on a flight map, ground and sea journeys
// in their own colours, and hops with no transport yet faint.
export type Style = {
  label: string;
  color: string;
  dash?: string;
  weight: number;
};
export const styles: Record<string, Style> = {
  Flight: { label: "Flight", color: "#2b2f2c", dash: "7 7", weight: 2.5 },
  Train: { label: "Train", color: "#354f43", weight: 3 },
  Ferry: { label: "Ferry", color: "#2f6f9f", dash: "2 7", weight: 3 },
  Bus: { label: "Bus or car", color: "#a86944", weight: 3 },
  Other: { label: "Other", color: "#6d6a75", weight: 3 },
  None: {
    label: "No transport yet",
    color: "#b5473a",
    dash: "3 8",
    weight: 2,
  },
};
export const modeParts = (mode: string) => mode.split(/\s*[+/,]\s*/);
export const styleKey = (mode: string) => {
  if (!mode) return "None";
  const parts = modeParts(mode);
  if (parts.includes("Flight")) return "Flight";
  if (parts.some((m) => ["Train", "Shinkansen", "Metro"].includes(m)))
    return "Train";
  if (parts.includes("Ferry")) return "Ferry";
  if (parts.some((m) => ["Bus", "Taxi"].includes(m))) return "Bus";
  return "Other";
};
// A tiny store: components re-render when any lookup finishes.
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  for (const f of listeners) f();
};
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const useVersion = () => useSyncExternalStore(subscribe, () => version);
// City positions from the (server-cached) geocoder; null when not found.
const cities: Record<string, Point | null> = {};
const asking = new Set<string>();
function askCity(city: string, country: string) {
  const key = stopKey(city, country);
  if (key in cities || asking.has(key)) return;
  asking.add(key);
  cityPoint(city, country)
    .then((hit) => {
      cities[key] = hit ? [hit.lat, hit.lng] : null;
      changed();
    })
    .catch(() => {})
    .finally(() => asking.delete(key));
}
// Rail tracks fetched before, so train lines show at once and offline.
const railKey = "fieldnotes.railPaths";
const rails: Record<string, Point[] | null> = (() => {
  try {
    return JSON.parse(localStorage.getItem(railKey) || "{}") || {};
  } catch {
    return {};
  }
})();
export const railId = (a: Point, b: Point) =>
  [...a, ...b].map((x) => x.toFixed(4)).join(",");
const railQueue: string[] = [];
let railBusy = false;
function askRail(a: Point, b: Point) {
  const id = railId(a, b);
  if (id in rails || railQueue.includes(id) || !navigator.onLine) return;
  railQueue.push(id);
  void pumpRails();
}
// One at a time: the server asks a public rail router for each.
async function pumpRails() {
  if (railBusy) return;
  railBusy = true;
  while (railQueue.length) {
    const id = railQueue[0];
    const n = id.split(",");
    const res = await fetch(
      `/api/rail-path?from=${n[0]},${n[1]}&to=${n[2]},${n[3]}`,
      { signal: AbortSignal.timeout(120000) },
    ).catch(() => null);
    railQueue.shift();
    // Failed requests are tried again next time; "no track" is kept.
    if (!res?.ok) continue;
    const { path } = (await res.json().catch(() => ({ path: undefined }))) as {
      path?: Point[] | null;
    };
    if (path === undefined) continue;
    delete rails[id];
    rails[id] = path;
    // The most recent 150 tracks are kept.
    const keys = Object.keys(rails);
    for (const k of keys.slice(0, Math.max(0, keys.length - 150)))
      delete rails[k];
    try {
      localStorage.setItem(railKey, JSON.stringify(rails));
    } catch {
      // Storage full: tracks are fetched again next time.
    }
    changed();
  }
  railBusy = false;
}
export type Locate = {
  // Changes whenever a lookup finishes, for effects that draw maps.
  version: number;
  // A city's position: the saved hotel when given, else looked up.
  point: (city: string, country: string, saved?: Point | null) => Point | null;
  // Whether a city could not be found at all.
  missing: (city: string, country: string) => boolean;
  // The line drawn for a journey between two positions.
  path: (mode: string, a: Point, b: Point) => Point[];
};
// `active` false stops new lookups (a collapsed map, say) but still answers
// from what is already known.
export function useLocate(active = true): Locate {
  const v = useVersion();
  return {
    version: v,
    point(city, country, saved) {
      if (saved) return saved;
      const key = stopKey(city, country);
      if (active && city) askCity(city, country);
      return cities[key] || null;
    },
    missing: (city, country) => cities[stopKey(city, country)] === null,
    path(mode, a, b) {
      const kind = styleKey(mode);
      if (kind === "Flight") return greatCircle(a, b);
      if (kind === "Train") {
        if (active) askRail(a, b);
        return rails[railId(a, b)] || [a, b];
      }
      return [a, b];
    },
  };
}
// Asks the route map to open and show these positions.
export const routeFocusEvent = "fieldnotes:route-focus";
export const showOnRouteMap = (points: Point[]) =>
  dispatchEvent(new CustomEvent(routeFocusEvent, { detail: points }));

// Where each day is spent (the night's stay, or the day's plans when there is
// none), with coordinates for prayer times, qibla and weather.
import { useEffect, useMemo, useState } from "react";
import { type Scenario, type Entry, type Place, entriesOn } from "./model";
import { cityPoint } from "./geo";
export type Point = { lat: number; lng: number };
export type Where = {
  key: string;
  city: string;
  country: string;
  timezone: string;
  /** The hotel's position, or the city's once looked up. */
  point: Point | null;
  stay: Entry | null;
};
export function whereOn(scenario: Scenario, places: Place[], dates: string[]) {
  const stays = scenario.entries
    .filter((e) => e.type === "stay" && e.city)
    .sort(
      (a, b) =>
        Number(a.status === "idea") - Number(b.status === "idea") ||
        a.date.localeCompare(b.date),
    );
  return dates.map((d): Where | null => {
    const stay = stays.find((s) => s.date <= d && d < s.endDate) || null;
    const e =
      stay ||
      stays.find((s) => s.endDate === d) ||
      entriesOn(scenario, d).find((x) => x.city && x.type !== "transport");
    if (!e) return null;
    const place = places.find(
      (p) => p.id === e.placeId && p.lat !== null && p.lng !== null,
    );
    return {
      key: `${e.country}|${e.city}`,
      city: e.city,
      country: e.country,
      timezone: e.timezone,
      point: place ? { lat: place.lat!, lng: place.lng! } : null,
      stay,
    };
  });
}
// The same, with city coordinates looked up (cached) where no hotel position
// is saved. Lookups only start when enabled.
export function useWhereabouts(
  scenario: Scenario,
  places: Place[],
  dates: string[],
  enabled: boolean,
) {
  const key = dates.join();
  const where = useMemo(
    () => whereOn(scenario, places, dates),
    // The dates arrive as a new list on every render; compare their values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario, places, key],
  );
  const [cities, setCities] = useState<Record<string, Point | null>>({});
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const missing = new Map(
      where
        .filter((w) => w && !w.point && !(w.key in cities))
        .map((w) => [w!.key, w!]),
    );
    for (const [k, w] of missing)
      cityPoint(w.city, w.country)
        .then((hit) => {
          if (!cancelled)
            setCities((old) => ({
              ...old,
              [k]: hit ? { lat: hit.lat, lng: hit.lng } : null,
            }));
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
    // cities is read only to skip cities already looked up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where, enabled]);
  return useMemo(
    () =>
      where.map((w) =>
        w && !w.point && cities[w.key] ? { ...w, point: cities[w.key] } : w,
      ),
    [where, cities],
  );
}
export type Weather = {
  /** Forecast (up to about two weeks ahead), or last year on the same date. */
  source: "forecast" | "last-year" | "observed";
  tempMax: number | null;
  tempMin: number | null;
  rain: string;
  windMax: number | null;
  sunrise: string;
  sunset: string;
  code?: number | null;
};
// Weather per place and date, fetched a few at a time and kept for the
// session (the server caches forecasts for 3 hours, past weather for 30 days).
const weatherCache = new Map<string, Promise<Weather | null>>();
let running = 0;
const waiting: (() => void)[] = [];
async function limited<T>(task: () => Promise<T>) {
  if (running >= 4) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
function fetchWeather(p: Point, date: string) {
  const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}|${date}`;
  if (!weatherCache.has(key))
    weatherCache.set(
      key,
      limited(async () => {
        const res = await fetch(
          "/api/weather?" +
            new URLSearchParams({
              lat: p.lat.toFixed(4),
              lng: p.lng.toFixed(4),
              date,
            }),
          { signal: AbortSignal.timeout(30000) },
        );
        if (!res.ok) throw Error("Weather unavailable");
        return (await res.json()) as Weather;
      }).catch(() => {
        // Try again next time (offline, or the service was busy).
        weatherCache.delete(key);
        return null;
      }),
    );
  return weatherCache.get(key)!;
}
export function useWeather(
  where: (Where | null)[],
  dates: string[],
  enabled: boolean,
) {
  const [weather, setWeather] = useState<Record<string, Weather | null>>({});
  const wanted = dates
    .map((d, i) => {
      const p = where[i]?.point;
      return p ? `${d}@${p.lat.toFixed(2)},${p.lng.toFixed(2)}` : "";
    })
    .join();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    dates.forEach((d, i) => {
      const p = where[i]?.point;
      if (!p) return;
      const id = `${d}@${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
      void fetchWeather(p, d).then((w) => {
        if (!cancelled) setWeather((old) => ({ ...old, [id]: w }));
      });
    });
    return () => {
      cancelled = true;
    };
    // Keyed by the dates and positions, not the list objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, enabled]);
  return dates.map((d, i) => {
    const p = where[i]?.point;
    return p
      ? weather[`${d}@${p.lat.toFixed(2)},${p.lng.toFixed(2)}`] || null
      : null;
  });
}
// Short descriptions of WMO weather codes.
export function weatherKind(code: number | null | undefined) {
  if (code == null) return "";
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorms";
}
export const weatherNote = (w: Weather) =>
  [
    weatherKind(w.code),
    w.tempMax !== null && w.tempMin !== null
      ? `${Math.round(w.tempMax)}° / ${Math.round(w.tempMin)}°`
      : "",
    w.rain,
    w.windMax !== null ? `wind up to ${Math.round(w.windMax)} km/h` : "",
    w.source === "forecast"
      ? "Forecast"
      : w.source === "observed"
        ? "Recorded weather"
        : "Last year on this date (forecasts start about two weeks ahead)",
  ]
    .filter(Boolean)
    .join(" · ");

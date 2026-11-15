// Keeps the weather the app is about to ask for ready in the lookup cache,
// so opening Today or the itinerary doesn't wait on the weather service.
type Point = { lat: number; lng: number };
type Target = Point & { date: string };
const day = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Where and when weather will be wanted for the active trip: each night's
// hotel for as far as forecasts reach, and every plan's place for the days
// around today. Positions are deduplicated at the cache's precision.
export function weatherTargets(data: any, today: string): Target[] {
  const trip = (data?.trips || []).find((t: any) => t.id === data.activeTripId);
  const scenario = (trip?.scenarios || []).find(
    (s: any) => s.id === trip.activeScenarioId,
  );
  if (!trip || !scenario) return [];
  const places = new Map<string, any>(
    (data.places || []).map((p: any) => [p.id, p]),
  );
  const now = Date.parse(today);
  const seen = new Set<string>();
  const out: Target[] = [];
  for (let i = -1; i <= 15; i++) {
    const date = iso(now + i * day);
    if (date < trip.start || date > trip.end) continue;
    for (const e of scenario.entries || []) {
      if (e.status === "idea" || e.date > date || e.endDate < date) continue;
      if (e.type !== "stay" && i > 3) continue;
      const p = places.get(e.placeId);
      if (!p || typeof p.lat !== "number" || typeof p.lng !== "number")
        continue;
      const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ lat: p.lat, lng: p.lng, date });
    }
  }
  return out;
}

export function weatherWarmer(
  read: () => any,
  weather: (
    lat: number,
    lng: number,
    date: string,
    fresh?: boolean,
  ) => Promise<unknown>,
) {
  let running = false;
  return async function run() {
    if (running) return;
    running = true;
    try {
      const targets = weatherTargets(read(), iso(Date.now()));
      let failed = 0;
      for (const t of targets) {
        try {
          await weather(t.lat, t.lng, t.date, true);
        } catch {
          // Keep what is cached; stop early if the service is down.
          if (++failed >= 3) break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (e) {
      console.error(
        "Weather prefetch failed:",
        e instanceof Error ? e.message : "unknown",
      );
    } finally {
      running = false;
    }
  };
}

// Locates saved places in the background. Results are kept beside the
// workspace (not in it) so locating never changes the workspace revision or
// conflicts with edits; devices merge them in when they sync.
import type { DatabaseSync } from "node:sqlite";
import type { Place } from "../src/model.ts";
import {
  type GeoResult,
  locatePlace,
  needsLocation,
  placeSignature,
} from "../src/locate.ts";
export type PlaceLocation = {
  signature: string;
  lat: number;
  lng: number;
  geo: "auto" | "approx" | "failed";
  address: string;
};
export function locator(
  db: DatabaseSync,
  geocode: (q: string, cc: string) => Promise<GeoResult[]>,
  places: () => Place[],
) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS place_geo (place_id TEXT PRIMARY KEY, signature TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, geo TEXT NOT NULL, address TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
  const all = () =>
    Object.fromEntries(
      (
        db
          .prepare(
            "SELECT place_id, signature, lat, lng, geo, address FROM place_geo",
          )
          .all() as (PlaceLocation & { place_id: string })[]
      ).map(({ place_id, ...rest }) => [place_id, rest]),
    ) as Record<string, PlaceLocation>;
  let running = false,
    again = false;
  async function run() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const known = all();
        for (const p of places().filter(needsLocation)) {
          const signature = placeSignature(p);
          if (known[p.id]?.signature === signature) continue;
          // A service outage stops this pass; the next run retries.
          const found = await locatePlace(p, geocode);
          db.prepare(
            "INSERT OR REPLACE INTO place_geo VALUES (?, ?, ?, ?, ?, ?, ?)",
          ).run(
            p.id,
            signature,
            found.lat,
            found.lng,
            found.geo,
            found.address,
            Date.now(),
          );
        }
      } while (again);
    } catch (e) {
      console.error(
        "Place locating paused:",
        e instanceof Error ? e.message : "unknown",
      );
    } finally {
      running = false;
    }
  }
  return { all, run };
}

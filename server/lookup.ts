// Server-side lookups against OpenStreetMap services. Requests are serialized
// and cached so the app stays within the services' usage policies.
import type { DatabaseSync } from "node:sqlite";
const agent = "Fieldnotes/1.0 (self-hosted travel planner)";
const day = 86400000;
import type { GeoResult } from "../src/locate.ts";
import type { maps as mapsFactory } from "./maps.ts";
import { type Point, km, simplify } from "../src/tripRoute.ts";
export type { GeoResult };
export type FoodResult = {
  id: string;
  name: string;
  nativeName: string;
  lat: number;
  lng: number;
  cuisine: string;
  halal: "yes" | "only" | "no" | "";
  address: string;
  phone: string;
  url: string;
  openingHours: string;
  // Where the result came from, to verify or open it there.
  link: string;
  source: "osm" | "google";
  // Google star rating and number of reviews.
  rating?: number;
  ratingCount?: number;
};
export type OutdoorResult = {
  id: string;
  osmType: string;
  osmId: number;
  kind:
    | "hiking"
    | "cycling"
    | "mtb"
    | "peak"
    | "viewpoint"
    | "trailhead"
    | "rental";
  name: string;
  nativeName: string;
  lat: number;
  lng: number;
  // Route extent [south, west, north, east]; null for single points.
  bounds: [number, number, number, number] | null;
  network: string;
  ref: string;
  lengthKm: number | null;
  difficulty: string;
  ascent: string;
  ele: string;
  roundtrip: boolean;
  description: string;
  website: string;
  openingHours: string;
};
export type Weather = {
  source: "forecast" | "last-year" | "observed";
  date: string;
  tempMax: number | null;
  tempMin: number | null;
  rain: string;
  windMax: number | null;
  sunrise: string;
  sunset: string;
  /** WMO weather code (0 clear … 95+ thunderstorm), for an icon. */
  code?: number | null;
};
function queue() {
  let last = Promise.resolve();
  return <T>(gapMs: number, task: () => Promise<T>) => {
    const run = last.then(task);
    last = run
      .catch(() => {})
      .then(() => new Promise((r) => setTimeout(r, gapMs)));
    return run;
  };
}
const nominatimQueue = queue();
const overpassQueue = queue();
const railQueue = queue();
export function lookups(
  db: DatabaseSync,
  maps: ReturnType<typeof mapsFactory>,
) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS lookup_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL)",
  );
  async function cached<T>(key: string, ttl: number, load: () => Promise<T>) {
    const row = db
      .prepare("SELECT value, created_at FROM lookup_cache WHERE key=?")
      .get(key) as { value: string; created_at: number } | undefined;
    if (row && Date.now() - row.created_at < ttl)
      return JSON.parse(row.value) as T;
    const value = await load();
    db.prepare("INSERT OR REPLACE INTO lookup_cache VALUES (?, ?, ?)").run(
      key,
      JSON.stringify(value),
      Date.now(),
    );
    return value;
  }
  // Searches by name or address. `near` biases (but does not restrict)
  // results toward a point, such as the trip's current city.
  async function geocode(
    q: string,
    cc: string,
    near?: { lat: number; lng: number },
  ): Promise<GeoResult[]> {
    const at = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : "";
    if (maps.provider() === "google")
      return cached(`ggeo:${cc}:${at}:${q.toLowerCase()}`, 30 * day, () =>
        maps.search({
          textQuery: q,
          regionCode: cc,
          bias: near && { ...near, radius: 50000 },
        }),
      );
    return cached(`geo2:${cc}:${at}:${q.toLowerCase()}`, 30 * day, async () => {
      const params = new URLSearchParams({
        format: "jsonv2",
        limit: "8",
        q,
        "accept-language": "en",
        addressdetails: "0",
        extratags: "1",
        namedetails: "1",
      });
      if (cc) params.set("countrycodes", cc);
      if (near)
        params.set(
          "viewbox",
          [near.lng - 0.5, near.lat + 0.5, near.lng + 0.5, near.lat - 0.5].join(
            ",",
          ),
        );
      const found = await nominatimQueue(1100, async () => {
        const res = await fetch(
          "https://nominatim.openstreetmap.org/search?" + params,
          {
            headers: { "User-Agent": agent },
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!res.ok) throw Error(`Nominatim ${res.status}`);
        return (await res.json()) as {
          osm_type: string;
          osm_id: number;
          lat: string;
          lon: string;
          name: string;
          display_name: string;
          type: string;
          extratags?: Record<string, string> | null;
          namedetails?: Record<string, string> | null;
        }[];
      });
      if (found.length)
        return found.map((r): GeoResult => {
          const t = r.extratags || {};
          const native = r.namedetails?.name || "";
          const name = r.name || r.display_name.split(",")[0];
          return {
            lat: Number(r.lat),
            lng: Number(r.lon),
            name,
            address: r.display_name,
            kind: r.type,
            nativeName: native !== name ? native : "",
            phone: t.phone || t["contact:phone"] || "",
            url: t.website || t["contact:website"] || t.url || "",
            hours: t.opening_hours || "",
            source: "osm",
            sourceId: `${r.osm_type}/${r.osm_id}`,
          };
        });
      // Photon tolerates misspellings and partial names better.
      const photon = new URLSearchParams({ q, limit: "8", lang: "en" });
      if (near) {
        photon.set("lat", String(near.lat));
        photon.set("lon", String(near.lng));
      }
      const res = await fetch("https://photon.komoot.io/api/?" + photon, {
        headers: { "User-Agent": agent },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        features: {
          geometry: { coordinates: [number, number] };
          properties: Record<string, string>;
        }[];
      };
      return json.features
        .filter(
          (f) =>
            !cc ||
            (f.properties.countrycode || "").toLowerCase() === cc.toLowerCase(),
        )
        .map((f) => {
          const p = f.properties;
          return {
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
            name: p.name || "",
            address: [p.name, p.street, p.city, p.state, p.country]
              .filter(Boolean)
              .join(", "),
            kind: p.osm_value || "",
            source: "osm" as const,
            sourceId: p.osm_type
              ? `${{ N: "node", W: "way", R: "relation" }[p.osm_type] || p.osm_type}/${p.osm_id}`
              : "",
          };
        });
    });
  }
  // The place nearest a point, for links that give only coordinates.
  async function reverse(lat: number, lng: number): Promise<GeoResult | null> {
    return cached(`rev:${lat.toFixed(5)},${lng.toFixed(5)}`, 30 * day, () =>
      nominatimQueue(1100, async () => {
        const res = await fetch(
          "https://nominatim.openstreetmap.org/reverse?" +
            new URLSearchParams({
              format: "jsonv2",
              lat: String(lat),
              lon: String(lng),
              zoom: "18",
              "accept-language": "en",
              extratags: "1",
              namedetails: "1",
            }),
          {
            headers: { "User-Agent": agent },
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!res.ok) throw Error(`Nominatim ${res.status}`);
        const r = await res.json();
        if (!r || r.error) return null;
        const t = (r.extratags || {}) as Record<string, string>;
        return {
          lat,
          lng,
          name: r.name || "",
          address: r.display_name || "",
          kind: r.type || "",
          nativeName:
            r.namedetails?.name !== r.name ? r.namedetails?.name || "" : "",
          phone: t.phone || t["contact:phone"] || "",
          url: t.website || t["contact:website"] || "",
          hours: t.opening_hours || "",
          source: "osm",
          sourceId: `${r.osm_type}/${r.osm_id}`,
        } satisfies GeoResult;
      }),
    );
  }
  async function overpass(query: string) {
    return overpassQueue(1000, async () => {
      let lastError: unknown;
      for (const endpoint of [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
      ]) {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "User-Agent": agent,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ data: query }),
            signal: AbortSignal.timeout(100000),
          });
          if (res.ok)
            return (await res.json()) as {
              elements: {
                type: string;
                id: number;
                lat?: number;
                lon?: number;
                center?: { lat: number; lon: number };
                bounds?: {
                  minlat: number;
                  minlon: number;
                  maxlat: number;
                  maxlon: number;
                };
                geometry?: { lat: number; lon: number }[];
                tags?: Record<string, string>;
              }[];
            };
          lastError = Error(`Overpass ${res.status}`);
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError;
    });
  }
  async function outdoors(
    lat: number,
    lng: number,
    radiusKm: number,
    kind: "hiking" | "cycling",
  ): Promise<OutdoorResult[]> {
    const key = `outdoors:${lat.toFixed(3)},${lng.toFixed(3)}:${radiusKm}:${kind}`;
    const r = Math.round(radiusKm * 1000);
    return cached(key, 7 * day, async () => {
      const near = Math.min(r, 30000);
      const at = (m: number) => `around:${m},${lat},${lng}`;
      const query =
        kind === "hiking"
          ? `[out:json][timeout:90];rel(${at(r)})["type"="route"]["route"~"^(hiking|foot|walking)$"];out tags bb qt 300;(node(${at(near)})["natural"="peak"]["name"];nwr(${at(near)})["tourism"="viewpoint"]["name"];node(${at(near)})["highway"="trailhead"];);out tags center 80;`
          : `[out:json][timeout:90];rel(${at(r)})["type"="route"]["route"~"^(bicycle|mtb)$"];out tags bb qt 300;(nwr(${at(near)})["amenity"="bicycle_rental"];nwr(${at(near)})["shop"="bicycle"]["service:bicycle:rental"="yes"];);out tags center 60;`;
      const json = await overpass(query);
      return json.elements
        .filter((el) => el.tags?.name || el.tags?.ref || el.type !== "relation")
        .map((el): OutdoorResult => {
          const t = el.tags || {};
          const route = el.type === "relation";
          const kind: OutdoorResult["kind"] = route
            ? t.route === "mtb"
              ? "mtb"
              : t.route === "bicycle"
                ? "cycling"
                : "hiking"
            : t.natural === "peak"
              ? "peak"
              : t.tourism === "viewpoint"
                ? "viewpoint"
                : t.highway === "trailhead"
                  ? "trailhead"
                  : "rental";
          const name =
            t["name:en"] ||
            t.int_name ||
            t["name:ja-Latn"] ||
            t["name:ko-Latn"] ||
            t["name:zh-Latn-pinyin"] ||
            t.name ||
            t.ref ||
            (kind === "rental" ? "Bicycle rental" : "Trailhead");
          const length = parseFloat((t.distance || "").replace(",", "."));
          return {
            id: `osm-${el.type}-${el.id}`,
            osmType: el.type,
            osmId: el.id,
            kind,
            name,
            nativeName: t.name || "",
            lat:
              el.lat ??
              el.center?.lat ??
              (el.bounds ? (el.bounds.minlat + el.bounds.maxlat) / 2 : 0),
            lng:
              el.lon ??
              el.center?.lon ??
              (el.bounds ? (el.bounds.minlon + el.bounds.maxlon) / 2 : 0),
            bounds: el.bounds
              ? [
                  el.bounds.minlat,
                  el.bounds.minlon,
                  el.bounds.maxlat,
                  el.bounds.maxlon,
                ]
              : null,
            network: t.network || "",
            ref: t.ref || "",
            lengthKm: Number.isFinite(length)
              ? /mi/.test(t.distance)
                ? length * 1.609
                : length
              : null,
            difficulty:
              t.sac_scale ||
              t["mtb:scale"] ||
              t.difficulty ||
              t["mtb:scale:imba"] ||
              "",
            ascent: t.ascent || "",
            ele: t.ele || "",
            roundtrip: t.roundtrip === "yes",
            description: t["description:en"] || t.description || t.note || "",
            website: t.website || t.url || t["contact:website"] || "",
            openingHours: t.opening_hours || "",
          };
        });
    });
  }
  // All ways of a route (including sub-routes) as simplified lines.
  async function routeShape(id: number): Promise<[number, number][][]> {
    return cached(`shape:${id}`, 7 * day, async () => {
      const json = await overpass(
        `[out:json][timeout:60];rel(${id})->.top;rel(r.top)->.subs;(way(r.top);way(r.subs););out geom 4000;`,
      );
      const lines = json.elements
        .filter((el) => el.geometry?.length)
        .map((el) =>
          el.geometry!.map((g) => [g.lat, g.lon] as [number, number]),
        );
      const total = lines.reduce((n, l) => n + l.length, 0);
      const step = Math.max(1, Math.ceil(total / 8000));
      return lines.map((l) =>
        l.filter((_, i) => i % step === 0 || i === l.length - 1),
      );
    });
  }
  async function weather(
    lat: number,
    lng: number,
    date: string,
  ): Promise<Weather> {
    const today = new Date().toISOString().slice(0, 10);
    const daysAhead = (Date.parse(date) - Date.parse(today)) / day;
    const forecast = daysAhead >= 0 && daysAhead <= 15;
    // Beyond the forecast range, last year's weather on the same date gives
    // a rough idea, and sunrise/sunset differ by about a minute.
    const lookup =
      forecast || daysAhead < -5
        ? date
        : `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
    const source: Weather["source"] = forecast
      ? "forecast"
      : lookup === date
        ? "observed"
        : "last-year";
    const key = `weather2:${lat.toFixed(2)},${lng.toFixed(2)}:${lookup}:${source}`;
    return cached(key, forecast ? 3 * 3600000 : 30 * day, async () => {
      const daily = forecast
        ? "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset"
        : "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset";
      const params = new URLSearchParams({
        latitude: lat.toFixed(4),
        longitude: lng.toFixed(4),
        daily,
        timezone: "auto",
        start_date: lookup,
        end_date: lookup,
      });
      const res = await fetch(
        (forecast
          ? "https://api.open-meteo.com/v1/forecast?"
          : "https://archive-api.open-meteo.com/v1/archive?") + params,
        {
          headers: { "User-Agent": agent },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!res.ok) throw Error(`Open-Meteo ${res.status}`);
      const d = (await res.json()).daily as Record<
        string,
        (number | string | null)[]
      >;
      const num = (k: string) =>
        typeof d[k]?.[0] === "number" ? (d[k][0] as number) : null;
      const time = (k: string) => String(d[k]?.[0] || "").slice(11, 16);
      return {
        source,
        date: lookup,
        tempMax: num("temperature_2m_max"),
        tempMin: num("temperature_2m_min"),
        rain: forecast
          ? num("precipitation_probability_max") === null
            ? ""
            : `${num("precipitation_probability_max")}% chance of rain`
          : num("precipitation_sum") === null
            ? ""
            : `${num("precipitation_sum")} mm rain`,
        windMax: num("wind_speed_10m_max"),
        sunrise: time("sunrise"),
        sunset: time("sunset"),
        code: num("weather_code"),
      };
    });
  }
  async function nearby(
    lat: number,
    lng: number,
    radius: number,
    halalOnly: boolean,
  ): Promise<FoodResult[]> {
    if (maps.provider() === "google") {
      const key = `gfood2:${lat.toFixed(4)},${lng.toFixed(4)}:${radius}:${halalOnly ? 1 : 0}`;
      return cached(key, day, async () => {
        // Text search covers up to 60 results, the most Google returns.
        const dLat = radius / 111320,
          dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
        const found = await maps.search({
          textQuery: halalOnly ? "halal restaurant" : "restaurant",
          within: [lat - dLat, lng - dLng, lat + dLat, lng + dLng],
          pages: 3,
        });
        return found.map((r) => ({
          id: `google-${r.sourceId}`,
          name: r.name,
          nativeName: r.name,
          lat: r.lat,
          lng: r.lng,
          cuisine: r.kindLabel || r.kind.replaceAll("_", " "),
          // Google has no halal attribute; matches are by name and reviews.
          halal: "",
          address: r.address,
          phone: r.phone || "",
          url: r.url || "",
          openingHours: r.hours || "",
          link: r.mapsUrl || "",
          source: "google",
          rating: r.rating,
          ratingCount: r.ratingCount,
        }));
      });
    }
    const key = `food:${lat.toFixed(4)},${lng.toFixed(4)}:${radius}:${halalOnly ? 1 : 0}`;
    return cached(key, day, async () => {
      const around = `around:${radius},${lat},${lng}`;
      const amenity = `["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]`;
      const body = halalOnly
        ? `nwr(${around})${amenity}["diet:halal"~"yes|only"];nwr(${around})${amenity}["halal"~"yes|only"];nwr(${around})${amenity}["cuisine"~"halal|arab|turkish|lebanese|indonesian|malaysian|pakistani|indian|kebab",i];nwr(${around})${amenity}["name"~"halal|ハラル|할랄|清真",i];`
        : `nwr(${around})${amenity};`;
      const query = `[out:json][timeout:60];(${body});out center tags 1500;`;
      const json = await overpass(query);
      return json.elements
        .filter((el) => el.tags?.name)
        .map((el): FoodResult => {
          const t = el.tags!;
          const halal = (t["diet:halal"] || t.halal || "") as string;
          return {
            id: `osm-${el.type}-${el.id}`,
            name: t["name:en"] || t.name,
            nativeName: t.name,
            lat: el.lat ?? el.center!.lat,
            lng: el.lon ?? el.center!.lon,
            cuisine: (t.cuisine || t.amenity || "").replaceAll(";", ", "),
            halal: ["yes", "only", "no"].includes(halal)
              ? (halal as FoodResult["halal"])
              : "",
            address: [
              t["addr:housenumber"],
              t["addr:street"],
              t["addr:city"] || t["addr:suburb"],
            ]
              .filter(Boolean)
              .join(" "),
            phone: t.phone || t["contact:phone"] || "",
            url: t.website || t["contact:website"] || "",
            openingHours: t.opening_hours || "",
            link: `https://www.openstreetmap.org/${el.type}/${el.id}`,
            source: "osm",
          };
        });
    });
  }
  // A plausible track between two cities for train journeys on the route map,
  // from OpenRailRouting (OpenStreetMap railways). Not the exact service taken:
  // the router picks any connected tracks. City centres can sit on an isolated
  // line (a metro, say), so nearby mainline stations are tried next. Null when
  // no rail connection is found.
  async function railPath(from: Point, to: Point): Promise<Point[] | null> {
    const f = (p: Point) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    return cached(`rail1:${f(from)}:${f(to)}`, 90 * day, async () => {
      const route = (a: Point, b: Point) =>
        railQueue(300, async () => {
          const params = new URLSearchParams({
            profile: "all_tracks",
            points_encoded: "false",
            instructions: "false",
          });
          params.append("point", f(a));
          params.append("point", f(b));
          const res = await fetch(
            "https://routing.openrailrouting.org/route?" + params,
            {
              headers: { "User-Agent": agent },
              signal: AbortSignal.timeout(30000),
            },
          );
          const json = await res.json().catch(() => null);
          // Unknown points and unconnected tracks are answered with 400.
          if (res.status === 400) return null;
          if (!res.ok || !json?.paths?.[0])
            throw Error(`Rail routing ${res.status}`);
          const path = json.paths[0];
          return {
            km: path.distance / 1000,
            points: (path.points.coordinates as [number, number][]).map(
              ([lng, lat]): Point => [lat, lng],
            ),
          };
        });
      // Points around a city, nearest first, to find another track nearby.
      const around = (p: Point) =>
        [3, 8].flatMap((r) =>
          [0, 45, 90, 135, 180, 225, 270, 315].map((deg): Point => {
            const t = (deg * Math.PI) / 180;
            return [
              p[0] + (r / 111) * Math.cos(t),
              p[1] +
                (r / (111 * Math.cos((p[0] * Math.PI) / 180))) * Math.sin(t),
            ];
          }),
        );
      const tries: [Point, Point][] = [
        [from, to],
        ...around(from).map((a): [Point, Point] => [a, to]),
        ...around(to).map((b): [Point, Point] => [from, b]),
        ...around(from).map((a, i): [Point, Point] => [a, around(to)[i]]),
      ];
      let found: Awaited<ReturnType<typeof route>> = null;
      for (const [a, b] of tries) if ((found = await route(a, b))) break;
      // A route far longer than the distance is not a sensible picture.
      if (!found || found.km > 3 * km(from, to) + 50) return null;
      return simplify([from, ...found.points, to], 0.001).map(
        ([lat, lng]): Point => [+lat.toFixed(5), +lng.toFixed(5)],
      );
    });
  }
  // Exchange rates for comparing prices: units of each currency per 1 base.
  async function rates(base: string) {
    return cached(`rates:${base}`, 12 * 3600000, async () => {
      const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
        headers: { "User-Agent": agent },
        signal: AbortSignal.timeout(15000),
      });
      const json = await res.json();
      if (!res.ok || json.result !== "success")
        throw Error("Exchange rates unavailable");
      return {
        base,
        updated: String(json.time_last_update_utc || ""),
        rates: json.rates as Record<string, number>,
      };
    });
  }
  return {
    geocode,
    reverse,
    nearby,
    outdoors,
    routeShape,
    railPath,
    weather,
    rates,
  };
}

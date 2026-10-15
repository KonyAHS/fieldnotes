import { type GeoResult, cityParts, countryCode } from "./locate";
import { type Place, countryMeta, emptyPlace } from "./model";
export type { GeoResult };
export async function geocode(
  q: string,
  country = "",
  near?: { lat: number; lng: number },
): Promise<GeoResult[]> {
  const params = new URLSearchParams({ q, cc: countryCode(country) });
  if (near) params.set("near", `${near.lat.toFixed(3)},${near.lng.toFixed(3)}`);
  const res = await fetch("/api/geocode?" + params, {
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok)
    throw Error(
      (await res.json().catch(() => null))?.error ||
        "Location service unavailable",
    );
  return (await res.json()).results;
}
const cityCache = new Map<string, Promise<GeoResult | null>>();
export function cityPoint(city: string, country: string) {
  const key = `${country}|${city}`;
  if (!cityCache.has(key))
    cityCache.set(
      key,
      (async () => {
        for (const c of cityParts(city)) {
          const [hit] = await geocode(c, country);
          if (hit) return hit;
        }
        return null;
      })().catch((e) => {
        cityCache.delete(key);
        throw e;
      }),
    );
  return cityCache.get(key)!;
}
export type LinkPlace = {
  name: string;
  nativeName: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  url: string;
  hours: string;
  kind: string;
  mapsUrl: string;
};
export const isMapsLink = (s: string) =>
  /^https?:\/\/(([\w-]+\.)*google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl\/|goo\.gl\/maps|g\.co\/)/i.test(
    s.trim(),
  );
export async function readMapsLink(url: string): Promise<LinkPlace> {
  const res = await fetch(
    "/api/maps-link?" + new URLSearchParams({ url: url.trim() }),
    { signal: AbortSignal.timeout(60000) },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Error(body?.error || "Couldn't read this link");
  return body.place;
}
export type MapsStatus = {
  provider: "osm" | "google";
  google: { configured: boolean; hint?: string };
};
let status: Promise<MapsStatus> | null = null;
export function mapsStatus(refresh = false) {
  if (!status || refresh)
    status = fetch("/api/maps")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .catch(() => {
        status = null;
        return { provider: "osm", google: { configured: false } };
      });
  return status;
}
export const providerName = (s: MapsStatus | null) =>
  s?.provider === "google" && s.google.configured
    ? "Google Maps"
    : "OpenStreetMap";
const countryNames: Record<string, string> = {
  "south korea": "Korea",
  "republic of korea": "Korea",
  대한민국: "Korea",
  日本: "Japan",
  中国: "China",
  "people's republic of china": "China",
};
// The trip country named at the end of an address, if any.
export function countryFromAddress(address: string) {
  const last = address.split(",").pop()?.trim().toLowerCase() || "";
  return (
    countryNames[last] ||
    Object.keys(countryMeta).find((c) => c.toLowerCase() === last) ||
    ""
  );
}
// A new place from a search result or a Google Maps link.
export function placeFrom(
  r: Omit<GeoResult, "kind"> & { kind?: string; mapsUrl?: string },
  defaults: Pick<Place, "kind" | "country" | "city">,
): Place {
  const country = countryFromAddress(r.address) || defaults.country;
  return {
    ...emptyPlace(),
    ...defaults,
    country,
    city: country === defaults.country ? defaults.city : "",
    name: (r.name || r.address.split(",")[0]).slice(0, 300),
    nativeName: (r.nativeName || "").slice(0, 300),
    address: r.address.slice(0, 2000),
    phone: (r.phone || "").slice(0, 300),
    url: (r.url || "").slice(0, 300),
    lat: r.lat,
    lng: r.lng,
    geo: "auto",
    notes: [
      r.hours && `Hours: ${r.hours}`,
      r.mapsUrl && `Google Maps: ${r.mapsUrl}`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000),
  };
}
// The place type suggested by a search result's category (Google or OSM).
export function kindFrom(kind = ""): Place["kind"] | null {
  const k = kind.toLowerCase();
  if (/hotel|lodging|hostel|guest_?house|motel|ryokan|resort|inn\b/.test(k))
    return "hotel";
  if (
    /restaurant|cafe|bakery|food|bar\b|meal|ramen|sushi|dessert|confection/.test(
      k,
    )
  )
    return "restaurant";
  if (/station|airport|terminal|ferry|bus_stop|halt/.test(k)) return "station";
  if (
    /museum|attraction|park|temple|shrine|gallery|monument|viewpoint|zoo|aquarium|castle|landmark|historic|garden/.test(
      k,
    )
  )
    return "attraction";
  return null;
}
// The trip city an address belongs to, from the cities already in the plan.
export function cityFrom(address: string, cities: string[]) {
  const a = address.toLowerCase();
  return (
    [...cities]
      .filter(Boolean)
      .sort((x, y) => y.length - x.length)
      .find((c) => a.includes(c.toLowerCase())) || ""
  );
}

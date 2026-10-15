// Shared by the server's background locator and the place editor.
import { type Place, countryMeta, distance } from "./model";
export type GeoResult = {
  lat: number;
  lng: number;
  name: string;
  address: string;
  kind: string;
  // Details, when the provider has them.
  kindLabel?: string;
  nativeName?: string;
  phone?: string;
  url?: string;
  mapsUrl?: string;
  hours?: string;
  rating?: number;
  ratingCount?: number;
  source?: "osm" | "google";
  sourceId?: string;
};
export type Located = {
  lat: number;
  lng: number;
  geo: "auto" | "approx" | "failed";
  address: string;
};
export const countryCode = (country: string) =>
  countryMeta[country]?.code.toLowerCase() || "";
// "Kuwana / Mie" or "Zhuhai · Hengqin" → the individual city names.
export const cityParts = (city: string) =>
  city
    .split(/[/·,]| or /)
    .map((c) => c.trim())
    .filter(Boolean);
// What the location depends on; a change means the place is located again.
export const placeSignature = (p: Place) =>
  [p.name, p.nativeName, p.city, p.country, p.address, p.nativeAddress]
    .map((v) => v.trim().toLowerCase())
    .join("|");
export const needsLocation = (p: Place) => p.lat === null && !p.geo;
// Try the most specific description first, then fall back to the city so a
// place always gets a usable search anchor. Name matches must lie near the
// city (fuzzy search can ignore it), so a similarly named place elsewhere in
// the country is not picked. Explicit addresses are trusted.
export async function locatePlace(
  p: Place,
  geocode: (q: string, cc: string) => Promise<GeoResult[]>,
): Promise<Located> {
  const cc = countryCode(p.country);
  const cities = cityParts(p.city);
  // Drop qualifiers such as "museum + facility bus tour".
  const short = p.name.split(/[+(·/]/)[0].trim();
  let centre: GeoResult | null | undefined;
  const cityCentre = async () => {
    if (centre !== undefined) return centre;
    centre = null;
    for (const c of cities) {
      const [hit] = await geocode(c, cc);
      if (hit) return (centre = hit);
    }
    return centre;
  };
  const queries: { q: string; trusted: boolean }[] = [
    { q: p.nativeAddress, trusted: true },
    { q: p.address, trusted: true },
    ...cities.flatMap((c) => [
      { q: `${p.name}, ${c}`, trusted: false },
      { q: `${short}, ${c}`, trusted: false },
    ]),
    { q: p.nativeName, trusted: false },
    { q: p.name, trusted: false },
    { q: short, trusted: false },
  ];
  const tried = new Set<string>();
  for (const { q, trusted } of queries) {
    const query = q.trim();
    if (!query || tried.has(query)) continue;
    tried.add(query);
    for (const hit of (await geocode(query, cc)).slice(0, 3)) {
      if (!trusted && cities.length) {
        const c = await cityCentre();
        const km = c ? distance(c, hit) : null;
        if (km === null || km > 80) continue;
      }
      return { lat: hit.lat, lng: hit.lng, geo: "auto", address: hit.address };
    }
  }
  const c = await cityCentre();
  if (c) return { lat: c.lat, lng: c.lng, geo: "approx", address: "" };
  return { lat: 0, lng: 0, geo: "failed", address: "" };
}

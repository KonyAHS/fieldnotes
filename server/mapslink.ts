// Reads what a Google Maps link says about a place: its name, the pin's
// coordinates and any search text, then fills in details from the map data
// provider.
import type { GeoResult } from "../src/locate.ts";
import { distance } from "../src/model.ts";
import type { GoogleSearch } from "./maps.ts";
export type MapsLink = {
  name: string;
  lat: number | null;
  lng: number | null;
  query: string;
  placeId: string;
};
const googleHost = /^((www|maps)\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/i;
const shortHosts = ["maps.app.goo.gl", "goo.gl", "g.co"];
export const isMapsHost = (host: string) =>
  googleHost.test(host) || shortHosts.includes(host.toLowerCase());
export const isShortLink = (u: URL) =>
  shortHosts.includes(u.hostname.toLowerCase());
const coords = (s: string) => {
  const m = s.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]),
    lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};
const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " ")).trim();
  } catch {
    return s.replace(/\+/g, " ").trim();
  }
};
export function parseMapsLink(u: URL): MapsLink {
  const path = u.pathname;
  const params = u.searchParams;
  const out: MapsLink = {
    name: "",
    lat: null,
    lng: null,
    query: "",
    placeId: params.get("query_place_id") || "",
  };
  const place = path.match(/\/maps\/place\/([^/]+)/);
  if (place) {
    const text = decode(place[1]);
    const c = coords(text);
    if (c) Object.assign(out, c);
    else out.name = text;
  }
  // The place's own pin (!3d lat !4d lng) is more precise than the map
  // centre (@lat,lng), which only shows where the map was looking.
  const full = decode(path + "?" + params.toString());
  const pin = [...full.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)].pop();
  if (pin) {
    out.lat = Number(pin[1]);
    out.lng = Number(pin[2]);
  }
  for (const key of ["q", "query", "daddr", "destination", "ll"]) {
    const v = params.get(key);
    if (!v) continue;
    const c = coords(v);
    if (c && out.lat === null) Object.assign(out, c);
    else if (!c && !out.query) out.query = v.trim();
  }
  const search = path.match(/\/maps\/search\/([^/]+)/);
  if (search && !out.query) {
    const text = decode(search[1]);
    const c = coords(text);
    if (c && out.lat === null) Object.assign(out, c);
    else if (!c) out.query = text;
  }
  if (out.lat === null) {
    const centre = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    // Only trust the centre when the link names a place; a bare map view's
    // centre is not a place.
    if (centre && (out.name || out.query)) {
      out.lat = Number(centre[1]);
      out.lng = Number(centre[2]);
    }
  }
  // "Name, address" search text: the first part is the name.
  if (!out.name && out.query) out.name = out.query.split(",")[0].trim();
  return out;
}
export type LinkPlace = {
  name: string;
  nativeName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  url: string;
  hours: string;
  kind: string;
  mapsUrl: string;
};
type Deps = {
  fetch: typeof fetch;
  geocode: (
    q: string,
    cc: string,
    near?: { lat: number; lng: number },
  ) => Promise<GeoResult[]>;
  reverse: (lat: number, lng: number) => Promise<GeoResult | null>;
  google: null | {
    search: (s: GoogleSearch) => Promise<GeoResult[]>;
    details: (id: string) => Promise<GeoResult>;
  };
};
export class LinkError extends Error {}
// Short links redirect to the full link. Only Google hosts are followed, so a
// pasted link cannot make the server fetch arbitrary addresses.
async function expand(u: URL, f: typeof fetch) {
  for (let hop = 0; hop < 6 && isShortLink(u); hop++) {
    const res = await f(u, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Fieldnotes/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    const location = res.headers.get("location");
    let next: string | undefined;
    if (location) next = new URL(location, u).toString();
    else if (res.ok)
      next = (await res.text()).match(
        /https:\/\/(?:www\.|maps\.)?google\.[a-z.]+\/maps[^"'\s<>\\]*/,
      )?.[0];
    else await res.body?.cancel();
    if (!next) throw new LinkError("This short link could not be opened");
    const target = new URL(next.replace(/&amp;/g, "&"));
    if (!isMapsHost(target.hostname))
      throw new LinkError("The link does not lead to Google Maps");
    u = target;
  }
  return u;
}
export async function resolveMapsLink(
  raw: string,
  deps: Deps,
): Promise<LinkPlace> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new LinkError("Paste a Google Maps link");
  }
  if (!/^https?:$/.test(u.protocol) || !isMapsHost(u.hostname))
    throw new LinkError("Paste a Google Maps link");
  u = await expand(u, deps.fetch);
  const link = parseMapsLink(u);
  if (!link.name && link.lat === null && !link.placeId)
    throw new LinkError(
      "This link doesn't include the place. In Google Maps, open the place and use Share → Copy link.",
    );
  const pin =
    link.lat !== null && link.lng !== null
      ? { lat: link.lat, lng: link.lng }
      : undefined;
  const nearPin = (r: GeoResult) => !pin || (distance(pin, r) ?? 99) < 1;
  let match: GeoResult | undefined | null;
  if (deps.google && link.placeId)
    match = await deps.google.details(link.placeId).catch(() => null);
  const text = link.name || link.query;
  if (!match && text) {
    const found = deps.google
      ? await deps.google.search({
          textQuery: text,
          bias: pin && { ...pin, radius: 1000 },
        })
      : await deps.geocode(text, "", pin);
    match = found.find(nearPin);
  }
  if (!match && pin) match = await deps.reverse(pin.lat, pin.lng);
  if (!pin && !match)
    throw new LinkError("Couldn't find this place. Try the full link.");
  return {
    name: link.name || match?.name || "",
    nativeName: match?.nativeName || "",
    address: match?.address || "",
    // The link's own pin is exact; use it over looked-up coordinates.
    lat: pin?.lat ?? match!.lat,
    lng: pin?.lng ?? match!.lng,
    phone: match?.phone || "",
    url: match?.url || "",
    hours: match?.hours || "",
    kind: match?.kind || "",
    mapsUrl: u.toString().slice(0, 1000),
  };
}

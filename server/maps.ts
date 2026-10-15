// Map data provider settings and the Google Places client. The Google API key
// is stored only on the server, in a private file, and never sent to
// browsers; requests are made by the server on the browsers' behalf.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { GeoResult } from "../src/locate.ts";
export type Provider = "osm" | "google";
type MapsConfig = { provider: Provider; googleKey: string };
const fields = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "primaryType",
  "primaryTypeDisplayName",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "regularOpeningHours.weekdayDescriptions",
  "rating",
  "userRatingCount",
];
type GooglePlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  rating?: number;
  userRatingCount?: number;
};
export type GoogleSearch = {
  textQuery: string;
  regionCode?: string;
  bias?: { lat: number; lng: number; radius: number };
  // [south, west, north, east]; results must lie inside.
  within?: [number, number, number, number];
  pages?: number;
};
export const toGeoResult = (p: GooglePlace): GeoResult => ({
  lat: p.location?.latitude ?? 0,
  lng: p.location?.longitude ?? 0,
  name: p.displayName?.text || "",
  address: p.formattedAddress || "",
  kind: p.primaryType || "",
  kindLabel: p.primaryTypeDisplayName?.text || "",
  phone: p.internationalPhoneNumber || "",
  url: p.websiteUri || "",
  mapsUrl: p.googleMapsUri || "",
  hours: p.regularOpeningHours?.weekdayDescriptions?.join("; ") || "",
  rating: p.rating,
  ratingCount: p.userRatingCount,
  source: "google",
  sourceId: p.id,
});
export function maps(dataDir: string) {
  const dir = join(dataDir, "secrets");
  const file = join(dir, "maps.json");
  const read = (): MapsConfig => {
    const fallback: MapsConfig = { provider: "osm", googleKey: "" };
    if (!existsSync(file)) return fallback;
    try {
      return { ...fallback, ...JSON.parse(readFileSync(file, "utf8")) };
    } catch {
      return fallback;
    }
  };
  const write = (c: MapsConfig) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    writeFileSync(file, JSON.stringify(c), { mode: 0o600 });
    chmodSync(file, 0o600);
  };
  async function call<T>(
    key: string,
    path: string,
    body: unknown,
    mask: string,
  ): Promise<T> {
    const res = await fetch("https://places.googleapis.com/v1/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": mask,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok)
      throw Error(
        `Google Places: ${json?.error?.message || `HTTP ${res.status}`}`,
      );
    return json as T;
  }
  async function search(s: GoogleSearch, key = read().googleKey) {
    const found: GeoResult[] = [];
    let pageToken = "";
    for (let page = 0; page < (s.pages || 1); page++) {
      const body: Record<string, unknown> = {
        textQuery: s.textQuery,
        languageCode: "en",
        pageSize: 20,
      };
      if (s.regionCode) body.regionCode = s.regionCode.toUpperCase();
      if (pageToken) body.pageToken = pageToken;
      if (s.within)
        body.locationRestriction = {
          rectangle: {
            low: { latitude: s.within[0], longitude: s.within[1] },
            high: { latitude: s.within[2], longitude: s.within[3] },
          },
        };
      else if (s.bias)
        body.locationBias = {
          circle: {
            center: { latitude: s.bias.lat, longitude: s.bias.lng },
            radius: Math.min(50000, s.bias.radius),
          },
        };
      const json = await call<{
        places?: GooglePlace[];
        nextPageToken?: string;
      }>(
        key,
        "places:searchText",
        body,
        fields.map((f) => "places." + f).join(",") + ",nextPageToken",
      );
      found.push(...(json.places || []).map(toGeoResult));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return found;
  }
  async function details(id: string) {
    if (!/^[\w-]{10,300}$/.test(id)) throw Error("Invalid place");
    return toGeoResult(
      await call<GooglePlace>(
        read().googleKey,
        "places/" + id + "?languageCode=en",
        null,
        fields.join(","),
      ),
    );
  }
  return {
    // The provider in effect: Google only when it is chosen and has a key.
    provider(): Provider {
      const c = read();
      return c.provider === "google" && c.googleKey ? "google" : "osm";
    },
    hasGoogle: () => Boolean(read().googleKey),
    status() {
      const c = read();
      return {
        provider: c.provider,
        google: c.googleKey
          ? { configured: true, hint: c.googleKey.slice(-4) }
          : { configured: false },
      };
    },
    async update(change: { provider?: Provider; googleKey?: string | null }) {
      const c = read();
      if (change.googleKey === null) {
        c.googleKey = "";
        c.provider = "osm";
      } else if (change.googleKey) {
        // A test search checks the key and that the Places API is enabled.
        await search({ textQuery: "Tokyo Tower" }, change.googleKey);
        c.googleKey = change.googleKey;
      }
      if (change.provider) {
        if (change.provider === "google" && !c.googleKey)
          throw Error("Add a Google Maps API key first");
        c.provider = change.provider;
      }
      write(c);
    },
    search,
    details,
  };
}

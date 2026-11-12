// Public transport directions from the Google Routes API, reduced to what the
// day map shows: walking and transit steps with their lines, times and paths.
import type { Point } from "../src/tripRoute.ts";
import { simplify } from "../src/tripRoute.ts";
import type {
  TransitRoute,
  TransitStep,
  TransitWhen,
} from "../src/dayRoute.ts";
// Google's encoded polyline format (5 decimal places).
export function decodePolyline(encoded: string): Point[] {
  const points: Point[] = [];
  let i = 0,
    lat = 0,
    lng = 0;
  const next = () => {
    let shift = 0,
      result = 0,
      b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lng += next();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}
type GoogleStep = {
  travelMode?: string;
  staticDuration?: string;
  distanceMeters?: number;
  polyline?: { encodedPolyline?: string };
  transitDetails?: {
    stopDetails?: {
      departureStop?: { name?: string };
      arrivalStop?: { name?: string };
    };
    localizedValues?: {
      departureTime?: { time?: { text?: string } };
      arrivalTime?: { time?: { text?: string } };
    };
    headsign?: string;
    stopCount?: number;
    transitLine?: {
      name?: string;
      nameShort?: string;
      color?: string;
      textColor?: string;
      agencies?: { name?: string }[];
      vehicle?: { name?: { text?: string }; type?: string };
    };
  };
};
type GoogleRoute = {
  duration?: string;
  distanceMeters?: number;
  localizedValues?: { transitFare?: { text?: string } };
  legs?: { steps?: GoogleStep[] }[];
};
const minutes = (d?: string) => Math.round(parseFloat(d || "0") / 60);
const path = (s: GoogleStep) =>
  simplify(decodePolyline(s.polyline?.encodedPolyline || ""), 0.00003).map(
    ([lat, lng]): Point => [+lat.toFixed(5), +lng.toFixed(5)],
  );
export function toTransitRoute(route: GoogleRoute | undefined): TransitRoute {
  const raw = route?.legs?.flatMap((l) => l.steps || []) || [];
  if (!route || !raw.length) return { found: false };
  const steps: TransitStep[] = [];
  for (const s of raw) {
    const t = s.transitDetails;
    if (s.travelMode === "TRANSIT" && t) {
      const line = t.transitLine || {};
      steps.push({
        mode: "transit",
        minutes: minutes(s.staticDuration),
        meters: s.distanceMeters || 0,
        points: path(s),
        line: {
          name: line.name || line.nameShort || "",
          short: line.nameShort || "",
          color: line.color || "",
          textColor: line.textColor || "",
          vehicle: line.vehicle?.name?.text || "",
          vehicleType: line.vehicle?.type || "",
          agency: line.agencies?.[0]?.name || "",
          headsign: t.headsign || "",
        },
        from: t.stopDetails?.departureStop?.name || "",
        to: t.stopDetails?.arrivalStop?.name || "",
        depart: t.localizedValues?.departureTime?.time?.text || "",
        arrive: t.localizedValues?.arrivalTime?.time?.text || "",
        stops: t.stopCount || 0,
      });
      continue;
    }
    // Directions list each turn as a walking step; the map shows one walk.
    const last = steps.at(-1);
    if (last?.mode === "walk") {
      last.minutes += minutes(s.staticDuration);
      last.meters += s.distanceMeters || 0;
      last.points.push(...path(s).slice(last.points.length ? 1 : 0));
    } else
      steps.push({
        mode: "walk",
        minutes: minutes(s.staticDuration),
        meters: s.distanceMeters || 0,
        points: path(s),
      });
  }
  return {
    found: true,
    minutes: minutes(route.duration),
    meters: route.distanceMeters || 0,
    fare: route.localizedValues?.transitFare?.text || "",
    steps,
  };
}
const fields = [
  "duration",
  "distanceMeters",
  "localizedValues",
  "legs.steps.travelMode",
  "legs.steps.staticDuration",
  "legs.steps.distanceMeters",
  "legs.steps.polyline",
  "legs.steps.transitDetails",
]
  .map((f) => "routes." + f)
  .join(",");
export async function googleTransit(
  key: string,
  from: Point,
  to: Point,
  when: TransitWhen,
): Promise<TransitRoute> {
  const at = (p: Point) => ({
    location: { latLng: { latitude: p[0], longitude: p[1] } },
  });
  const res = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": fields,
      },
      body: JSON.stringify({
        origin: at(from),
        destination: at(to),
        travelMode: "TRANSIT",
        [when.by === "arrive" ? "arrivalTime" : "departureTime"]: when.at,
        languageCode: "en",
        units: "METRIC",
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw Error(
      `Google Routes: ${json?.error?.message || `HTTP ${res.status}`}`,
    );
  return toTransitRoute((json?.routes as GoogleRoute[] | undefined)?.[0]);
}

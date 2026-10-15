import { useEffect, useMemo, useState } from "react";
import {
  Mountain,
  Bike,
  ExternalLink,
  Plus,
  Check,
  MapPin,
  Navigation,
  Download,
  Route,
  Sunrise,
  Sunset,
  Thermometer,
  CloudRain,
  Wind,
} from "lucide-react";
import {
  type Workspace,
  type Trip,
  type Scenario,
  type Place,
  shortDate,
  weekday,
  distance,
  mapLinks,
  emptyPlace,
  entriesOn,
} from "../model";
import { mutate, download } from "../sync";
import { gpx } from "../gpx";
import { RadiusInput } from "./RadiusInput";
import { PlaceMap } from "./Places";
import { type Anchor, StopList, placeAnchor, useAnchorPoint } from "./Food";
type Kind = "hiking" | "cycling";
type OutdoorResult = {
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
type Weather = {
  source: "forecast" | "last-year" | "observed";
  date: string;
  tempMax: number | null;
  tempMin: number | null;
  rain: string;
  windMax: number | null;
  sunrise: string;
  sunset: string;
};
type Point = { lat: number; lng: number };
const isRoute = (r: OutdoorResult) =>
  r.kind === "hiking" || r.kind === "cycling" || r.kind === "mtb";
const networks: Record<string, string> = {
  iwn: "International",
  nwn: "National",
  rwn: "Regional",
  lwn: "Local",
  icn: "International",
  ncn: "National",
  rcn: "Regional",
  lcn: "Local",
};
const difficulty: Record<string, string> = {
  hiking: "Easy (T1)",
  mountain_hiking: "Moderate (T2)",
  demanding_mountain_hiking: "Demanding (T3)",
  alpine_hiking: "Alpine (T4)",
  demanding_alpine_hiking: "Demanding alpine (T5)",
  difficult_alpine_hiking: "Difficult alpine (T6)",
};
const label = (r: OutdoorResult) =>
  difficulty[r.difficulty] ||
  (r.kind === "mtb" && r.difficulty
    ? `MTB scale ${r.difficulty}`
    : r.difficulty);
const km = (d: number) =>
  d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(d < 10 ? 1 : 0)} km`;
// Distance to a route's extent (0 inside it), or to a single point.
function away(p: Point, r: OutdoorResult) {
  if (!r.bounds) return distance(p, r) ?? Infinity;
  const [s, w, n, e] = r.bounds;
  return (
    distance(p, {
      lat: Math.min(n, Math.max(s, p.lat)),
      lng: Math.min(e, Math.max(w, p.lng)),
    }) ?? Infinity
  );
}
const site = (r: OutdoorResult) =>
  r.kind === "mtb" ? "mtb" : r.kind === "cycling" ? "cycling" : "hiking";
const waymarked = (r: OutdoorResult) =>
  `https://${site(r)}.waymarkedtrails.org/#route?id=${r.osmId}&type=relation`;
async function shape(r: OutdoorResult) {
  const res = await fetch(`/api/route-shape?id=${r.osmId}`, {
    signal: AbortSignal.timeout(90000),
  });
  const body = await res.json();
  if (!res.ok) throw Error(body.error || "Route map unavailable");
  return body.lines as [number, number][][];
}
// Rough time on the route: walking 4 km/h plus 1 h per 500 m climbed,
// cycling 15 km/h, mountain biking 10 km/h.
function hours(r: OutdoorResult, measured?: number | null) {
  const length = r.lengthKm ?? measured;
  if (!length) return r.kind === "rental" ? 4 : 3;
  const climb = parseFloat(r.ascent) || 0;
  const h =
    r.kind === "hiking"
      ? length / 4 + climb / 500
      : length / (r.kind === "mtb" ? 10 : 15);
  return Math.min(9, Math.max(1, Math.round(h * 2) / 2));
}
const regional: Record<string, { name: string; url: string; note: string }[]> =
  {
    Japan: [
      {
        name: "YAMAP",
        url: "https://yamap.com/",
        note: "Japanese mountain trails, offline maps and recent trip reports",
      },
      {
        name: "Docomo Bike Share",
        url: "https://docomo-cycle.jp/",
        note: "Shared bikes in Tokyo and other cities",
      },
    ],
    Korea: [
      {
        name: "Durunubi",
        url: "https://www.durunubi.kr/",
        note: "Official Korea walking and cycling trails, with GPX",
      },
      {
        name: "Seoul Bike (Ttareungyi)",
        url: "https://www.bikeseoul.com/",
        note: "Seoul's public bike share",
      },
    ],
    China: [
      {
        name: "2bulu (两步路)",
        url: "https://www.2bulu.com/",
        note: "Chinese hiking tracks; maps work best with GCJ-02 apps",
      },
    ],
  };
export function Outdoors({
  data,
  trip,
  scenario,
  initialPlaceId,
  onPlan,
  onEditPlace,
}: {
  data: Workspace;
  trip: Trip;
  scenario: Scenario;
  initialPlaceId: string;
  onPlan: (p: Place, date: string, time: string, endTime: string) => void;
  onEditPlace: (p: Place) => void;
}) {
  const initialPlace = data.places.find((p) => p.id === initialPlaceId);
  const [anchor, setAnchor] = useState<Anchor | null>(() =>
    initialPlace ? placeAnchor(initialPlace, scenario, trip, "08:00") : null,
  );
  const [kind, setKind] = useState<Kind>("hiking");
  const [radius, setRadius] = useState(10);
  const [results, setResults] = useState<OutdoorResult[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [weather, setWeather] = useState<Weather | null>(null);
  const [route, setRoute] = useState<{
    id: string;
    lines: [number, number][][];
  } | null>(null);
  const place = anchor && data.places.find((p) => p.id === anchor.placeId);
  const located = useAnchorPoint(anchor, place);
  const point = located.point;
  useEffect(() => {
    setResults(null);
    setRoute(null);
  }, [anchor?.key]);
  useEffect(() => {
    if (!point) return;
    let cancelled = false;
    setBusy("Searching…");
    setError("");
    setResults(null);
    fetch(
      "/api/outdoors?" +
        new URLSearchParams({
          lat: point.lat.toFixed(4),
          lng: point.lng.toFixed(4),
          radius: String(radius),
          kind,
        }),
      { signal: AbortSignal.timeout(90000) },
    )
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw Error(body.error || "Trail search unavailable");
        return body.results as OutdoorResult[];
      })
      .then((found) => {
        if (cancelled) return;
        setResults(
          found
            .filter((r) => away(point, r) <= radius)
            .sort((a, b) => away(point, a) - away(point, b)),
        );
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(""));
    return () => {
      cancelled = true;
    };
  }, [point?.lat, point?.lng, radius, kind]);
  useEffect(() => {
    if (!point || !anchor) return;
    let cancelled = false;
    setWeather(null);
    fetch(
      "/api/weather?" +
        new URLSearchParams({
          lat: point.lat.toFixed(3),
          lng: point.lng.toFixed(3),
          date: anchor.date,
        }),
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => !cancelled && setWeather(w))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [point?.lat, point?.lng, anchor?.date]);
  const routes = useMemo(() => (results || []).filter(isRoute), [results]);
  const spots = useMemo(
    () => (results || []).filter((r) => !isRoute(r)).slice(0, 40),
    [results],
  );
  async function showRoute(r: OutdoorResult) {
    if (route?.id === r.id) {
      setRoute(null);
      return;
    }
    setBusy(`Loading ${r.name}…`);
    try {
      setRoute({ id: r.id, lines: await shape(r) });
      document
        .querySelector(".outdoor-map")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Route map unavailable");
    } finally {
      setBusy("");
    }
  }
  async function downloadGpx(r: OutdoorResult) {
    setBusy(`Preparing ${r.name}…`);
    try {
      const lines = route?.id === r.id ? route.lines : await shape(r);
      download(
        `${r.name.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "route"}.gpx`,
        gpx(r.name, r.osmId, lines),
        "application/gpx+xml",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "GPX unavailable");
    } finally {
      setBusy("");
    }
  }
  // Save a result as a place. Routes are pinned at their point nearest to the
  // stop, which is where you would join them.
  async function save(r: OutdoorResult) {
    const existing = data.places.find((p) => p.id === r.id);
    if (existing) return { place: existing, measured: null };
    let at: Point = { lat: r.lat, lng: r.lng };
    let measured: number | null = null;
    if (isRoute(r) && point) {
      try {
        const lines = route?.id === r.id ? route.lines : await shape(r);
        // Sum of the route's ways; both directions of split sections count.
        measured = lines.reduce(
          (sum, l) =>
            sum +
            l
              .slice(1)
              .reduce(
                (n, [lat, lng], i) =>
                  n +
                  (distance({ lat: l[i][0], lng: l[i][1] }, { lat, lng }) ?? 0),
                0,
              ),
          0,
        );
        let best = Infinity;
        for (const l of lines)
          for (const [lat, lng] of l) {
            const d = distance(point, { lat, lng }) ?? Infinity;
            if (d < best) {
              best = d;
              at = { lat, lng };
            }
          }
      } catch {
        // Keep the route's centre.
      }
    }
    const facts = [
      isRoute(r) &&
        `${r.kind === "hiking" ? "Hiking" : r.kind === "mtb" ? "Mountain bike" : "Cycling"} route`,
      networks[r.network] && `${networks[r.network]} network`,
      r.ref && `Ref ${r.ref}`,
      (r.lengthKm || measured) &&
        `${km((r.lengthKm || measured)!)}${r.roundtrip ? " loop" : ""}${r.lengthKm ? "" : " (measured)"}`,
      r.ascent && `Ascent ${r.ascent} m`,
      label(r) && `Difficulty ${label(r)}`,
      r.ele && `Elevation ${r.ele} m`,
      r.openingHours && `Hours: ${r.openingHours}`,
      `Estimated ${hours(r, measured)} h${hours(r, measured) >= 9 ? " (long route: plan a section)" : ""}`,
      isRoute(r) && `Pinned at the point nearest ${anchor?.label}`,
      r.description,
    ].filter(Boolean);
    const p: Place = {
      ...emptyPlace(),
      id: r.id,
      name: r.name,
      nativeName: r.nativeName !== r.name ? r.nativeName : "",
      kind: r.kind === "rental" ? "other" : "attraction",
      country: anchor?.country || "",
      city: anchor?.city || "",
      lat: at.lat,
      lng: at.lng,
      geo: "auto",
      url: isRoute(r)
        ? waymarked(r)
        : r.website || `https://www.openstreetmap.org/${r.osmType}/${r.osmId}`,
      evidence: `https://www.openstreetmap.org/${r.osmType}/${r.osmId}`,
      notes: facts.join("\n"),
    };
    mutate((d) => {
      if (!d.places.some((x) => x.id === p.id)) d.places.push(p);
    });
    return { place: p, measured };
  }
  async function plan(r: OutdoorResult) {
    if (!anchor) return;
    setBusy(`Adding ${r.name}…`);
    const { place: p, measured } = await save(r);
    setBusy("");
    const start = kind === "hiking" ? 8 : 9;
    const end = Math.min(22, start + hours(r, measured));
    const hhmm = (h: number) =>
      `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;
    onPlan(p, anchor.date, hhmm(start), hhmm(end));
  }
  const planned = new Set(scenario.entries.map((e) => e.placeId));
  const anchorPlace: Place | undefined = point
    ? {
        ...emptyPlace(),
        id: "anchor",
        name: anchor?.label || "",
        lat: point.lat,
        lng: point.lng,
      }
    : undefined;
  const daylight =
    weather?.sunrise && weather.sunset
      ? (() => {
          const m = (t: string) =>
            Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
          const d = m(weather.sunset) - m(weather.sunrise);
          return `${Math.floor(d / 60)} h ${d % 60} min`;
        })()
      : "";
  const card = (r: OutdoorResult) => {
    const saved = data.places.some((p) => p.id === r.id);
    const Icon =
      r.kind === "hiking" || r.kind === "peak" || r.kind === "viewpoint"
        ? Mountain
        : r.kind === "trailhead"
          ? MapPin
          : Bike;
    return (
      <article
        className={`food-card outdoor-card ${route?.id === r.id ? "highlighted" : ""}`}
        key={r.id}
        id={"outdoor-" + r.id}
      >
        <Icon size={18} className="outdoor-icon" />
        <div className="food-card-main">
          <strong>{r.name}</strong>
          {r.nativeName && r.nativeName !== r.name && (
            <span className="native-name">{r.nativeName}</span>
          )}
          <span className="food-meta">
            {point &&
              (away(point, r) < 0.05
                ? "Passes nearby"
                : `${km(away(point, r))} away`)}
            {r.lengthKm !== null &&
              ` · ${km(r.lengthKm)}${r.roundtrip ? " loop" : ""}`}
            {r.ascent && ` · ↑${r.ascent} m`}
            {r.ele && ` · ${r.ele} m`}
            {networks[r.network] && (
              <span className="halal-badge">{networks[r.network]}</span>
            )}
            {label(r) && <span className="halal-badge">{label(r)}</span>}
            {r.kind === "rental" && (
              <span className="halal-badge">Bike rental</span>
            )}
            {r.kind === "viewpoint" && (
              <span className="halal-badge">Viewpoint</span>
            )}
            {r.kind === "trailhead" && (
              <span className="halal-badge">Trailhead</span>
            )}
          </span>
          {(r.description || r.openingHours) && (
            <span className="food-hours">
              {r.description || r.openingHours}
            </span>
          )}
        </div>
        <div className="food-actions">
          {isRoute(r) ? (
            <>
              <button
                className={`icon-button ${route?.id === r.id ? "active-button" : ""}`}
                aria-label={`Show ${r.name} on the map`}
                title="Show on map"
                onClick={() => void showRoute(r)}
              >
                <Route size={15} />
              </button>
              <button
                className="icon-button"
                aria-label={`Download GPX for ${r.name}`}
                title="Download GPX"
                onClick={() => void downloadGpx(r)}
              >
                <Download size={15} />
              </button>
              <a
                className="icon-button"
                aria-label={`${r.name} on Waymarked Trails`}
                title="Waymarked Trails (elevation profile, details)"
                href={waymarked(r)}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
              </a>
            </>
          ) : (
            <a
              className="icon-button"
              aria-label={`Directions to ${r.name}`}
              href={
                mapLinks({
                  ...emptyPlace(),
                  name: r.nativeName || r.name,
                  lat: r.lat,
                  lng: r.lng,
                  country: anchor?.country || "",
                })[0].url
              }
              target="_blank"
              rel="noreferrer"
            >
              <Navigation size={15} />
            </a>
          )}
          {!saved && (
            <button className="button small" onClick={() => void save(r)}>
              Save
            </button>
          )}
          {anchor && (
            <button
              className="button primary small"
              onClick={() => void plan(r)}
            >
              {planned.has(r.id) ? <Check size={14} /> : <Plus size={14} />}
              Add to {shortDate(anchor.date)}
            </button>
          )}
        </div>
      </article>
    );
  };
  return (
    <div className="food-view">
      <StopList
        trip={trip}
        scenario={scenario}
        selected={anchor?.key}
        onSelect={setAnchor}
        badge={(d) => {
          const outdoor = entriesOn(scenario, d).filter((e) =>
            data.places.some(
              (p) =>
                p.id === e.placeId &&
                /^osm-relation-/.test(p.id) &&
                e.status !== "idea",
            ),
          );
          return (
            outdoor.length > 0 && (
              <span
                className="tag"
                title={outdoor.map((e) => e.title).join(", ")}
              >
                <Mountain size={11} /> {outdoor.length}
              </span>
            )
          );
        }}
      />
      <div className="food-results">
        {!anchor ? (
          <div className="empty-state">
            <Mountain size={22} />
            <p>
              Choose a stop from your itinerary to find hiking trails, cycling
              routes and bike rental near it.
            </p>
          </div>
        ) : (
          <>
            <div className="food-heading">
              <div>
                <span className="eyebrow">
                  {weekday(anchor.date)} {shortDate(anchor.date)} · near
                </span>
                <h2>{anchor.label}</h2>
                {located.point?.approx && (
                  <span className="food-approx">
                    Searching around the centre of {anchor.city}.{" "}
                    {place && (
                      <button
                        className="text-button"
                        onClick={() => onEditPlace(place)}
                      >
                        Set exact position
                      </button>
                    )}
                  </span>
                )}
              </div>
              <div className="food-filters">
                <div className="segmented">
                  <button
                    className={kind === "hiking" ? "selected" : ""}
                    onClick={() => {
                      setKind("hiking");
                      setRoute(null);
                    }}
                  >
                    <Mountain size={14} /> Hiking
                  </button>
                  <button
                    className={kind === "cycling" ? "selected" : ""}
                    onClick={() => {
                      setKind("cycling");
                      setRoute(null);
                    }}
                  >
                    <Bike size={14} /> Cycling
                  </button>
                </div>
                <RadiusInput
                  metres={radius * 1000}
                  min={500}
                  max={100000}
                  onChange={(m) => setRadius(m / 1000)}
                />
              </div>
            </div>
            {(located.message || error || busy) && (
              <div className="notice" role="status">
                {located.message || error || busy}
              </div>
            )}
            {weather && (
              <div className="conditions">
                <span title="Sunrise">
                  <Sunrise size={15} /> {weather.sunrise}
                </span>
                <span title="Sunset">
                  <Sunset size={15} /> {weather.sunset}
                </span>
                {daylight && <span>{daylight} daylight</span>}
                {weather.tempMax !== null && (
                  <span>
                    <Thermometer size={15} /> {Math.round(weather.tempMin!)}–
                    {Math.round(weather.tempMax)}°C
                  </span>
                )}
                {weather.rain && (
                  <span>
                    <CloudRain size={15} /> {weather.rain}
                  </span>
                )}
                {weather.windMax !== null && (
                  <span>
                    <Wind size={15} /> up to {Math.round(weather.windMax)} km/h
                  </span>
                )}
                <em>
                  {weather.source === "forecast"
                    ? "Forecast"
                    : weather.source === "last-year"
                      ? `Weather on ${shortDate(weather.date)} ${weather.date.slice(0, 4)}, as a guide; a forecast appears 16 days ahead`
                      : "Observed"}{" "}
                  · Open-Meteo
                </em>
              </div>
            )}
            {point && (
              <div className="outdoor-map">
                <PlaceMap
                  places={[
                    ...(results || []).map((r) => ({
                      ...emptyPlace(),
                      id: r.id,
                      name: r.name,
                      kind:
                        r.kind === "rental"
                          ? ("other" as const)
                          : ("attraction" as const),
                      lat: r.lat,
                      lng: r.lng,
                    })),
                    anchorPlace!,
                  ]}
                  anchor={anchorPlace}
                  online={navigator.onLine}
                  radius={radius * 1000}
                  lines={route?.lines}
                  overlay={{
                    url: `https://tile.waymarkedtrails.org/${kind}/{z}/{x}/{y}.png`,
                    attribution:
                      '<a href="https://waymarkedtrails.org">Waymarked Trails</a> (CC BY-SA)',
                  }}
                  onSelect={(p) =>
                    document
                      .getElementById("outdoor-" + p.id)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }
                />
              </div>
            )}
            <div className="tool-links">
              {point && (
                <>
                  <a
                    href={`https://${kind}.waymarkedtrails.org/#?map=13/${point.lat.toFixed(4)}/${point.lng.toFixed(4)}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Marked trails with elevation profiles"
                  >
                    Waymarked Trails <ExternalLink size={12} />
                  </a>
                  {kind === "cycling" && (
                    <a
                      href={`https://www.cyclosm.org/#map=14/${point.lat.toFixed(4)}/${point.lng.toFixed(4)}/cyclosm`}
                      target="_blank"
                      rel="noreferrer"
                      title="Cycling map: bike lanes, parking, rental"
                    >
                      CyclOSM <ExternalLink size={12} />
                    </a>
                  )}
                  <a
                    href={`https://www.komoot.com/plan/@${point.lat.toFixed(4)},${point.lng.toFixed(4)},12z`}
                    target="_blank"
                    rel="noreferrer"
                    title="Plan your own route"
                  >
                    Komoot planner <ExternalLink size={12} />
                  </a>
                </>
              )}
              {(regional[anchor.country] || []).map((t) => (
                <a
                  key={t.name}
                  href={t.url}
                  target="_blank"
                  rel="noreferrer"
                  title={t.note}
                >
                  {t.name} <ExternalLink size={12} />
                </a>
              ))}
            </div>
            <h3 className="section-heading">
              {results
                ? `${routes.length} ${kind === "hiking" ? "hiking and walking" : "cycling"} routes within ${radius} km`
                : "Routes"}
            </h3>
            <div className="food-list">{routes.map(card)}</div>
            {results && !routes.length && !busy && (
              <div className="empty-state compact-empty">
                No marked routes within {radius} km. Try a larger radius, or
                plan your own with Komoot.
              </div>
            )}
            {spots.length > 0 && (
              <>
                <h3 className="section-heading">
                  {kind === "hiking"
                    ? "Peaks, viewpoints and trailheads"
                    : "Bike rental"}
                </h3>
                <div className="food-list">{spots.map(card)}</div>
              </>
            )}
            <p className="food-hint">
              Routes, peaks and rentals come from OpenStreetMap; times are rough
              estimates (4 km/h walking plus 1 h per 500 m climbed, 15 km/h
              cycling). Check trail conditions, closures and the last bus before
              you go.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

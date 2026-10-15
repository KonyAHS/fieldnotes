import { useEffect, useMemo, useState } from "react";
import {
  Utensils,
  Search,
  ExternalLink,
  Plus,
  Check,
  MapPin,
  BedDouble,
  Navigation,
} from "lucide-react";
import {
  type Workspace,
  type Trip,
  type Scenario,
  type Place,
  type Entry,
  days,
  entriesOn,
  shortDate,
  weekday,
  distance,
  mapLinks,
  emptyPlace,
  isWeekend,
} from "../model";
import { mutate } from "../sync";
import { cityPoint } from "../geo";
import { PlaceMap } from "./Places";
import { halalLabels } from "./Editors";
import { RadiusInput } from "./RadiusInput";
type FoodResult = {
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
  link: string;
  source: "osm" | "google";
  rating?: number;
  ratingCount?: number;
};
export type Anchor = {
  key: string;
  label: string;
  date: string;
  // Suggested time for a meal after this stop.
  time: string;
  country: string;
  city: string;
  placeId: string;
  stay: boolean;
};
type Point = { lat: number; lng: number; approx: boolean };
// The restaurant's Google Maps page, for reviews and photos. OpenStreetMap
// results have no Google ID, so search the name at their position instead.
export const googleMapsLink = (r: FoodResult) =>
  r.source === "google" && r.link
    ? r.link
    : `https://www.google.com/maps/search/${encodeURIComponent(r.nativeName || r.name)}/@${r.lat},${r.lng},18z`;
// "japanese, ramen" or "Japanese restaurant" → ["japanese", "ramen"].
// Results without a cuisine are grouped as "other".
const aliases: Record<string, string> = {
  coffee: "cafe",
  "coffee shop": "cafe",
  café: "cafe",
  noodles: "noodle",
};
const generic = new Set(["restaurant", "food", "establishment", "point of interest", ""]);
function cuisinesOf(r: FoodResult) {
  const found = r.cuisine
    .split(/[,;]/)
    .map((c) =>
      c
        .trim()
        .toLowerCase()
        .replaceAll("_", " ")
        .replace(/\s+(restaurant|shop|house)$/, ""),
    )
    .filter((c) => !generic.has(c))
    .map((c) => aliases[c] || c);
  return found.length ? [...new Set(found)] : ["other"];
}
const cuisineLabel = (c: string) =>
  c === "other"
    ? "Not listed"
    : c === "cafe"
      ? "Café & coffee"
      : c[0].toUpperCase() + c.slice(1);
const km = (d: number) =>
  d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`;
function mealTime(e: Entry, date: string) {
  if (e.allDay || e.type === "stay") return "19:00";
  const end = e.endDate > date ? "23:00" : e.endTime;
  const h = Math.min(
    22,
    Number(end.slice(0, 2)) + (Number(end.slice(3)) ? 1 : 0),
  );
  return `${String(h).padStart(2, "0")}:00`;
}
export function anchorsFor(scenario: Scenario, date: string): Anchor[] {
  return entriesOn(scenario, date)
    .filter(
      (e) =>
        e.status !== "idea" &&
        ["activity", "stay", "food"].includes(e.type) &&
        (e.placeId || e.city),
    )
    .sort(
      (a, b) =>
        (a.type === "stay" ? 1 : 0) - (b.type === "stay" ? 1 : 0) ||
        a.startTime.localeCompare(b.startTime),
    )
    .map((e) => ({
      key: `${e.id}|${date}`,
      label: e.title,
      date,
      time: mealTime(e, date),
      country: e.country,
      city: e.city,
      placeId: e.placeId,
      stay: e.type === "stay",
    }));
}
export function placeAnchor(
  p: Place,
  scenario: Scenario,
  trip: Trip,
  time = "19:00",
): Anchor {
  return {
    key: "place|" + p.id,
    label: p.name,
    date: scenario.entries.find((e) => e.placeId === p.id)?.date || trip.start,
    time,
    country: p.country,
    city: p.city,
    placeId: p.id,
    stay: p.kind === "hotel",
  };
}
// The anchor's coordinates: its saved place, else the centre of its city.
export function useAnchorPoint(anchor: Anchor | null, place?: Place | null) {
  const [point, setPoint] = useState<Point | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!anchor) return;
    setMessage("");
    if (place && place.lat !== null && place.lng !== null) {
      setPoint({
        lat: place.lat,
        lng: place.lng,
        approx: place.geo === "approx",
      });
      return;
    }
    setPoint(null);
    if (!anchor.city) {
      setMessage("This plan has no place or city to search near.");
      return;
    }
    let cancelled = false;
    setMessage(`Locating ${anchor.city}…`);
    cityPoint(anchor.city, anchor.country)
      .then((hit) => {
        if (cancelled) return;
        if (!hit) setMessage(`Could not locate ${anchor.city}.`);
        else {
          setPoint({ lat: hit.lat, lng: hit.lng, approx: true });
          setMessage("");
        }
      })
      .catch((e) => !cancelled && setMessage(e.message));
    return () => {
      cancelled = true;
    };
  }, [anchor?.key, place?.lat, place?.lng]);
  return { point, message };
}
export function StopList({
  trip,
  scenario,
  selected,
  onSelect,
  badge,
}: {
  trip: Trip;
  scenario: Scenario;
  selected: string | undefined;
  onSelect: (a: Anchor) => void;
  badge?: (date: string) => React.ReactNode;
}) {
  return (
    <aside className="food-days" aria-label="Itinerary stops">
      {days(trip.start, trip.end).map((d) => {
        const stops = anchorsFor(scenario, d);
        return (
          <section
            key={d}
            className={`food-day ${isWeekend(d) ? "weekend" : ""}`}
          >
            <div className="food-day-date">
              <span>{weekday(d)}</span>
              <strong>{shortDate(d)}</strong>
              {badge?.(d)}
            </div>
            {stops.map((a) => (
              <button
                key={a.key}
                className={`food-stop ${selected === a.key ? "selected" : ""}`}
                onClick={() => onSelect(a)}
              >
                {a.stay ? <BedDouble size={14} /> : <MapPin size={14} />}
                <span>{a.label}</span>
                <Search size={13} />
              </button>
            ))}
            {!stops.length && <span className="food-empty">No plans yet</span>}
          </section>
        );
      })}
    </aside>
  );
}
export function Food({
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
  onPlan: (p: Place, date: string, time: string) => void;
  onEditPlace: (p: Place) => void;
}) {
  const initialPlace = data.places.find((p) => p.id === initialPlaceId);
  const [anchor, setAnchor] = useState<Anchor | null>(() =>
    initialPlace ? placeAnchor(initialPlace, scenario, trip) : null,
  );
  const [halalOnly, setHalalOnly] = useState(true);
  const [radius, setRadius] = useState(1000);
  const [results, setResults] = useState<FoodResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showMap, setShowMap] = useState(true);
  const [cuisines, setCuisines] = useState<Set<string>>(new Set());
  const [allCuisines, setAllCuisines] = useState(false);
  const shownLimit = 300;
  const place = anchor && data.places.find((p) => p.id === anchor.placeId);
  const located = useAnchorPoint(anchor, place);
  const point = located.point;
  const message = located.message || error;
  useEffect(() => setResults(null), [anchor?.key]);
  // Search as soon as the location is known or the filters change.
  useEffect(() => {
    if (!point) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    fetch(
      "/api/nearby?" +
        new URLSearchParams({
          lat: point.lat.toFixed(5),
          lng: point.lng.toFixed(5),
          radius: String(radius),
          halal: halalOnly ? "1" : "0",
        }),
      { signal: AbortSignal.timeout(60000) },
    )
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw Error(body.error || "Restaurant search unavailable");
        return body.results as FoodResult[];
      })
      .then((found) => {
        if (cancelled) return;
        setResults(
          found
            .map((r) => ({ r, d: distance(point, r) ?? Infinity }))
            .sort((a, b) => a.d - b.d)
            .map((x) => x.r),
        );
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [point?.lat, point?.lng, radius, halalOnly]);
  // Cuisines in the results, most common first, for the filter.
  const cuisineCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of results || [])
      for (const c of cuisinesOf(r)) counts.set(c, (counts.get(c) || 0) + 1);
    return [...counts].sort(
      (a, b) =>
        (a[0] === "other" ? 1 : 0) - (b[0] === "other" ? 1 : 0) ||
        b[1] - a[1] ||
        a[0].localeCompare(b[0]),
    );
  }, [results]);
  // Selections missing from new results don't hide everything.
  const activeCuisines = [...cuisines].filter((c) =>
    cuisineCounts.some(([k]) => k === c),
  );
  const filtered = useMemo(
    () =>
      activeCuisines.length
        ? (results || []).filter((r) =>
            cuisinesOf(r).some((c) => activeCuisines.includes(c)),
          )
        : results || [],
    [results, activeCuisines.join("|")],
  );
  const toggleCuisine = (c: string) =>
    setCuisines((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  const chipLimit = 12;
  // Keep chosen cuisines visible even when they rank below the limit.
  const visibleCuisines = allCuisines
    ? cuisineCounts
    : cuisineCounts.filter(
        ([c], i) => i < chipLimit || activeCuisines.includes(c),
      );
  const savedNearby = useMemo(
    () =>
      point
        ? data.places.filter(
            (p) =>
              p.kind === "restaurant" &&
              (distance(point, p) ?? Infinity) <= radius / 1000,
          )
        : [],
    [data.places, point, radius],
  );
  const asPlace = (r: FoodResult): Place => ({
    ...emptyPlace(),
    id: r.id,
    name: r.name,
    nativeName: r.nativeName !== r.name ? r.nativeName : "",
    kind: "restaurant",
    country: anchor?.country || "",
    city: anchor?.city || "",
    address: r.address,
    phone: r.phone,
    url: r.url,
    lat: r.lat,
    lng: r.lng,
    geo: "auto",
    halal: r.halal === "yes" || r.halal === "only" ? "tagged" : "unknown",
    evidence: r.link,
    notes: [
      r.cuisine && `Cuisine: ${r.cuisine}`,
      r.openingHours && `Hours: ${r.openingHours}`,
      r.source === "google"
        ? "Found on Google Maps; halal status not verified."
        : r.halal === "yes" || r.halal === "only"
          ? "OpenStreetMap halal tag; certification not checked."
          : "Halal status not tagged; verify before visiting.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  function save(r: FoodResult) {
    const p = asPlace(r);
    mutate((d) => {
      if (!d.places.some((x) => x.id === p.id)) d.places.push(p);
    });
    return data.places.find((x) => x.id === p.id) || p;
  }
  const planned = new Set(scenario.entries.map((e) => e.placeId));
  const anchorPlace: Place | undefined = point
    ? {
        ...emptyPlace(),
        id: "anchor",
        name: anchor?.label || "",
        country: anchor?.country || "",
        lat: point.lat,
        lng: point.lng,
      }
    : undefined;
  return (
    <div className="food-view">
      <StopList
        trip={trip}
        scenario={scenario}
        selected={anchor?.key}
        onSelect={setAnchor}
        badge={(d) => {
          const meals = entriesOn(scenario, d).filter(
            (e) => e.type === "food" && e.status !== "idea",
          );
          return (
            meals.length > 0 && (
              <span
                className="tag"
                title={meals.map((m) => m.title).join(", ")}
              >
                <Utensils size={11} /> {meals.length}
              </span>
            )
          );
        }}
      />
      <div className="food-results">
        {!anchor ? (
          <div className="empty-state">
            <Utensils size={22} />
            <p>
              Choose a stop from your itinerary to find restaurants close to it.
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
                {point?.approx && (
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
                    className={halalOnly ? "selected" : ""}
                    onClick={() => setHalalOnly(true)}
                  >
                    Halal-friendly
                  </button>
                  <button
                    className={!halalOnly ? "selected" : ""}
                    onClick={() => setHalalOnly(false)}
                  >
                    All restaurants
                  </button>
                </div>
                <RadiusInput
                  metres={radius}
                  min={50}
                  max={50000}
                  onChange={setRadius}
                />
                <button
                  className={`button ${showMap ? "active-button" : ""}`}
                  onClick={() => setShowMap(!showMap)}
                >
                  <MapPin size={15} />
                  Map
                </button>
                {place && (
                  <a
                    className="button"
                    href={mapLinks(place, true)[0].url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {mapLinks(place, true)[0].name}
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </div>
            {message && (
              <div className="notice" role="status">
                {message}
              </div>
            )}
            {showMap && point && (
              <PlaceMap
                places={[
                  ...filtered.slice(0, shownLimit).map(asPlace),
                  ...savedNearby,
                  anchorPlace!,
                ]}
                anchor={anchorPlace}
                online={navigator.onLine}
                radius={radius}
                onSelect={(p) =>
                  document
                    .getElementById("food-" + p.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
              />
            )}
            {savedNearby.length > 0 && (
              <>
                <h3 className="section-heading">
                  Your saved restaurants nearby
                </h3>
                <div className="food-list">
                  {savedNearby.map((p) => (
                    <article
                      className="food-card"
                      key={p.id}
                      id={"food-" + p.id}
                    >
                      <div className="food-card-main">
                        <a
                          className="food-name"
                          href={
                            /google\.[a-z.]+\/maps|maps\.app\.goo\.gl/.test(
                              p.evidence,
                            )
                              ? p.evidence
                              : googleMapsLink({
                                  name: p.name,
                                  nativeName: p.nativeName,
                                  lat: p.lat!,
                                  lng: p.lng!,
                                  link: "",
                                  source: "osm",
                                } as FoodResult)
                          }
                          target="_blank"
                          rel="noreferrer"
                          title="Open in Google Maps for reviews and photos"
                        >
                          {p.name}
                          <ExternalLink size={12} />
                        </a>
                        <span className="food-meta">
                          {km(distance(point!, p)!)} ·{" "}
                          <span
                            className={`halal-badge ${["certified", "self-certified"].includes(p.halal) ? "verified" : ""}`}
                          >
                            {halalLabels[p.halal]}
                          </span>
                        </span>
                      </div>
                      <button
                        className="button primary small"
                        onClick={() => onPlan(p, anchor.date, anchor.time)}
                      >
                        {planned.has(p.id) ? (
                          <Check size={14} />
                        ) : (
                          <Plus size={14} />
                        )}
                        Add to {shortDate(anchor.date)}
                      </button>
                    </article>
                  ))}
                </div>
              </>
            )}
            <h3 className="section-heading">
              {busy
                ? "Searching…"
                : results
                  ? `${activeCuisines.length ? `${filtered.length} of ` : ""}${results.length} ${halalOnly ? "halal-friendly places" : "places to eat"} within ${km(radius / 1000)}${filtered.length > shownLimit ? ` · nearest ${shownLimit} shown` : ""}`
                  : "Nearby"}
            </h3>
            {halalOnly && results && (
              <p className="food-hint">
                {results[0]?.source === "google"
                  ? "Google Maps results for “halal restaurant”. Google doesn't record halal status, so confirm before relying on it."
                  : "Includes places tagged halal on OpenStreetMap and places whose cuisine is often halal. A tag is not certification; confirm before relying on it."}
              </p>
            )}
            {cuisineCounts.length > 1 && (
              <div
                className="cuisine-filter"
                role="group"
                aria-label="Filter by cuisine"
              >
                <button
                  className={`cuisine-chip ${activeCuisines.length ? "" : "selected"}`}
                  aria-pressed={!activeCuisines.length}
                  onClick={() => setCuisines(new Set())}
                >
                  All cuisines
                </button>
                {visibleCuisines.map(([c, n]) => (
                  <button
                    key={c}
                    className={`cuisine-chip ${activeCuisines.includes(c) ? "selected" : ""}`}
                    aria-pressed={activeCuisines.includes(c)}
                    onClick={() => toggleCuisine(c)}
                  >
                    {cuisineLabel(c)} <span>{n}</span>
                  </button>
                ))}
                {cuisineCounts.length > chipLimit && (
                  <button
                    className="text-button"
                    onClick={() => setAllCuisines(!allCuisines)}
                  >
                    {allCuisines
                      ? "Fewer"
                      : `+${cuisineCounts.length - visibleCuisines.length} more`}
                  </button>
                )}
              </div>
            )}
            <div className="food-list">
              {filtered.slice(0, shownLimit).map((r) => {
                const saved = data.places.some((p) => p.id === r.id);
                const tagged = r.halal === "yes" || r.halal === "only";
                return (
                  <article className="food-card" key={r.id} id={"food-" + r.id}>
                    <div className="food-card-main">
                      <a
                        className="food-name"
                        href={googleMapsLink(r)}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in Google Maps for reviews and photos"
                      >
                        {r.name}
                        <ExternalLink size={12} />
                      </a>
                      {r.nativeName !== r.name && (
                        <span className="native-name">{r.nativeName}</span>
                      )}
                      <span className="food-meta">
                        {km(distance(point!, r)!)}
                        {r.rating !== undefined && " · "}
                        {r.rating !== undefined && (
                          <span
                            className="food-rating"
                            title={`${r.rating} stars from ${r.ratingCount ?? 0} Google reviews`}
                          >
                            ★ {r.rating.toFixed(1)}
                            {r.ratingCount ? ` (${r.ratingCount})` : ""}
                          </span>
                        )}
                        {r.cuisine && ` · ${r.cuisine.replaceAll("_", " ")}`}
                        {tagged ? (
                          <span className="halal-badge verified">
                            Halal tagged{r.halal === "only" ? " (only)" : ""}
                          </span>
                        ) : r.halal === "no" ? (
                          <span className="halal-badge">Not halal</span>
                        ) : halalOnly ? (
                          <span className="halal-badge">
                            Check halal status
                          </span>
                        ) : null}
                      </span>
                      {r.openingHours && (
                        <span className="food-hours">{r.openingHours}</span>
                      )}
                    </div>
                    <div className="food-actions">
                      <a
                        className="icon-button"
                        aria-label={`Directions to ${r.name}`}
                        href={mapLinks(asPlace(r))[0].url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Navigation size={15} />
                      </a>
                      {!saved && (
                        <button
                          className="button small"
                          onClick={() => save(r)}
                        >
                          Save
                        </button>
                      )}
                      <button
                        className="button primary small"
                        onClick={() =>
                          onPlan(save(r), anchor.date, anchor.time)
                        }
                      >
                        <Plus size={14} />
                        Add to {shortDate(anchor.date)}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {results && !results.length && !busy && (
              <div className="empty-state compact-empty">
                Nothing found within {km(radius / 1000)}.{" "}
                {halalOnly
                  ? "Try a larger radius or all restaurants."
                  : "Try a larger radius."}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

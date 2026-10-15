import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  Search,
  Plus,
  MapPin,
  ExternalLink,
  Utensils,
  Navigation,
  Pencil,
  Check,
  LocateFixed,
  Mountain,
  Phone,
  LoaderCircle,
} from "lucide-react";
import { geocode, mapsStatus, type MapsStatus } from "../geo";
import { mutate, notify } from "../sync";
import {
  type Workspace,
  type Place,
  type Trip,
  type Scenario,
  type Entry,
  emptyPlace,
  mapLinks,
  safeUrl,
  distance,
  shortDate,
  weekday,
} from "../model";
import { halalLabels } from "./Editors";
const noLines: [number, number][][] = [];
const center: Record<string, L.LatLngExpression> = {
  Japan: [35.68, 139.76],
  Korea: [37.56, 126.98],
  China: [31.23, 121.47],
};
export function PlaceMap({
  places,
  anchor,
  online,
  onSelect,
  radius = 2000,
  overlay,
  lines = noLines,
}: {
  places: Place[];
  anchor: Place | undefined;
  online: boolean;
  onSelect: (p: Place) => void;
  radius?: number;
  // Extra tile layer drawn over the base map, such as marked trails.
  overlay?: { url: string; attribution: string };
  // Highlighted route, fitted into view when present.
  lines?: [number, number][][];
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useEffect(() => {
    if (!container.current) return;
    const m = L.map(container.current, { scrollWheelZoom: false }).setView(
      center[anchor?.country || "Japan"] || [30, 130],
      5,
    );
    map.current = m;
    // Redraw tiles when the layout changes the map's size.
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(container.current);
    if (online)
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, [online]);
  useEffect(() => {
    const m = map.current;
    if (!m || !online || !overlay) return;
    const layer = L.tileLayer(overlay.url, {
      maxZoom: 18,
      opacity: 0.85,
      attribution: overlay.attribution,
    }).addTo(m);
    return () => {
      layer.remove();
    };
  }, [online, overlay?.url]);
  useEffect(() => {
    const m = map.current;
    if (!m || !lines.length) return;
    const route = L.featureGroup(
      lines.map((l) =>
        L.polyline(l, { color: "#c2410c", weight: 4, opacity: 0.9 }),
      ),
    ).addTo(m);
    m.fitBounds(route.getBounds(), { padding: [24, 24] });
    return () => {
      route.remove();
    };
  }, [lines]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const group = L.featureGroup().addTo(m);
    const valid = places.filter((p) => p.lat !== null && p.lng !== null);
    for (const p of valid) {
      const isAnchor = anchor?.id === p.id;
      const marker = L.circleMarker([p.lat!, p.lng!], {
        radius: isAnchor ? 10 : p.kind === "restaurant" ? 7 : 6,
        color: "#fff",
        weight: 2,
        fillColor: isAnchor
          ? "#a86944"
          : p.kind === "restaurant"
            ? "#56734e"
            : "#354f43",
        fillOpacity: 1,
      }).addTo(group);
      const el = document.createElement("button");
      el.textContent = p.name;
      el.className = "map-popup";
      el.onclick = () => onSelectRef.current(p);
      marker.bindPopup(el);
    }
    if (
      anchor?.lat !== null &&
      anchor?.lat !== undefined &&
      anchor.lng !== null
    ) {
      if (!lines.length)
        m.setView(
          [anchor.lat, anchor.lng],
          radius > 15000
            ? 10
            : radius > 7000
              ? 11
              : radius > 3500
                ? 12
                : radius > 1500
                  ? 14
                  : 15,
        );
      L.circle([anchor.lat, anchor.lng], {
        radius,
        color: "#354f43",
        fillOpacity: 0.02,
        weight: 1,
        dashArray: "4 6",
      }).addTo(group);
    } else if (valid.length)
      m.fitBounds(group.getBounds(), { padding: [30, 30], maxZoom: 14 });
    return () => {
      group.remove();
    };
  }, [places, anchor, online, radius, lines]);
  return (
    <div className="place-map" ref={container} aria-label="Saved places map" />
  );
}
// Places worth looking up: no phone yet, a real place (not a search-area
// placeholder) with a known position to check results against.
const needsPhone = (p: Place) =>
  !p.phone.trim() && p.lat !== null && !/search area|placeholder/i.test(p.name);
// Looks up each place without a phone number and keeps a result only when it
// is within 300 m of the saved position, so nothing wrong is filled in.
function PhoneFill({ places }: { places: Place[] }) {
  const missing = places.filter(needsPhone);
  const [status, setStatus] = useState<MapsStatus | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState("");
  useEffect(() => {
    void mapsStatus().then(setStatus);
  }, []);
  const google = status?.provider === "google" && status.google.configured;
  async function run() {
    const queue = [...missing];
    const found = new Map<string, { phone: string; address: string }>();
    setResult("");
    setProgress({ done: 0, total: queue.length });
    for (const [i, p] of queue.entries()) {
      for (const q of [...new Set([p.name, p.nativeName].filter(Boolean))]) {
        try {
          const hits = await geocode(q, p.country, {
            lat: p.lat!,
            lng: p.lng!,
          });
          const hit = hits.find(
            (h) => h.phone && (distance(p, h) ?? Infinity) <= 0.3,
          );
          if (hit) {
            found.set(p.id, { phone: hit.phone!, address: hit.address });
            break;
          }
        } catch {
          // Try the next name, then move on.
        }
      }
      setProgress({ done: i + 1, total: queue.length });
    }
    if (found.size)
      mutate((d) => {
        for (const p of d.places) {
          const f = found.get(p.id);
          if (!f) continue;
          p.phone = f.phone;
          if (!p.address.trim()) p.address = f.address;
        }
      });
    setProgress(null);
    const text = `Found phone numbers for ${found.size} of ${queue.length} places.`;
    setResult(
      found.size < queue.length
        ? `${text} The rest have no number listed nearby; add them by hand if you need them.`
        : text,
    );
    if (found.size) notify(text);
  }
  if (!missing.length && !result) return null;
  return (
    <div className="phone-fill">
      <Phone size={15} />
      {progress ? (
        <span>
          <LoaderCircle size={14} className="spin" /> Looking up phone numbers…{" "}
          {progress.done} of {progress.total}
        </span>
      ) : result ? (
        <span>{result}</span>
      ) : (
        <span>
          {missing.length} places have no phone number.
          {!google &&
            " Phone numbers mostly come from Google Maps; select it in Settings for the best results."}
        </span>
      )}
      {!progress && missing.length > 0 && (
        <button className="button" onClick={() => void run()}>
          Fill missing phones
        </button>
      )}
    </div>
  );
}
export function Places({
  data,
  trip,
  scenario,
  onEdit,
  onAddPlan,
  onOpenPlan,
  onFindFood,
  onFindTrails,
}: {
  data: Workspace;
  trip: Trip;
  scenario: Scenario;
  onEdit: (p: Place) => void;
  onAddPlan: (p: Place) => void;
  onOpenPlan: (e: Entry) => void;
  onFindFood: (p: Place) => void;
  onFindTrails: (p: Place) => void;
}) {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [kind, setKind] = useState("");
  const [halal, setHalal] = useState("");
  const [city, setCity] = useState("");
  const [inPlan, setInPlan] = useState("");
  const [sort, setSort] = useState<"trip" | "name">("trip");
  const [showMap, setShowMap] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  // When each place is in the plan, and the order cities are visited in.
  const plannedOn = useMemo(() => {
    const dates = new Map<string, string[]>();
    for (const e of scenario.entries)
      if (e.placeId && e.status !== "idea")
        dates.set(e.placeId, [...(dates.get(e.placeId) || []), e.date].sort());
    return dates;
  }, [scenario]);
  const cityOrder = useMemo(() => {
    const order = new Map<string, string>();
    for (const e of [...scenario.entries].sort((a, b) =>
      a.date.localeCompare(b.date),
    ))
      if (e.city && !order.has(e.city.toLowerCase()))
        order.set(e.city.toLowerCase(), e.date);
    return order;
  }, [scenario]);
  const cities = useMemo(
    () =>
      [...new Set(data.places.map((p) => p.city).filter(Boolean))].sort(
        (a, b) =>
          (cityOrder.get(a.toLowerCase()) || "9").localeCompare(
            cityOrder.get(b.toLowerCase()) || "9",
          ) || a.localeCompare(b),
      ),
    [data.places, cityOrder],
  );
  const filtered = useMemo(
    () =>
      data.places
        .filter(
          (p) =>
            (!country || p.country === country) &&
            (!city || p.city === city) &&
            (!kind || p.kind === kind) &&
            (!inPlan || (inPlan === "yes") === plannedOn.has(p.id)) &&
            (kind !== "restaurant" ||
              !halal ||
              (halal === "verified"
                ? ["certified", "self-certified"].includes(p.halal)
                : p.halal === halal)) &&
            `${p.name} ${p.nativeName} ${p.city} ${p.address} ${p.nativeAddress} ${p.notes}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .sort((a, b) => {
          if (sort === "name") return a.name.localeCompare(b.name);
          // Trip order: planned places by date, then by when their city is visited.
          const when = (p: Place) =>
            plannedOn.get(p.id)?.[0] ??
            `${cityOrder.get(p.city.toLowerCase()) ?? "9999"}~`;
          return when(a).localeCompare(when(b)) || a.name.localeCompare(b.name);
        }),
    [
      data.places,
      country,
      city,
      kind,
      inPlan,
      halal,
      query,
      sort,
      plannedOn,
      cityOrder,
    ],
  );
  const card = (p: Place) => {
    const visits = scenario.entries
      .filter((e) => e.placeId === p.id && e.status !== "idea")
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.startTime.localeCompare(b.startTime),
      );
    return (
      <article
        className={`place-card ${selected === p.id ? "highlighted" : ""}`}
        key={p.id}
        id={`saved-place-${p.id}`}
        tabIndex={-1}
      >
        <div className="place-card-top">
          <span
            className={`place-kind ${p.kind === "restaurant" ? "food" : ""}`}
          >
            {p.kind === "restaurant" ? (
              <Utensils size={18} />
            ) : (
              <MapPin size={18} />
            )}
          </span>
          <div className="place-card-title">
            <h3>{p.name}</h3>
            {p.nativeName && p.nativeName !== p.name && (
              <span className="native-name">{p.nativeName}</span>
            )}
          </div>
          <button
            className="icon-button"
            aria-label={`Edit ${p.name}`}
            onClick={() => onEdit(p)}
          >
            <Pencil size={15} />
          </button>
        </div>
        <div className="place-location">
          {p.city} · {p.country}
          {plannedOn.has(p.id) && (
            <span className="planned-badge">
              <Check size={11} />
              {(() => {
                const d = plannedOn.get(p.id)!;
                return `${weekday(d[0])} ${shortDate(d[0])}${d.length > 1 ? ` +${d.length - 1}` : ""}`;
              })()}
            </span>
          )}
          <span
            className={`geo-status ${p.lat === null ? "missing" : ""}`}
            title={
              p.geo === "approx"
                ? "Exact place not found; using the city centre"
                : undefined
            }
          >
            {p.lat !== null
              ? p.geo === "approx"
                ? "Approx. location"
                : "Located"
              : p.geo === "failed"
                ? "Not found"
                : "Locating…"}
          </span>
        </div>
        {p.kind === "restaurant" && (
          <span
            className={`halal-badge ${["certified", "self-certified"].includes(p.halal) ? "verified" : ""}`}
          >
            {halalLabels[p.halal]}
            {p.checkedOn && ` · ${p.checkedOn}`}
          </span>
        )}
        {p.address && <p className="place-address">{p.address}</p>}
        {p.nativeAddress && p.nativeAddress !== p.address && (
          <p className="native-address">{p.nativeAddress}</p>
        )}
        {visits.length > 0 && (
          <div className="place-visits">
            <span>In {scenario.name}</span>
            {visits.map((entry) => (
              <button
                key={entry.id}
                className="text-button"
                aria-label={`Open ${entry.title} on ${shortDate(entry.date)}`}
                title={entry.title}
                onClick={() => onOpenPlan(entry)}
              >
                <Check size={13} />
                {shortDate(entry.date)}
                {entry.type === "stay"
                  ? `–${shortDate(entry.endDate)}`
                  : ` · ${entry.startTime}`}
                {entry.status === "booked" ? " · Booked" : ""}
              </button>
            ))}
          </div>
        )}
        {p.notes && (
          <details className="place-notes">
            <summary>Notes</summary>
            <p>{p.notes}</p>
          </details>
        )}
        <div className="place-actions">
          <a href={mapLinks(p)[0].url} target="_blank" rel="noreferrer">
            <Navigation size={14} />
            {mapLinks(p)[0].name}
          </a>
          {safeUrl(p.url) && (
            <a href={safeUrl(p.url)} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              Source
            </a>
          )}
          <div className="spacer" />
          {p.geo === "failed" && p.lat === null ? (
            <button className="text-button" onClick={() => onEdit(p)}>
              <LocateFixed size={14} />
              Set position
            </button>
          ) : (
            p.kind !== "restaurant" && (
              <button
                className="text-button"
                onClick={() => onFindFood(p)}
                aria-label={`Find food near ${p.name}`}
              >
                <Utensils size={14} />
                Food
              </button>
            )
          )}
          {p.lat !== null && (
            <button
              className="text-button"
              onClick={() => onFindTrails(p)}
              aria-label={`Find trails near ${p.name}`}
            >
              <Mountain size={14} />
              Trails
            </button>
          )}
          <button
            className="text-button"
            onClick={() => onAddPlan(p)}
            aria-label={
              visits.length
                ? `Add another visit to ${p.name}`
                : `Add ${p.name} to plan`
            }
            title={
              plannedOn.has(p.id)
                ? "Add another visit; use the dated buttons above to open existing plans"
                : "Add to the plan"
            }
          >
            <Plus size={14} />
            {visits.length ? "Add visit" : "Add to plan"}
          </button>
        </div>
      </article>
    );
  };
  return (
    <div className="places-view">
      <div className="places-toolbar">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="Search places"
            placeholder="Search places"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter country"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setCity("");
          }}
        >
          <option value="">All countries</option>
          {[...new Set(data.places.map((p) => p.country))].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          aria-label="Filter city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        >
          <option value="">All cities</option>
          {cities
            .filter(
              (c) =>
                !country ||
                data.places.some((p) => p.city === c && p.country === country),
            )
            .map((c) => (
              <option key={c}>{c}</option>
            ))}
        </select>
        <select
          aria-label="Filter by plan"
          value={inPlan}
          onChange={(e) => setInPlan(e.target.value)}
        >
          <option value="">In the plan or not</option>
          <option value="yes">In the plan</option>
          <option value="no">Not planned yet</option>
        </select>
        <select
          aria-label="Sort places"
          value={sort}
          onChange={(e) => setSort(e.target.value as "trip" | "name")}
        >
          <option value="trip">Trip order</option>
          <option value="name">A–Z</option>
        </select>
        <select
          aria-label="Filter place type"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setHalal("");
          }}
        >
          <option value="">All places</option>
          <option value="attraction">Activities</option>
          <option value="restaurant">Food</option>
          <option value="hotel">Hotels</option>
          <option value="station">Stations</option>
          <option value="other">Other</option>
        </select>
        {kind === "restaurant" && (
          <select
            aria-label="Filter halal status"
            value={halal}
            onChange={(e) => setHalal(e.target.value)}
          >
            <option value="">All halal statuses</option>
            <option value="verified">Certified / self-certified</option>
            {Object.entries(halalLabels).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        )}
        <button
          className={`button ${showMap ? "active-button" : ""}`}
          aria-pressed={showMap}
          onClick={() => setShowMap(!showMap)}
        >
          <MapPin size={16} />
          Map
        </button>
        <button className="button primary" onClick={() => onEdit(emptyPlace())}>
          <Plus size={16} />
          Add place
        </button>
      </div>
      {showMap && (
        <>
          <PlaceMap
            places={filtered}
            anchor={undefined}
            online={online}
            onSelect={(p) => {
              setSelected(p.id);
              const card = document.getElementById(`saved-place-${p.id}`);
              card?.scrollIntoView({ behavior: "smooth", block: "center" });
              card?.focus({ preventScroll: true });
            }}
          />
          {!online && (
            <div className="notice">
              Map tiles need internet. Saved places and addresses are available
              offline.
            </div>
          )}
        </>
      )}
      <PhoneFill places={data.places} />
      <div className="list-heading" id="place-results">
        <h2>Saved places</h2>
        <span>
          {filtered.length}
          {filtered.length !== data.places.length &&
            ` of ${data.places.length}`}
        </span>
        {(query || country || city || kind || inPlan || halal) && (
          <button
            className="text-button"
            onClick={() => {
              setQuery("");
              setCountry("");
              setCity("");
              setKind("");
              setInPlan("");
              setHalal("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="place-cards">{filtered.map((p) => card(p))}</div>
      {!filtered.length && (
        <div className="empty-state">No places match these filters.</div>
      )}
    </div>
  );
}

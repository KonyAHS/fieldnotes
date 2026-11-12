// One day's places on a map, with public transport between them (Google
// directions, cached by the server so each journey is asked once) and the
// day's planned journeys: flights as arcs, trains along their tracks.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { ExternalLink, Footprints, Maximize2 } from "lucide-react";
import { Modal } from "./Modal";
import { type Place, type Scenario, shortDate, weekday } from "../model";
import {
  type DayLeg,
  type TransitRoute,
  type TransitStep,
  TransitError,
  dayRoute,
  directionsUrl,
  fetchTransit,
  legMode,
  legWhen,
} from "../dayRoute";
import { BufferedTiles, smoothWheel } from "../mapControls";
import { viaLabel, viaStops } from "../via";
import { styleKey, styles, useLocate } from "../routeGeometry";
import { type Point, km } from "../tripRoute";
type Result =
  | { state: "loading" }
  | { state: "done"; route: TransitRoute }
  | { state: "error"; message: string; code: string };
const walkColor = "#6d6a75";
const stepColor = (s: TransitStep) => {
  if (s.mode === "walk") return walkColor;
  if (s.line?.color) return s.line.color;
  const t = s.line?.vehicleType || "";
  return styles[
    /BUS|TROLLEY/.test(t) ? "Bus" : /FERRY/.test(t) ? "Ferry" : "Train"
  ].color;
};
const duration = (min: number) =>
  min < 60
    ? `${min} min`
    : `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ""}`.trim();
const distance = (m: number) =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
export function DayMap({
  scenario,
  places,
  date,
  onClose,
}: {
  scenario: Scenario;
  places: Place[];
  date: string;
  onClose: () => void;
}) {
  // City centres stand in for journeys with no saved place (flights, most
  // trains between cities); train lines follow the tracks, as on the route map.
  const locate = useLocate();
  const route = useMemo(
    () =>
      dayRoute(scenario, places, date, (city, country) =>
        locate.point(city, country),
      ),
    // locate.version changes when a city or track lookup finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario, places, date, locate.version],
  );
  // What to look up, so finished city/track lookups don't ask again.
  const asks = useMemo(
    () =>
      route.legs.map((leg) => {
        const when = legWhen(leg);
        return when && { from: leg.from.point, to: leg.to.point, when };
      }),
    [route],
  );
  const asksKey = JSON.stringify(asks);
  const [results, setResults] = useState<Record<number, Result>>({});
  // Looked up a few at a time; repeats come from the caches.
  useEffect(() => {
    let cancelled = false;
    const todo = asks.flatMap((a, i) => (a ? [{ ...a, i }] : []));
    setResults(
      Object.fromEntries(todo.map((x) => [x.i, { state: "loading" }])),
    );
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < todo.length) {
        const { from, to, when, i } = todo[next++];
        let r: Result;
        try {
          r = { state: "done", route: await fetchTransit(from, to, when) };
        } catch (e) {
          r = {
            state: "error",
            message: navigator.onLine
              ? e instanceof Error
                ? e.message
                : String(e)
              : "Offline. Directions load when you're connected.",
            code: e instanceof TransitError ? e.code : "",
          };
        }
        if (!cancelled) setResults((old) => ({ ...old, [i]: r }));
        // Without a key nothing else can be looked up.
        if (
          r.state === "error" &&
          (r.code === "nokey" || r.code === "disabled")
        )
          cancelled = true;
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asksKey]);
  const blocked = Object.values(results).find(
    (r) => r.state === "error" && (r.code === "nokey" || r.code === "disabled"),
  );
  const noKey = !!blocked;
  const disabled = Object.values(results).some(
    (r) => r.state === "error" && r.code === "disabled",
  );
  const [selected, setSelected] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const lines = useRef<L.LayerGroup | null>(null);
  // Set once the map has been moved or a stretch picked, so finished lookups
  // don't pull the view away.
  const moved = useRef(false);
  const whole = useRef<L.LatLngBounds | null>(null);
  const legBounds = useRef<L.LatLngBounds[]>([]);
  const padding = L.point(36, 36);
  useEffect(() => {
    if (!container.current) return;
    const renderer = L.svg({ padding: 1.5 });
    const m = L.map(container.current, {
      // Zooming is continuous while it happens (see smoothWheel) but comes
      // to rest on whole levels, where tiles are sharp.
      zoomSnap: 1,
      scrollWheelZoom: false,
      fadeAnimation: false,
      maxZoom: 19,
      renderer,
    }).setView([35, 135], 5);
    map.current = m;
    m.on("dragstart", () => (moved.current = true));
    const unwheel = smoothWheel(m);
    container.current.addEventListener("wheel", () => (moved.current = true));
    // The dialog lays out after the map is made: fit again once it has a size.
    const resize = new ResizeObserver(() => {
      m.invalidateSize();
      if (!moved.current && whole.current)
        m.fitBounds(whole.current, { padding, maxZoom: 16, animate: false });
    });
    resize.observe(container.current);
    if (navigator.onLine)
      new BufferedTiles("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        keepBuffer: 6,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
    lines.current = L.layerGroup().addTo(m);
    markers.current = L.layerGroup().addTo(m);
    return () => {
      unwheel();
      resize.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick = (i: number | null, fromMap = false) => {
    setSelected(i);
    const m = map.current;
    const b = i === null ? whole.current : legBounds.current[i];
    if (!m || !b) return;
    moved.current = i !== null;
    m.flyToBounds(b, { padding, maxZoom: 16, duration: 0.6 });
    if (fromMap && i !== null)
      list.current?.children[i]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
  };
  const stopsKey = JSON.stringify(
    route.stops.map((s) => [s.n, s.name, s.point, s.kind, s.approx]),
  );
  useEffect(() => {
    const group = markers.current;
    if (!group) return;
    group.clearLayers();
    const last = route.stops.length - 1;
    for (const [i, s] of route.stops.entries())
      L.marker(s.point, {
        icon: L.divIcon({
          className: `route-stop ${s.kind === "hotel" ? (i === last && i ? "last" : "first") : ""} ${s.approx ? "approx" : ""}`,
          html: `<span>${s.n}</span>`,
          iconSize: [22, 22],
        }),
        title: `${s.n}. ${s.name}${s.approx ? " (city centre)" : ""}`,
        zIndexOffset: 1000,
      })
        // A stop picks the stretch leaving it (the last, the one arriving).
        .on(
          "click",
          () =>
            route.legs.length && pick(Math.min(i, route.legs.length - 1), true),
        )
        .addTo(group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey]);
  // Lines: looked-up routes step by step in their lines' colours, planned
  // journeys in their mode's style (flights as arcs, trains on the tracks),
  // anything else as a faint straight line. The picked stretch stands out.
  useEffect(() => {
    const m = map.current,
      group = lines.current;
    if (!m || !group) return;
    group.clearLayers();
    const all: Point[] = route.stops.map((s) => s.point);
    legBounds.current = [];
    const dim = (i: number) => selected !== null && selected !== i;
    route.legs.forEach((leg, i) => {
      const r = results[i];
      const mine: Point[] = [leg.from.point, leg.to.point];
      const line = (points: Point[], o: L.PolylineOptions, tip?: string) => {
        mine.push(...points);
        const p = L.polyline(points, {
          ...o,
          weight: (o.weight || 3) + (selected === i ? 2 : 0),
          opacity: dim(i) ? 0.3 : o.opacity,
          lineCap: "round",
          bubblingMouseEvents: false,
        })
          .on("click", () => pick(i, true))
          .addTo(group);
        if (tip) p.bindTooltip(tip, { sticky: true });
      };
      if (r?.state === "done" && r.route.found) {
        for (const s of r.route.steps)
          if (s.points.length > 1)
            line(
              s.points,
              {
                color: stepColor(s),
                weight: s.mode === "walk" ? 3 : 5,
                opacity: 0.9,
                dashArray: s.mode === "walk" ? "1 7" : undefined,
              },
              s.mode === "walk"
                ? `Walk ${duration(s.minutes)}`
                : `${s.line?.short || s.line?.name || s.line?.vehicle} · ${s.from} → ${s.to}`,
            );
      } else if (leg.planned.length) {
        const mode = legMode(leg);
        const style = styles[styleKey(mode)];
        // Tracks and arcs suit journeys between cities; a rail router sends
        // short city rides on long detours, so those stay straight.
        // Connections on the way (Dubai on a flight to Tokyo) are passed through.
        const between = leg.planned.filter((e) => e.scope === "intercity");
        const via = locate.stops(between);
        const path = between.length
          ? locate.route(mode, [
              leg.from.point,
              ...via.map((v) => v.point),
              leg.to.point,
            ])
          : [leg.from.point, leg.to.point];
        for (const v of via)
          L.marker(v.point, {
            icon: L.divIcon({
              className: `via-stop ${v.source === "assumed" ? "assumed" : ""}`,
              iconSize: [12, 12],
            }),
            zIndexOffset: 500,
          })
            .bindTooltip(
              `Via ${viaLabel(v)}${v.source === "assumed" ? " · assumed from the airline" : ""}`,
            )
            .on("click", () => pick(i, true))
            .addTo(group);
        const tip = leg.planned.map((e) => e.title).join(" · ");
        line(
          path,
          {
            color: style.color,
            weight: style.weight + 1,
            dashArray: style.dash,
            opacity: 0.9,
          },
          tip,
        );
        // Tracks run from station to station: join them to the stops.
        if (path.length > 2)
          for (const [a, b] of [
            [leg.from.point, path[0]],
            [path.at(-1)!, leg.to.point],
          ] as [Point, Point][])
            if (km(a, b) > 0.05)
              line([a, b], {
                color: style.color,
                weight: 2,
                dashArray: "1 6",
                opacity: 0.7,
              });
      } else
        line([leg.from.point, leg.to.point], {
          color: styles.None.color,
          weight: styles.None.weight,
          dashArray: styles.None.dash,
          opacity: 0.6,
        });
      all.push(...mine);
      legBounds.current[i] = L.latLngBounds(mine);
    });
    if (all.length === 0) return;
    const before = whole.current;
    whole.current = L.latLngBounds(all);
    if (moved.current) return;
    if (!before)
      m.fitBounds(whole.current, { padding, maxZoom: 16, animate: false });
    else if (!before.equals(whole.current, 1e-4))
      m.flyToBounds(whole.current, { padding, maxZoom: 16, duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, results, selected, locate.version]);
  return (
    <Modal
      title={`${weekday(date)} ${shortDate(date)}`}
      onClose={onClose}
      wide
      className="day-map-modal"
    >
      <div className="day-map-layout">
        <div className="day-map-pane">
          <div ref={container} className="day-map" />
          {route.stops.length > 1 && (
            <button
              className="day-map-all"
              onClick={() => pick(null)}
              title="Show the whole day"
            >
              <Maximize2 size={14} /> Whole day
            </button>
          )}
        </div>
        <div className="day-map-side">
          {route.stops.length === 0 && (
            <p className="muted">
              No hotel or plans with a saved position on this day.
            </p>
          )}
          {noKey && (
            <p className="day-map-note">
              {disabled ? (
                <>
                  Your Google Maps key doesn't have the Routes API turned on.{" "}
                  <a
                    href="https://console.cloud.google.com/apis/library/routes.googleapis.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Turn it on in Google Cloud
                  </a>{" "}
                  (same project as the key), then open this day again.
                </>
              ) : (
                "Add a Google Maps API key in Settings to see public transport."
              )}{" "}
              Until then, local rides are drawn straight.
            </p>
          )}
          {route.legs.length > 0 && (
            <ol className="day-legs" ref={list}>
              {route.legs.map((leg, i) => (
                <LegItem
                  key={i}
                  leg={leg}
                  result={results[i]}
                  noKey={noKey}
                  selected={selected === i}
                  onFocus={() => pick(selected === i ? null : i)}
                />
              ))}
            </ol>
          )}
          {route.stops.length === 1 && (
            <p className="muted">
              Only one place on this day, so there is nothing to route.
            </p>
          )}
          {route.unplaced.length > 0 && (
            <p className="day-map-note">
              Not on the map (no saved position):{" "}
              {route.unplaced.map((e) => e.title).join(", ")}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
function LegItem({
  leg,
  result,
  noKey,
  selected,
  onFocus,
}: {
  leg: DayLeg;
  result: Result | undefined;
  noKey: boolean;
  selected: boolean;
  onFocus: () => void;
}) {
  const timing = leg.when
    ? leg.when.by === "depart"
      ? `Leave ${leg.when.time}`
      : `Arrive by ${leg.when.time}`
    : "";
  const found = result?.state === "done" && result.route.found;
  const between = leg.planned.some((e) => e.scope === "intercity");
  return (
    <li className={`day-leg ${selected ? "selected" : ""}`}>
      <button
        className="day-leg-head"
        onClick={onFocus}
        aria-pressed={selected}
        title="Show on map"
      >
        <span className="day-leg-n">{leg.from.n}</span>
        <span className="day-leg-name">{leg.from.name}</span>
        <span aria-hidden>→</span>
        <span className="day-leg-n">{leg.to.n}</span>
        <span className="day-leg-name">{leg.to.name}</span>
        {timing && <span className="day-leg-time">{timing}</span>}
      </button>
      <div className="day-leg-body">
        {leg.planned.map((e) => {
          const via = viaStops(e);
          return (
            <span key={e.id} className="day-leg-planned">
              Planned: {e.mode || "Transport"} · {e.title} · {e.startTime}–
              {e.endTime}
              {via.length > 0 && (
                <span className="day-leg-via">
                  Via {via.map(viaLabel).join(" · ")}
                  {via.some((v) => v.source === "assumed") &&
                    " (assumed from the airline)"}
                </span>
              )}
            </span>
          );
        })}
        {leg.planned.length > 0 ? (
          found && (
            <TransitSteps
              route={result.route as Extract<TransitRoute, { found: true }>}
              tz={leg.when!.tz}
            />
          )
        ) : !leg.when ? (
          <span className="muted">
            {leg.from.approx || leg.to.approx
              ? "Only the city is known here, so no directions."
              : "No times to plan from."}
          </span>
        ) : !result || noKey ? null : result.state === "loading" ? (
          <span className="muted">Looking up public transport…</span>
        ) : result.state === "error" ? (
          <span className="day-leg-error">{result.message}</span>
        ) : !result.route.found ? (
          <span className="muted">
            No public transport found for this time.
          </span>
        ) : (
          <TransitSteps route={result.route} tz={leg.when.tz} />
        )}
        {(leg.from.approx || leg.to.approx) && leg.planned.length > 0 && (
          <span className="day-leg-sample">
            No saved place for the{" "}
            {leg.from.approx && leg.to.approx
              ? "start or end"
              : leg.from.approx
                ? "start"
                : "end"}
            ; drawn from the city centre.
          </span>
        )}
        {!between && (
          <a
            className="day-leg-link"
            href={directionsUrl(leg.from.point, leg.to.point)}
            target="_blank"
            rel="noreferrer"
          >
            Google Maps <ExternalLink size={12} />
          </a>
        )}
      </div>
    </li>
  );
}
function TransitSteps({
  route,
  tz,
}: {
  route: Extract<TransitRoute, { found: true }>;
  tz: string;
}) {
  return (
    <>
      <span className="day-leg-total">
        {duration(route.minutes)}
        {route.fare && ` · ${route.fare}`}
      </span>
      {route.sample && (
        <span className="day-leg-sample">
          No timetable for this date yet; times are from{" "}
          {new Date(route.sample).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
            timeZone: tz || undefined,
          })}
          , the same weekday.
        </span>
      )}
      <ol className="transit-steps">
        {route.steps.map((s, i) =>
          s.mode === "walk" ? (
            <li key={i} className="transit-walk">
              <Footprints size={13} /> Walk {duration(s.minutes)} (
              {distance(s.meters)})
            </li>
          ) : (
            <li key={i} className="transit-ride">
              <span
                className="transit-line"
                style={{
                  background: stepColor(s),
                  color: s.line?.textColor || "#fff",
                }}
              >
                {s.line?.short || s.line?.name || s.line?.vehicle}
              </span>
              <span>
                {s.depart} {s.from} → {s.arrive} {s.to}
                <small>
                  {[
                    s.line?.short && s.line.name !== s.line.short
                      ? s.line.name
                      : "",
                    s.line?.headsign && `towards ${s.line.headsign}`,
                    s.stops ? `${s.stops} stop${s.stops === 1 ? "" : "s"}` : "",
                    s.line?.agency,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
            </li>
          ),
        )}
      </ol>
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import {
  TrainFront,
  Plane,
  Ship,
  Bus,
  CarTaxiFront,
  Footprints,
  TramFront,
  Route,
  CircleDashed,
  ChevronDown,
  ChevronRight,
  Download,
  Maximize2,
} from "lucide-react";
import { type Place, type Scenario, shortDate, weekday } from "../model";
import {
  modeParts,
  routeFocusEvent,
  styleKey,
  styles,
  useLocate,
} from "../routeGeometry";
import { type Hop, type Point, type Stop, tripRoute } from "../tripRoute";
const icons: Record<string, typeof Plane> = {
  Train: TrainFront,
  Shinkansen: TrainFront,
  Flight: Plane,
  Ferry: Ship,
  Bus: Bus,
  Taxi: CarTaxiFront,
  Metro: TramFront,
  Walk: Footprints,
};
// Leaflet markers take HTML. Each icon is drawn once when this module
// loads (flushSync can't render while React is committing).
const modeName = (mode: string) => modeParts(mode)[0];
const iconMarkup = new Map(
  [...new Set([...Object.values(icons), Route, CircleDashed])].map((Icon) => {
    const el = document.createElement("div");
    const root = createRoot(el);
    flushSync(() => root.render(<Icon size={14} strokeWidth={2.2} />));
    const html = el.innerHTML;
    root.unmount();
    return [Icon, html] as const;
  }),
);
const iconHtml = (mode: string) =>
  iconMarkup.get(icons[modeName(mode)] || (mode ? Route : CircleDashed))!;
const nights = (s: Stop) =>
  s.stay
    ? Math.round(
        (Date.parse(s.stay.endDate) - Date.parse(s.stay.date)) / 86400000,
      )
    : 0;
const day = (d: string) => `${weekday(d)} ${shortDate(d)}`;
const text = (tag: string, value: string, className = "") => {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  return el;
};
function hopPopup(h: Hop) {
  const el = document.createElement("div");
  el.className = "map-popup route-popup";
  el.append(text("strong", `${h.from.city} → ${h.to.city}`));
  if (!h.journeys.length)
    el.append(text("span", "No transport planned yet", "needs"));
  for (const j of h.journeys)
    el.append(
      text(
        "span",
        `${day(j.date)} ${j.startTime} · ${j.mode || "Travel"} ${j.city} → ${j.toCity}${j.provider ? ` · ${j.provider}` : ""}${j.status === "booked" ? " · booked" : ""}`,
      ),
    );
  return el;
}
function stopPopup(visits: Stop[]) {
  const el = document.createElement("div");
  el.className = "map-popup route-popup";
  el.append(text("strong", `${visits[0].city}, ${visits[0].country}`));
  for (const s of visits)
    el.append(
      text(
        "span",
        `${s.n}. ${day(s.arrive)}${s.stay ? ` · ${nights(s)} night${nights(s) === 1 ? "" : "s"} · ${s.stay.title}` : " · passing through"}`,
      ),
    );
  return el;
}

// Loads a ring of tiles beyond the visible area, so panning shows the map
// at once instead of blank squares while tiles download.
const BufferedTiles = L.TileLayer.extend({
  _getTiledPixelBounds(this: L.TileLayer, center: L.LatLng) {
    const bounds = (
      L.TileLayer.prototype as unknown as {
        _getTiledPixelBounds(c: L.LatLng): L.Bounds;
      }
    )._getTiledPixelBounds.call(this, center);
    const pad = this.getTileSize().multiplyBy(1.5);
    return L.bounds(bounds.min!.subtract(pad), bounds.max!.add(pad));
  },
}) as unknown as typeof L.TileLayer;
// Leaflet's wheel zoom ignores the wheel while a zoom animates, so zooming
// several levels needed pauses. Here every wheel event moves a target zoom
// and the map eases toward it each frame (as a pinch does), keeping the point
// under the pointer in place.
function smoothWheel(map: L.Map) {
  const m = map as L.Map & {
    _move(center: L.LatLng, zoom: number, data: object): void;
    _moveStart(zoomChanged: boolean, noMoveStart: boolean): void;
    _moveEnd(zoomChanged: boolean): void;
    _stop(): void;
  };
  const el = map.getContainer();
  let goal = 0,
    zoom = 0,
    frame = 0,
    last = 0,
    anchor = L.point(0, 0);
  const step = () => {
    zoom += (goal - zoom) * 0.3;
    if (Math.abs(goal - zoom) < 0.002) zoom = goal;
    const half = map.getSize().divideBy(2);
    const scale = map.getZoomScale(zoom, map.getZoom());
    const shift = anchor.subtract(half).multiplyBy(1 - 1 / scale);
    m._move(map.containerPointToLatLng(half.add(shift)), zoom, {
      pinch: true,
    });
    // Once the wheel has been still a moment, settles on the nearest whole
    // level (tiles are sharp there and show no seams), then ends.
    if (zoom === goal && performance.now() - last > 150) {
      if (goal !== Math.round(goal)) goal = Math.round(goal);
      else {
        frame = 0;
        m._moveEnd(true);
        return;
      }
    }
    frame = requestAnimationFrame(step);
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    last = performance.now();
    anchor = map.mouseEventToContainerPoint(e);
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
    // A wheel notch (about 100 px) is one level; trackpad pinches (sent
    // with ctrlKey) have small steps and get more weight.
    const delta = (-e.deltaY * unit) / (e.ctrlKey ? 40 : 100);
    if (!frame) {
      m._stop();
      zoom = goal = map.getZoom();
      m._moveStart(true, false);
      frame = requestAnimationFrame(step);
    }
    goal = Math.min(
      map.getMaxZoom(),
      Math.max(map.getMinZoom(), goal + Math.max(-1, Math.min(1, delta))),
    );
  };
  el.addEventListener("wheel", wheel, { passive: false });
  return () => {
    el.removeEventListener("wheel", wheel);
    cancelAnimationFrame(frame);
  };
}
const storageKey = "fieldnotes.routeMap";
const sizeKey = "fieldnotes.routeMapSize";
const readJson = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "") ?? fallback;
  } catch {
    return fallback;
  }
};
export function RouteMap({
  scenario,
  places,
}: {
  scenario: Scenario;
  places: Place[];
}) {
  const route = useMemo(() => tripRoute(scenario), [scenario]);
  const [open, setOpen] = useState(
    () => localStorage.getItem(storageKey) !== "hidden",
  );
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    addEventListener("online", change);
    addEventListener("offline", change);
    return () => {
      removeEventListener("online", change);
      removeEventListener("offline", change);
    };
  }, []);
  // Hotel positions where saved; other cities are looked up (cached).
  const saved = useMemo(() => {
    const out: Record<string, Point> = {};
    for (const s of route.stops) {
      const p = places.find((x) => x.id === s.stay?.placeId);
      if (p && p.lat !== null && p.lng !== null && !out[s.key])
        out[s.key] = [p.lat, p.lng];
    }
    return out;
  }, [route, places]);
  const locate = useLocate(open);
  const point = (s: Stop) => locate.point(s.city, s.country, saved[s.key]);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  useEffect(() => {
    if (!open || !container.current) return;
    const renderer = L.svg({ padding: 1.5 });
    const m = L.map(container.current, {
      // Zooming is continuous while it happens (see smoothWheel) but comes
      // to rest on whole levels, where tiles are sharp and seamless.
      zoomSnap: 1,
      scrollWheelZoom: false,
      // Faded-in tiles were composited apart from the first ones, leaving
      // hairline seams around them at in-between zoom levels.
      fadeAnimation: false,
      maxZoom: 19,
      minZoom: 1,
      worldCopyJump: true,
      // Lines are drawn well beyond the visible area, so panning doesn't
      // show them cut off before the map redraws.
      renderer,
    }).setView([30, 100], 3);
    // Leaflet redraws lines only once a zoom ends, so zooming out showed
    // them clipped at the old edges; redraw a few times a second meanwhile.
    let redrawn = 0;
    m.on("zoom", () => {
      if (performance.now() - redrawn < 120) return;
      redrawn = performance.now();
      (renderer as unknown as { _reset(): void })._reset();
    });
    map.current = m;
    const unwheel = smoothWheel(m);
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(container.current);
    if (online)
      new BufferedTiles("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        // Tiles already seen stay loaded while panning; CORS so the map can
        // be saved as an image.
        keepBuffer: 6,
        crossOrigin: "anonymous",
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
    return () => {
      unwheel();
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, [open, online]);
  const placed = route.stops.filter((s) => point(s)).length;
  const fitted = useRef(-1);
  const everything = useRef<L.LatLngBounds | null>(null);
  // Countries in the order they are first reached, to jump between them.
  const countries = [...new Set(route.stops.map((s) => s.country))].filter(
    (c) => c && route.stops.some((s) => s.country === c && point(s)),
  );
  const show = (bounds: L.LatLngBounds | null) => {
    const m = map.current;
    if (!m || !bounds?.isValid()) return;
    m.flyToBounds(bounds, { padding: [40, 40], maxZoom: 10, duration: 0.8 });
  };
  const showCountry = (country: string) =>
    show(
      L.latLngBounds(
        route.stops
          .filter((s) => s.country === country && point(s))
          .map((s) => point(s)!),
      ),
    );
  // A journey's preview asks to be shown here: open the map, bring it into
  // view and move to the journey (once the map exists, if it was closed).
  const section = useRef<HTMLElement>(null);
  const pending = useRef<L.LatLngBounds | null>(null);
  useEffect(() => {
    const focus = (e: Event) => {
      const bounds = L.latLngBounds((e as CustomEvent<Point[]>).detail);
      section.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (map.current) show(bounds);
      else {
        pending.current = bounds;
        localStorage.setItem(storageKey, "shown");
        setOpen(true);
      }
    };
    addEventListener(routeFocusEvent, focus);
    return () => removeEventListener(routeFocusEvent, focus);
    // `show` only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The map's size can be dragged from its corner and is kept per browser.
  const frame = useRef<HTMLDivElement>(null);
  const [size] = useState(() =>
    readJson<{ w: number; h: number } | null>(sizeKey, null),
  );
  const resize = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = frame.current;
    if (!el) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = el.getBoundingClientRect();
    const max = el.parentElement!.clientWidth;
    const [x0, y0] = [e.clientX, e.clientY];
    const move = (ev: PointerEvent) => {
      el.style.aspectRatio = "auto";
      el.style.width = `${Math.min(max, Math.max(240, start.width + ev.clientX - x0))}px`;
      el.style.height = `${Math.max(240, start.height + ev.clientY - y0)}px`;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      const r = el.getBoundingClientRect();
      localStorage.setItem(
        sizeKey,
        JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) }),
      );
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const resetSize = () => {
    const el = frame.current;
    if (!el) return;
    el.style.width = el.style.height = el.style.aspectRatio = "";
    localStorage.removeItem(sizeKey);
  };
  const [saving, setSaving] = useState("");
  async function saveImage() {
    const el = container.current;
    if (!el) return;
    setSaving("Drawing…");
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(el, {
        pixelRatio: Math.min(2, Math.max(1, devicePixelRatio)),
        backgroundColor: getComputedStyle(el).backgroundColor,
        cacheBust: false,
        skipFonts: true,
        // Zoom buttons and open popups stay off the picture.
        filter: (n) =>
          !(
            n instanceof HTMLElement &&
            (n.classList.contains("leaflet-control-zoom") ||
              n.classList.contains("leaflet-popup"))
          ),
      });
      if (!blob) throw Error("the browser returned an empty image");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(scenario.name || "Trip").replace(/[\\/:*?"<>|]+/g, " ")} route.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setSaving("");
    } catch (e) {
      setSaving(
        `Could not save the image: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const group = L.featureGroup().addTo(m);
    const lines = L.featureGroup().addTo(group);
    for (const h of route.hops) {
      const a = point(h.from),
        b = point(h.to);
      if (!a || !b) continue;
      const style = styles[styleKey(h.mode)];
      const path = locate.path(h.mode, a, b);
      const line = L.polyline(path, {
        color: style.color,
        weight: style.weight,
        dashArray: style.dash,
        opacity: 0.9,
      }).addTo(lines);
      // A wider invisible line makes thin routes easy to tap.
      L.polyline(path, { opacity: 0, weight: 16 })
        .bindPopup(hopPopup(h))
        .addTo(lines);
      const centre: Point =
        path.length > 2
          ? path[Math.floor(path.length / 2)]
          : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      L.marker(centre, {
        icon: L.divIcon({
          className: `route-mode ${h.mode ? "" : "missing"}`,
          html: iconHtml(h.mode),
          iconSize: [24, 24],
        }),
        title: `${h.mode || "No transport yet"}: ${h.from.city} → ${h.to.city}`,
      })
        .bindPopup(hopPopup(h))
        .addTo(group);
      line.bringToBack();
    }
    // One marker per city, numbered with each visit.
    const visits = new Map<string, Stop[]>();
    for (const s of route.stops)
      if (point(s)) visits.set(s.key, [...(visits.get(s.key) || []), s]);
    for (const list of visits.values()) {
      const stay = list.some((s) => s.stay);
      const first = list[0].n === 1,
        last = list.at(-1)!.n === route.stops.length;
      const label = list.map((s) => s.n).join(" · ");
      // Overnight stops and the trip's ends are larger; badges fit their numbers.
      const size = stay || first || last ? 24 : 18;
      const width = Math.max(size, label.length * 6 + 12);
      const marker = L.marker(point(list[0])!, {
        icon: L.divIcon({
          className: `route-stop ${stay || first || last ? "stay" : "pass"} ${first ? "first" : ""} ${last ? "last" : ""}`,
          html: `<span>${label}</span>`,
          iconSize: [width, size],
        }),
        zIndexOffset: stay ? 1000 : 500,
      })
        .bindPopup(stopPopup(list))
        .addTo(group);
      marker.bindTooltip(list[0].city, {
        permanent: stay,
        direction: "right",
        offset: [width / 2 + 2, 0],
        className: "route-label",
      });
    }
    // Fit once more each time further cities are found. Without animation, so
    // a fit made while an earlier one is still zooming is not lost.
    everything.current = group.getBounds();
    if (placed && placed !== fitted.current) {
      fitted.current = placed;
      m.fitBounds(group.getBounds(), {
        padding: [36, 36],
        maxZoom: 9,
        animate: false,
      });
    }
    if (pending.current && placed) {
      m.fitBounds(pending.current, {
        padding: [40, 40],
        maxZoom: 10,
        animate: false,
      });
      pending.current = null;
    }
    return () => {
      group.remove();
    };
    // `point` and `locate` change with `saved` and `locate.version`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, saved, locate.version, open, online]);
  if (route.stops.length < 2) return null;
  const used = [...new Set(route.hops.map((h) => styleKey(h.mode)))];
  const missing = route.hops.filter((h) => !h.journeys.length).length;
  const unplaced = [
    ...new Set(
      route.stops
        .filter((s) => !saved[s.key] && locate.missing(s.city, s.country))
        .map((s) => s.city),
    ),
  ];
  return (
    <section className="route-map" ref={section}>
      <button
        className="route-map-toggle"
        aria-expanded={open}
        onClick={() => {
          localStorage.setItem(storageKey, open ? "hidden" : "shown");
          fitted.current = -1;
          setOpen(!open);
        }}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        Route map
        <span className="muted">
          {new Set(route.stops.map((s) => s.key)).size} cities ·{" "}
          {route.hops.length} hops
          {missing > 0 && ` · ${missing} without transport`}
        </span>
      </button>
      {open && (
        <>
          <div className="route-map-tools">
            <button
              className="button small"
              onClick={() => show(everything.current)}
              title="Show the whole route"
            >
              <Maximize2 size={13} />
              Whole trip
            </button>
            {countries.length > 1 &&
              countries.map((c) => (
                <button
                  key={c}
                  className="button small"
                  onClick={() => showCountry(c)}
                >
                  {c}
                </button>
              ))}
            <button
              className="button small route-map-save"
              onClick={() => void saveImage()}
              disabled={saving === "Drawing…"}
              title="Save the map as it is shown as a PNG image"
            >
              <Download size={13} />
              {saving === "Drawing…" ? saving : "Save image"}
            </button>
          </div>
          <div
            className="route-map-frame"
            ref={frame}
            style={
              size
                ? { width: size.w, height: size.h, aspectRatio: "auto" }
                : undefined
            }
          >
            <div
              className="route-map-canvas"
              ref={container}
              aria-label="Map of the trip's route between cities"
            />
            <div
              className="route-map-resize"
              onPointerDown={resize}
              onDoubleClick={resetSize}
              title="Drag to resize the map; double-click for the standard size"
              aria-hidden
            />
          </div>
          <div className="route-legend">
            {used.map((k) => (
              <span key={k}>
                <svg width="26" height="8" aria-hidden>
                  <line
                    x1="1"
                    y1="4"
                    x2="25"
                    y2="4"
                    stroke={styles[k].color}
                    strokeWidth={styles[k].weight}
                    strokeDasharray={styles[k].dash}
                  />
                </svg>
                {styles[k].label}
              </span>
            ))}
            {unplaced.length > 0 && (
              <span className="needs">
                Not on the map: {unplaced.join(", ")}
              </span>
            )}
            {!online && <span className="muted">Offline: no map tiles</span>}
            {saving && saving !== "Drawing…" && (
              <span className="needs">{saving}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

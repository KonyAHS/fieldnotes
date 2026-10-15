import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BedDouble,
  TrainFront,
  MapPin,
  Utensils,
  StickyNote,
  Plus,
  Check,
  ArrowRight,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Paperclip,
} from "lucide-react";
import {
  type Entry,
  type Trip,
  type Scenario,
  type Issue,
  type Place,
  addDays,
  days,
  shortDate,
  weekday,
  countryMeta,
  entriesOn,
  isWeekend,
  mondayOf,
  shiftStay,
  bookingState,
  bookingLabel,
} from "../model";
import { useWhereabouts, useWeather } from "../whereabouts";
import { WeatherBadge } from "./WeatherBadge";
import { prayerTimes, qibla } from "../prayer";
import { layout } from "../timelineLayout";
export function EntryIcon({
  type,
  size = 15,
}: {
  type: Entry["type"];
  size?: number;
}) {
  const Icon = {
    stay: BedDouble,
    transport: TrainFront,
    activity: MapPin,
    food: Utensils,
    note: StickyNote,
  }[type];
  return <Icon size={size} />;
}
// Corner tag that stays visible however small the card is.
export function BookingTag({ state }: { state: "booked" | "todo" }) {
  return (
    <span
      className={`booking-tag ${state}`}
      role="img"
      aria-label={bookingLabel[state]}
    >
      {state === "booked" ? <Check size={10} strokeWidth={4} /> : "!"}
    </span>
  );
}
// How much of a card fits in a box of the given height: the title is kept
// first (clamped with an ellipsis), then the time row, then the route.
function fitCard(height: number, route: boolean, needed: number) {
  const inner = height - 2;
  const compact = {
    compact: true,
    lines: Math.max(1, Math.floor((inner - 6) / 13)),
    route: false,
  };
  if (height < 46) return compact;
  const room = inner - 12 - 12 - 3;
  const withRoute = route && room >= 16 * 2 + 17;
  const lines = Math.max(1, Math.floor((room - (withRoute ? 17 : 0)) / 16));
  // On short cards a long title matters more than the time row.
  if (lines < needed && height < 72 && compact.lines > lines) return compact;
  return { compact: false, lines, route: withRoute };
}
export function EntryCard({
  entry,
  onClick,
  compact = false,
  draggable = false,
  onDate,
  height,
  width = 120,
}: {
  entry: Entry;
  onClick: () => void;
  compact?: boolean;
  draggable?: boolean;
  onDate?: string;
  /** Box size in pixels; the content is shortened to fit it. */
  height?: number;
  width?: number;
}) {
  const time = entry.allDay
    ? "All day"
    : onDate && onDate > entry.date
      ? onDate === entry.endDate
        ? `Arrives ${entry.endTime}`
        : "In transit"
      : entry.startTime +
        (entry.endDate === entry.date ? `–${entry.endTime}` : " →");
  // The route repeats the title when the title already names both cities.
  const hasRoute =
    entry.type === "transport" &&
    !!entry.toCity &&
    !(entry.title.includes(entry.city) && entry.title.includes(entry.toCity));
  // Rough count of title lines at about 6.8px per character.
  const needed = Math.ceil(
    (entry.title.length * 6.8) / Math.max(40, width - 20),
  );
  const fit = height === undefined ? null : fitCard(height, hasRoute, needed);
  const small = fit ? fit.compact : compact;
  const booking = bookingState(entry);
  return (
    <button
      className={`event-card event-${entry.type} ${entry.status === "idea" ? "idea" : ""} ${small ? "compact" : ""} ${fit ? "fitted" : ""} ${booking ? `booking-${booking}` : ""}`}
      style={
        fit ? ({ "--lines": fit.lines } as React.CSSProperties) : undefined
      }
      onClick={onClick}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", entry.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      title={`${entry.title} · ${entry.city}${booking ? ` · ${bookingLabel[booking]}` : ""}`}
    >
      {booking && <BookingTag state={booking} />}
      <span className="event-top">
        <EntryIcon type={entry.type} />
        <span>{time}</span>
        {!!entry.attachments?.length && (
          <Paperclip
            size={12}
            aria-label={`${entry.attachments.length} attachments`}
          />
        )}
      </span>
      <strong>{entry.title}</strong>
      {hasRoute && (fit || !compact) && (
        <span className={`event-route ${fit && !fit.route ? "extra" : ""}`}>
          {entry.city}
          <ArrowRight size={12} />
          {entry.toCity}
        </span>
      )}
    </button>
  );
}
// An empty drag image: the drop preview shows where the plan will go.
const blank = new Image();
blank.src =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const hour = (t: string) => Number(t.slice(0, 2)) + Number(t.slice(3)) / 60;
type Placed = ReturnType<typeof layout>[number];
// Horizontal position of a card as CSS lengths, and its width in pixels for
// a day `day` pixels wide. Plans on a backdrop sit inside its card, indented.
const indent = 14;
function across(x: Placed, day: number) {
  const own = (lane: number, count: number) => ({
    left: `(${(lane / count) * 100}% + ${lane ? 2 : 5}px)`,
    width: `(${100 / count}% - ${count > 1 ? 7 : 10}px)`,
    px: day / count - 10,
  });
  if (!x.host) {
    const o = own(x.lane, x.lanes);
    return { left: `calc${o.left}`, width: `calc${o.width}`, px: o.px };
  }
  const h = own(x.host.lane, x.host.lanes);
  const inner = `(${h.width} - ${indent}px)`;
  return {
    left: `calc(${h.left} + ${indent}px + ${inner} * ${x.lane / x.lanes})`,
    // Leaves the backdrop's right edge (and its booking mark) visible.
    width: `calc(${inner} / ${x.lanes} - ${x.lanes > 1 ? 2 : 0}px - 5px)`,
    px: (h.px - indent - 5) / x.lanes,
  };
}
// Smallest box that still shows one readable title line, in pixels.
const cardMin = 24;
// Where each plan is drawn. Hours keep one height; plans too short to read
// borrow room from their longer neighbours in the same run of back-to-back
// plans (and from free time just after or before it), so they stay one under
// the other in order. Plans that really overlap keep their exact times.
function pack(items: Placed[], firstHour: number, hourPx: number) {
  const y = (t: number) => (t - firstHour) * hourPx;
  const total = y(24);
  const groups = new Map<number, Placed[]>();
  for (const x of items)
    groups.set(x.group, [...(groups.get(x.group) || []), x]);
  const blocks = [...groups.values()].map((members) => {
    const a = y(Math.min(...members.map((x) => x.start)));
    const b = y(Math.max(...members.map((x) => x.end)));
    const fixed = members.length > 1;
    return {
      members,
      a,
      b,
      min: fixed ? b - a : cardMin,
      fixed,
      top: a,
      h: b - a,
    };
  });
  // Runs of plans that follow each other within 15 minutes.
  const runs: (typeof blocks)[] = [];
  for (const block of blocks) {
    const run = runs.at(-1);
    if (run && block.a - run.at(-1)!.b < hourPx / 4 + 0.5) run.push(block);
    else runs.push([block]);
  }
  let floor = 0;
  runs.forEach((run, r) => {
    let from = run[0].a,
      to = run.at(-1)!.b;
    const least = run.reduce((n, x) => n + x.min, 0);
    // Not enough room: take free time after the run, then before it.
    if (least > to - from) {
      const after = (runs[r + 1]?.[0].a ?? total) - to;
      to += Math.max(0, Math.min(after, least - (to - from)));
      from -= Math.max(0, Math.min(from - floor, least - (to - from)));
    }
    const room = to - from;
    const size = (k: number) =>
      run.map((x) => (x.fixed ? x.b - x.a : Math.max(x.min, k * (x.b - x.a))));
    const sum = (k: number) => size(k).reduce((n, h) => n + h, 0);
    if (sum(1) <= room) {
      // Everything fits: keep exact times where possible.
      const h = size(1);
      let bottom = from;
      run.forEach((x, i) => {
        x.h = h[i];
        x.top = Math.max(x.a, bottom);
        bottom = x.top + x.h;
      });
      let ceiling = to;
      for (let i = run.length - 1; i >= 0; i--) {
        run[i].top = Math.min(run[i].top, ceiling - run[i].h);
        ceiling = run[i].top;
      }
    } else {
      // Long plans shrink so short ones can be read.
      let low = 0,
        high = 1;
      for (let i = 0; i < 30; i++) {
        const mid = (low + high) / 2;
        if (sum(mid) > room) high = mid;
        else low = mid;
      }
      let h = size(low);
      const used = h.reduce((n, v) => n + v, 0);
      if (used > room) h = h.map((v) => (v * room) / used);
      let top = from;
      run.forEach((x, i) => {
        x.h = h[i];
        x.top = top;
        top += x.h;
      });
    }
    floor = run.at(-1)!.top + run.at(-1)!.h;
  });
  const boxes = new Map<Placed, { top: number; height: number }>();
  for (const block of blocks)
    for (const x of block.members)
      boxes.set(
        x,
        block.fixed
          ? {
              top: y(x.start) + block.top - block.a,
              height: Math.max(y(x.end) - y(x.start), x.host ? cardMin + 4 : 0),
            }
          : { top: block.top, height: block.h },
      );
  return boxes;
}
export function Timeline({
  trip,
  scenario,
  start,
  setStart,
  onEdit,
  onAdd,
  onIssue,
  onMove,
  onStayChange,
  issues,
  places = [],
  hideStays = false,
  context,
  exporting = false,
  only,
}: {
  trip: Trip;
  scenario: Scenario;
  start: string;
  setStart: (d: string) => void;
  onEdit: (e: Entry) => void;
  onAdd: (date: string, time?: string, type?: Entry["type"]) => void;
  onIssue: (i: Issue) => void;
  onMove: (id: string, date: string, time: string) => void;
  onStayChange: (id: string, date: string, endDate: string) => void;
  issues: Issue[];
  /** Saved places, for the coordinates used by prayer times. */
  places?: Place[];
  /** Leave out the hotel row (the stays still name each day's city). */
  hideStays?: boolean;
  /** The unfiltered plan, for each day's city when some kinds are hidden. */
  context?: Scenario;
  /** Static whole-trip rendering for an image export. */
  exporting?: boolean;
  /** Exact days to show, for exporting one week at a time. */
  only?: [string, string];
}) {
  const [chosenRange, setRange] = useState<"week" | "trip">(() =>
    localStorage.getItem("fieldnotes-range") === "trip" ? "trip" : "week",
  );
  const chooseRange = (r: "week" | "trip") => {
    setRange(r);
    localStorage.setItem("fieldnotes-range", r);
  };
  // 1 fits a whole day in the window; other steps zoom in or out.
  const zooms = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
  const [chosenZoom, setZoom] = useState(() => {
    const z = Number(localStorage.getItem("fieldnotes-zoom"));
    return zooms.includes(z) ? z : 1;
  });
  const range = exporting ? "trip" : chosenRange;
  const zoom = exporting ? 1 : chosenZoom;
  const changeZoom = (step: number) => {
    const next =
      zooms[
        Math.max(0, Math.min(zooms.length - 1, zooms.indexOf(zoom) + step))
      ];
    setZoom(next);
    localStorage.setItem("fieldnotes-zoom", String(next));
  };
  const [expanded, setExpanded] = useState(false);
  const section = useRef<HTMLElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const [chrome, setChrome] = useState(260);
  // The layout viewport stays the same while a phone's address bar slides in
  // and out or the keyboard opens, unlike innerHeight, so scrolling does not
  // re-lay out the whole timeline.
  const viewportHeight = () =>
    document.documentElement.clientHeight || window.innerHeight;
  const [viewport, setViewport] = useState(viewportHeight);
  useEffect(() => {
    const resize = () => setViewport(viewportHeight());
    const fullscreen = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]"))
        setExpanded(false);
    };
    window.addEventListener("resize", resize);
    document.addEventListener("fullscreenchange", fullscreen);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("fullscreenchange", fullscreen);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  // Height taken by the toolbar, day headers, stays and all-day plans.
  useLayoutEffect(() => {
    const measure = () =>
      setChrome(
        (toolbar.current?.offsetHeight || 0) + (top.current?.offsetHeight || 0),
      );
    measure();
    const observer = new ResizeObserver(measure);
    if (top.current) observer.observe(top.current);
    if (toolbar.current) observer.observe(toolbar.current);
    return () => observer.disconnect();
  }, []);
  async function toggleExpanded() {
    if (expanded) {
      if (document.fullscreenElement) await document.exitFullscreen();
      setExpanded(false);
      return;
    }
    setExpanded(true);
    // Browsers without the Fullscreen API (iPhone) keep the in-page overlay.
    await section.current?.requestFullscreen?.().catch(() => {});
  }
  const monday = mondayOf(start);
  const visible = useMemo(
    () =>
      only
        ? days(only[0], only[1])
        : range === "trip"
          ? days(trip.start, trip.end)
          : days(
              monday < trip.start ? trip.start : monday,
              addDays(monday, 6) > trip.end ? trip.end : addDays(monday, 6),
            ),
    [range, monday, trip.start, trip.end, only?.[0], only?.[1]],
  );
  const first = visible[0];
  // Weeks run Monday to Sunday, numbered from the week the trip starts.
  const [weekNumbers, setWeekNumbers] = useState(
    () => localStorage.getItem("fieldnotes-weeks") !== "off",
  );
  const toggleWeeks = () => {
    localStorage.setItem("fieldnotes-weeks", weekNumbers ? "off" : "on");
    setWeekNumbers(!weekNumbers);
  };
  const weekOf = (d: string) =>
    Math.round(
      (Date.parse(mondayOf(d)) - Date.parse(mondayOf(trip.start))) /
        (7 * 86400000),
    ) + 1;
  const weekCount = weekOf(trip.end);
  const showWeeks = (exporting || range === "trip") && weekNumbers;
  // A divider before each Monday that is not the first day shown.
  const weekStart = (d: string, i: number) =>
    showWeeks && i > 0 && mondayOf(d) === d;
  // Fajr, Dhuhr and Maghrib for where each day is spent (the night's stay).
  const [prayers, setPrayers] = useState(
    () => localStorage.getItem("fieldnotes-prayers") !== "off",
  );
  const togglePrayers = () => {
    localStorage.setItem("fieldnotes-prayers", prayers ? "off" : "on");
    setPrayers(!prayers);
  };
  const showPrayers = prayers && !exporting;
  // Weather for each day where it is spent; last year's before forecasts.
  const [weatherOn, setWeatherOn] = useState(
    () => localStorage.getItem("fieldnotes-weather") !== "off",
  );
  const toggleWeather = () => {
    localStorage.setItem("fieldnotes-weather", weatherOn ? "off" : "on");
    setWeatherOn(!weatherOn);
  };
  const showWeather = weatherOn && !exporting;
  const whereabouts = useWhereabouts(
    context || scenario,
    places,
    visible,
    showPrayers || showWeather,
  );
  const weather = useWeather(whereabouts, visible, showWeather);
  const prayerMarks = visible.map((d, i) => {
    const w = whereabouts[i];
    const point = w?.point;
    if (!showPrayers || !w || !point) return [];
    const t = prayerTimes(d, point.lat, point.lng, w.timezone);
    return [
      { name: "Fajr", at: t.fajr },
      { name: "Dhuhr", at: t.dhuhr },
      { name: "Maghrib", at: t.maghrib },
    ].filter(
      (x): x is { name: string; at: number } =>
        x.at !== null && x.at > 0 && x.at < 24,
    );
  });
  const weekBands: { week: number; from: number; to: number }[] = [];
  visible.forEach((d, i) => {
    const w = weekOf(d);
    const last = weekBands.at(-1);
    if (last && last.week === w) last.to = i;
    else weekBands.push({ week: w, from: i, to: i });
  });
  // Show from 06:00, or earlier when a plan starts earlier, until midnight.
  const firstHour = Math.min(
    6,
    ...visible.flatMap((d) =>
      entriesOn(scenario, d)
        .filter((e) => e.type !== "stay" && !e.allDay && e.date === d)
        .map((e) => Math.floor(hour(e.startTime))),
    ),
  );
  const hours = 24 - firstHour;
  const fit = (viewport - chrome - (expanded ? 4 : 24)) / hours;
  // Zooming out narrows the days; the day itself always fills the height.
  const hourPx = exporting
    ? 40
    : Math.round(Math.max(fit, 16) * Math.max(1, zoom));
  const column = Math.round(
    (exporting ? 150 : range === "trip" ? 154 : 168) * zoom,
  );
  const placed = visible.map((d) =>
    layout(entriesOn(scenario, d), d, firstHour),
  );
  const boxes = placed.map((items) => pack(items, firstHour, hourPx));
  const y = (t: number) => (t - firstHour) * hourPx;
  const labelStep = hourPx < 22 ? 3 : hourPx < 40 ? 2 : 1;
  // Days with overlapping plans get wider so side-by-side cards stay readable.
  const auto = placed.map((items) => {
    const lanes = Math.min(4, Math.max(1, ...items.map((x) => x.lanes)));
    return column + (lanes - 1) * Math.round(Math.max(column, 120) * 0.85);
  });
  // Days resized by hand keep their width (stored per trip on this device,
  // at 100% zoom); the others share any spare room.
  const widthKey = `fieldnotes-widths-${trip.id}`;
  const [custom, setCustom] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(widthKey) || "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      setCustom(JSON.parse(localStorage.getItem(widthKey) || "{}"));
    } catch {
      setCustom({});
    }
  }, [widthKey]);
  const saveWidths = (next: Record<string, number>) => {
    setCustom(next);
    localStorage.setItem(widthKey, JSON.stringify(next));
  };
  const widths = visible.map((d, i) =>
    custom[d] ? Math.round(custom[d] * zoom) : auto[i],
  );
  const columns = `62px ${widths
    .map((w, i) =>
      custom[visible[i]]
        ? `${w}px`
        : `minmax(${w}px, ${(w / column).toFixed(2)}fr)`,
    )
    .join(" ")}`;
  function startResize(event: React.PointerEvent<HTMLElement>, date: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const header = handle.parentElement!;
    const start = header.getBoundingClientRect().width;
    const x0 = event.clientX;
    let latest = custom;
    const move = (e: PointerEvent) => {
      const px = Math.max(70, Math.min(900, start + e.clientX - x0));
      latest = { ...custom, [date]: Math.round(px / zoom) };
      setCustom(latest);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      saveWidths(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }
  function resizeKey(event: React.KeyboardEvent<HTMLElement>, date: string) {
    const step =
      event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0;
    if (event.key === "Delete" || event.key === "Backspace") {
      const { [date]: _, ...rest } = custom;
      void _;
      saveWidths(rest);
      return;
    }
    if (!step) return;
    event.preventDefault();
    const current =
      custom[date] ||
      event.currentTarget.parentElement!.getBoundingClientRect().width / zoom;
    saveWidths({
      ...custom,
      [date]: Math.round(
        Math.max(70 / zoom, Math.min(900 / zoom, current + step)),
      ),
    });
  }
  // A plan being dragged: where it was grabbed (hours below its start), its
  // length, and the slot it would land on, drawn as a preview until dropped.
  const [moving, setMoving] = useState<{
    id: string;
    title: string;
    type: Entry["type"];
    grab: number;
    length: number;
  } | null>(null);
  const [landing, setLanding] = useState<{ date: string; at: number } | null>(
    null,
  );
  // The current time on today's column, updated every minute.
  const readNow = () => {
    const t = new Date();
    return {
      date: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`,
      hour: t.getHours() + t.getMinutes() / 60,
    };
  };
  const [now, setNow] = useState(readNow);
  useEffect(() => {
    if (exporting) return;
    const timer = setInterval(() => setNow(readNow()), 60000);
    return () => clearInterval(timer);
  }, [exporting]);
  const clock = (h: number) => {
    const m = Math.round(h * 60);
    return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  function landingAt(e: React.DragEvent<HTMLElement>, date: string) {
    if (!moving) return null;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    // Snap to 15 minutes, keeping the point where the card was grabbed.
    const at = Math.round((firstHour + y / hourPx - moving.grab) * 4) / 4;
    return { date, at: Math.max(firstHour, Math.min(23.75, at)) };
  }
  // A stay being dragged is drawn at its new dates until released.
  const [drag, setDrag] = useState<{
    id: string;
    mode: "start" | "end" | "move";
    delta: number;
  } | null>(null);
  const stayGrid = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const stayEntries = scenario.entries
    .filter((e) => e.type === "stay")
    .map((e) =>
      drag?.id === e.id
        ? { ...e, ...shiftStay(e, drag.mode, drag.delta, trip) }
        : e,
    )
    .filter((e) => e.date <= visible.at(-1)! && e.endDate > first)
    .sort((a, b) => a.date.localeCompare(b.date));
  function startDrag(
    event: React.PointerEvent<HTMLElement>,
    entry: Entry,
    mode: "start" | "end" | "move",
  ) {
    if (event.button !== 0 || !stayGrid.current) return;
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    // Days differ in width, so find the day under the pointer.
    const cells = [
      ...stayGrid.current.parentElement!.querySelectorAll(".day-header"),
    ].map((c) => c.getBoundingClientRect());
    const dayAt = (x: number) => {
      const a = cells[0],
        z = cells.at(-1)!;
      if (x < a.left) return -Math.ceil((a.left - x) / a.width);
      if (x >= z.right)
        return cells.length - 1 + Math.ceil((x - z.right) / z.width);
      return cells.findIndex((c) => x < c.right);
    };
    const x0 = event.clientX;
    const day0 = dayAt(x0);
    let delta = 0;
    dragged.current = false;
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - x0) > 4) dragged.current = true;
      const next = dayAt(e.clientX) - day0;
      if (next !== delta) {
        delta = next;
        setDrag({ id: entry.id, mode, delta });
      }
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setDrag(null);
      const original = scenario.entries.find((e) => e.id === entry.id)!;
      const next = shiftStay(original, mode, delta, trip);
      if (next.date !== original.date || next.endDate !== original.endDate)
        onStayChange(entry.id, next.date, next.endDate);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }
  // Arrow keys on a focused handle move it by a day.
  function nudge(
    event: React.KeyboardEvent,
    entry: Entry,
    mode: "start" | "end" | "move",
  ) {
    const delta =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const original = scenario.entries.find((e) => e.id === entry.id)!;
    const next = shiftStay(original, mode, delta, trip);
    if (next.date !== original.date || next.endDate !== original.endDate)
      onStayChange(entry.id, next.date, next.endDate);
  }
  const stayLanes: {
    entry: Entry;
    left: number;
    right: number;
    lane: number;
  }[] = [];
  for (const entry of stayEntries) {
    const left = Math.max(
      0,
      visible.findIndex((d) => d >= entry.date),
    );
    const right =
      entry.endDate > visible.at(-1)!
        ? visible.length
        : visible.findIndex((d) => d >= entry.endDate);
    let lane = 0;
    while (
      stayLanes.some((s) => s.lane === lane && s.left < right && left < s.right)
    )
      lane++;
    stayLanes.push({ entry, left, right, lane });
  }
  const laneCount = Math.max(1, ...stayLanes.map((s) => s.lane + 1));
  // Missing nights already show "Add stay" in the stay lane.
  const dayIssues = (d: string) =>
    issues.filter((i) => i.date === d && i.kind !== "night").slice(0, 3);
  const gridWidth = widths.reduce((a, b) => a + b, 62);
  return (
    <section
      className={`timeline-section ${expanded ? "expanded" : ""} ${exporting ? "exporting" : ""}`}
      ref={section}
    >
      <div className="timeline-toolbar" ref={toolbar}>
        <div className="date-range">
          {range === "week" && (
            <button
              className="icon-button"
              aria-label="Previous week"
              disabled={monday <= trip.start}
              onClick={() => setStart(addDays(monday, -7))}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <strong>
            {range === "week" && (
              <span className="week-badge">
                Week {weekOf(first)} of {weekCount}
              </span>
            )}
            {shortDate(first)} — {shortDate(visible.at(-1)!)}
          </strong>
          {range === "week" && (
            <button
              className="icon-button"
              aria-label="Next week"
              disabled={addDays(monday, 7) > trip.end}
              onClick={() => setStart(addDays(monday, 7))}
            >
              <ChevronRight size={18} />
            </button>
          )}
          <div className="segmented range-picker">
            <button
              className={range === "week" ? "selected" : ""}
              onClick={() => chooseRange("week")}
            >
              Week
            </button>
            <button
              className={range === "trip" ? "selected" : ""}
              onClick={() => chooseRange("trip")}
            >
              Whole trip
            </button>
          </div>
          {range === "trip" && (
            <button
              className={`week-toggle ${weekNumbers ? "on" : ""}`}
              aria-pressed={weekNumbers}
              title="Split the trip into numbered weeks"
              onClick={toggleWeeks}
            >
              Weeks
            </button>
          )}
          <button
            className={`week-toggle prayer-toggle ${prayers ? "on" : ""}`}
            aria-pressed={prayers}
            title="Mark Fajr, Dhuhr and Maghrib on each day"
            onClick={togglePrayers}
          >
            Prayer times
          </button>
          <button
            className={`week-toggle prayer-toggle ${weatherOn ? "on" : ""}`}
            aria-pressed={weatherOn}
            title="Show each day's weather where you stay"
            onClick={toggleWeather}
          >
            Weather
          </button>
        </div>
        <div className="timeline-controls">
          <input
            aria-label="Jump to date"
            type="date"
            min={trip.start}
            max={trip.end}
            value={start}
            onChange={(e) => {
              if (e.target.value >= trip.start && e.target.value <= trip.end) {
                setStart(e.target.value);
                if (range === "trip")
                  document
                    .querySelector(`[data-day="${e.target.value}"]`)
                    ?.scrollIntoView({ inline: "start", block: "nearest" });
              }
            }}
          />
          <span className="legend-dot activity" />
          Activities
          <span className="legend-dot transport" />
          Travel
          <span className="legend-dot weekend" />
          Weekend
          <div className="zoom-controls">
            <button
              className="icon-button"
              aria-label="Zoom out"
              disabled={zoom === zooms[0]}
              onClick={() => changeZoom(-1)}
            >
              <ZoomOut size={16} />
            </button>
            <button
              className="text-button"
              title="Fit a whole day to the window"
              onClick={() => {
                setZoom(1);
                localStorage.setItem("fieldnotes-zoom", "1");
              }}
            >
              {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
            </button>
            <button
              className="icon-button"
              aria-label="Zoom in"
              disabled={zoom === zooms.at(-1)}
              onClick={() => changeZoom(1)}
            >
              <ZoomIn size={16} />
            </button>
            <button
              className="icon-button"
              aria-label={expanded ? "Exit full screen" : "Full screen"}
              title={expanded ? "Exit full screen (Esc)" : "Full screen"}
              onClick={() => void toggleExpanded()}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>
      </div>
      <div className="timeline-scroll">
        <div
          className={`timeline-grid ${column < 100 ? "narrow" : ""}`}
          style={{ minWidth: gridWidth }}
        >
          <div className="timeline-top" ref={top}>
            <div
              className="day-headers"
              style={{
                gridTemplateColumns: columns,
              }}
            >
              {showWeeks &&
                weekBands.map((b) => (
                  <div
                    key={"week-" + b.week}
                    className={`week-band ${b.from > 0 ? "week-start" : ""}`}
                    style={{
                      gridColumn: `${b.from + 2} / ${b.to + 3}`,
                      gridRow: 1,
                    }}
                  >
                    <strong>Week {b.week}</strong>
                    <span>
                      {shortDate(visible[b.from])}
                      {b.to > b.from && ` – ${shortDate(visible[b.to])}`}
                    </span>
                  </div>
                ))}
              <div
                className="corner-label"
                style={showWeeks ? { gridRow: "1 / 3" } : undefined}
              >
                Local
                <br />
                time
              </div>
              {visible.map((d, dayIndex) => {
                const es = entriesOn(context || scenario, d);
                const stay = es.find((e) => e.type === "stay");
                const location =
                  stay || es.find((e) => e.type !== "transport") || es[0];
                return (
                  <div
                    className={`day-header ${isWeekend(d) ? "weekend" : ""} ${weekStart(d, dayIndex) ? "week-start" : ""}`}
                    key={d}
                    data-day={d}
                    style={showWeeks ? { gridRow: 2 } : undefined}
                  >
                    <button
                      className={`col-resize ${custom[d] ? "set" : ""}`}
                      aria-label={`Resize ${shortDate(d)} (arrow keys; Delete resets)`}
                      title="Drag to resize this day · double-click to reset"
                      onPointerDown={(e) => startResize(e, d)}
                      onKeyDown={(e) => resizeKey(e, d)}
                      onDoubleClick={() => {
                        const { [d]: _, ...rest } = custom;
                        void _;
                        saveWidths(rest);
                      }}
                    />
                    <div className="day-heading">
                      <span>{weekday(d)}</span>
                      <button
                        className="icon-button small"
                        aria-label={`Add plan on ${shortDate(d)}`}
                        onClick={() => onAdd(d)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <strong>{shortDate(d)}</strong>
                    <div className="day-city">
                      {location?.city || "Unplanned"}
                      {location?.country && (
                        <span className="country-code">
                          {countryMeta[location.country]?.code ||
                            location.country.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      {/* Fajr usually comes before the first hour shown, so
                          it is noted under the date instead. */}
                      {prayerMarks[dayIndex]
                        .filter((p) => p.at < firstHour)
                        .map((p) => (
                          <span
                            key={p.name}
                            className="day-prayer"
                            title={`${p.name} ${clock(p.at)} · ${whereabouts[dayIndex]!.city}`}
                          >
                            {p.name} {clock(p.at)}
                          </span>
                        ))}
                    </div>
                    {(weather[dayIndex] ||
                      (showPrayers && whereabouts[dayIndex]?.point)) && (
                      <div className="day-extra">
                        {weather[dayIndex] && (
                          <WeatherBadge weather={weather[dayIndex]!} />
                        )}
                        {showPrayers && whereabouts[dayIndex]?.point && (
                          <span
                            className="day-qibla"
                            title={`Qibla from ${whereabouts[dayIndex]!.city}: ${qibla(whereabouts[dayIndex]!.point!.lat, whereabouts[dayIndex]!.point!.lng).toFixed(1)}° from true north`}
                          >
                            Qibla{" "}
                            {Math.round(
                              qibla(
                                whereabouts[dayIndex]!.point!.lat,
                                whereabouts[dayIndex]!.point!.lng,
                              ),
                            )}
                            °
                          </span>
                        )}
                      </div>
                    )}
                    {dayIssues(d).length > 0 && (
                      <div className="day-issues">
                        {dayIssues(d).map((i) => (
                          <button
                            key={i.id}
                            className="day-issue"
                            title={`${i.title}\n${i.detail}`}
                            onClick={() => onIssue(i)}
                          >
                            <AlertTriangle size={12} />
                            <span>{i.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div
              className={`stay-grid ${hideStays ? "hidden" : ""}`}
              ref={stayGrid}
              style={{
                gridTemplateColumns: columns,
                gridTemplateRows: `repeat(${laneCount},${expanded ? 30 : 42}px)`,
              }}
            >
              <div
                className="lane-label"
                style={{ gridRow: `1 / span ${laneCount}` }}
              >
                <BedDouble size={17} />
              </div>
              {visible.map(
                (d, i) =>
                  isWeekend(d) && (
                    <div
                      key={"we-" + d}
                      className="weekend-band"
                      style={{
                        gridColumn: i + 2,
                        gridRow: `1 / span ${laneCount}`,
                      }}
                    />
                  ),
              )}
              {visible.map(
                (d, i) =>
                  weekStart(d, i) && (
                    <div
                      key={"wk-" + d}
                      className="week-line"
                      style={{
                        gridColumn: i + 2,
                        gridRow: `1 / span ${laneCount}`,
                      }}
                    />
                  ),
              )}
              {stayLanes.map(({ entry, left, right, lane }) => {
                // Short bars (often one night) show the city, not the dates.
                const short =
                  widths
                    .slice(left, Math.max(left + 1, right))
                    .reduce((a, b) => a + b, 0) < 260;
                const dates = `${shortDate(entry.date)}–${shortDate(entry.endDate)}`;
                const booking = bookingState(entry);
                return (
                  <div
                    key={entry.id}
                    className={`stay-bar ${drag?.id === entry.id ? "dragging" : ""} ${short ? "short" : ""} ${booking ? `booking-${booking}` : ""}`}
                    style={{
                      gridColumn: `${left + 2} / span ${Math.max(1, right - left)}`,
                      gridRow: lane + 1,
                    }}
                  >
                    {
                      <button
                        className={`stay-handle start ${entry.date < first ? "clipped" : ""}`}
                        aria-label={`Move check-in of ${entry.title} (arrow keys)`}
                        title="Drag to change check-in"
                        onPointerDown={(e) => startDrag(e, entry, "start")}
                        onKeyDown={(e) => nudge(e, entry, "start")}
                      />
                    }
                    <button
                      className="stay-body"
                      title={`${entry.title} · ${dates}${booking ? ` · ${bookingLabel[booking]}` : ""}\nDrag to move the stay, click to edit`}
                      onPointerDown={(e) => startDrag(e, entry, "move")}
                      onKeyDown={(e) => nudge(e, entry, "move")}
                      onClick={() => {
                        if (!dragged.current) onEdit(entry);
                        dragged.current = false;
                      }}
                    >
                      {booking && <BookingTag state={booking} />}
                      <BedDouble size={14} />
                      <strong>
                        {short ? entry.city || entry.title : entry.title}
                      </strong>
                      {!short && <span>{dates}</span>}
                      {!!entry.attachments?.length && (
                        <Paperclip
                          size={12}
                          aria-label={`${entry.attachments.length} attachments`}
                        />
                      )}
                    </button>
                    {
                      <button
                        className={`stay-handle end ${entry.endDate > visible.at(-1)! ? "clipped" : ""}`}
                        aria-label={`Move checkout of ${entry.title} (arrow keys)`}
                        title="Drag to change checkout"
                        onPointerDown={(e) => startDrag(e, entry, "end")}
                        onKeyDown={(e) => nudge(e, entry, "end")}
                      />
                    }
                  </div>
                );
              })}
              {visible.map(
                (d, i) =>
                  !stayEntries.some((e) => e.date <= d && e.endDate > d) &&
                  d < trip.end &&
                  (scenario.entries.some(
                    (e) =>
                      e.type === "transport" &&
                      e.status !== "idea" &&
                      e.date <= d &&
                      e.endDate > d,
                  ) ? (
                    <div
                      key={d}
                      className="night-transit"
                      style={{ gridColumn: i + 2, gridRow: 1 }}
                    >
                      <TrainFront size={13} />
                      In transit
                    </div>
                  ) : (
                    <button
                      key={d}
                      className="empty-stay"
                      style={{ gridColumn: i + 2, gridRow: 1 }}
                      onClick={() => onAdd(d, undefined, "stay")}
                    >
                      <Plus size={13} />
                      Add stay
                    </button>
                  )),
              )}
            </div>
            <div
              className="all-day-grid"
              style={{
                gridTemplateColumns: columns,
              }}
            >
              <div className="lane-label">Day</div>
              {visible.map((d, i) => (
                <div
                  className={`all-day-cell ${isWeekend(d) ? "weekend" : ""} ${weekStart(d, i) ? "week-start" : ""}`}
                  key={d}
                >
                  {entriesOn(scenario, d)
                    .filter((e) => e.allDay && e.type !== "stay")
                    .map((e) => (
                      <EntryCard
                        key={e.id}
                        entry={e}
                        compact
                        onClick={() => onEdit(e)}
                      />
                    ))}
                </div>
              ))}
            </div>
          </div>
          <div
            className="time-grid"
            style={{
              gridTemplateColumns: columns,
            }}
          >
            <div className="hours" style={{ height: hours * hourPx }}>
              {Array.from({ length: hours }, (_, i) => firstHour + i)
                .filter((h) => h % labelStep === 0)
                .map((h) => (
                  <span
                    key={h}
                    className={h % 6 === 0 ? "anchor" : ""}
                    style={{ top: y(h) }}
                  >
                    {String(h).padStart(2, "0")}:00
                  </span>
                ))}
            </div>
            {visible.map((d, dayIndex) => (
              <div
                key={d}
                className={`day-column ${isWeekend(d) ? "weekend" : ""} ${weekStart(d, dayIndex) ? "week-start" : ""}`}
                style={{ height: hours * hourPx }}
                onDragOver={(e) => {
                  if (!moving) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const next = landingAt(e, d);
                  if (
                    next &&
                    (next.date !== landing?.date || next.at !== landing?.at)
                  )
                    setLanding(next);
                }}
                onDrop={(e) => {
                  const next = landingAt(e, d);
                  if (!moving || !next) return;
                  e.preventDefault();
                  onMove(moving.id, next.date, clock(next.at));
                  setMoving(null);
                  setLanding(null);
                }}
              >
                {Array.from({ length: hours }, (_, i) => (
                  <button
                    key={i}
                    className={`time-slot ${(firstHour + i) % 6 === 0 ? "anchor" : ""} ${hourPx >= 44 ? "halves" : ""}`}
                    aria-label={`Add on ${shortDate(d)} at ${firstHour + i}:00`}
                    style={{ top: i * hourPx, height: hourPx }}
                    onClick={() =>
                      onAdd(d, `${String(firstHour + i).padStart(2, "0")}:00`)
                    }
                  >
                    {(firstHour + i) % labelStep === 0 && (
                      <span>
                        <Plus size={12} />
                      </span>
                    )}
                  </button>
                ))}
                {placed[dayIndex].map((item) => {
                  const { entry } = item;
                  const box = boxes[dayIndex].get(item)!;
                  const where = across(item, widths[dayIndex]);
                  const height = Math.round(box.height - 4);
                  return (
                    <div
                      className={`positioned-event ${item.host ? "nested" : ""} ${moving?.id === entry.id ? "drag-source" : ""}`}
                      key={entry.id}
                      onDragStart={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        e.dataTransfer.setDragImage(blank, 0, 0);
                        const length =
                          (Date.parse(`${entry.endDate}T${entry.endTime}:00Z`) -
                            Date.parse(
                              `${entry.date}T${entry.startTime}:00Z`,
                            )) /
                          3600000;
                        // Cards may be drawn a little off their times, so
                        // keep the grab point as a share of the card.
                        const grab =
                          Math.min(
                            Math.max(0, (e.clientY - rect.top) / rect.height),
                            1,
                          ) *
                            (item.end - item.start) || 0;
                        // Changing the page during dragstart can cancel the drag.
                        setTimeout(() =>
                          setMoving({
                            id: entry.id,
                            title: entry.title,
                            type: entry.type,
                            grab: entry.date < d ? 0 : grab,
                            length: Math.max(0.25, length),
                          }),
                        );
                      }}
                      onDragEnd={() => {
                        setMoving(null);
                        setLanding(null);
                      }}
                      style={
                        {
                          top: box.top + 2,
                          height,
                          "--h": `${height}px`,
                          left: where.left,
                          width: where.width,
                        } as React.CSSProperties
                      }
                    >
                      <EntryCard
                        entry={entry}
                        onClick={() => onEdit(entry)}
                        draggable
                        height={height}
                        width={where.px}
                        onDate={d}
                      />
                    </div>
                  );
                })}
                {prayerMarks[dayIndex]
                  .filter((p) => p.at >= firstHour)
                  .map((p) => (
                    <div
                      key={p.name}
                      className="prayer-mark"
                      style={{ top: y(p.at) }}
                      title={`${p.name} ${clock(p.at)} · ${whereabouts[dayIndex]!.city}`}
                    >
                      <span>
                        {p.name} {clock(p.at)}
                      </span>
                    </div>
                  ))}
                {!exporting && d === now.date && now.hour >= firstHour && (
                  <div
                    className="now-line"
                    style={{ top: y(now.hour) }}
                    title={`Now ${clock(now.hour)}`}
                  />
                )}
                {moving && landing?.date === d && (
                  <div
                    className={`drop-preview event-${moving.type}`}
                    style={{
                      top: y(landing.at) + 2,
                      height: Math.max(
                        22,
                        y(Math.min(24, landing.at + moving.length)) -
                          y(landing.at) -
                          4,
                      ),
                    }}
                  >
                    <span>
                      {clock(landing.at)}–{clock(landing.at + moving.length)}
                      {landing.at + moving.length > 24 &&
                        ` +${Math.floor((landing.at + moving.length) / 24)}`}
                    </span>
                    <strong>{moving.title}</strong>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
export function Agenda({
  trip,
  scenario,
  onEdit,
  onAdd,
  exporting = false,
  only,
  weekHeadings,
  places,
  context,
}: {
  trip: Trip;
  scenario: Scenario;
  onEdit: (e: Entry) => void;
  onAdd: (date: string) => void;
  exporting?: boolean;
  /** Exact days to show, for exporting one week at a time. */
  only?: [string, string];
  /** Overrides the saved choice for numbered week headings. */
  weekHeadings?: boolean;
  /** Saved places, for each day's weather (shown when given). */
  places?: Place[];
  /** The unfiltered plan, so hidden hotels still say where each day is. */
  context?: Scenario;
}) {
  // Numbered Monday-to-Sunday weeks, as on the timeline.
  const weeks =
    weekHeadings ?? localStorage.getItem("fieldnotes-weeks") !== "off";
  const all = only ? days(only[0], only[1]) : days(trip.start, trip.end);
  // Same setting as the timeline's Weather button.
  const showWeather =
    !!places &&
    !exporting &&
    localStorage.getItem("fieldnotes-weather") !== "off";
  const where = useWhereabouts(
    context || scenario,
    places || [],
    all,
    showWeather,
  );
  const weather = useWeather(where, all, showWeather);
  const weekOf = (d: string) =>
    Math.round(
      (Date.parse(mondayOf(d)) - Date.parse(mondayOf(trip.start))) /
        (7 * 86400000),
    ) + 1;
  return (
    <div className={`agenda ${exporting ? "exporting" : ""}`}>
      {all.map((d, i) => (
        <Fragment key={d}>
          {weeks && (i === 0 || mondayOf(d) === d) && (
            <div className="agenda-week">
              <strong>Week {weekOf(d)}</strong>
              <span>
                {shortDate(d)} –{" "}
                {shortDate([addDays(mondayOf(d), 6), trip.end].sort()[0])}
              </span>
            </div>
          )}
          <section className={`agenda-day ${isWeekend(d) ? "weekend" : ""}`}>
            <div className="agenda-date">
              <span>{weekday(d)}</span>
              <strong>{shortDate(d)}</strong>
              {weather[i] && (
                <WeatherBadge weather={weather[i]!} rain={false} />
              )}
              <button
                className="icon-button"
                aria-label={`Add plan on ${shortDate(d)}`}
                onClick={() => onAdd(d)}
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="agenda-entries">
              {entriesOn(scenario, d)
                .sort(
                  (a, b) =>
                    (a.type === "stay" ? -1 : 0) -
                      (b.type === "stay" ? -1 : 0) ||
                    a.startTime.localeCompare(b.startTime),
                )
                .map((e) =>
                  e.type === "stay" ? (
                    <button
                      className="agenda-stay"
                      key={e.id}
                      onClick={() => onEdit(e)}
                    >
                      <BedDouble size={16} />
                      {e.title}
                      {!!e.attachments?.length && (
                        <Paperclip
                          size={13}
                          aria-label={`${e.attachments.length} attachments`}
                        />
                      )}
                    </button>
                  ) : (
                    <EntryCard
                      key={e.id}
                      entry={e}
                      onClick={() => onEdit(e)}
                      onDate={d}
                    />
                  ),
                )}
              {!entriesOn(scenario, d).length && exporting && (
                <span className="free-day">Free day</span>
              )}
              {!entriesOn(scenario, d).length && !exporting && (
                <button className="empty-day" onClick={() => onAdd(d)}>
                  <Plus size={16} />
                  Plan this day
                </button>
              )}
            </div>
          </section>
        </Fragment>
      ))}
    </div>
  );
}

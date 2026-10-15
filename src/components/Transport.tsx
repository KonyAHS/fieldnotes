import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Copy,
  Trash2,
  Pencil,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Split,
  Check,
  AlertTriangle,
  CalendarDays,
  TrainFront,
  Plane,
  Ship,
  Bus,
  CarTaxiFront,
  Footprints,
  TramFront,
  Route,
  GripVertical,
  Ticket,
  Paperclip,
  Link2,
  Phone,
} from "lucide-react";
import { AttachmentViewer, TicketDetails } from "./Attachments";
import {
  type Entry,
  type Trip,
  type Scenario,
  type Place,
  addDays,
  shortDate,
  weekday,
  zone,
  currency,
  uid,
  instant,
  countryMeta,
  type Attachment,
  hasTicket,
  phoneLink,
  webLink,
} from "../model";
import {
  type Leg,
  type RouteOption,
  transportLegs,
  shiftTime,
  arrivalDate,
  ensureOption,
  durationText,
} from "../transport";
import { mutate, notify } from "../sync";
import { modeOptions } from "../transportModes";
import { RouteMap } from "./RouteMap";
import { RoutePreview } from "./RoutePreview";
import { useLocate } from "../routeGeometry";
const ModeIcon = ({ mode, size = 15 }: { mode: string; size?: number }) => {
  const Icon =
    {
      Train: TrainFront,
      Shinkansen: TrainFront,
      Flight: Plane,
      Ferry: Ship,
      Bus: Bus,
      Taxi: CarTaxiFront,
      Metro: TramFront,
      Walk: Footprints,
    }[mode] || Route;
  return <Icon size={size} aria-label={mode} />;
};
type Rates = { base: string; rates: Record<string, number>; updated: string };
type Sort = "depart" | "duration" | "price";
// Search sites for comparing schedules and fares on a leg.
function searchLinks(leg: Leg, date: string) {
  const from = encodeURIComponent(leg.from),
    to = encodeURIComponent(leg.to);
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const links = [
    {
      name: "Google Maps",
      url: `https://www.google.com/maps/dir/?api=1&origin=${from}&destination=${to}&travelmode=transit`,
    },
    { name: "Rome2rio", url: `https://www.rome2rio.com/map/${from}/${to}` },
    {
      name: "Google Flights",
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${leg.from} to ${leg.to} on ${date}`)}`,
    },
    {
      name: "12Go",
      url: `https://12go.asia/en/travel/${slug(leg.from)}/${slug(leg.to)}`,
    },
  ];
  const countries = new Set([leg.fromCountry, leg.toCountry]);
  if (countries.has("Japan"))
    links.push({
      name: "Japan Transit Planner",
      url: "https://world.jorudan.co.jp/mln/en/",
    });
  if (countries.has("Korea"))
    links.push(
      { name: "Korail", url: "https://www.letskorail.com/" },
      { name: "Kobus (express bus)", url: "https://www.kobus.co.kr/" },
    );
  if (countries.has("China"))
    links.push(
      { name: "Trip.com trains", url: "https://www.trip.com/trains/china/" },
      { name: "12306", url: "https://www.12306.cn/en/" },
    );
  return links;
}
// Small buttons on a route for what is saved with it: the ticket file opens
// straight away, the link opens the booking page, the phone number dials.
function TicketChips({
  segments,
  onView,
  onOpen,
}: {
  segments: Entry[];
  onView: (a: Attachment) => void;
  onOpen: (id: string) => void;
}) {
  const files = segments.flatMap((s) => s.attachments || []);
  const link = segments.find((s) => s.ticketUrl?.trim());
  const call = segments.find((s) => s.phone?.trim());
  if (!files.length && !link && !call) return null;
  return (
    <span className="ticket-chips">
      {files.length > 0 && (
        <button
          className="ticket-chip"
          title={
            files.length > 1
              ? `${files.length} tickets — click to see them`
              : `Open ${files[0].name}`
          }
          onClick={() =>
            files.length > 1
              ? onOpen(segments.find((s) => s.attachments?.length)!.id)
              : onView(files[0])
          }
        >
          <Paperclip size={12} />
          {files.length > 1 ? `${files.length} tickets` : "Ticket"}
        </button>
      )}
      {link && (
        <a
          className="ticket-chip"
          href={webLink(link.ticketUrl!)}
          target="_blank"
          rel="noreferrer"
          title={link.ticketUrl}
        >
          <Link2 size={12} />
          {link.status === "booked" ? "Booking" : "Buy"}
        </a>
      )}
      {call && (
        <a
          className="ticket-chip"
          href={phoneLink(call.phone!)}
          title={`Call ${call.phone}`}
        >
          <Phone size={12} />
          {call.phone}
        </a>
      )}
    </span>
  );
}
export function Transport({
  trip,
  scenario,
  places,
  onEdit,
  onShowDay,
}: {
  trip: Trip;
  scenario: Scenario;
  places: Place[];
  onEdit: (e: Entry) => void;
  onShowDay: (date: string) => void;
}) {
  const legs = useMemo(() => transportLegs(trip, scenario), [trip, scenario]);
  const locate = useLocate();
  const [sort, setSort] = useState<Sort>("depart");
  const [rates, setRates] = useState<Rates | null>(null);
  const [splitting, setSplitting] = useState<{
    id: string;
    via: string;
  } | null>(null);
  const [confirm, setConfirm] = useState("");
  // The route part whose tickets panel is open, and a ticket being viewed.
  const [tickets, setTickets] = useState("");
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [journey, setJourney] = useState<{
    from: string;
    fromCountry: string;
    to: string;
    toCountry: string;
    date: string;
  } | null>(null);
  const home = trip.homeCurrency || "SAR";
  useEffect(() => {
    fetch(`/api/rates?base=${encodeURIComponent(home)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setRates)
      .catch(() => {});
  }, [home]);
  // Total price in the home currency, when every part has a price and rate.
  const converted = (o: RouteOption) => {
    if (!o.priced || !Object.keys(o.costs).length) return null;
    let sum = 0;
    for (const [cur, v] of Object.entries(o.costs)) {
      const rate = cur === home ? 1 : rates?.rates[cur];
      if (!rate) return null;
      sum += v / rate;
    }
    return sum;
  };
  const update = (change: (entries: Entry[]) => void) =>
    mutate((d) =>
      change(
        d.trips
          .find((t) => t.id === trip.id)!
          .scenarios.find((s) => s.id === scenario.id)!.entries,
      ),
    );
  const edit = (id: string, change: (e: Entry) => void) =>
    update((entries) => {
      const e = entries.find((x) => x.id === id);
      if (e) change(e);
    });
  function choose(leg: Leg, o: RouteOption) {
    update((entries) => {
      for (const other of leg.options) {
        ensureOption(other, entries);
        for (const s of other.segments) {
          const e = entries.find((x) => x.id === s.id)!;
          if (other.id === o.id) {
            if (e.status === "idea") e.status = "planned";
          } else if (e.status === "planned") e.status = "idea";
        }
      }
    });
  }
  function newSegment(leg: Leg, date: string, status: Entry["status"]): Entry {
    return {
      id: uid(),
      type: "transport",
      title: `${leg.from} → ${leg.to}`,
      date,
      endDate: date,
      startTime: "10:00",
      endTime: "12:00",
      allDay: false,
      country: leg.fromCountry,
      city: leg.from,
      toCountry: leg.toCountry,
      toCity: leg.to,
      timezone: zone(leg.fromCountry),
      endTimezone: zone(leg.toCountry),
      scope: "intercity",
      mode: "Train",
      placeId: "",
      status,
      notes: "",
      bookingRef: "",
      cost: null,
      currency: currency(leg.fromCountry),
      refundDeadline: "",
      option: uid(),
      provider: "",
    };
  }
  function addOption(leg: Leg) {
    // The first route for a gap is chosen straight away; later ones are
    // alternatives until chosen.
    const chosen = leg.options.some((o) => o.status !== "alternative");
    update((entries) => {
      entries.push(newSegment(leg, leg.earliest, chosen ? "idea" : "planned"));
    });
  }
  function duplicate(o: RouteOption) {
    const id = uid();
    update((entries) => {
      for (const s of o.segments)
        entries.push({
          ...structuredClone(s),
          id: uid(),
          option: id,
          status: "idea",
          bookingRef: "",
        });
    });
  }
  function remove(o: RouteOption) {
    const ids = new Set(o.segments.map((s) => s.id));
    update((entries) => {
      for (let i = entries.length - 1; i >= 0; i--)
        if (ids.has(entries[i].id)) entries.splice(i, 1);
    });
    setConfirm("");
  }
  function shiftDays(o: RouteOption, days: number) {
    update((entries) => {
      for (const s of o.segments) {
        const e = entries.find((x) => x.id === s.id)!;
        e.date = addDays(e.date, days);
        e.endDate = addDays(e.endDate, days);
      }
    });
  }
  // Moving the departure moves the whole route, keeping its durations.
  function retime(o: RouteOption, time: string) {
    const first = o.segments[0];
    if (!time) return;
    const minutes =
      (Date.parse(`2000-01-01T${time}:00Z`) -
        Date.parse(`2000-01-01T${first.startTime}:00Z`)) /
      60000;
    update((entries) => {
      for (const s of o.segments) {
        const e = entries.find((x) => x.id === s.id)!;
        const a = shiftTime(e.date, e.startTime, minutes),
          b = shiftTime(e.endDate, e.endTime, minutes);
        e.date = a.date;
        e.startTime = a.time;
        e.endDate = b.date;
        e.endTime = b.time;
      }
    });
  }
  function moveSegment(s: Entry, time: string) {
    if (!time) return;
    const minutes =
      (Date.parse(`2000-01-01T${time}:00Z`) -
        Date.parse(`2000-01-01T${s.startTime}:00Z`)) /
      60000;
    edit(s.id, (e) => {
      const a = shiftTime(e.date, e.startTime, minutes),
        b = shiftTime(e.endDate, e.endTime, minutes);
      e.date = a.date;
      e.startTime = a.time;
      e.endDate = b.date;
      e.endTime = b.time;
    });
  }
  // Insert a change: A→B becomes A→via and via→B. The original departure
  // and arrival are kept; the time between is split around a short change.
  function split(o: RouteOption, s: Entry, via: string) {
    if (!via.trim()) return;
    update((entries) => {
      const id = ensureOption(o, entries);
      const e = entries.find((x) => x.id === s.id)!;
      const total = Math.max(
        10,
        Math.round(
          (instant(e.endDate, e.endTime, e.endTimezone) -
            instant(e.date, e.startTime, e.timezone)) /
            60000,
        ),
      );
      const change = Math.min(30, Math.round(total / 4));
      const ride = Math.round((total - change) / 2);
      // Work in departure-zone wall time, then express the arrival in its zone.
      const mid = shiftTime(e.date, e.startTime, ride);
      const next = shiftTime(mid.date, mid.time, change);
      const second: Entry = {
        ...structuredClone(e),
        id: uid(),
        option: id,
        city: via.trim(),
        country: e.toCountry || e.country,
        timezone: e.timezone,
        date: next.date,
        startTime: next.time,
        cost: null,
        bookingRef: "",
        provider: "",
        title: `${via.trim()} → ${e.toCity}`,
      };
      e.toCity = via.trim();
      e.toCountry = e.toCountry || e.country;
      e.endTimezone = e.timezone;
      e.endDate = mid.date;
      e.endTime = mid.time;
      e.title = `${e.city} → ${via.trim()}`;
      entries.push(second);
    });
    setSplitting(null);
  }
  function removeSegment(o: RouteOption, s: Entry) {
    const i = o.segments.findIndex((x) => x.id === s.id);
    update((entries) => {
      ensureOption(o, entries);
      // Join the neighbouring segments so the route still connects.
      const before =
        i > 0 ? entries.find((x) => x.id === o.segments[i - 1].id) : null;
      if (before) {
        before.toCity = s.toCity;
        before.toCountry = s.toCountry;
        before.endTimezone = s.endTimezone;
        before.endDate = s.endDate;
        before.endTime = s.endTime;
        before.title = `${before.city} → ${s.toCity}`;
      } else {
        const after = entries.find((x) => x.id === o.segments[1]?.id);
        if (after) {
          after.city = s.city;
          after.country = s.country;
          after.timezone = s.timezone;
          after.date = s.date;
          after.startTime = s.startTime;
          after.title = `${s.city} → ${after.toCity}`;
        }
      }
      const j = entries.findIndex((x) => x.id === s.id);
      if (j >= 0) entries.splice(j, 1);
    });
  }
  function addJourney() {
    if (!journey || !journey.from.trim() || !journey.to.trim()) return;
    const leg: Leg = {
      key: "new",
      from: journey.from.trim(),
      fromCountry: journey.fromCountry,
      to: journey.to.trim(),
      toCountry: journey.toCountry,
      earliest: journey.date,
      latest: journey.date,
      options: [],
    };
    update((entries) => {
      entries.push(newSegment(leg, journey.date, "planned"));
    });
    setJourney(null);
  }
  // Move a route to another journey: its first departure and last arrival
  // take that journey's cities, and its dates move into the journey's window.
  function moveRoute(o: RouteOption, to: Leg) {
    const window = to.fromStay ? to.fromStay.endDate : to.earliest;
    const shift =
      o.date >= to.earliest && o.date <= to.latest
        ? 0
        : Math.round((Date.parse(window) - Date.parse(o.date)) / 86400000);
    const taken = to.options.some((x) => x.status !== "alternative");
    update((entries) => {
      ensureOption(o, entries);
      const segs = o.segments.map((s) => entries.find((x) => x.id === s.id)!);
      // Titles still reading "From → To" follow the new cities.
      const named = segs.map((e) => e.title === `${e.city} → ${e.toCity}`);
      const first = segs[0],
        last = segs.at(-1)!;
      first.city = to.from;
      first.country = to.fromCountry;
      first.timezone = zone(to.fromCountry);
      last.toCity = to.to;
      last.toCountry = to.toCountry;
      last.endTimezone = zone(to.toCountry);
      segs.forEach((e, i) => {
        if (named[i]) e.title = `${e.city} → ${e.toCity}`;
        e.date = addDays(e.date, shift);
        e.endDate = addDays(e.endDate, shift);
        // One chosen route per journey: join as an alternative if needed.
        if (taken && e.status === "planned") e.status = "idea";
        if (!taken && e.status === "idea") e.status = "planned";
      });
    });
    notify(`Moved ${o.modes.join(" + ")} route to ${to.from} → ${to.to}`);
  }
  // Dragging a route by its handle; works with mouse, pen and touch.
  const [dragging, setDragging] = useState<{
    option: RouteOption;
    leg: Leg;
    x: number;
    y: number;
    over: string | null;
  } | null>(null);
  const [moveMenu, setMoveMenu] = useState("");
  const pointerY = useRef(0);
  // Scroll the page while a route is held near the top or bottom edge.
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const y = pointerY.current,
        edge = 70;
      if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 5));
      else if (y > window.innerHeight - edge)
        window.scrollBy(0, Math.ceil((y - window.innerHeight + edge) / 5));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [!!dragging]);
  function startRouteDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    option: RouteOption,
    leg: Leg,
  ) {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    const x0 = event.clientX,
      y0 = event.clientY;
    let started = false;
    let over: string | null = null;
    const legAt = (x: number, y: number) => {
      const card = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-leg]");
      return card && card.dataset.leg !== leg.key ? card.dataset.leg! : null;
    };
    const move = (e: PointerEvent) => {
      if (!started && Math.hypot(e.clientX - x0, e.clientY - y0) < 6) return;
      if (!started) handle.setPointerCapture(e.pointerId);
      started = true;
      pointerY.current = e.clientY;
      over = legAt(e.clientX, e.clientY);
      setDragging({ option, leg, x: e.clientX, y: e.clientY, over });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      setDragging(null);
      if (!started) {
        // A plain click opens the list of journeys instead.
        setMoveMenu((m) => (m === option.id ? "" : option.id));
        return;
      }
      const target = legs.find((l) => l.key === over);
      if (target) moveRoute(option, target);
    };
    const cancel = () => {
      over = null;
      up();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
  }
  const chosenCount = legs.filter((l) =>
    l.options.some((o) => o.status !== "alternative"),
  ).length;
  const countries = [
    ...new Set([
      ...Object.keys(countryMeta),
      ...legs.flatMap((l) => [l.fromCountry, l.toCountry]),
    ]),
  ];
  return (
    <div className="transport-view">
      <RouteMap scenario={scenario} places={places} />
      <div className="transport-summary">
        <span>
          <strong>{legs.length}</strong> journeys ·{" "}
          <strong>{chosenCount}</strong> chosen
          {legs.length - chosenCount > 0 && (
            <span className="needs">
              {" "}
              · <AlertTriangle size={13} /> {legs.length - chosenCount} need
              transport
            </span>
          )}
        </span>
        <div className="spacer" />
        <label className="sort-label">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="depart">Departure</option>
            <option value="duration">Duration</option>
            <option value="price">Price</option>
          </select>
        </label>
        <button
          className="button"
          onClick={() =>
            setJourney({
              from: "",
              fromCountry: "Japan",
              to: "",
              toCountry: "Japan",
              date: trip.start,
            })
          }
        >
          <Plus size={15} />
          Add journey
        </button>
      </div>
      {journey && (
        <div className="journey-form">
          <input
            aria-label="From city"
            placeholder="From city"
            value={journey.from}
            onChange={(e) => setJourney({ ...journey, from: e.target.value })}
          />
          <select
            aria-label="From country"
            value={journey.fromCountry}
            onChange={(e) =>
              setJourney({ ...journey, fromCountry: e.target.value })
            }
          >
            {countries.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span>→</span>
          <input
            aria-label="To city"
            placeholder="To city"
            value={journey.to}
            onChange={(e) => setJourney({ ...journey, to: e.target.value })}
          />
          <select
            aria-label="To country"
            value={journey.toCountry}
            onChange={(e) =>
              setJourney({ ...journey, toCountry: e.target.value })
            }
          >
            {countries.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input
            aria-label="Journey date"
            type="date"
            value={journey.date}
            onChange={(e) => setJourney({ ...journey, date: e.target.value })}
          />
          <button className="button primary" onClick={addJourney}>
            Add
          </button>
          <button className="text-button" onClick={() => setJourney(null)}>
            Cancel
          </button>
        </div>
      )}
      {legs.map((leg) => {
        const sorted = [...leg.options].sort((a, b) =>
          sort === "duration"
            ? a.minutes - b.minutes
            : sort === "price"
              ? (converted(a) ?? Infinity) - (converted(b) ?? Infinity)
              : a.depart - b.depart,
        );
        const chosen = leg.options.find((o) => o.status !== "alternative");
        const booked = leg.options.filter((o) => o.status === "booked");
        const priced = leg.options.filter((o) => converted(o) !== null);
        const cheapest =
          priced.length > 1
            ? priced.reduce((a, b) => (converted(a)! <= converted(b)! ? a : b))
            : null;
        const fastest =
          leg.options.length > 1
            ? leg.options.reduce((a, b) => (a.minutes <= b.minutes ? a : b))
            : null;
        // Timing scale: whole days around the leg and its options.
        const tz = zone(leg.fromCountry);
        const firstDay = [
          leg.earliest,
          ...leg.options.map((o) => o.date),
        ].sort()[0];
        const lastDay = [
          leg.latest,
          ...leg.options.map((o) => o.segments.at(-1)!.endDate),
        ]
          .sort()
          .at(-1)!;
        const scaleStart = instant(firstDay, "00:00", tz);
        const scaleEnd = instant(addDays(lastDay, 1), "00:00", tz);
        const span = scaleEnd - scaleStart;
        const dayCount = Math.round(span / 86400000);
        const pct = (t: number) =>
          Math.max(0, Math.min(100, ((t - scaleStart) / span) * 100));
        return (
          <section
            className={`leg-card ${dragging ? (dragging.leg.key === leg.key ? "drag-origin" : dragging.over === leg.key ? "drop-target" : "droppable") : ""}`}
            key={leg.key}
            data-leg={leg.key}
          >
            {dragging && dragging.over === leg.key && (
              <div className="drop-banner">
                Drop to move this route to {leg.from} → {leg.to}
                {leg.options.some((x) => x.status !== "alternative") &&
                  " (as an alternative)"}
              </div>
            )}
            <div className="leg-top">
              <RoutePreview leg={leg} places={places} locate={locate} />
              <div className="leg-main">
                <header className="leg-header">
                  <div>
                    <h2>
                      {leg.from} <span className="arrow">→</span> {leg.to}
                    </h2>
                    <p className="leg-window">
                      {leg.fromStay && leg.toStay ? (
                        <>
                          Leave {leg.fromStay.title} (checkout{" "}
                          {weekday(leg.fromStay.endDate)}{" "}
                          {shortDate(leg.fromStay.endDate)}{" "}
                          {leg.fromStay.endTime}) · arrive for{" "}
                          {leg.toStay.title} (check-in{" "}
                          {weekday(leg.toStay.date)}{" "}
                          {shortDate(leg.toStay.date)} {leg.toStay.startTime})
                        </>
                      ) : (
                        <>
                          Journey · {weekday(leg.earliest)}{" "}
                          {shortDate(leg.earliest)}
                          {leg.latest !== leg.earliest &&
                            ` – ${shortDate(leg.latest)}`}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="leg-state">
                    {chosen ? (
                      <span className={`leg-chip ${chosen.status}`}>
                        <Check size={13} />
                        {chosen.status === "booked" ? "Booked" : "Chosen"}:{" "}
                        {chosen.modes.join(" + ")} ·{" "}
                        {durationText(chosen.minutes)}
                      </span>
                    ) : (
                      <span className="leg-chip missing">
                        <AlertTriangle size={13} /> No transport chosen
                      </span>
                    )}
                    <button
                      className="icon-button"
                      title="Show this day in the itinerary"
                      aria-label={`Show ${shortDate(leg.earliest)} in the itinerary`}
                      onClick={() => onShowDay(chosen?.date || leg.earliest)}
                    >
                      <CalendarDays size={16} />
                    </button>
                  </div>
                </header>
                {booked.length > 1 && (
                  <div className="notice error">
                    <AlertTriangle size={15} /> More than one route is booked
                    for this journey. Cancel the one you won't use.
                  </div>
                )}
                <div className="leg-links">
                  <span>Compare:</span>
                  {searchLinks(leg, chosen?.date || leg.earliest).map((l) => (
                    <a
                      key={l.name}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {l.name}
                      <ExternalLink size={11} />
                    </a>
                  ))}
                </div>
              </div>
            </div>
            {sorted.length > 0 && (
              <div className="option-scale" aria-hidden="true">
                <span />
                <div className="scale-track">
                  {Array.from({ length: dayCount }, (_, i) => {
                    const d = addDays(firstDay, i);
                    return (
                      <span
                        key={d}
                        style={{ left: `${(i / dayCount) * 100}%` }}
                        className={
                          leg.fromStay && (d < leg.earliest || d > leg.latest)
                            ? "outside"
                            : ""
                        }
                      >
                        {weekday(d)} {shortDate(d)}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {sorted.map((o) => {
              const total = converted(o);
              const hints: string[] = [];
              if (leg.fromStay && o.date < leg.fromStay.endDate)
                hints.push("Leaves before your last night there");
              if (leg.toStay && o.segments.at(-1)!.endDate > leg.toStay.date)
                hints.push("Arrives after the check-in day");
              if (o.waits.some((w) => w < 30)) hints.push("Tight connection");
              if (o.minutes <= 0) hints.push("Arrival is before departure");
              return (
                <div className={`route-option ${o.status}`} key={o.id}>
                  <div className="option-row">
                    <button
                      className="route-grip"
                      aria-label="Move this route to another journey"
                      title="Drag to another journey, or click to choose one"
                      aria-expanded={moveMenu === o.id}
                      onPointerDown={(e) => startRouteDrag(e, o, leg)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setMoveMenu((m) => (m === o.id ? "" : o.id));
                        }
                      }}
                    >
                      <GripVertical size={15} />
                    </button>
                    <label className="option-choose" title="Use this route">
                      <input
                        type="radio"
                        name={`leg-${leg.key}`}
                        checked={o.status !== "alternative"}
                        onChange={() => choose(leg, o)}
                      />
                    </label>
                    <div className="option-route">
                      <span className="option-modes">
                        {o.segments.map((s, i) => (
                          <span key={s.id}>
                            {i > 0 && <span className="via">{s.city}</span>}
                            <ModeIcon mode={s.mode} />
                          </span>
                        ))}
                      </span>
                      <strong>
                        {o.modes.join(" + ")}
                        {o.segments.length > 1 &&
                          ` · ${o.segments.length - 1} change${o.segments.length > 2 ? "s" : ""}`}
                      </strong>
                      <span className="option-badges">
                        {o.status === "booked" && (
                          <span className="badge booked">Booked</span>
                        )}
                        {fastest?.id === o.id && (
                          <span className="badge">Fastest</span>
                        )}
                        {cheapest?.id === o.id && (
                          <span className="badge">Cheapest</span>
                        )}
                      </span>
                      <TicketChips
                        segments={o.segments}
                        onView={setViewing}
                        onOpen={(id) => setTickets(id)}
                      />
                    </div>
                    <div className="option-date">
                      <button
                        className="icon-button small"
                        aria-label="One day earlier"
                        onClick={() => shiftDays(o, -1)}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <input
                        type="date"
                        aria-label="Departure date"
                        value={o.date}
                        onChange={(e) => {
                          if (!e.target.value) return;
                          shiftDays(
                            o,
                            Math.round(
                              (Date.parse(e.target.value) -
                                Date.parse(o.date)) /
                                86400000,
                            ),
                          );
                        }}
                      />
                      <button
                        className="icon-button small"
                        aria-label="One day later"
                        onClick={() => shiftDays(o, 1)}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                    <div className="option-times">
                      <input
                        type="time"
                        aria-label="Departure time (moves the whole route)"
                        title="Moves the whole route"
                        value={o.segments[0].startTime}
                        onChange={(e) => retime(o, e.target.value)}
                      />
                      <span>→</span>
                      <span className="arrive">
                        {o.segments.at(-1)!.endTime}
                        {o.segments.at(-1)!.endDate !== o.date && (
                          <sup>
                            +
                            {Math.round(
                              (Date.parse(o.segments.at(-1)!.endDate) -
                                Date.parse(o.date)) /
                                86400000,
                            )}
                          </sup>
                        )}
                      </span>
                    </div>
                    <div className="option-duration">
                      {durationText(o.minutes)}
                      {o.waits.length > 0 && (
                        <small>
                          changes{" "}
                          {o.waits.map((w) => durationText(w)).join(", ")}
                        </small>
                      )}
                    </div>
                    <div className="option-price">
                      {Object.keys(o.costs).length ? (
                        <>
                          {Object.entries(o.costs)
                            .map(
                              ([cur, v]) =>
                                `${v.toLocaleString("en", { maximumFractionDigits: 0 })} ${cur}`,
                            )
                            .join(" + ")}
                          {!o.priced && <small>some parts unpriced</small>}
                          {total !== null &&
                            Object.keys(o.costs).some((c) => c !== home) && (
                              <small>
                                ≈ {Math.round(total).toLocaleString("en")}{" "}
                                {home}
                              </small>
                            )}
                        </>
                      ) : (
                        <span className="muted">No price</span>
                      )}
                    </div>
                    <div
                      className="option-timing"
                      title="Departure and arrival"
                    >
                      <div className="timing-track">
                        {o.segments.map((s) => (
                          <span
                            key={s.id}
                            className={`timing-bar mode-${s.mode.toLowerCase()}`}
                            style={{
                              left: `${pct(instant(s.date, s.startTime, s.timezone))}%`,
                              width: `${Math.max(
                                0.8,
                                pct(
                                  instant(s.endDate, s.endTime, s.endTimezone),
                                ) -
                                  pct(instant(s.date, s.startTime, s.timezone)),
                              )}%`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="option-actions">
                      <button
                        className="icon-button"
                        aria-label="Duplicate as an alternative"
                        title="Duplicate as an alternative"
                        onClick={() => duplicate(o)}
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        className={`icon-button ${confirm === o.id ? "danger" : ""}`}
                        aria-label={
                          confirm === o.id
                            ? "Confirm delete route"
                            : "Delete route"
                        }
                        title={
                          confirm === o.id
                            ? "Click again to delete"
                            : "Delete route"
                        }
                        onClick={() =>
                          confirm === o.id ? remove(o) : setConfirm(o.id)
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  {moveMenu === o.id && (
                    <div className="move-route">
                      <span>Move to</span>
                      <select
                        autoFocus
                        aria-label="Journey to move this route to"
                        value=""
                        onChange={(e) => {
                          const target = legs.find(
                            (l) => l.key === e.target.value,
                          );
                          if (target) moveRoute(o, target);
                          setMoveMenu("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setMoveMenu("");
                        }}
                      >
                        <option value="">Choose a journey…</option>
                        {legs
                          .filter((l) => l.key !== leg.key)
                          .map((l) => (
                            <option key={l.key} value={l.key}>
                              {l.from} → {l.to} · {shortDate(l.earliest)}
                            </option>
                          ))}
                      </select>
                      <button
                        className="text-button"
                        onClick={() => setMoveMenu("")}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {hints.length > 0 && (
                    <div className="option-hints">
                      <AlertTriangle size={12} /> {hints.join(" · ")}
                    </div>
                  )}
                  {o.segments.map((s) => (
                    <Fragment key={s.id}>
                      <div className="segment-row">
                        <select
                          aria-label="Mode"
                          value={s.mode}
                          onChange={(e) =>
                            edit(s.id, (x) => (x.mode = e.target.value))
                          }
                        >
                          {modeOptions(s.mode).map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                        <span className="segment-cities">
                          {s.city} → {s.toCity}
                        </span>
                        <input
                          type="time"
                          aria-label={`Departure from ${s.city}`}
                          title="Departure (keeps this part's duration)"
                          value={s.startTime}
                          onChange={(e) => moveSegment(s, e.target.value)}
                        />
                        <input
                          type="time"
                          aria-label={`Arrival in ${s.toCity}`}
                          title="Arrival"
                          value={s.endTime}
                          onChange={(e) => {
                            const t = e.target.value;
                            if (!t) return;
                            edit(s.id, (x) => {
                              x.endTime = t;
                              x.endDate = arrivalDate(x, t);
                            });
                          }}
                        />
                        <input
                          className="segment-provider"
                          aria-label="Operator and service"
                          placeholder="Operator / no."
                          value={s.provider || ""}
                          onChange={(e) =>
                            edit(s.id, (x) => (x.provider = e.target.value))
                          }
                        />
                        <input
                          className="segment-cost"
                          type="number"
                          min="0"
                          step="any"
                          aria-label="Price"
                          placeholder="Price"
                          value={s.cost ?? ""}
                          onChange={(e) =>
                            edit(s.id, (x) => {
                              x.cost =
                                e.target.value === ""
                                  ? null
                                  : Math.max(0, Number(e.target.value));
                            })
                          }
                        />
                        <input
                          className="segment-currency"
                          aria-label="Currency"
                          maxLength={3}
                          value={s.currency}
                          onChange={(e) =>
                            edit(
                              s.id,
                              (x) =>
                                (x.currency = e.target.value.toUpperCase()),
                            )
                          }
                        />
                        {splitting?.id === s.id ? (
                          <span className="split-form">
                            <input
                              autoFocus
                              aria-label="Change at city"
                              placeholder="Change at…"
                              value={splitting.via}
                              onChange={(e) =>
                                setSplitting({ id: s.id, via: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  split(o, s, splitting.via);
                                if (e.key === "Escape") setSplitting(null);
                              }}
                            />
                            <button
                              className="text-button"
                              onClick={() => split(o, s, splitting.via)}
                            >
                              Add
                            </button>
                          </span>
                        ) : (
                          <button
                            className="icon-button small"
                            aria-label="Add a change of transport"
                            title="Add a change (connection) on this part"
                            onClick={() => setSplitting({ id: s.id, via: "" })}
                          >
                            <Split size={14} />
                          </button>
                        )}
                        <button
                          className={`ticket-toggle ${hasTicket(s) ? "has" : ""} ${tickets === s.id ? "open" : ""}`}
                          aria-expanded={tickets === s.id}
                          title="Ticket file, link to buy, phone number"
                          onClick={() =>
                            setTickets((t) => (t === s.id ? "" : s.id))
                          }
                        >
                          <Ticket size={14} />
                          {hasTicket(s) ? "Ticket" : "Add ticket"}
                          {!!s.attachments?.length && (
                            <span className="ticket-count">
                              {s.attachments.length}
                            </span>
                          )}
                        </button>
                        <button
                          className="icon-button small"
                          aria-label="Edit all details"
                          title="All details"
                          onClick={() => onEdit(s)}
                        >
                          <Pencil size={14} />
                        </button>
                        {o.segments.length > 1 && (
                          <button
                            className="icon-button small"
                            aria-label="Remove this part"
                            title="Remove this part (joins its neighbours)"
                            onClick={() => removeSegment(o, s)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      {tickets === s.id && (
                        <div className="ticket-panel">
                          <div className="ticket-panel-head">
                            <strong>
                              <Ticket size={14} /> Ticket for {s.city} →{" "}
                              {s.toCity}
                            </strong>
                            <button
                              className="text-button"
                              onClick={() => setTickets("")}
                            >
                              Done
                            </button>
                          </div>
                          <TicketDetails
                            entry={s}
                            onChange={(patch) =>
                              edit(s.id, (x) => Object.assign(x, patch))
                            }
                          />
                        </div>
                      )}
                    </Fragment>
                  ))}
                </div>
              );
            })}
            <button
              className="text-button add-option"
              onClick={() => addOption(leg)}
            >
              <Plus size={14} />
              {leg.options.length ? "Add an alternative" : "Add a route"}
            </button>
          </section>
        );
      })}
      {viewing && (
        <AttachmentViewer
          attachment={viewing}
          onClose={() => setViewing(null)}
        />
      )}
      {dragging && (
        <div
          className="route-ghost"
          style={{ left: dragging.x + 14, top: dragging.y + 10 }}
        >
          <ModeIcon mode={dragging.option.segments[0].mode} />
          <strong>
            {dragging.option.from} → {dragging.option.to}
          </strong>
          <span>
            {(() => {
              const l = legs.find((x) => x.key === dragging.over);
              return l ? `→ ${l.from} → ${l.to}` : "Drop on another journey";
            })()}
          </span>
        </div>
      )}
      {!legs.length && (
        <div className="empty-state">
          Add stays in different cities, or a journey, to plan transport between
          them.
        </div>
      )}
      <p className="food-hint">
        The chosen route (planned or booked) is in your itinerary; alternatives
        are kept as ideas and excluded from checks and visa schedules. Prices in
        other currencies are converted to {home} with daily rates
        {rates?.updated && ` (${rates.updated.slice(5, 16)})`} from{" "}
        <a
          href="https://www.exchangerate-api.com"
          target="_blank"
          rel="noreferrer"
        >
          ExchangeRate-API
        </a>
        . Schedules and fares are not fetched automatically; use the compare
        links and enter what you find.
      </p>
    </div>
  );
}

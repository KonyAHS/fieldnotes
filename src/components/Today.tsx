import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  BedDouble,
  Navigation,
  Phone,
  ChevronDown,
  CarTaxiFront,
  Ticket,
  History,
  StickyNote,
  Sunrise,
  Sun,
  Sunset,
  Paperclip,
  Copy,
  Check,
  Compass,
  MapPin,
} from "lucide-react";
import {
  type Trip,
  type Scenario,
  type Entry,
  type Place,
  type Attachment,
  addDays,
  days,
  entriesOn,
  instant,
  shortDate,
  weekday,
  placeMaps,
  phoneLink,
  webLink,
  countryMeta,
  deviceToday,
  bookingState,
  openLocalMap,
} from "../model";
import { prayerTimes, qibla } from "../prayer";
import {
  useWhereabouts,
  useWeather,
  weatherKind,
  type Weather,
  type Where,
} from "../whereabouts";
import { WeatherBadge, WeatherIcon } from "./WeatherBadge";
import { EntryIcon, BookingTag } from "./Timeline";
import { AttachmentViewer } from "./Attachments";
import { DriverCard, LocalName, canShowDriver } from "./LocalName";
const clock = (h: number) => {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const until = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
};
function CopyRef({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="today-chip"
      title="Copy booking reference"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {text}
    </button>
  );
}
type MapChoice = {
  name: string;
  href: string;
  app?: Parameters<typeof openLocalMap>[2];
};
// The same six spots on every card, in the same order: directions, the
// place's page, the driver card, call, ticket or files, and more details.
// A spot that doesn't apply stays in place, dimmed.
function ActionBar({
  entry,
  place,
  open,
  hasMore,
  onToggle,
  onOpen,
}: {
  entry: Entry;
  place: Place | undefined;
  open: boolean;
  hasMore: boolean;
  onToggle: () => void;
  onOpen: (a: Attachment) => void;
}) {
  const [menu, setMenu] = useState<"go" | "place" | null>(null);
  const [driver, setDriver] = useState(false);
  // A hotel or plan's place, or where a journey ends; not for flights and
  // trains, which a driver doesn't take you on.
  const driveTo =
    entry.type === "transport" && entry.scope === "intercity"
      ? undefined
      : place;
  const phone = entry.phone?.trim() || place?.phone || "";
  const link = entry.ticketUrl?.trim();
  const files = entry.attachments || [];
  const maps = place && placeMaps(place);
  const go: MapChoice[] = maps
    ? [
        ...(maps.googleWay ? [{ name: "Google", href: maps.googleWay }] : []),
        { name: "Apple", href: maps.appleWay },
        ...maps.local
          .filter((l) => l.way)
          .map((l) => ({ name: l.name, href: l.way!, app: l.wayApp })),
      ]
    : [];
  const at: MapChoice[] = maps
    ? [
        ...(maps.google ? [{ name: "Google", href: maps.google }] : []),
        { name: "Apple", href: maps.apple },
        ...maps.local.map((l) => ({ name: l.name, href: l.place, app: l.app })),
      ]
    : [];
  const canDrive = canShowDriver(driveTo);
  if (!go.length && !canDrive && !phone && !link && !files.length && !hasMore)
    return null;
  const off = (icon: ReactNode, label: string) => (
    <span className="act off" aria-hidden="true">
      {icon}
      <small>{label}</small>
    </span>
  );
  const mapSpot = (
    kind: "go" | "place",
    list: MapChoice[],
    icon: ReactNode,
    label: string,
  ) =>
    !list.length ? (
      off(icon, label)
    ) : list.length === 1 ? (
      <a
        className="act"
        href={list[0].href}
        target="_blank"
        rel="noreferrer"
        onClick={(ev) =>
          list[0].app && openLocalMap(ev, list[0].href, list[0].app)
        }
      >
        {icon}
        <small>{label}</small>
      </a>
    ) : (
      <button
        className={`act ${menu === kind ? "on" : ""}`}
        aria-expanded={menu === kind}
        onClick={() => setMenu(menu === kind ? null : kind)}
      >
        {icon}
        <small>{label}</small>
      </button>
    );
  const choices = menu === "go" ? go : menu === "place" ? at : [];
  return (
    <>
      <div
        className={`act-bar ${!go.length && !canDrive && !phone && !link && !files.length ? "bare" : ""}`}
      >
        {mapSpot("go", go, <Navigation size={17} />, "Directions")}
        {mapSpot("place", at, <MapPin size={17} />, "Place")}
        {canDrive ? (
          <button className="act" onClick={() => setDriver(true)}>
            <CarTaxiFront size={17} />
            <small>Driver</small>
          </button>
        ) : (
          off(<CarTaxiFront size={17} />, "Driver")
        )}
        {phone ? (
          <a className="act" href={phoneLink(phone)}>
            <Phone size={17} />
            <small>Call</small>
          </a>
        ) : (
          off(<Phone size={17} />, "Call")
        )}
        {link ? (
          <a
            className="act"
            href={webLink(link)}
            target="_blank"
            rel="noreferrer"
          >
            <Ticket size={17} />
            <small>Ticket</small>
          </a>
        ) : files.length ? (
          <button
            className="act"
            onClick={() => (files.length === 1 ? onOpen(files[0]) : onToggle())}
          >
            <Paperclip size={17} />
            <small>
              {files.length === 1 ? "File" : `${files.length} files`}
            </small>
          </button>
        ) : (
          off(<Ticket size={17} />, "Ticket")
        )}
        {hasMore ? (
          <button
            className={`act more ${open ? "on" : ""}`}
            aria-expanded={open}
            onClick={onToggle}
          >
            <ChevronDown size={17} />
            <small>{open ? "Less" : "More"}</small>
          </button>
        ) : (
          off(<ChevronDown size={17} />, "More")
        )}
      </div>
      {menu && (
        <div className="act-menu">
          <span>{menu === "go" ? "Directions in" : "Open place in"}</span>
          {choices.map((c) => (
            <a
              key={c.name}
              href={c.href}
              target="_blank"
              rel="noreferrer"
              onClick={(ev) => {
                if (c.app) openLocalMap(ev, c.href, c.app);
                setMenu(null);
              }}
            >
              {c.name}
            </a>
          ))}
        </div>
      )}
      {driver && canDrive && (
        <DriverCard place={driveTo} onClose={() => setDriver(false)} />
      )}
    </>
  );
}
// A short label for an attached file: what it is, not its whole name.
const fileKinds: [RegExp, string][] = [
  [/boarding|e-?ticket|ticket|乘车|搭乗/i, "Ticket"],
  [/receipt|invoice|payment|refund/i, "Receipt"],
  [/confirm|voucher|booking|reservation|itinerary/i, "Confirmation"],
  [/visa|passport|insurance/i, "Document"],
  [/map|route|directions/i, "Map"],
];
function fileLabels(files: Attachment[]) {
  const names = files.map((f) => {
    const kind = fileKinds.find(([r]) => r.test(f.name))?.[1];
    if (kind) return kind;
    if (f.type.startsWith("image/")) return "Photo";
    const ext = /\.([a-z0-9]{2,5})$/i.exec(f.name)?.[1];
    return ext ? ext.toUpperCase() : "File";
  });
  // "Ticket 1", "Ticket 2" when a card has several of a kind.
  return names.map((n, i) =>
    names.filter((x) => x === n).length > 1
      ? `${n} ${names.slice(0, i + 1).filter((x) => x === n).length}`
      : n,
  );
}
function CopyLine({ text, lang }: { text: string; lang?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="today-copyline"
      title={`${text}\nTap to copy`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      <MapPin size={12} />
      <span lang={lang}>{done ? "Copied" : text}</span>
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
// What a card keeps folded away: the local name, one line of address, and
// chips for the reference, files and notes. Notes open on a tap.
function Details({
  entry,
  place,
  from,
  onOpen,
}: {
  entry: Entry;
  place: Place | undefined;
  from?: Place;
  onOpen: (a: Attachment) => void;
}) {
  const [notes, setNotes] = useState(false);
  const files = entry.attachments || [];
  const labels = fileLabels(files);
  const text = entry.notes?.trim();
  const address = place?.nativeAddress.trim() || place?.address.trim();
  return (
    <div className="today-details">
      {from && place ? (
        <div className="local-route">
          <LocalName place={from} label="From" address={false} />
          <LocalName place={place} label="To" address={false} />
        </div>
      ) : (
        place && <LocalName place={place} address={false} />
      )}
      {address && <CopyLine text={address} />}
      {(entry.bookingRef || files.length > 0 || text) && (
        <div className="today-actions">
          {entry.bookingRef && <CopyRef text={entry.bookingRef} />}
          {files.map((a, i) => (
            <button
              className="today-chip"
              key={a.id}
              title={a.name}
              onClick={() => onOpen(a)}
            >
              <Paperclip size={13} /> {labels[i]}
            </button>
          ))}
          {text && (
            <button
              className={`today-chip ${notes ? "on" : ""}`}
              aria-expanded={notes}
              onClick={() => setNotes(!notes)}
            >
              <StickyNote size={13} /> Notes
            </button>
          )}
        </div>
      )}
      {text && notes && <p className="today-notes">{text}</p>}
    </div>
  );
}
const hasDetails = (e: Entry, p: Place | undefined) =>
  !!(p || e.notes?.trim() || e.bookingRef || e.attachments?.length);
// Weather at one hour: icon, temperature, and rain when it matters.
function HourWeather({ weather, hour }: { weather: Weather; hour: number }) {
  const h = weather.hours?.[hour];
  if (!h || h.temp === null) return null;
  const forecast = weather.source === "forecast";
  const wet =
    h.rain !== null && (forecast ? h.rain >= 20 : h.rain >= 0.2)
      ? forecast
        ? `${Math.round(h.rain)}%`
        : `${h.rain} mm`
      : "";
  return (
    <span
      className="today-wx"
      title={`${weatherKind(h.code)} around ${String(hour).padStart(2, "0")}:00${forecast ? "" : " (last year on this date)"}`}
    >
      <WeatherIcon code={h.code} size={13} />
      {!forecast && "≈"}
      {Math.round(h.temp)}°{wet && <b>{wet}</b>}
    </span>
  );
}
// One day of the trip at a glance, for using the app on the way: where you
// sleep, what is next, and everything needed to get there.
export function Today({
  trip,
  scenario,
  places,
  onEdit,
}: {
  trip: Trip;
  scenario: Scenario;
  places: Place[];
  onEdit: (e: Entry) => void;
}) {
  const today = deviceToday();
  const during = today >= trip.start && today <= trip.end;
  const [date, setDate] = useState(() =>
    during ? today : today < trip.start ? trip.start : trip.end,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  // Cards opened or closed by hand; otherwise only what is on now or next
  // (and tonight's hotel on a check-in day) shows its details.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [showDone, setShowDone] = useState(false);
  const [dir, setDir] = useState<"next" | "prev" | "">("");
  const go = (to: string, top = false) => {
    if (to < trip.start || to > trip.end || to === date) return;
    setDir(to > date ? "next" : "prev");
    setDate(to);
    setShowDone(false);
    if (top) window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Swipe sideways anywhere on the page to change day.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const [where] = useWhereabouts(scenario, places, [date], true);
  const [weather] = useWeather([where], [date], true);
  const all = days(trip.start, trip.end);
  const index = all.indexOf(date);
  const placeOf = (e: Entry) => places.find((p) => p.id === e.placeId);
  // Times as on the itinerary's cards.
  const timeOf = (e: Entry) =>
    e.allDay
      ? "All day"
      : date > e.date
        ? date === e.endDate
          ? `Arrives ${e.endTime}`
          : "In transit"
        : e.startTime + (e.endDate === e.date ? `–${e.endTime}` : " →");
  const plans = entriesOn(scenario, date)
    .filter((e) => e.type !== "stay")
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        (a.date === date ? a.startTime : "00:00").localeCompare(
          b.date === date ? b.startTime : "00:00",
        ),
    );
  // Weather where each plan happens, at the hour it starts (not for
  // journeys between cities, whose saved place is where they end).
  const planWeather = useWeather(
    plans.map((e) => {
      const p = placeOf(e);
      const point =
        p && p.lat !== null && p.lng !== null
          ? { lat: p.lat, lng: p.lng }
          : where?.point;
      return point ? ({ point } as Where) : null;
    }),
    plans.map(() => date),
    true,
  );
  const hourOf = (e: Entry) =>
    e.allDay || (e.type === "transport" && e.scope === "intercity")
      ? null
      : e.date === date
        ? Number(e.startTime.slice(0, 2))
        : e.endDate === date
          ? Number(e.endTime.slice(0, 2))
          : null;
  const nowHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: where?.timezone || undefined,
    }).format(now),
  );
  const zoneOf = (e: Entry) =>
    e.timezone || countryMeta[e.country]?.zone || "UTC";
  const startOf = (e: Entry) => instant(e.date, e.startTime, zoneOf(e));
  const endOf = (e: Entry) =>
    instant(
      e.endDate,
      e.endTime,
      (e.type === "transport" && e.endTimezone) || zoneOf(e),
    );
  const live = date === today;
  const current = live
    ? plans.find((e) => !e.allDay && startOf(e) <= now && now < endOf(e))
    : undefined;
  const next = live
    ? plans.find((e) => !e.allDay && startOf(e) > now)
    : undefined;
  const stay = where?.stay || null;
  // Where a journey starts: the last earlier plan's place that day, else
  // the hotel slept in.
  const slept = scenario.entries.find(
    (e) =>
      e.type === "stay" &&
      e.status !== "idea" &&
      e.date < date &&
      e.endDate >= date,
  );
  const originOf = (e: Entry) => {
    const i = plans.indexOf(e);
    for (let j = i - 1; j >= 0; j--) {
      const p = placeOf(plans[j]);
      if (p && p.id !== e.placeId && plans[j].date === date) return p;
    }
    const hotelBefore = e.date === date && slept ? placeOf(slept) : undefined;
    return hotelBefore?.id !== e.placeId ? hotelBefore : undefined;
  };
  const checkout = scenario.entries.find(
    (e) => e.type === "stay" && e.endDate === date && e.id !== stay?.id,
  );
  const hotel = stay ? placeOf(stay) : undefined;
  const prayers =
    where?.point &&
    prayerTimes(date, where.point.lat, where.point.lng, where.timezone);
  const bearing = where?.point && qibla(where.point.lat, where.point.lng);
  const tomorrow = addDays(date, 1);
  const firstTomorrow =
    tomorrow <= trip.end
      ? entriesOn(scenario, tomorrow)
          .filter((e) => e.type !== "stay" && !e.allDay && e.date === tomorrow)
          .sort((a, b) => a.startTime.localeCompare(b.startTime))[0]
      : undefined;
  const isOpen = (e: Entry, auto: boolean) => opened[e.id] ?? auto;
  const toggle = (e: Entry, auto: boolean) =>
    setOpened((v) => ({ ...v, [e.id]: !(v[e.id] ?? auto) }));
  const isDone = (e: Entry) => live && !e.allDay && endOf(e) <= now;
  // On the day itself, finished plans fold into one line once there are a few.
  const finished = plans.filter(isDone);
  const hidden = !showDone && finished.length >= 2 ? finished : [];
  const status =
    today < trip.start
      ? `Trip starts in ${Math.round((Date.parse(trip.start) - Date.parse(today)) / 86400000)} days`
      : today > trip.end
        ? "Trip finished"
        : "";
  return (
    <div
      className="today-view"
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current =
          e.touches.length === 1
            ? { x: t.clientX, y: t.clientY, t: Date.now() }
            : null;
      }}
      onTouchEnd={(e) => {
        const from = touch.current;
        touch.current = null;
        if (!from) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - from.x;
        const dy = t.clientY - from.y;
        if (
          Math.abs(dx) > 70 &&
          Math.abs(dy) < Math.abs(dx) * 0.4 &&
          Date.now() - from.t < 600
        )
          go(addDays(date, dx < 0 ? 1 : -1), window.scrollY > 200);
      }}
    >
      <div className="today-side">
        <div className="today-head">
          <button
            className="icon-button"
            aria-label="Previous day"
            disabled={index <= 0}
            onClick={() => go(addDays(date, -1))}
          >
            <ChevronLeft size={20} />
          </button>
          <div className={`today-date day-${dir}`} key={date}>
            <span>
              {live ? "Today · " : ""}
              {weekday(date)} · Day {index + 1} of {all.length}
            </span>
            <h2>{shortDate(date)}</h2>
            {where && (
              <small>
                {where.city}
                {where.country ? `, ${where.country}` : ""}
              </small>
            )}
          </div>
          <button
            className="icon-button"
            aria-label="Next day"
            disabled={index >= all.length - 1}
            onClick={() => go(addDays(date, 1))}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        {(status || (during && !live)) && (
          <p className="today-status">
            {status}
            {during && !live && (
              <button className="text-button" onClick={() => go(today)}>
                Back to today
              </button>
            )}
          </p>
        )}
        <div className={`today-facts day-${dir}`} key={`facts-${date}`}>
          {weather && (
            <div className="today-weather">
              <div className="today-weather-now">
                <WeatherBadge weather={weather} size={24} rain={false} />
                <small>
                  {[
                    weatherKind(weather.code),
                    weather.rain,
                    weather.windMax !== null &&
                      `wind ${Math.round(weather.windMax)} km/h`,
                    weather.source === "forecast" ? "" : "last year",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
              {weather.hours && (
                <div className="today-hours">
                  {[6, 9, 12, 15, 18, 21].map((hr) => {
                    const h = weather.hours![hr];
                    const forecast = weather.source === "forecast";
                    const wet =
                      h.rain !== null &&
                      (forecast ? h.rain >= 20 : h.rain >= 0.2);
                    return (
                      <span
                        key={hr}
                        className={
                          live && nowHour >= hr && nowHour < hr + 3 ? "now" : ""
                        }
                      >
                        <small>{String(hr).padStart(2, "0")}</small>
                        <WeatherIcon code={h.code} size={17} />
                        <strong>
                          {h.temp === null ? "–" : `${Math.round(h.temp)}°`}
                        </strong>
                        <em className={wet ? "wet" : ""}>
                          {h.rain === null
                            ? ""
                            : forecast
                              ? `${Math.round(h.rain)}%`
                              : wet
                                ? `${h.rain}mm`
                                : "dry"}
                        </em>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {(prayers || bearing != null) && (
            <div className="today-sun">
              {prayers &&
                (
                  [
                    ["Fajr", prayers.fajr, Sunrise],
                    ["Dhuhr", prayers.dhuhr, Sun],
                    ["Maghrib", prayers.maghrib, Sunset],
                  ] as const
                ).map(([name, at, Icon]) =>
                  at === null ? null : (
                    <span key={name} title={name} aria-label={name}>
                      <Icon size={15} />
                      {clock(at)}
                    </span>
                  ),
                )}
              {bearing != null && where && (
                <span
                  className="today-qibla"
                  title={`Qibla: ${bearing.toFixed(1)}° clockwise from true north, from ${where.city}`}
                  aria-label="Qibla"
                >
                  <Compass size={15} />
                  {Math.round(bearing)}°
                </span>
              )}
            </div>
          )}
        </div>
        {(stay || checkout) && (
          <section className={`today-hotel day-${dir}`} key={`hotel-${date}`}>
            {checkout && (
              <p className="today-checkout">
                Check out of <strong>{checkout.title}</strong>
                {checkout.endTime ? ` by ${checkout.endTime}` : ""}
              </p>
            )}
            {stay && (
              <>
                <button className="today-title" onClick={() => onEdit(stay)}>
                  <BedDouble size={18} />
                  <span>
                    <small>
                      {stay.date === date ? "Check in tonight" : "Tonight"}
                    </small>
                    {stay.title}
                  </span>
                </button>
                <ActionBar
                  entry={stay}
                  place={hotel}
                  open={isOpen(stay, stay.date === date)}
                  hasMore={hasDetails(stay, hotel)}
                  onToggle={() => toggle(stay, stay.date === date)}
                  onOpen={setViewing}
                />
                {isOpen(stay, stay.date === date) && (
                  <Details entry={stay} place={hotel} onOpen={setViewing} />
                )}
              </>
            )}
          </section>
        )}
      </div>
      <section className={`today-plans day-${dir}`} key={`plans-${date}`}>
        <h3>Plans</h3>
        {!plans.length && <p className="today-empty">Nothing planned.</p>}
        {hidden.length > 0 && (
          <button className="today-earlier" onClick={() => setShowDone(true)}>
            <History size={14} />
            {hidden.length} earlier {hidden.length === 1 ? "plan" : "plans"}
            <span>{hidden.map((e) => e.title).join(" · ")}</span>
          </button>
        )}
        {plans
          .filter((e) => !hidden.includes(e))
          .map((e) => {
            const place = placeOf(e);
            const isNow = e === current;
            const isNext = e === next;
            const done = isDone(e);
            const booking = bookingState(e);
            const wx = planWeather[plans.indexOf(e)];
            const hour = hourOf(e);
            const from =
              e.type === "transport" && e.scope === "local"
                ? originOf(e)
                : undefined;
            const auto = isNow || isNext;
            return (
              <article
                key={e.id}
                className={`today-plan event-card event-${e.type} ${e.status === "idea" ? "idea" : ""} ${booking ? `booking-${booking}` : ""} ${isNow ? "now" : ""} ${isNext ? "next" : ""} ${done ? "done" : ""}`}
              >
                {booking && <BookingTag state={booking} />}
                <button className="today-plan-head" onClick={() => onEdit(e)}>
                  <span className="event-top">
                    <EntryIcon type={e.type} />
                    <span>{timeOf(e)}</span>
                    {(isNow || isNext) && (
                      <span className="today-badge">
                        {isNow ? "Now" : `Next · in ${until(startOf(e) - now)}`}
                      </span>
                    )}
                    {wx && hour !== null && (
                      <HourWeather weather={wx} hour={hour} />
                    )}
                  </span>
                  <strong>{e.title}</strong>
                </button>
                <ActionBar
                  entry={e}
                  place={place}
                  open={isOpen(e, auto)}
                  hasMore={hasDetails(e, place)}
                  onToggle={() => toggle(e, auto)}
                  onOpen={setViewing}
                />
                {isOpen(e, auto) && (
                  <Details
                    entry={e}
                    place={place}
                    from={from}
                    onOpen={setViewing}
                  />
                )}
              </article>
            );
          })}
        <nav className="today-nav" aria-label="Other days">
          <button
            className="today-nav-prev"
            disabled={index <= 0}
            onClick={() => go(addDays(date, -1), true)}
          >
            <ChevronLeft size={18} />
            <span>
              <small>Previous</small>
              {index > 0 &&
                `${weekday(addDays(date, -1))} ${shortDate(addDays(date, -1))}`}
            </span>
          </button>
          {index < all.length - 1 ? (
            <button
              className="today-nav-next"
              onClick={() => go(tomorrow, true)}
            >
              <span>
                <small>
                  Next day
                  {firstTomorrow && ` · starts ${firstTomorrow.startTime}`}
                </small>
                {weekday(tomorrow)} {shortDate(tomorrow)}
                {firstTomorrow && <em>{firstTomorrow.title}</em>}
              </span>
              <ChevronRight size={18} />
            </button>
          ) : (
            <span className="today-nav-end">Last day of the trip</span>
          )}
        </nav>
      </section>
      {viewing && (
        <AttachmentViewer
          attachment={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

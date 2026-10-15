import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  BedDouble,
  Navigation,
  Phone,
  ExternalLink,
  Paperclip,
  Copy,
  Check,
  Compass,
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
  mapLinks,
  phoneLink,
  webLink,
  countryMeta,
} from "../model";
import { prayerTimes, qibla } from "../prayer";
import { useWhereabouts, useWeather, weatherKind } from "../whereabouts";
import { WeatherBadge } from "./WeatherBadge";
import { EntryIcon } from "./Timeline";
import { AttachmentViewer } from "./Attachments";
// The device's calendar date; abroad the phone uses local time.
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
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
// Directions to a place: Google Maps by position when known, and the local
// map app in Korea and China, where Google is incomplete.
function directions(place: Place) {
  const google =
    place.lat !== null && place.lng !== null
      ? `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`
      : mapLinks(place)
          .filter((l) => l.name === "Google Maps")
          .map((l) => l.url)[0];
  const local =
    place.country === "Korea" || place.country === "China"
      ? mapLinks(place)[0]
      : null;
  return { google, local };
}
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
function Actions({
  entry,
  place,
  onOpen,
}: {
  entry: Entry;
  place: Place | undefined;
  onOpen: (a: Attachment) => void;
}) {
  const phone = entry.phone?.trim() || place?.phone || "";
  const link = entry.ticketUrl?.trim();
  const ways = place && directions(place);
  return (
    <div className="today-actions">
      {ways?.google && (
        <a
          className="today-chip"
          href={ways.google}
          target="_blank"
          rel="noreferrer"
        >
          <Navigation size={13} /> Directions
        </a>
      )}
      {ways?.local && (
        <a
          className="today-chip"
          href={ways.local.url}
          target="_blank"
          rel="noreferrer"
        >
          <Navigation size={13} /> {ways.local.name}
        </a>
      )}
      {phone && (
        <a className="today-chip" href={phoneLink(phone)}>
          <Phone size={13} /> Call
        </a>
      )}
      {link && (
        <a
          className="today-chip"
          href={webLink(link)}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={13} /> Ticket
        </a>
      )}
      {entry.bookingRef && <CopyRef text={entry.bookingRef} />}
      {(entry.attachments || []).map((a) => (
        <button className="today-chip" key={a.id} onClick={() => onOpen(a)}>
          <Paperclip size={13} /> {a.name}
        </button>
      ))}
    </div>
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
  const today = localToday();
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
  const [where] = useWhereabouts(scenario, places, [date], true);
  const [weather] = useWeather([where], [date], true);
  const all = days(trip.start, trip.end);
  const index = all.indexOf(date);
  const placeOf = (e: Entry) => places.find((p) => p.id === e.placeId);
  const plans = entriesOn(scenario, date)
    .filter((e) => e.type !== "stay")
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        (a.date === date ? a.startTime : "00:00").localeCompare(
          b.date === date ? b.startTime : "00:00",
        ),
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
  const status =
    today < trip.start
      ? `Trip starts in ${Math.round((Date.parse(trip.start) - Date.parse(today)) / 86400000)} days`
      : today > trip.end
        ? "Trip finished"
        : "";
  return (
    <div className="today-view">
      <div className="today-head">
        <button
          className="icon-button"
          aria-label="Previous day"
          disabled={index <= 0}
          onClick={() => setDate(addDays(date, -1))}
        >
          <ChevronLeft size={20} />
        </button>
        <div className="today-date">
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
          onClick={() => setDate(addDays(date, 1))}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      {(status || (during && !live)) && (
        <p className="today-status">
          {status}
          {during && !live && (
            <button className="text-button" onClick={() => setDate(today)}>
              Back to today
            </button>
          )}
        </p>
      )}
      <div className="today-facts">
        {weather && (
          <div className="today-fact">
            <WeatherBadge weather={weather} size={22} />
            <small>
              {[
                weatherKind(weather.code),
                weather.rain,
                weather.source === "forecast" ? "" : "last year on this date",
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </div>
        )}
        {prayers && (
          <div className="today-fact today-prayers">
            {[
              ["Fajr", prayers.fajr],
              ["Dhuhr", prayers.dhuhr],
              ["Maghrib", prayers.maghrib],
            ].map(([name, at]) =>
              at === null ? null : (
                <span key={name as string}>
                  <small>{name}</small>
                  {clock(at as number)}
                </span>
              ),
            )}
          </div>
        )}
        {bearing !== undefined && bearing !== null && where && (
          <div
            className="today-fact today-qibla"
            title={`${bearing.toFixed(1)}° clockwise from true north, from ${where.city}`}
          >
            <Compass size={22} />
            <span>
              <small>Qibla</small>
              {Math.round(bearing)}°
            </span>
          </div>
        )}
      </div>
      {(stay || checkout) && (
        <section className="today-hotel">
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
              {hotel && (hotel.nativeAddress || hotel.address) && (
                <p className="today-address">
                  {hotel.nativeName && hotel.nativeName !== hotel.name && (
                    <strong lang="und">{hotel.nativeName}</strong>
                  )}
                  <span lang="und">{hotel.nativeAddress || hotel.address}</span>
                  {hotel.nativeAddress && hotel.address && (
                    <small>{hotel.address}</small>
                  )}
                </p>
              )}
              <Actions entry={stay} place={hotel} onOpen={setViewing} />
            </>
          )}
        </section>
      )}
      <section className="today-plans">
        <h3>Plans</h3>
        {!plans.length && <p className="today-empty">Nothing planned.</p>}
        {plans.map((e) => {
          const place = placeOf(e);
          const isNow = e === current;
          const isNext = e === next;
          const done = live && !e.allDay && endOf(e) <= now;
          return (
            <article
              key={e.id}
              className={`today-plan kind-${e.type} ${isNow ? "now" : ""} ${isNext ? "next" : ""} ${done ? "done" : ""}`}
            >
              <div className="today-time">
                {e.allDay ? (
                  "All day"
                ) : (
                  <>
                    <strong>{e.date === date ? e.startTime : "…"}</strong>
                    {e.endDate === date && e.endTime !== e.startTime && (
                      <span>{e.endTime}</span>
                    )}
                  </>
                )}
              </div>
              <div className="today-body">
                {(isNow || isNext) && (
                  <span className="today-badge">
                    {isNow ? "Now" : `Next · in ${until(startOf(e) - now)}`}
                  </span>
                )}
                <button className="today-title" onClick={() => onEdit(e)}>
                  <EntryIcon type={e.type} size={16} />
                  <span>{e.title}</span>
                </button>
                {e.type === "transport" && (
                  <p className="today-meta">
                    {[
                      e.toCity && e.toCity !== e.city
                        ? `${e.city} → ${e.toCity}`
                        : "",
                      e.mode,
                      e.provider,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {place && (
                  <p className="today-meta">
                    {[
                      ...new Set([place.name, place.address].filter(Boolean)),
                    ].join(" · ")}
                  </p>
                )}
                <Actions entry={e} place={place} onOpen={setViewing} />
              </div>
            </article>
          );
        })}
        {firstTomorrow && (
          <p className="today-tomorrow">
            Tomorrow starts at <strong>{firstTomorrow.startTime}</strong> with{" "}
            {firstTomorrow.title}.
          </p>
        )}
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

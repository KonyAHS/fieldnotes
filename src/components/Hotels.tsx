import { useMemo, useRef, useState } from "react";
import {
  BedDouble,
  Navigation,
  LocateFixed,
  MapPin,
  Phone,
  Link2,
  Search,
  Pencil,
  ExternalLink,
  Map as MapIcon,
  Check,
} from "lucide-react";
import {
  type Entry,
  type Place,
  type Scenario,
  type Trip,
  shortDate,
  weekday,
  phoneLink,
  webLink,
} from "../model";
import { mutate, notify } from "../sync";
type Hotel = {
  stay: Entry;
  place: Place | undefined;
  name: string;
  chosen: boolean;
  // What Google Maps is asked to find: the hotel, or the city until one is chosen.
  query: string;
  nights: number;
  phone: string;
};
type View =
  | { kind: "all" }
  | { kind: "hotel"; id: string }
  | { kind: "route"; id: string };
const today = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
// Google Maps without an API key: an embedded map for one place or a route
// with stops, and links that open directions in the app or website.
const embed = (params: Record<string, string>) =>
  `https://maps.google.com/maps?${new URLSearchParams({ ...params, output: "embed" })}`;
const directions = (destination: string, origin?: string) =>
  `https://www.google.com/maps/dir/?${new URLSearchParams({
    api: "1",
    ...(origin ? { origin } : {}),
    destination,
    travelmode: "transit",
  })}`;
export function Hotels({
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
  const hotels = useMemo<Hotel[]>(
    () =>
      scenario.entries
        .filter((e) => e.type === "stay" && e.status !== "idea")
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((stay) => {
          const place = places.find((p) => p.id === stay.placeId);
          const where = [stay.city, stay.country].filter(Boolean).join(", ");
          const query = place
            ? place.address
              ? `${place.name}, ${place.address}`
              : place.lat !== null
                ? `${place.lat},${place.lng}`
                : [
                    place.name,
                    place.city || stay.city,
                    place.country || stay.country,
                  ]
                    .filter(Boolean)
                    .join(", ")
            : where || stay.title;
          return {
            stay,
            place,
            name: place?.name || stay.title,
            chosen: !!place,
            query,
            nights: Math.round(
              (Date.parse(stay.endDate) - Date.parse(stay.date)) / 86400000,
            ),
            phone: place?.phone?.trim() || stay.phone?.trim() || "",
          };
        }),
    [scenario, places],
  );
  // Tonight's hotel and the next one to check in to.
  const now = today();
  const current = hotels.find(
    (h) => h.stay.date <= now && now < h.stay.endDate,
  );
  const next = hotels.find((h) => h.stay.date > now);
  const [view, setLocalView] = useState<View>({ kind: "all" });
  const map = useRef<HTMLElement>(null);
  // Changing the map also brings it into sight (it sits above the list on phones).
  const setView = (v: View) => {
    setLocalView(v);
    const box = map.current?.getBoundingClientRect();
    if (box && (box.bottom < 80 || box.top > window.innerHeight - 80))
      map.current!.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const previous = (h: Hotel) => hotels[hotels.indexOf(h) - 1];
  const find = (id: string) => hotels.find((h) => h.stay.id === id);
  const shown = view.kind === "all" ? undefined : find(view.id) || undefined;
  const mapUrl =
    view.kind === "all" || !shown
      ? hotels.length > 1
        ? embed({
            saddr: hotels[0].query,
            daddr: hotels
              .slice(1)
              .map((h) => h.query)
              .join(" to:"),
          })
        : embed({ q: hotels[0]?.query || trip.name, z: "12" })
      : view.kind === "route" && previous(shown)
        ? embed({
            saddr: previous(shown).query,
            daddr: shown.query,
            dirflg: "r",
          })
        : embed({ q: shown.query, z: shown.chosen ? "16" : "12" });
  const mapTitle =
    view.kind === "all" || !shown
      ? `All ${hotels.length} hotels`
      : view.kind === "route" && previous(shown)
        ? `${previous(shown).stay.city} → ${shown.stay.city}`
        : shown.name;
  // Hotels already saved in Places for a stay's city, ready to link.
  const savedFor = (h: Hotel) =>
    h.chosen
      ? []
      : places.filter(
          (p) =>
            p.kind === "hotel" &&
            p.city.trim().toLowerCase() === h.stay.city.trim().toLowerCase(),
        );
  const link = (h: Hotel, p: Place) => {
    mutate((d) => {
      for (const t of d.trips)
        for (const s of t.scenarios)
          for (const e of s.entries) if (e.id === h.stay.id) e.placeId = p.id;
    });
    notify(`Linked ${p.name} to the ${h.stay.city} stay`);
  };
  if (!hotels.length)
    return (
      <p className="empty-state">
        Add stays to the itinerary to see your hotels here.
      </p>
    );
  return (
    <div className="hotels-view">
      <div className="hotels-list">
        {next && (
          <section className="next-hotel">
            <span className="next-label">
              {now < trip.start ? "First hotel" : "Next hotel"}
            </span>
            <h2>{next.name}</h2>
            <p>
              Check in {weekday(next.stay.date)} {shortDate(next.stay.date)}
              {next.stay.startTime && !next.stay.allDay
                ? ` from ${next.stay.startTime}`
                : ""}{" "}
              · {next.nights} night{next.nights === 1 ? "" : "s"} in{" "}
              {next.stay.city}
            </p>
            <div className="next-actions">
              {current && (
                <a
                  className="button primary"
                  href={directions(next.query, current.query)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation size={15} /> Directions from {current.name}
                </a>
              )}
              <a
                className={`button ${current ? "" : "primary"}`}
                href={directions(next.query)}
                target="_blank"
                rel="noreferrer"
              >
                <LocateFixed size={15} /> Directions from where I am
              </a>
              <button
                className="button"
                onClick={() => setView({ kind: "route", id: next.stay.id })}
              >
                <MapIcon size={15} /> Show on map
              </button>
            </div>
            {!next.chosen && (
              <p className="next-note">
                No hotel chosen yet, so directions go to the centre of{" "}
                {next.stay.city}.
              </p>
            )}
          </section>
        )}
        <ol className="hotel-cards">
          {hotels.map((h, i) => {
            const before = previous(h);
            const selected = view.kind !== "all" && view.id === h.stay.id;
            const past = h.stay.endDate <= now;
            return (
              <li
                key={h.stay.id}
                className={`hotel-card ${selected ? "selected" : ""} ${past ? "past" : ""} ${current === h ? "tonight" : ""}`}
              >
                <button
                  className="hotel-number"
                  aria-label={`Show ${h.name} on the map`}
                  onClick={() => setView({ kind: "hotel", id: h.stay.id })}
                >
                  {i + 1}
                </button>
                <div className="hotel-body">
                  <div className="hotel-dates">
                    {weekday(h.stay.date)} {shortDate(h.stay.date)} –{" "}
                    {weekday(h.stay.endDate)} {shortDate(h.stay.endDate)} ·{" "}
                    {h.nights} night{h.nights === 1 ? "" : "s"}
                    {current === h && (
                      <span className="badge booked">Tonight</span>
                    )}
                    {h.stay.status === "booked" && current !== h && (
                      <span className="badge">Booked</span>
                    )}
                  </div>
                  <button
                    className="hotel-name"
                    onClick={() => setView({ kind: "hotel", id: h.stay.id })}
                  >
                    <BedDouble size={15} />
                    <strong>{h.name}</strong>
                  </button>
                  <div className="hotel-where">
                    <MapPin size={12} />
                    {h.place?.address ||
                      (h.chosen
                        ? [h.stay.city, h.stay.country]
                            .filter(Boolean)
                            .join(", ")
                        : `Hotel not chosen · ${h.stay.city}, ${h.stay.country}`)}
                  </div>
                  {savedFor(h).length > 0 && (
                    <div className="hotel-saved">
                      <span>Saved in Places:</span>
                      {savedFor(h).map((p) => (
                        <button
                          key={p.id}
                          className="ticket-chip"
                          title={p.address || p.notes}
                          onClick={() => link(h, p)}
                        >
                          <Check size={12} /> Use {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="hotel-actions">
                    {before && (
                      <a
                        className="text-button"
                        href={directions(h.query, before.query)}
                        target="_blank"
                        rel="noreferrer"
                        title={`Directions from ${before.name}`}
                      >
                        <Navigation size={13} /> From {before.stay.city}
                      </a>
                    )}
                    <a
                      className="text-button"
                      href={directions(h.query)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <LocateFixed size={13} /> From here
                    </a>
                    {before && (
                      <button
                        className="text-button"
                        onClick={() =>
                          setView({ kind: "route", id: h.stay.id })
                        }
                      >
                        <MapIcon size={13} /> Route
                      </button>
                    )}
                    {h.phone && (
                      <a className="text-button" href={phoneLink(h.phone)}>
                        <Phone size={13} /> {h.phone}
                      </a>
                    )}
                    {h.stay.ticketUrl?.trim() && (
                      <a
                        className="text-button"
                        href={webLink(h.stay.ticketUrl)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Link2 size={13} /> Booking
                      </a>
                    )}
                    {!h.chosen && (
                      <a
                        className="text-button"
                        href={`https://www.google.com/maps/search/${encodeURIComponent(`hotels in ${h.stay.city}, ${h.stay.country}`)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Search size={13} /> Find hotels
                      </a>
                    )}
                    <button
                      className="text-button"
                      onClick={() => onEdit(h.stay)}
                    >
                      <Pencil size={13} /> {h.chosen ? "Edit" : "Choose hotel"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <aside className="hotels-map" ref={map}>
        <div className="hotels-map-head">
          <strong>{mapTitle}</strong>
          <div className="segmented">
            <button
              className={view.kind === "all" ? "selected" : ""}
              onClick={() => setView({ kind: "all" })}
            >
              All hotels
            </button>
            {shown && (
              <button
                className={view.kind === "hotel" ? "selected" : ""}
                onClick={() => setView({ kind: "hotel", id: shown.stay.id })}
              >
                Hotel
              </button>
            )}
            {shown && previous(shown) && (
              <button
                className={view.kind === "route" ? "selected" : ""}
                onClick={() => setView({ kind: "route", id: shown.stay.id })}
              >
                From previous
              </button>
            )}
          </div>
        </div>
        <iframe
          key={mapUrl}
          title={`Google Maps: ${mapTitle}`}
          src={mapUrl}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
        <p className="hotels-map-note">
          {view.kind === "all"
            ? "Every hotel is a stop on the map in stay order. Where Google can't draw a route (across the sea, or in Korea and China) the stops are still marked."
            : view.kind === "route"
              ? "Public transport route; open the directions links for live times."
              : "Click a hotel's number to show it here."}{" "}
          <a
            href={mapUrl.replace("&output=embed", "")}
            target="_blank"
            rel="noreferrer"
          >
            Open in Google Maps <ExternalLink size={11} />
          </a>
        </p>
      </aside>
    </div>
  );
}

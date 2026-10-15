import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  MapPin,
  Search,
  Trash2,
  ExternalLink,
  Phone,
  Globe,
  Pencil,
} from "lucide-react";
import { Modal } from "./Modal";
import {
  type Entry,
  type Place,
  type Trip,
  type Workspace,
  EntrySchema,
  PlaceSchema,
  emptyEntry,
  emptyPlace,
  zone,
  currency,
  addDays,
  uid,
  mapLinks,
  phoneLink,
  webLink,
  bookingState,
  needsBookingByDefault,
} from "../model";
import { mutate } from "../sync";
import {
  geocode,
  isMapsLink,
  mapsStatus,
  placeFrom,
  providerName,
  readMapsLink,
  kindFrom,
  cityFrom,
  type GeoResult,
} from "../geo";
import { PlacePicker } from "./PlacePicker";
import { TicketDetails } from "./Attachments";
import { modeOptions } from "../transportModes";
const placeKinds: Record<Entry["type"], Place["kind"]> = {
  activity: "attraction",
  stay: "hotel",
  transport: "station",
  food: "restaurant",
  note: "other",
};
export const entryLabels = {
  activity: "Activity",
  stay: "Stay",
  transport: "Transport",
  food: "Food",
  note: "Note",
};
export const halalLabels = {
  unknown: "Not verified",
  tagged: "OSM halal tag",
  certified: "Halal certified",
  "self-certified": "Self-certified",
  "muslim-friendly": "Muslim friendly",
  "pork-free": "Pork free",
};
export function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function EntryEditor({
  trip,
  scenarioId,
  places,
  initial,
  onClose,
  cities = [],
}: {
  trip: Trip;
  scenarioId: string;
  places: Place[];
  initial: Entry;
  onClose: () => void;
  cities?: string[];
}) {
  const [entry, setEntry] = useState<Entry>(() => structuredClone(initial));
  // The plan's place opened on top of this editor, so its details can be
  // read and changed without leaving the plan.
  const [placeOpen, setPlaceOpen] = useState<Place | null>(null);
  const [hotel, setHotel] = useState<Place>(() =>
    structuredClone(
      places.find((p) => p.id === initial.placeId) || {
        ...emptyPlace(),
        kind: "hotel",
        country: initial.country,
        city: initial.city,
      },
    ),
  );
  const [newHotel, setNewHotel] = useState(
    initial.type === "stay" && !initial.placeId,
  );
  // A place found by search or a link, saved together with the plan.
  const [pending, setPending] = useState<Place | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exists = trip.scenarios
    .find((s) => s.id === scenarioId)
    ?.entries.some((e) => e.id === entry.id);
  const change = <K extends keyof Entry>(key: K, value: Entry[K]) =>
    setEntry((v) => ({ ...v, [key]: value }));
  const changeDate = (date: string) => {
    if (!date) return;
    const offset = Math.round(
      (Date.parse(entry.endDate) - Date.parse(entry.date)) / 86400000,
    );
    setEntry((v) => ({ ...v, date, endDate: addDays(date, offset) }));
  };
  const changeType = (type: Entry["type"]) => {
    const needsHotel =
      type === "stay" &&
      places.find((p) => p.id === entry.placeId)?.kind !== "hotel";
    setEntry((v) => ({
      ...v,
      type,
      placeId: needsHotel ? "" : v.placeId,
      endDate:
        type === "stay"
          ? v.endDate > v.date
            ? v.endDate
            : addDays(v.date, 1)
          : v.endDate,
      startTime: type === "stay" ? "15:00" : v.startTime,
      endTime: type === "stay" ? "11:00" : v.endTime,
    }));
    if (needsHotel) {
      setNewHotel(true);
      setHotel({
        ...emptyPlace(),
        kind: "hotel",
        country: entry.country,
        city: entry.city,
      });
    }
  };
  const selectPlace = (id: string, found?: Place) => {
    const p = found || places.find((p) => p.id === id);
    setNewHotel(id === "new");
    if (p) {
      setEntry((v) => ({
        ...v,
        placeId: id,
        title: entry.type === "stay" ? p.name : v.title || p.name,
        country: p.country,
        city: p.city,
        timezone: zone(p.country),
        endTimezone: zone(p.country),
        currency: currency(p.country),
      }));
      setHotel(structuredClone(p));
    } else {
      change("placeId", "");
      if (id === "new")
        setHotel({
          ...emptyPlace(),
          kind: "hotel",
          country: entry.country,
          city: entry.city,
        });
    }
  };
  // A new place from search: hotels go through the hotel fields below.
  const pickNew = (p: Place) => {
    if (entry.type === "stay") {
      selectPlace("new");
      setHotel({ ...p, kind: "hotel" });
      setEntry((v) => ({
        ...v,
        title: p.name,
        country: p.country || v.country,
        city: p.city || v.city,
        timezone: zone(p.country || v.country),
        endTimezone: zone(p.country || v.country),
        currency: currency(p.country || v.country),
      }));
    } else {
      setPending(p);
      selectPlace(p.id, p);
    }
  };
  const chosen =
    entry.type === "stay"
      ? newHotel
        ? undefined
        : places.find((p) => p.id === entry.placeId)
      : pending && entry.placeId === pending.id
        ? pending
        : places.find((p) => p.id === entry.placeId);
  // Saved from the place editor: keep this form in step with what was saved.
  const placeSaved = (p: Place) => {
    if (entry.type === "stay") setHotel(structuredClone(p));
    else if (pending?.id === p.id) setPending(null);
    setEntry((v) => ({
      ...v,
      title: entry.type === "stay" ? p.name : v.title,
      country: p.country || v.country,
      city: p.city || v.city,
    }));
  };
  function save(e: FormEvent) {
    e.preventDefault();
    let next = { ...entry };
    let updatedHotel: Place | undefined =
      pending && entry.type !== "stay" && entry.placeId === pending.id
        ? pending
        : undefined;
    if (entry.type === "stay" && (newHotel || entry.placeId)) {
      updatedHotel = {
        ...hotel,
        name: hotel.name.trim() || entry.title,
        country: entry.country,
        city: entry.city,
        kind: "hotel",
      };
      next.placeId = updatedHotel.id;
    }
    if (updatedHotel) {
      const checked = PlaceSchema.safeParse(updatedHotel);
      if (!checked.success) {
        setError(checked.error.issues[0].message);
        return;
      }
    }
    const checked = EntrySchema.safeParse(next);
    if (!checked.success) {
      setError(checked.error.issues[0].message);
      return;
    }
    mutate((d) => {
      const scenario = d.trips
        .find((t) => t.id === trip.id)!
        .scenarios.find((s) => s.id === scenarioId)!;
      const index = scenario.entries.findIndex((e) => e.id === next.id);
      if (index < 0) scenario.entries.push(next);
      else scenario.entries[index] = next;
      if (updatedHotel) {
        const i = d.places.findIndex((p) => p.id === updatedHotel!.id);
        if (i < 0) d.places.push(updatedHotel);
        else d.places[i] = updatedHotel;
      }
    });
    onClose();
  }
  const hotelField = <K extends keyof Place>(key: K, value: Place[K]) =>
    setHotel((v) => ({ ...v, [key]: value }));
  const countries = [
    ...new Set([
      "Japan",
      "Korea",
      "China",
      ...places.map((p) => p.country),
    ]),
  ];
  return (
    <Modal title={exists ? "Edit plan" : "Add to plan"} onClose={onClose}>
      <form onSubmit={save}>
        <div className="segmented type-picker">
          {(Object.keys(entryLabels) as Entry["type"][]).map((type) => (
            <button
              type="button"
              key={type}
              className={entry.type === type ? "selected" : ""}
              onClick={() => changeType(type)}
            >
              {entryLabels[type]}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label="Title" full>
            <input
              required
              autoFocus
              value={entry.title}
              onChange={(e) => change("title", e.target.value)}
              placeholder={
                entry.type === "stay"
                  ? "Hotel or city stay"
                  : "What’s the plan?"
              }
            />
          </Field>
          <Field label={entry.type === "stay" ? "Check-in" : "Date"}>
            <input
              type="date"
              required
              value={entry.date}
              onChange={(e) => changeDate(e.target.value)}
            />
          </Field>
          <Field label={entry.type === "stay" ? "Checkout" : "End date"}>
            <input
              type="date"
              required
              min={entry.type === "stay" ? addDays(entry.date, 1) : entry.date}
              value={entry.endDate}
              onChange={(e) => change("endDate", e.target.value)}
            />
          </Field>
          {entry.type !== "stay" && (
            <label className="check-field full">
              <input
                type="checkbox"
                checked={entry.allDay}
                onChange={(e) => change("allDay", e.target.checked)}
              />
              All day / time undecided
            </label>
          )}
          {!entry.allDay && (
            <>
              <Field
                label={
                  entry.type === "transport"
                    ? "Departure time"
                    : entry.type === "stay"
                      ? "Check-in time"
                      : "Start time"
                }
              >
                <input
                  type="time"
                  required
                  value={entry.startTime}
                  onChange={(e) => change("startTime", e.target.value)}
                />
              </Field>
              <Field
                label={
                  entry.type === "transport"
                    ? "Arrival time"
                    : entry.type === "stay"
                      ? "Checkout time"
                      : "End time"
                }
              >
                <input
                  type="time"
                  required
                  value={entry.endTime}
                  onChange={(e) => change("endTime", e.target.value)}
                />
              </Field>
            </>
          )}
          <Field
            label={entry.type === "transport" ? "From country" : "Country"}
          >
            <input
              list="countries"
              value={entry.country}
              onChange={(e) => {
                change("country", e.target.value);
                change("timezone", zone(e.target.value));
                change("currency", currency(e.target.value));
                if (entry.type !== "transport")
                  change("endTimezone", zone(e.target.value));
              }}
            />
          </Field>
          <Field label={entry.type === "transport" ? "From city" : "City"}>
            <input
              list="cities"
              value={entry.city}
              onChange={(e) => change("city", e.target.value)}
            />
          </Field>
          {entry.type === "transport" && (
            <>
              <Field label="To country">
                <input
                  list="countries"
                  value={entry.toCountry}
                  onChange={(e) => {
                    change("toCountry", e.target.value);
                    change("endTimezone", zone(e.target.value));
                  }}
                />
              </Field>
              <Field label="To city">
                <input
                  list="cities"
                  value={entry.toCity}
                  onChange={(e) => change("toCity", e.target.value)}
                />
              </Field>
              <Field label="Mode">
                <select
                  value={entry.mode}
                  onChange={(e) => change("mode", e.target.value)}
                >
                  {modeOptions(entry.mode).map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Operator / service">
                <input
                  value={entry.provider || ""}
                  placeholder="e.g. JR Nozomi 21"
                  onChange={(e) => change("provider", e.target.value)}
                />
              </Field>
              <Field label="Journey">
                <select
                  value={entry.scope}
                  onChange={(e) =>
                    change("scope", e.target.value as Entry["scope"])
                  }
                >
                  <option value="intercity">Between cities</option>
                  <option value="local">Within the day</option>
                </select>
              </Field>
            </>
          )}
          {entry.type !== "transport" && (
            <Field label={entry.type === "stay" ? "Hotel" : "Place"} full>
              <PlacePicker
                label={entry.type === "stay" ? "Hotel" : "Place"}
                places={places.filter(
                  (p) => entry.type !== "stay" || p.kind === "hotel",
                )}
                value={
                  newHotel && entry.type === "stay" ? "new" : entry.placeId
                }
                pending={entry.type === "stay" ? hotel : pending}
                allowNew={entry.type === "stay"}
                defaults={{
                  kind: placeKinds[entry.type],
                  country: entry.country,
                  city: entry.city,
                }}
                onSelect={(id) => selectPlace(id)}
                onPickNew={pickNew}
              />
            </Field>
          )}
          {entry.type !== "transport" && chosen && (
            <PlaceCard
              place={chosen}
              unsaved={!places.some((p) => p.id === chosen.id)}
              onOpen={() => setPlaceOpen(structuredClone(chosen))}
            />
          )}
          {entry.type === "transport" && entry.scope === "local" && (
            <>
              <Field label="From accommodation">
                <select
                  value={entry.fromStayId || ""}
                  onChange={(e) => change("fromStayId", e.target.value)}
                >
                  <option value="">Not a hotel transfer</option>
                  {trip.scenarios
                    .find((s) => s.id === scenarioId)
                    ?.entries.filter((e) => e.type === "stay")
                    .map((e) => (
                      <option value={e.id} key={e.id}>
                        {e.title}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="To accommodation">
                <select
                  value={entry.toStayId || ""}
                  onChange={(e) => change("toStayId", e.target.value)}
                >
                  <option value="">Not a hotel transfer</option>
                  {trip.scenarios
                    .find((s) => s.id === scenarioId)
                    ?.entries.filter((e) => e.type === "stay")
                    .map((e) => (
                      <option value={e.id} key={e.id}>
                        {e.title}
                      </option>
                    ))}
                </select>
              </Field>
            </>
          )}
          {entry.type === "stay" && (newHotel || entry.placeId) && (
            <>
              <Field label="Hotel name" full>
                <input
                  value={hotel.name}
                  onChange={(e) => hotelField("name", e.target.value)}
                  placeholder={entry.title}
                />
              </Field>
              <Field label="Hotel address" full>
                <input
                  value={hotel.address}
                  onChange={(e) => hotelField("address", e.target.value)}
                />
              </Field>
              <Field label="Local-language address" full>
                <input
                  value={hotel.nativeAddress}
                  onChange={(e) => hotelField("nativeAddress", e.target.value)}
                />
              </Field>
              <Field label="Hotel phone">
                <input
                  type="tel"
                  value={hotel.phone}
                  onChange={(e) => hotelField("phone", e.target.value)}
                />
              </Field>
              <Field label="Website">
                <input
                  value={hotel.url}
                  onChange={(e) => hotelField("url", e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="Reservation" full>
            <select
              value={
                bookingState(entry) === "booked"
                  ? "booked"
                  : (entry.needsBooking ?? needsBookingByDefault(entry))
                    ? "needed"
                    : "none"
              }
              onChange={(e) => {
                const value = e.target.value;
                setEntry((v) => ({
                  ...v,
                  needsBooking: value !== "none",
                  status:
                    value === "booked"
                      ? "booked"
                      : v.status === "booked"
                        ? "planned"
                        : v.status,
                }));
              }}
            >
              <option value="none">No reservation needed</option>
              <option value="needed">Not reserved yet</option>
              <option value="booked">Reserved</option>
            </select>
          </Field>
          <Field label="Status" full>
            <select
              value={entry.status}
              onChange={(e) =>
                change("status", e.target.value as Entry["status"])
              }
            >
              <option value="idea">Idea · excluded from checks & visa</option>
              <option value="planned">Planned</option>
              <option value="booked">Booked</option>
              <option value="done">Done</option>
            </select>
          </Field>
        </div>
        <details
          className="form-details"
          open={
            !!(
              initial.attachments?.length ||
              initial.ticketUrl ||
              initial.phone
            )
          }
        >
          <summary>
            Tickets, link & phone
            {entry.attachments?.length ? ` · ${entry.attachments.length}` : ""}
          </summary>
          <TicketDetails
            entry={entry}
            onChange={(patch) => setEntry((v) => ({ ...v, ...patch }))}
          />
        </details>
        <details className="form-details">
          <summary>Cost & cancellation</summary>
          <div className="form-grid">
            <Field label="Cancel before">
              <input
                type="date"
                value={entry.refundDeadline}
                onChange={(e) => change("refundDeadline", e.target.value)}
              />
            </Field>
            <Field label="Cost">
              <input
                type="number"
                min="0"
                step="0.01"
                value={entry.cost ?? ""}
                onChange={(e) =>
                  change(
                    "cost",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </Field>
            <Field label="Currency">
              <input
                value={entry.currency}
                maxLength={10}
                onChange={(e) =>
                  change("currency", e.target.value.toUpperCase())
                }
              />
            </Field>
          </div>
        </details>
        <details className="form-details">
          <summary>Notes & time zones</summary>
          <div className="form-grid">
            <Field label="Notes" full>
              <textarea
                rows={3}
                value={entry.notes}
                onChange={(e) => change("notes", e.target.value)}
              />
            </Field>
            <Field
              label={
                entry.type === "transport" ? "Departure time zone" : "Time zone"
              }
            >
              <input
                value={entry.timezone}
                onChange={(e) => change("timezone", e.target.value)}
              />
            </Field>
            {entry.type === "transport" && (
              <Field label="Arrival time zone">
                <input
                  value={entry.endTimezone}
                  onChange={(e) => change("endTimezone", e.target.value)}
                />
              </Field>
            )}
          </div>
        </details>
        <datalist id="countries">
          {countries.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </datalist>
        <datalist id="cities">
          {[
            ...new Set([
              ...places.map((p) => p.city),
              ...trip.scenarios.flatMap((s) => s.entries.map((e) => e.city)),
            ]),
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </datalist>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="modal-footer">
          {exists && (
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                mutate((d) => {
                  const s = d.trips
                    .find((t) => t.id === trip.id)!
                    .scenarios.find((s) => s.id === scenarioId)!;
                  s.entries = s.entries.filter((e) => e.id !== entry.id);
                });
                onClose();
              }}
            >
              <Trash2 size={16} />
              {confirmDelete ? "Confirm delete" : "Delete"}
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            Save plan
          </button>
        </div>
      </form>
      {placeOpen &&
        createPortal(
          <PlaceEditor
            initial={placeOpen}
            cities={cities}
            onClose={() => setPlaceOpen(null)}
            onSaved={placeSaved}
          />,
          document.body,
        )}
    </Modal>
  );
}
// The chosen place at a glance in the plan editor, with a way into its details.
function PlaceCard({
  place,
  unsaved,
  onOpen,
}: {
  place: Place;
  unsaved: boolean;
  onOpen: () => void;
}) {
  const maps = mapLinks(place).find((l) => l.name === "Google Maps")!;
  const notes = place.notes.trim().split("\n")[0];
  return (
    <div className="place-card-mini full">
      <div className="place-card-mini-text">
        {(place.address || place.nativeAddress) && (
          <span>
            <MapPin size={12} /> {place.address || place.nativeAddress}
          </span>
        )}
        {place.kind === "restaurant" && place.halal !== "unknown" && (
          <span className="tag">{halalLabels[place.halal]}</span>
        )}
        {notes && <span className="place-card-mini-notes">{notes}</span>}
        {unsaved && (
          <span className="place-card-mini-notes">
            New place, saved to Places with this plan.
          </span>
        )}
      </div>
      <div className="place-card-mini-links">
        {place.phone.trim() && (
          <a className="text-button" href={phoneLink(place.phone)}>
            <Phone size={13} /> {place.phone}
          </a>
        )}
        {place.url.trim() && (
          <a
            className="text-button"
            href={webLink(place.url)}
            target="_blank"
            rel="noreferrer"
          >
            <Globe size={13} /> Website
          </a>
        )}
        <a
          className="text-button"
          href={maps.url}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={13} /> Google Maps
        </a>
        <button type="button" className="text-button" onClick={onOpen}>
          <Pencil size={13} /> Place details
        </button>
      </div>
    </div>
  );
}
export function PlaceEditor({
  initial,
  onClose,
  onSaved,
  cities = [],
}: {
  initial: Place;
  onClose: () => void;
  onSaved?: (p: Place) => void;
  /** Cities in the trip, used to fill in a found place's city. */
  cities?: string[];
}) {
  const isNew = !initial.name.trim();
  const [find, setFind] = useState("");
  const [place, setPlace] = useState(() => structuredClone(initial));
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [link, setLink] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [provider, setProvider] = useState("OpenStreetMap");
  useEffect(() => {
    void mapsStatus().then((s) => setProvider(providerName(s)));
  }, []);
  const change = <K extends keyof Place>(key: K, value: Place[K]) =>
    setPlace((p) => ({ ...p, [key]: value }));
  // Fills empty fields from a search result or link; the position is always
  // taken because it is what was chosen.
  const fill = (found: Place, category = "") =>
    setPlace((p) => {
      const kind = (isNew && kindFrom(category)) || p.kind;
      const city =
        p.city.trim() || found.city || cityFrom(found.address, cities);
      const keep = (k: "name" | "nativeName" | "address" | "phone" | "url") =>
        p[k].trim() || found[k];
      return {
        ...p,
        name: keep("name"),
        nativeName: keep("nativeName"),
        address: keep("address"),
        phone: keep("phone"),
        url: keep("url"),
        country: p.country || found.country,
        kind,
        city,
        lat: found.lat,
        lng: found.lng,
        geo: "auto",
        notes: [p.notes.trim(), ...found.notes.split("\n")]
          .filter((line, i, all) => line && all.indexOf(line) === i)
          .join("\n")
          .slice(0, 20000),
      };
    });
  // One box for both: a pasted Google Maps link is read straight away, other
  // text is searched with the provider chosen in Settings.
  async function findPlace() {
    const q = find.trim();
    if (!q) return;
    if (isMapsLink(q)) return readLink(q);
    setSearching(true);
    setError("");
    setLinkNote("");
    try {
      let data = await geocode(q, place.country);
      if (!data.length && place.country) data = await geocode(q, "");
      setResults(data);
      if (!data.length)
        setError("No match. Try the local name, or paste a Google Maps link.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }
  async function readLink(value: string) {
    setLink(value);
    setLinkNote("");
    if (!isMapsLink(value)) return;
    setSearching(true);
    setError("");
    try {
      const r = await readMapsLink(value);
      const found = placeFrom(r, place);
      fill(found, (r as { kind?: string }).kind);
      setLinkNote(
        `Filled from Google Maps: ${[r.name, r.address && "address", r.phone && "phone", r.url && "website", "map position"].filter(Boolean).join(", ")}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read this link");
    } finally {
      setSearching(false);
    }
  }
  async function locate() {
    setSearching(true);
    setError("");
    try {
      const queries = [
        place.nativeAddress || place.address,
        `${place.name} ${place.city}`.trim(),
        place.nativeName,
      ].filter((q) => q.trim());
      if (!queries.length) throw Error("Enter a name or address first");
      let data: GeoResult[] = [];
      for (const q of queries) {
        data = await geocode(q, place.country);
        if (data.length) break;
      }
      setResults(data);
      if (!data.length)
        setError("No match. Add coordinates manually or use a map link.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }
  function save(e: FormEvent) {
    e.preventDefault();
    let next = place;
    // A renamed or re-addressed place is located again automatically, unless
    // its position was set by hand.
    const described = (p: Place) =>
      [
        p.name,
        p.nativeName,
        p.city,
        p.country,
        p.address,
        p.nativeAddress,
      ].join("|");
    if (
      place.geo !== "manual" &&
      place.lat === initial.lat &&
      place.lng === initial.lng &&
      described(place) !== described(initial)
    )
      next = { ...place, lat: null, lng: null, geo: undefined };
    if (next.lat === null && next.geo === "manual")
      next = { ...next, geo: undefined };
    const parsed = PlaceSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    mutate((d) => {
      const i = d.places.findIndex((p) => p.id === next.id);
      if (i < 0) d.places.push(next);
      else d.places[i] = next;
    });
    onSaved?.(next);
    onClose();
  }
  return (
    <Modal title="Place details" onClose={onClose}>
      <form onSubmit={save}>
        <div className="form-grid">
          <div className="place-find full">
            <label htmlFor="place-find">
              {isNew ? "Find the place" : "Update from the map (optional)"}
            </label>
            <div className="place-find-row">
              <input
                id="place-find"
                autoFocus={isNew}
                value={find}
                placeholder={`Search ${provider} by name, or paste a Google Maps link`}
                onChange={(e) => {
                  setFind(e.target.value);
                  if (isMapsLink(e.target.value)) void readLink(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void findPlace();
                  }
                }}
              />
              <button
                type="button"
                className="button"
                disabled={searching || !find.trim()}
                onClick={() => void findPlace()}
              >
                <Search size={15} />
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
            {results.length > 0 && (
              <div className="place-find-results">
                {results.slice(0, 6).map((r, i) => (
                  <button
                    className="search-result"
                    key={i}
                    type="button"
                    onClick={() => {
                      fill(placeFrom(r, place), r.kind);
                      setLinkNote(
                        `Filled from ${provider}: ${[r.address && "address", r.phone && "phone", r.url && "website", "map position"].filter(Boolean).join(", ")}. Check the details below and save.`,
                      );
                      setResults([]);
                    }}
                  >
                    <MapPin size={16} />
                    <span>
                      <strong>{r.name}</strong>
                      {r.kindLabel && <small> · {r.kindLabel}</small>}
                      <br />
                      {r.address}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {linkNote && <p className="field-note">{linkNote}</p>}
            {isNew && !results.length && !linkNote && (
              <p className="field-note">
                Pick a result and the name, address, phone, website, type and
                map position are filled in for you.
              </p>
            )}
          </div>
          <Field label="Name" full>
            <input
              autoFocus={!isNew}
              required
              value={place.name}
              onChange={(e) => change("name", e.target.value)}
            />
          </Field>
          <Field label="Local-language name" full>
            <input
              value={place.nativeName}
              onChange={(e) => change("nativeName", e.target.value)}
            />
          </Field>
          <Field label="Type">
            <select
              value={place.kind}
              onChange={(e) => change("kind", e.target.value as Place["kind"])}
            >
              {["attraction", "restaurant", "hotel", "station", "other"].map(
                (k) => (
                  <option key={k} value={k}>
                    {k.charAt(0).toUpperCase() + k.slice(1)}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Country">
            <input
              list="place-countries"
              value={place.country}
              onChange={(e) => change("country", e.target.value)}
            />
            <datalist id="place-countries">
              {["Japan", "Korea", "China"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </datalist>
          </Field>
          <Field label="City" full>
            <input
              value={place.city}
              onChange={(e) => change("city", e.target.value)}
            />
          </Field>
          <Field label="Address" full>
            <input
              value={place.address}
              onChange={(e) => change("address", e.target.value)}
            />
          </Field>
          <Field label="Local-language address" full>
            <input
              value={place.nativeAddress}
              onChange={(e) => change("nativeAddress", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={place.phone}
              onChange={(e) => change("phone", e.target.value)}
            />
          </Field>
          <Field label="Website">
            <input
              value={place.url}
              onChange={(e) => change("url", e.target.value)}
            />
          </Field>
          {place.kind === "restaurant" && (
            <>
              <Field label="Halal status" full>
                <select
                  value={place.halal}
                  onChange={(e) =>
                    change("halal", e.target.value as Place["halal"])
                  }
                >
                  {Object.entries(halalLabels).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Source / evidence" full>
                <textarea
                  value={place.evidence}
                  onChange={(e) => change("evidence", e.target.value)}
                  rows={2}
                />
              </Field>
              <Field label="Last checked" full>
                <input
                  type="date"
                  value={place.checkedOn}
                  onChange={(e) => change("checkedOn", e.target.value)}
                />
              </Field>
            </>
          )}
        </div>
        <details className="form-details">
          <summary>
            Map position ·{" "}
            {place.lat === null
              ? place.geo === "failed"
                ? "not found automatically"
                : "located automatically after saving"
              : place.geo === "approx"
                ? "approximate (city centre)"
                : place.geo === "manual"
                  ? "set by hand"
                  : "located"}
          </summary>
          <div className="form-grid">
            <Field label="Latitude (WGS84)">
              <input
                type="number"
                min="-90"
                max="90"
                step="any"
                value={place.lat ?? ""}
                onChange={(e) =>
                  setPlace((p) => ({
                    ...p,
                    lat: e.target.value === "" ? null : Number(e.target.value),
                    geo: "manual",
                  }))
                }
              />
            </Field>
            <Field label="Longitude (WGS84)">
              <input
                type="number"
                min="-180"
                max="180"
                step="any"
                value={place.lng ?? ""}
                onChange={(e) =>
                  setPlace((p) => ({
                    ...p,
                    lng: e.target.value === "" ? null : Number(e.target.value),
                    geo: "manual",
                  }))
                }
              />
            </Field>
            <button
              className="button full"
              type="button"
              onClick={locate}
              disabled={searching}
            >
              <Search size={16} />
              {searching ? "Looking up…" : `Search ${provider}`}
            </button>
          </div>
        </details>
        <details className="form-details">
          <summary>Notes</summary>
          <textarea
            rows={3}
            value={place.notes}
            onChange={(e) => change("notes", e.target.value)}
          />
        </details>
        <div className="map-links">
          {mapLinks(place)
            .slice(0, 2)
            .map((l) => (
              <a key={l.name} href={l.url} target="_blank" rel="noreferrer">
                {l.name}
                <ExternalLink size={13} />
              </a>
            ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <div className="spacer" />
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            Save place
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function TripEditor({
  trip,
  onClose,
  isNew = false,
}: {
  trip: Trip;
  onClose: () => void;
  isNew?: boolean;
}) {
  const [value, setValue] = useState(() => structuredClone(trip));
  const [error, setError] = useState("");
  function save(e: FormEvent) {
    e.preventDefault();
    if (
      value.end < value.start ||
      (Date.parse(value.end) - Date.parse(value.start)) / 86400000 > 365
    ) {
      setError("Choose a trip of up to 366 days.");
      return;
    }
    mutate((d) => {
      if (isNew) {
        d.trips.push(value);
        d.activeTripId = value.id;
      } else {
        d.trips[d.trips.findIndex((t) => t.id === trip.id)] = value;
      }
    });
    onClose();
  }
  return (
    <Modal title={isNew ? "New trip" : "Trip settings"} onClose={onClose}>
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="Trip name" full>
            <input
              autoFocus
              required
              value={value.name}
              onChange={(e) =>
                setValue((v) => ({ ...v, name: e.target.value }))
              }
            />
          </Field>
          <Field label="Start">
            <input
              type="date"
              required
              value={value.start}
              onChange={(e) =>
                setValue((v) => ({ ...v, start: e.target.value }))
              }
            />
          </Field>
          <Field label="End">
            <input
              type="date"
              required
              min={value.start}
              value={value.end}
              onChange={(e) => setValue((v) => ({ ...v, end: e.target.value }))}
            />
          </Field>
          <Field label="Applicant name (visa export)" full>
            <input
              value={value.applicant}
              onChange={(e) =>
                setValue((v) => ({ ...v, applicant: e.target.value }))
              }
            />
          </Field>
          <Field label="Home currency" full>
            <input
              value={value.homeCurrency}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  homeCurrency: e.target.value.toUpperCase(),
                }))
              }
            />
          </Field>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <div className="spacer" />
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">Save trip</button>
        </div>
      </form>
    </Modal>
  );
}
export function newTrip(): Trip {
  const id = uid(),
    scenario = uid(),
    date = new Date().toISOString().slice(0, 10);
  return {
    id,
    name: "",
    start: date,
    end: addDays(date, 6),
    applicant: "",
    homeCurrency: "SAR",
    scenarios: [
      { id: scenario, name: "Main plan", description: "", entries: [] },
    ],
    activeScenarioId: scenario,
    tasks: [],
  };
}

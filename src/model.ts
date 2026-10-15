import { z } from "zod";
const text = z.string().max(20000);
const short = z.string().max(300);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) &&
      new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v,
    "Invalid date",
  );
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const validZones = new Map<string, boolean>();
const timezone = z
  .string()
  .max(100)
  .refine((v) => {
    if (validZones.has(v)) return validZones.get(v)!;
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      validZones.set(v, true);
      return true;
    } catch {
      validZones.set(v, false);
      return false;
    }
  }, "Use an IANA time zone");
export const PlaceSchema = z
  .object({
    id: short,
    name: short.min(1),
    nativeName: short,
    kind: z.enum(["attraction", "restaurant", "hotel", "station", "other"]),
    country: short,
    city: short,
    address: text,
    nativeAddress: text,
    phone: short,
    url: short,
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    halal: z.enum([
      "unknown",
      "tagged",
      "certified",
      "self-certified",
      "muslim-friendly",
      "pork-free",
    ]),
    evidence: text,
    checkedOn: z.union([date, z.literal("")]),
    notes: text,
    // How the coordinates were obtained: looked up automatically (exact or
    // city-level), entered by hand, or not found by the automatic lookup.
    geo: z.enum(["auto", "approx", "manual", "failed"]).optional(),
  })
  .refine(
    (v) => (v.lat === null) === (v.lng === null),
    "Latitude and longitude must be supplied together",
  );
// Tickets, confirmations and other files on a plan. The file itself is
// stored separately (on the server and in each device's file store).
export const AttachmentSchema = z.object({
  id: z.string().regex(/^[\w-]{8,64}$/),
  name: short.min(1),
  type: short,
  size: z
    .number()
    .int()
    .min(0)
    .max(25 * 1024 * 1024),
  added: short,
});
export const maxAttachmentBytes = 25 * 1024 * 1024;
export const EntrySchema = z
  .object({
    id: short,
    type: z.enum(["activity", "stay", "transport", "food", "note"]),
    title: short.min(1),
    date,
    endDate: date,
    startTime: time,
    endTime: time,
    allDay: z.boolean(),
    country: short,
    city: short,
    toCountry: short,
    toCity: short,
    timezone,
    endTimezone: timezone,
    scope: z.enum(["intercity", "local"]),
    mode: short,
    placeId: short,
    fromStayId: short.optional(),
    toStayId: short.optional(),
    // Transport: segments sharing an option form one alternative route.
    option: short.optional(),
    // Transport: operator and service, e.g. "JR Nozomi 21" or "Peach MM702".
    provider: short.optional(),
    status: z.enum(["idea", "planned", "booked", "done"]),
    // Whether the plan has to be reserved; unset uses the default for its
    // kind (hotels and journeys between cities do).
    needsBooking: z.boolean().optional(),
    notes: text,
    bookingRef: short,
    // Where to buy or manage the ticket, and a number to call about it.
    ticketUrl: short.optional(),
    phone: short.optional(),
    cost: z.number().min(0).nullable(),
    currency: short,
    refundDeadline: z.union([date, z.literal("")]),
    attachments: z.array(AttachmentSchema).max(30).optional(),
  })
  .refine((v) => v.endDate >= v.date, "End date must follow start date")
  .refine(
    (v) => v.type !== "stay" || v.endDate > v.date,
    "Checkout must be after check-in",
  );
export const TaskSchema = z.object({
  id: short,
  title: short.min(1),
  due: z.union([date, z.literal("")]),
  done: z.boolean(),
  country: short,
  url: short,
  // Marked to work on today, and longer instructions.
  today: z.boolean().optional(),
  notes: text.optional(),
});
export const ScenarioSchema = z.object({
  id: short,
  name: short.min(1),
  description: text,
  entries: z.array(EntrySchema).max(3000),
});
export const visaCategoryIds = [
  "activity",
  "food",
  "transport",
  "local",
  "note",
] as const;
export type VisaCategory = (typeof visaCategoryIds)[number];
export const TripSchema = z
  .object({
    id: short,
    name: short.min(1),
    start: date,
    end: date,
    applicant: short,
    homeCurrency: short,
    scenarios: z.array(ScenarioSchema).min(1).max(50),
    activeScenarioId: short,
    tasks: z.array(TaskSchema).max(500),
    // Kinds of plan left out of visa itineraries; notes by default.
    visaHidden: z.array(z.enum(visaCategoryIds)).max(10).optional(),
  })
  .refine(
    (v) =>
      v.end >= v.start &&
      (Date.parse(v.end) - Date.parse(v.start)) / 86400000 <= 365,
    "Trip must span 1–366 days",
  )
  .refine(
    (v) => v.scenarios.some((s) => s.id === v.activeScenarioId),
    "Select an existing scenario",
  );
export const WorkspaceSchema = z
  .object({
    version: z.literal(1),
    trips: z.array(TripSchema).min(1).max(50),
    places: z.array(PlaceSchema).max(3000),
    activeTripId: short,
  })
  .superRefine((v, ctx) => {
    if (!v.trips.some((t) => t.id === v.activeTripId))
      ctx.addIssue({ code: "custom", message: "Select an existing trip" });
    const ids = [
      ...v.trips.map((t) => t.id),
      ...v.places.map((p) => p.id),
      ...v.trips.flatMap((t) => [
        ...t.tasks.map((a) => a.id),
        ...t.scenarios.flatMap((s) => [s.id, ...s.entries.map((e) => e.id)]),
      ]),
    ];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "IDs must be unique" });
    const places = new Set(v.places.map((p) => p.id));
    if (
      v.trips.some((t) =>
        t.scenarios.some((s) =>
          s.entries.some((e) => e.placeId && !places.has(e.placeId)),
        ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "A plan refers to a missing place",
      });
  });
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type Trip = z.infer<typeof TripSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type Task = z.infer<typeof TaskSchema>;
export const countryMeta: Record<
  string,
  { zone: string; currency: string; code: string }
> = {
  Japan: { zone: "Asia/Tokyo", currency: "JPY", code: "JP" },
  Korea: { zone: "Asia/Seoul", currency: "KRW", code: "KR" },
  China: { zone: "Asia/Shanghai", currency: "CNY", code: "CN" },
  Singapore: { zone: "Asia/Singapore", currency: "SGD", code: "SG" },
  Qatar: { zone: "Asia/Qatar", currency: "QAR", code: "QA" },
  "Saudi Arabia": { zone: "Asia/Riyadh", currency: "SAR", code: "SA" },
  "United Arab Emirates": { zone: "Asia/Dubai", currency: "AED", code: "AE" },
  "United Kingdom": { zone: "Europe/London", currency: "GBP", code: "GB" },
};
// crypto.randomUUID only exists in secure contexts (HTTPS or localhost); plain
// HTTP on a LAN address must still be able to create plans and places.
export function uid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const zone = (country: string) => countryMeta[country]?.zone || "UTC";
export const currency = (country: string) =>
  countryMeta[country]?.currency || "USD";
export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function days(start: string, end: string) {
  const result: string[] = [];
  for (let d = start; d <= end && result.length < 367; d = addDays(d, 1))
    result.push(d);
  return result;
}
// toLocaleDateString builds a new formatter on every call, which is slow on
// phones when a timeline labels hundreds of days; reuse formatters and results.
const dateLabel = (options: Intl.DateTimeFormatOptions) => {
  const format = new Intl.DateTimeFormat("en-GB", {
    ...options,
    timeZone: "UTC",
  });
  const seen = new Map<string, string>();
  return (d: string) => {
    let label = seen.get(d);
    if (label === undefined) {
      label = format.format(new Date(d + "T12:00:00Z"));
      seen.set(d, label);
    }
    return label;
  };
};
export const shortDate = dateLabel({ day: "numeric", month: "short" });
export const weekday = dateLabel({ weekday: "short" });
export const isWeekend = (d: string) =>
  [0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay());
// Weeks run Monday to Sunday.
export const mondayOf = (d: string) =>
  addDays(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));
// Shift a stay's check-in, checkout or both by whole days, keeping at least
// one night and staying within the trip.
export function shiftStay(
  e: Pick<Entry, "date" | "endDate">,
  mode: "start" | "end" | "move",
  delta: number,
  trip: Pick<Trip, "start" | "end">,
) {
  const nights = Math.round(
    (Date.parse(e.endDate) - Date.parse(e.date)) / 86400000,
  );
  if (mode === "start") {
    let date = addDays(e.date, delta);
    if (date < trip.start) date = trip.start;
    if (date >= e.endDate) date = addDays(e.endDate, -1);
    return { date, endDate: e.endDate };
  }
  if (mode === "end") {
    let endDate = addDays(e.endDate, delta);
    if (endDate > trip.end) endDate = trip.end;
    if (endDate <= e.date) endDate = addDays(e.date, 1);
    return { date: e.date, endDate };
  }
  let date = addDays(e.date, delta);
  if (date < trip.start) date = trip.start;
  if (addDays(date, nights) > trip.end) date = addDays(trip.end, -nights);
  return { date, endDate: addDays(date, nights) };
}
export function emptyEntry(
  date: string,
  type: Entry["type"] = "activity",
): Entry {
  return {
    id: uid(),
    type,
    title: "",
    date,
    endDate: type === "stay" ? addDays(date, 1) : date,
    startTime: type === "stay" ? "15:00" : "09:00",
    endTime: type === "stay" ? "11:00" : "12:00",
    allDay: false,
    country: "Japan",
    city: "",
    toCountry: "",
    toCity: "",
    timezone: "Asia/Tokyo",
    endTimezone: "Asia/Tokyo",
    scope: "intercity",
    mode: "Train",
    placeId: "",
    status: "planned",
    notes: "",
    bookingRef: "",
    cost: null,
    currency: "JPY",
    refundDeadline: "",
  };
}
export function emptyPlace(): Place {
  return {
    id: uid(),
    name: "",
    nativeName: "",
    kind: "attraction",
    country: "Japan",
    city: "",
    address: "",
    nativeAddress: "",
    phone: "",
    url: "",
    lat: null,
    lng: null,
    halal: "unknown",
    evidence: "",
    checkedOn: "",
    notes: "",
  };
}
export function cloneScenario(s: Scenario, name: string): Scenario {
  const ids = new Map(s.entries.map((e) => [e.id, uid()]));
  return {
    ...structuredClone(s),
    id: uid(),
    name,
    entries: s.entries.map((e) => ({
      ...structuredClone(e),
      id: ids.get(e.id)!,
      fromStayId: e.fromStayId ? ids.get(e.fromStayId) : undefined,
      toStayId: e.toStayId ? ids.get(e.toStayId) : undefined,
    })),
  };
}
export function occupies(e: Entry, d: string) {
  return e.date <= d && (e.type === "stay" ? e.endDate > d : e.endDate >= d);
}
export function entriesOn(s: Scenario, d: string) {
  return s.entries.filter((e) => occupies(e, d));
}
// Convert local wall times to UTC; Japan/Korea/China have no seasonal clock changes.
// Generic zones are resolved iteratively through Intl rather than the device zone.
const formatters = new Map<string, Intl.DateTimeFormat>();
const instants = new Map<string, number>();
export function instant(date: string, time: string, tz: string) {
  const key = `${date} ${time} ${tz}`;
  let found = instants.get(key);
  if (found === undefined) {
    if (instants.size > 20_000) instants.clear();
    found = convert(date, time, tz);
    instants.set(key, found);
  }
  return found;
}
function convert(date: string, time: string, tz: string) {
  const target = Date.parse(date + "T" + time + ":00Z");
  let candidate = target;
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, formatter);
  }
  for (let i = 0; i < 3; i++) {
    const parts = formatter.formatToParts(candidate);
    const p = Object.fromEntries(parts.map((a) => [a.type, a.value]));
    const wall = Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    );
    candidate += target - wall;
  }
  return candidate;
}
const normalized = (s: string) => s.trim().toLocaleLowerCase();
export type Issue = {
  id: string;
  kind:
    "transfer" | "stay-transfer" | "night" | "overlap" | "timing" | "address";
  date: string;
  title: string;
  // Plain-language explanation of exactly what is missing or conflicting.
  detail: string;
  entryId?: string;
  fromCity?: string;
  toCity?: string;
  country?: string;
  toCountry?: string;
  fromStayId?: string;
  toStayId?: string;
};
// Local transfers can cross municipality boundaries without becoming intercity
// journeys. Match cities, countries and times for both kinds of connection.
export function hasTransportConnection(
  entries: Entry[],
  from: string,
  to: string,
  fc: string,
  tc: string,
  earliest: string,
  latest: string,
) {
  const key = (city: string, country: string) =>
    normalized(country) + "|" + normalized(city);
  const reachable = new Map([
    [key(from, fc), instant(earliest, "00:00", zone(fc))],
  ]);
  const routes = entries
    .filter((t) => t.type === "transport" && t.status !== "idea")
    .filter((t) => t.date >= earliest && t.endDate <= latest)
    .sort(
      (a, b) =>
        instant(a.date, a.startTime, a.timezone) -
        instant(b.date, b.startTime, b.timezone),
    );
  for (const t of routes) {
    const prior = reachable.get(key(t.city, t.country));
    const departure = instant(t.date, t.startTime, t.timezone),
      arrival = instant(t.endDate, t.endTime, t.endTimezone);
    if (prior !== undefined && departure >= prior && arrival > departure) {
      const dest = key(t.toCity, t.toCountry || t.country);
      reachable.set(dest, Math.min(arrival, reachable.get(dest) ?? Infinity));
    }
  }
  return reachable.has(key(to, tc));
}
export function issuesFor(trip: Trip, s: Scenario, places: Place[]): Issue[] {
  const result: Issue[] = [];
  const live = s.entries.filter((e) => e.status !== "idea");
  const stays = live
    .filter((e) => e.type === "stay")
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
    );
  const covered = (
    from: string,
    to: string,
    fc: string,
    tc: string,
    earliest: string,
    latest: string,
  ) => hasTransportConnection(live, from, to, fc, tc, earliest, latest);
  for (let i = 1; i < stays.length; i++) {
    const a = stays[i - 1],
      b = stays[i];
    if (b.date < a.endDate) {
      result.push({
        id: "overlap-" + b.id,
        kind: "overlap",
        date: b.date,
        title: "Overlapping stays",
        detail: `${b.title} starts ${shortDate(b.date)}, before ${a.title} checks out on ${shortDate(a.endDate)}.`,
        entryId: b.id,
      });
      continue;
    }
    if (
      a.city &&
      b.city &&
      (normalized(a.city) !== normalized(b.city) ||
        normalized(a.country) !== normalized(b.country))
    ) {
      if (!covered(a.city, b.city, a.country, b.country, a.endDate, b.date))
        result.push({
          id: "transfer-" + b.id,
          kind: "transfer",
          date: b.date,
          title: `${a.city} → ${b.city}`,
          detail: `No transport from ${a.city} to ${b.city} between checkout on ${shortDate(a.endDate)} and check-in on ${shortDate(b.date)}.`,
          fromCity: a.city,
          toCity: b.city,
          country: a.country,
          toCountry: b.country,
        });
    } else if (
      (a.placeId !== b.placeId || a.title !== b.title) &&
      !live.some(
        (t) =>
          t.type === "transport" &&
          t.date === b.date &&
          t.scope === "local" &&
          t.fromStayId === a.id &&
          t.toStayId === b.id,
      )
    ) {
      result.push({
        id: "stay-transfer-" + b.id,
        kind: "stay-transfer",
        date: b.date,
        title: `Hotel change in ${b.city || b.country}`,
        detail: `No local transfer from ${a.title} to ${b.title} on ${shortDate(b.date)}.`,
        fromCity: a.city,
        toCity: b.city,
        country: b.country,
        toCountry: b.country,
        fromStayId: a.id,
        toStayId: b.id,
      });
    }
  }
  // Track city changes implied by activities when hotels have not been entered yet.
  const stops = live
    .filter((e) => ["activity", "food"].includes(e.type) && e.city)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
    );
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1],
      b = stops[i];
    if (
      normalized(a.city) === normalized(b.city) &&
      normalized(a.country) === normalized(b.country)
    )
      continue;
    if (
      covered(a.city, b.city, a.country, b.country, a.date, b.date) ||
      result.some(
        (r) =>
          r.kind === "transfer" &&
          normalized(r.fromCity || "") === normalized(a.city) &&
          normalized(r.toCity || "") === normalized(b.city) &&
          r.date >= a.date &&
          r.date <= b.date,
      )
    )
      continue;
    result.push({
      id: "activity-transfer-" + b.id,
      kind: "transfer",
      date: b.date,
      title: `${a.city} → ${b.city}`,
      detail: `${a.title} is in ${a.city} (${shortDate(a.date)}) and ${b.title} is in ${b.city} (${shortDate(b.date)}), with no transport between them.`,
      fromCity: a.city,
      toCity: b.city,
      country: a.country,
      toCountry: b.country,
    });
  }
  for (const d of days(trip.start, trip.end).slice(0, -1)) {
    const nightTravel = live.some(
      (e) => e.type === "transport" && e.date <= d && e.endDate > d,
    );
    if (!stays.some((e) => occupies(e, d)) && !nightTravel)
      result.push({
        id: "night-" + d,
        kind: "night",
        date: d,
        title: "Accommodation missing",
        detail: `No stay or overnight transport covers the night of ${weekday(d)} ${shortDate(d)}.`,
      });
  }
  const timed = live.filter((e) => e.type !== "stay" && !e.allDay);
  for (const e of timed) {
    if (
      instant(
        e.endDate,
        e.endTime,
        e.type === "transport" ? e.endTimezone : e.timezone,
      ) <= instant(e.date, e.startTime, e.timezone)
    )
      result.push({
        id: "timing-" + e.id,
        kind: "timing",
        date: e.date,
        title: `Check times: ${e.title}`,
        detail: `Ends (${shortDate(e.endDate)} ${e.endTime}) before or at its start (${shortDate(e.date)} ${e.startTime}), in local time.`,
        entryId: e.id,
      });
  }
  const intervals = timed
    .map((e) => ({
      e,
      start: instant(e.date, e.startTime, e.timezone),
      end: instant(
        e.endDate,
        e.endTime,
        e.type === "transport" ? e.endTimezone : e.timezone,
      ),
    }))
    .filter((x) => x.end > x.start)
    .sort((a, b) => a.start - b.start);
  let active: typeof intervals = [];
  let overlaps = 0;
  for (const b of intervals) {
    active = active.filter((a) => a.end > b.start);
    for (const a of active) {
      if (overlaps >= 200) break;
      // A meal or visit inside a long activity (a festival day, a theme park)
      // is planned that way, and the timeline draws it on top.
      if (
        a.e.type === "activity" &&
        a.end - a.start >= 2 * 3600000 &&
        b.end <= a.end
      )
        continue;
      result.push({
        id: `overlap-${a.e.id}-${b.e.id}`,
        kind: "overlap",
        date: b.e.date,
        title: `${a.e.title} / ${b.e.title}`,
        detail: `These plans overlap: ${a.e.startTime}–${a.e.endTime} and ${b.e.startTime}–${b.e.endTime} on ${shortDate(b.e.date)}.`,
        entryId: b.e.id,
      });
      overlaps++;
    }
    if (overlaps >= 200) break;
    active.push(b);
  }
  for (const e of stays) {
    const p = places.find((p) => p.id === e.placeId);
    const lacking = [
      !p?.address && "address",
      !p?.phone && "phone number",
    ].filter(Boolean);
    if (lacking.length)
      result.push({
        id: "address-" + e.id,
        kind: "address",
        date: e.date,
        title: `Add address & contact: ${e.title}`,
        detail: `${p ? "Missing" : "No hotel chosen yet; add its"} ${lacking.join(" and ")} (needed for visa schedules and arrival cards).`,
        entryId: e.id,
      });
  }
  for (const e of s.entries)
    if (e.date < trip.start || e.endDate > trip.end)
      result.push({
        id: "outside-" + e.id,
        kind: "timing",
        date: e.date,
        title: `Outside trip dates: ${e.title}`,
        detail: `${shortDate(e.date)}–${shortDate(e.endDate)} falls outside the trip (${shortDate(trip.start)}–${shortDate(trip.end)}).`,
        entryId: e.id,
      });
  return result.sort((a, b) => a.date.localeCompare(b.date));
}
export function distance(
  a: Pick<Place, "lat" | "lng">,
  b: Pick<Place, "lat" | "lng">,
) {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null)
    return null;
  const r = (n: number) => (n * Math.PI) / 180,
    dlat = r(b.lat - a.lat),
    dlng = r(b.lng - a.lng);
  return (
    6371 *
    2 *
    Math.atan2(
      Math.sqrt(
        Math.sin(dlat / 2) ** 2 +
          Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dlng / 2) ** 2,
      ),
      Math.sqrt(
        1 -
          (Math.sin(dlat / 2) ** 2 +
            Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dlng / 2) ** 2),
      ),
    )
  );
}
export function mapLinks(p: Place, food = false) {
  const q = food
    ? `${p.country === "China" ? "清真餐厅" : p.country === "Korea" ? "할랄 음식점" : "halal restaurants"} ${p.nativeName || p.name} ${p.city}`
    : `${p.nativeName || p.name} ${p.nativeAddress || p.address || p.city}`;
  const encoded = encodeURIComponent(q);
  const links = [
    {
      name: "Google Maps",
      url: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
    },
    {
      name: "OpenStreetMap",
      url: `https://www.openstreetmap.org/search?query=${encoded}`,
    },
  ];
  if (p.country === "Korea")
    links.unshift(
      { name: "Naver", url: `https://map.naver.com/p/search/${encoded}` },
      { name: "Kakao", url: `https://map.kakao.com/?q=${encoded}` },
    );
  if (p.country === "China")
    links.unshift(
      { name: "Amap", url: `https://www.amap.com/search?query=${encoded}` },
      { name: "Baidu", url: `https://map.baidu.com/search/${encoded}` },
    );
  return links;
}
// One line of a day's activity plan, split up for formatting.
export type VisaItem = {
  time: string;
  label: string;
  title: string;
  detail: string;
};
export type VisaRow = {
  date: string;
  activity: string;
  items: VisaItem[];
  contact: string;
  accommodation: string;
  missing: string[];
};
// Reservation marks: reserved, not reserved yet, or none for plans that need
// no reservation. Hotels and journeys between cities need one unless the
// plan says otherwise; anything else only when marked.
export const needsBookingByDefault = (e: Entry) =>
  e.type === "stay" || (e.type === "transport" && e.scope !== "local");
export function bookingState(e: Entry): "booked" | "todo" | null {
  if (e.status === "booked") return "booked";
  if (e.status !== "planned") return null;
  return (e.needsBooking ?? needsBookingByDefault(e)) ? "todo" : null;
}
export const bookingLabel = { booked: "Reserved", todo: "Not reserved yet" };
// Countries with a schedule export. Requirements depend on nationality; the
// notes are shown next to the export and must be checked with official sources.
export const visaCountries: Record<
  string,
  { title: string; intro: string; official: string; officialName: string }
> = {
  Japan: {
    title: "Schedule of Stay",
    intro: "The schedule of stay in Japan of",
    official: "https://www.mofa.go.jp/files/000433544.pdf",
    officialName: "MOFA Schedule of Stay form",
  },
  Korea: {
    title: "Travel Itinerary — Republic of Korea",
    intro: "The travel itinerary in the Republic of Korea of",
    official: "https://www.k-eta.go.kr/",
    officialName: "K-ETA",
  },
  China: {
    title: "Travel Itinerary — People's Republic of China",
    intro: "The travel itinerary in the People's Republic of China of",
    official: "https://www.visaforchina.cn/",
    officialName: "China Visa Application Service Center",
  },
};
export const visaCategories: { id: VisaCategory; label: string }[] = [
  { id: "activity", label: "Activities" },
  { id: "food", label: "Meals" },
  { id: "transport", label: "Travel between cities" },
  { id: "local", label: "Local transport" },
  { id: "note", label: "Notes" },
];
export const defaultVisaHidden: VisaCategory[] = ["note"];
const visaCategory = (e: Entry): VisaCategory =>
  e.type === "transport"
    ? e.scope === "local"
      ? "local"
      : "transport"
    : (e.type as VisaCategory);
const hhmm = (e: Entry) => (e.allDay ? "" : e.startTime);
export function visaRows(
  trip: Trip,
  s: Scenario,
  places: Place[],
  country = "Japan",
  hidden: readonly VisaCategory[] = trip.visaHidden ?? defaultVisaHidden,
): VisaRow[] {
  const live = s.entries.filter((e) => e.status !== "idea");
  const inCountry = (e: Entry) =>
    e.country === country ||
    (e.type === "transport" && (e.toCountry || e.country) === country);
  if (!live.some(inCountry)) return [];
  const place = (e: Entry) => places.find((p) => p.id === e.placeId);
  const placeName = (p: Place | undefined, fallback = "") =>
    p?.nativeName.trim() || p?.name.trim() || fallback;
  const placeAddress = (p: Place | undefined) =>
    p?.nativeAddress.trim() || p?.address.trim() || "";
  const contactPhone = (p: Place | undefined) => {
    const phone = p?.phone.trim() || "";
    const digits = phone.replace(/\D/g, "");
    return p?.country === "Japan" && /^81\d{9,10}$/.test(digits)
      ? phone.replace(/^\+81[\s-]*/, "0")
      : phone;
  };
  // Arrival into and departure from the country happen on one specific day;
  // journeys within the country appear on every day they span.
  const arrives = (e: Entry) =>
    e.type === "transport" && e.country !== country && e.toCountry === country;
  const departs = (e: Entry) =>
    e.type === "transport" &&
    e.country === country &&
    !!e.toCountry &&
    e.toCountry !== country;
  const onDay = (e: Entry, d: string) =>
    arrives(e)
      ? e.endDate === d
      : departs(e)
        ? e.date === d
        : e.country === country && occupies(e, d);
  const stayOn = (d: string) =>
    live.find(
      (e) => e.type === "stay" && e.country === country && occupies(e, d),
    );
  const relevant = days(trip.start, trip.end).filter((d) =>
    live.some(
      (e) =>
        onDay(e, d) ||
        (e.type === "stay" && e.country === country && e.endDate === d),
    ),
  );
  if (!relevant.length) return [];
  return days(relevant[0], relevant.at(-1)!)
    .filter(
      (d) =>
        relevant.includes(d) ||
        !live.some(
          (e) => e.type === "stay" && e.country !== country && occupies(e, d),
        ),
    )
    .map((d) => {
      const es = live
        // Arrival and departure always stay: the schedule must show them.
        .filter(
          (e) =>
            e.type !== "stay" &&
            onDay(e, d) &&
            (arrives(e) || departs(e) || !hidden.includes(visaCategory(e))),
        )
        .sort((a, b) => {
          // Arrival first, departure last, then by local time.
          const rank = (e: Entry) => (arrives(e) ? 0 : departs(e) ? 2 : 1);
          const time = (e: Entry) =>
            arrives(e) || (e.date < d && e.endDate === d)
              ? e.endTime
              : e.date < d
                ? "00:00"
                : hhmm(e);
          return rank(a) - rank(b) || time(a).localeCompare(time(b));
        });
      const stay = stayOn(d);
      const hotel = stay && place(stay);
      // Plans left out on purpose: the day is accounted for, not missing.
      const withheld = live.find(
        (e) =>
          e.type !== "stay" &&
          onDay(e, d) &&
          !es.includes(e) &&
          hidden.includes(visaCategory(e)),
      );
      const checkout = live.find(
        (e) =>
          e.type === "stay" &&
          e.country === country &&
          e.endDate === d &&
          e.id !== stay?.id,
      );
      const overnight = live.find(
        (e) =>
          e.type === "transport" &&
          e.date <= d &&
          e.endDate > d &&
          (e.country === country || e.toCountry === country),
      );
      const departure = es.some(departs);
      const lines: string[] = [];
      const items: VisaItem[] = [];
      const item = (
        text: string,
        time: string,
        label: string,
        title: string,
        detail = "",
      ) => {
        lines.push(text);
        items.push({ time, label, title, detail });
      };
      if (checkout) {
        const name = placeName(place(checkout), checkout.title);
        item(`Check out of ${name}`, "", "Check out of", name);
      }
      for (const e of es) {
        const at = place(e);
        const city = at?.city || e.city;
        const address = placeAddress(at);
        const title = at ? placeName(at, e.title) : e.title;
        const where = address
          ? ` — ${address}`
          : at && title !== e.title
            ? ` — ${title}${city ? `, ${city}` : ""}`
            : city
              ? ` (${city})`
              : "";
        if (e.type === "transport") {
          const route = `${e.mode || "Travel"} ${e.city || e.country} → ${e.toCity || e.toCountry || e.country}`;
          if (arrives(e))
            item(
              `Arrive in ${country}${e.allDay ? "" : ` ${e.endTime}`}: ${e.title} (${route})`,
              e.allDay ? "" : e.endTime,
              `Arrive in ${country}:`,
              e.title,
              route,
            );
          else if (departs(e))
            item(
              `Depart from ${country}${e.allDay ? "" : ` ${e.startTime}`}: ${e.title} (${route})`,
              e.allDay ? "" : e.startTime,
              `Depart from ${country}:`,
              e.title,
              route,
            );
          else if (e.date < d && e.endDate > d)
            item(
              `In transit: ${e.title} (${route})`,
              "",
              "In transit:",
              e.title,
              route,
            );
          else if (e.date < d)
            item(
              `Arrive ${e.endTime}: ${e.title} (${route})`,
              e.endTime,
              "Arrive:",
              e.title,
              route,
            );
          else {
            const time = e.allDay
              ? ""
              : `${e.startTime}–${e.endDate === d ? e.endTime : "overnight"}`;
            item(
              `${time ? time + " " : ""}${e.title} (${route})`,
              time,
              "",
              e.title,
              route,
            );
          }
        } else {
          const time = e.allDay
            ? ""
            : e.date < d
              ? `until ${e.endTime}`
              : `${e.startTime}–${e.endDate === d ? e.endTime : "…"}`;
          item(
            `${time ? time + " " : ""}${title}${where}`,
            time,
            "",
            title,
            where.replace(/^ — | \(|\)$/g, ""),
          );
        }
      }
      if (stay && stay.date === d) {
        const name = placeName(hotel, stay.title);
        item(`Check in to ${name}`, "", "Check in to", name);
      }
      if (!lines.length && withheld) {
        const where = hotel?.city || stay?.city || withheld.city || country;
        item(`Stay in ${where}`, "", "Stay in", where);
      }
      const missing: string[] = [];
      if (!es.length && !withheld && !(stay && stay.date === d))
        missing.push("activity plan");
      if (!stay && !overnight && !departure)
        missing.push(
          checkout ? "onward travel or accommodation" : "accommodation",
        );
      if (stay && !placeAddress(hotel)) missing.push("hotel address");
      if (stay && !hotel?.phone) missing.push("contact number");
      // Each number is labelled with the place it belongs to, hotel first.
      const contacts: string[] = [];
      const seen = new Set<string>();
      for (const [p, label] of [
        [hotel, placeName(hotel, stay?.title)],
        ...es.map((e) => [place(e), placeName(place(e), e.title)] as const),
      ] as const) {
        const phone = contactPhone(p);
        const key = phone.replace(/[^\d+]/g, "");
        if (!phone || seen.has(key)) continue;
        seen.add(key);
        contacts.push(label ? `${label}: ${phone}` : phone);
      }
      return {
        date: d,
        activity: lines.join("\n") || "To be completed",
        items,
        contact: contacts.join("\n") || "—",
        accommodation: stay
          ? `${placeName(hotel, stay.title)}\n${placeAddress(hotel) || "Address to be completed"}`
          : overnight
            ? `In transit (${overnight.title})`
            : departure
              ? `Departure from ${country}`
              : "To be completed",
        missing,
      };
    });
}
export function csv(rows: string[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              (/^(?:\s*[=+\-@]|[\t\r])/.test(v) ? "'" : "") +
              v.replaceAll('"', '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n")
  );
}
export function safeUrl(url: string) {
  try {
    const u = new URL(url);
    return ["https:", "http:"].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
export const attachmentExtension = (name: string) =>
  name.match(/\.[a-z0-9]{1,8}$/i)?.[0] || "";
// A new display name keeps the file's extension, so saved copies still open.
export function renamedAttachment(a: Attachment, name: string) {
  const clean = name
    .replace(/[\u0000-\u001f/\\]/g, "")
    .trim()
    .slice(0, 280);
  if (!clean) return a.name;
  const ext = attachmentExtension(a.name);
  return ext && !clean.toLowerCase().endsWith(ext.toLowerCase())
    ? clean + ext
    : clean;
}
// Every attachment referenced anywhere in the workspace.
export const attachmentsIn = (w: Workspace) =>
  w.trips.flatMap((t) =>
    t.scenarios.flatMap((s) => s.entries.flatMap((e) => e.attachments || [])),
  );
// Links for a plan's ticket page and phone number; plain text is accepted.
export const webLink = (url: string) =>
  /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
export const phoneLink = (phone: string) =>
  `tel:${phone.replace(/[^\d+]/g, "")}`;
export const hasTicket = (e: Entry) =>
  !!(e.attachments?.length || e.ticketUrl?.trim() || e.phone?.trim());
const monthNames = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
// The trip day a task is about when its title names one ("Book Nov2 bus",
// "6 Nov flight"), so tasks can show it without a date being typed in.
export function taskTripDate(title: string, trip: Pick<Trip, "start" | "end">) {
  const pattern =
    /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s?(\d{1,2})(?!\d)|(\d{1,2})\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)/gi;
  for (const m of title.matchAll(pattern)) {
    const month = monthNames.indexOf((m[1] || m[4]).toLowerCase()) + 1;
    const day = Number(m[2] || m[3]);
    if (day < 1 || day > 31) continue;
    for (const year of new Set([
      trip.start.slice(0, 4),
      trip.end.slice(0, 4),
    ])) {
      const d = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (d >= addDays(trip.start, -3) && d <= addDays(trip.end, 3)) return d;
    }
  }
  return "";
}
// "Due today", "Due Tue 27 Oct · in 22 days", "3 days overdue".
export function dueText(due: string, today: string) {
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  return `Due ${weekday(due)} ${shortDate(due)} · in ${days} days`;
}

// Kinds of plans that can be hidden from the itinerary and its shared image.
export type Kind =
  "stay" | "activity" | "food" | "transport" | "local" | "note";
export const kindOf = (e: Entry): Kind =>
  e.type === "transport"
    ? e.scope === "local"
      ? "local"
      : "transport"
    : e.type;
export const kindLabels: Record<Kind, string> = {
  stay: "Hotels",
  activity: "Activities",
  food: "Food",
  transport: "Between cities",
  local: "Local transport",
  note: "Notes",
};

// A small set of high-level tools for AI agents and scripts. The same tools
// back the MCP endpoint (/mcp), the JSON API (/api/agent/<tool>) and the
// command-line client (scripts/fieldnotes.mjs), so an agent can read the plan
// and add or change things without handling the whole workspace document.
import { z } from "zod";
import {
  WorkspaceSchema,
  emptyEntry,
  emptyPlace,
  uid,
  zone,
  currency,
  issuesFor,
  entriesOn,
  days,
  weekday,
  distance,
  type Workspace,
  type Entry,
  type Place,
  type Trip,
  bookingState,
} from "../src/model.ts";
import { countryCode } from "../src/locate.ts";
import type { GeoResult } from "../src/locate.ts";
import type { FoodResult } from "./lookup.ts";

export type Store = {
  read(): { revision: number; data: Workspace };
  // Saves only if the revision is unchanged; returns the new revision or null.
  write(data: Workspace, revision: number): number | null;
};
export type Lookups = {
  geocode(
    q: string,
    cc: string,
    near?: { lat: number; lng: number },
  ): Promise<GeoResult[]>;
  nearby(
    lat: number,
    lng: number,
    radius: number,
    halal: boolean,
  ): Promise<FoodResult[]>;
};
export class AgentError extends Error {}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 h)");
const where = {
  tripId: z
    .string()
    .optional()
    .describe("Trip ID. Defaults to the trip open in the app."),
  scenarioId: z
    .string()
    .optional()
    .describe("Scenario (plan version) ID. Defaults to the trip's active one."),
};
const entryFields = {
  title: z.string().min(1).max(300),
  date: date.describe("Start date (check-in date for stays)."),
  endDate: date
    .optional()
    .describe(
      "End date. Stays: checkout date (default next day). Others: default same day.",
    ),
  startTime: time.optional().describe("Local start time. Stays: check-in."),
  endTime: time.optional().describe("Local end time. Stays: checkout."),
  allDay: z.boolean().optional(),
  city: z
    .string()
    .max(300)
    .optional()
    .describe("City (departure city for transport)."),
  country: z
    .string()
    .max(300)
    .optional()
    .describe(
      'Country name, e.g. "Japan", "Korea", "China", "Saudi Arabia". Defaults to the country of the stay on that date.',
    ),
  toCity: z.string().max(300).optional().describe("Transport: arrival city."),
  scope: z
    .enum(["intercity", "local"])
    .optional()
    .describe(
      "Transport grouping. Use local for nearby day trips and airport transfers, even when the municipality differs.",
    ),
  toCountry: z
    .string()
    .max(300)
    .optional()
    .describe("Transport: arrival country."),
  timezone: z
    .string()
    .optional()
    .describe("IANA zone of the start time. Defaults from the country."),
  endTimezone: z
    .string()
    .optional()
    .describe("IANA zone of the end time. Defaults from the arrival country."),
  mode: z
    .string()
    .max(300)
    .optional()
    .describe(
      "Transport mode: Flight, Train, Shinkansen, Bus, Ferry, Car, Walk, Metro…",
    ),
  provider: z
    .string()
    .max(300)
    .optional()
    .describe('Transport operator and service, e.g. "JR Nozomi 21".'),
  option: z
    .string()
    .max(300)
    .optional()
    .describe(
      "Transport: label shared by alternative-route segments being compared.",
    ),
  status: z.enum(["idea", "planned", "booked", "done"]).optional(),
  needsBooking: z
    .boolean()
    .optional()
    .describe(
      "Whether the plan must be reserved. Defaults to true for hotels and journeys between cities, false otherwise. Use status booked once reserved.",
    ),
  notes: z.string().max(20000).optional(),
  bookingRef: z.string().max(300).optional(),
  ticketUrl: z
    .string()
    .max(300)
    .optional()
    .describe("Link to buy or manage the ticket/booking."),
  phone: z
    .string()
    .max(300)
    .optional()
    .describe("Phone number for the booking, operator or venue."),
  cost: z.number().min(0).nullable().optional(),
  currency: z
    .string()
    .max(300)
    .optional()
    .describe("ISO code, e.g. JPY. Defaults from the country."),
  refundDeadline: z.union([date, z.literal("")]).optional(),
  place: z
    .string()
    .optional()
    .describe("Linked saved place: its ID or exact name (see list_places)."),
};
const placeFields = {
  name: z.string().min(1).max(300),
  nativeName: z
    .string()
    .max(300)
    .optional()
    .describe("Name in the local script."),
  kind: z
    .enum(["attraction", "restaurant", "hotel", "station", "other"])
    .optional(),
  city: z.string().max(300).optional(),
  country: z.string().max(300).optional(),
  address: z.string().max(20000).optional(),
  nativeAddress: z.string().max(20000).optional(),
  phone: z.string().max(300).optional(),
  url: z.string().max(300).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  halal: z
    .enum([
      "unknown",
      "tagged",
      "certified",
      "self-certified",
      "muslim-friendly",
      "pork-free",
    ])
    .optional(),
  evidence: z
    .string()
    .max(20000)
    .optional()
    .describe("Source for the halal status or details, e.g. a link."),
  notes: z.string().max(20000).optional(),
};
const taskFields = {
  title: z.string().min(1).max(300),
  due: z.union([date, z.literal("")]).optional(),
  done: z.boolean().optional(),
  country: z.string().max(300).optional(),
  url: z.string().max(300).optional(),
  today: z
    .boolean()
    .optional()
    .describe("Marked to work on today (shown at the top of the checklist)."),
  notes: z.string().max(20000).optional(),
};

type Tool = {
  name: string;
  description: string;
  input: z.ZodObject;
  write?: boolean;
  run(args: any, ctx: Ctx): unknown | Promise<unknown>;
};
type Ctx = { data: Workspace; lookups: Lookups };

const tripOf = (w: Workspace, id?: string) => {
  const t = w.trips.find((t) => t.id === (id || w.activeTripId));
  if (!t) throw new AgentError(`No trip with ID ${id}. Use get_overview.`);
  return t;
};
const scenarioOf = (t: Trip, id?: string) => {
  const s = t.scenarios.find((s) => s.id === (id || t.activeScenarioId));
  if (!s)
    throw new AgentError(
      `No scenario with ID ${id} in "${t.name}". Use get_overview.`,
    );
  return s;
};
const findEntry = (w: Workspace, id: string) => {
  for (const trip of w.trips)
    for (const scenario of trip.scenarios) {
      const index = scenario.entries.findIndex((e) => e.id === id);
      if (index >= 0)
        return { trip, scenario, index, entry: scenario.entries[index] };
    }
  throw new AgentError(`No plan entry with ID ${id}. Use get_itinerary.`);
};
const findPlace = (w: Workspace, ref: string) => {
  const key = ref.trim().toLowerCase();
  const p =
    w.places.find((p) => p.id === ref) ||
    w.places.find(
      (p) => p.name.toLowerCase() === key || p.nativeName.toLowerCase() === key,
    );
  if (!p)
    throw new AgentError(
      `No saved place "${ref}". Use list_places or add_place.`,
    );
  return p;
};
const findTask = (w: Workspace, id: string) => {
  for (const trip of w.trips) {
    const index = trip.tasks.findIndex((t) => t.id === id);
    if (index >= 0) return { trip, index };
  }
  throw new AgentError(`No task with ID ${id}. Use get_overview.`);
};
// The country of the stay covering a date, so "add dinner in Osaka on the
// 5th" lands in the right time zone and currency without spelling it out.
const countryOn = (entries: Entry[], d: string) =>
  entries.find((e) => e.type === "stay" && e.date <= d && e.endDate > d)
    ?.country ||
  entries.find((e) => e.date <= d && e.endDate >= d && e.country)?.country ||
  "Japan";

const brief = (e: Entry, places: Place[]) => {
  const place = e.placeId ? places.find((p) => p.id === e.placeId) : undefined;
  return clean({
    id: e.id,
    type: e.type,
    title: e.title,
    date: e.date,
    endDate: e.endDate !== e.date ? e.endDate : undefined,
    time: e.allDay ? "all day" : `${e.startTime}–${e.endTime}`,
    city: e.city,
    country: e.country,
    to:
      e.type === "transport" && e.toCity
        ? `${e.toCity}, ${e.toCountry}`
        : undefined,
    mode: e.type === "transport" ? e.mode : undefined,
    provider: e.provider,
    option: e.option,
    status: e.status,
    reservation:
      bookingState(e) === "booked"
        ? "reserved"
        : bookingState(e) === "todo"
          ? "not reserved yet"
          : undefined,
    place: place ? `${place.name} (${place.id})` : undefined,
    cost: e.cost !== null ? `${e.cost} ${e.currency}` : undefined,
    bookingRef: e.bookingRef,
    ticketUrl: e.ticketUrl,
    phone: e.phone,
    refundDeadline: e.refundDeadline,
    notes: e.notes,
    attachments: e.attachments?.length
      ? e.attachments.map((a) => a.name)
      : undefined,
  });
};
const placeBrief = (p: Place) =>
  clean({
    id: p.id,
    name: p.name,
    nativeName: p.nativeName,
    kind: p.kind,
    city: p.city,
    country: p.country,
    address: p.address,
    halal: p.halal !== "unknown" ? p.halal : undefined,
    located:
      p.lat !== null
        ? `${p.lat.toFixed(5)},${p.lng!.toFixed(5)}`
        : p.geo === "failed"
          ? "not found"
          : "pending",
    url: p.url,
    phone: p.phone,
    notes: p.notes,
  });
// Drop empty values to keep responses short.
function clean<T extends Record<string, unknown>>(o: T) {
  return Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) => v !== undefined && v !== "" && v !== null,
    ),
  ) as Partial<T>;
}

function applyEntry(e: Entry, a: Record<string, any>, w: Workspace) {
  for (const k of [
    "title",
    "date",
    "endDate",
    "startTime",
    "endTime",
    "allDay",
    "city",
    "country",
    "toCity",
    "toCountry",
    "mode",
    "provider",
    "option",
    "status",
    "needsBooking",
    "notes",
    "bookingRef",
    "ticketUrl",
    "phone",
    "cost",
    "currency",
    "refundDeadline",
  ] as const)
    if (a[k] !== undefined) (e as any)[k] = a[k];
  if (a.place !== undefined)
    e.placeId = a.place ? findPlace(w, a.place).id : "";
  if (a.country !== undefined && a.timezone === undefined)
    e.timezone = zone(e.country);
  if (
    (a.toCountry !== undefined || a.country !== undefined) &&
    a.endTimezone === undefined
  )
    e.endTimezone = zone(e.toCountry || e.country);
  if (a.timezone !== undefined) e.timezone = a.timezone;
  if (a.endTimezone !== undefined) e.endTimezone = a.endTimezone;
  if (a.country !== undefined && a.currency === undefined && e.cost === null)
    e.currency = currency(e.country);
  if (
    e.type === "transport" &&
    (a.toCity !== undefined || a.city !== undefined)
  )
    e.scope =
      e.toCity && e.toCity.toLowerCase() !== e.city.toLowerCase()
        ? "intercity"
        : "local";
  if (e.type === "transport" && a.scope !== undefined) e.scope = a.scope;
}
function applyPlace(p: Place, a: Record<string, any>) {
  const located = p.lat !== null;
  for (const k of [
    "name",
    "nativeName",
    "kind",
    "city",
    "country",
    "address",
    "nativeAddress",
    "phone",
    "url",
    "halal",
    "evidence",
    "notes",
  ] as const)
    if (a[k] !== undefined) (p as any)[k] = a[k];
  if (a.lat !== undefined && a.lng !== undefined) {
    p.lat = a.lat;
    p.lng = a.lng;
    p.geo = "manual";
  } else if (
    located &&
    p.geo !== "manual" &&
    ["name", "nativeName", "city", "country", "address", "nativeAddress"].some(
      (k) => a[k] !== undefined,
    )
  ) {
    // Details changed: let the server's locator find it again.
    p.lat = p.lng = null;
    delete p.geo;
  }
}

export const tools: Tool[] = [
  {
    name: "get_overview",
    description:
      "Start here. Lists trips (with dates, scenarios, open tasks), counts of saved places, and which trip/scenario the tools use by default.",
    input: z.object({}),
    run: (_a, { data: w }) => ({
      defaultTripId: w.activeTripId,
      trips: w.trips.map((t) => ({
        id: t.id,
        name: t.name,
        start: t.start,
        end: t.end,
        homeCurrency: t.homeCurrency,
        activeScenarioId: t.activeScenarioId,
        scenarios: t.scenarios.map((s) => ({
          id: s.id,
          name: s.name,
          entries: s.entries.length,
        })),
        tasks: t.tasks.map((k) =>
          clean({
            id: k.id,
            title: k.title,
            due: k.due,
            done: k.done,
            today: k.today || undefined,
            notes: k.notes,
          }),
        ),
      })),
      places: w.places.length,
    }),
  },
  {
    name: "get_itinerary",
    description:
      "Day-by-day plan with entry IDs, plus problems the app detects (missing transfers, nights without a stay, overlaps). Use the IDs with update_entry/delete_entry.",
    input: z.object({
      ...where,
      from: date
        .optional()
        .describe("First day to include (default trip start)."),
      to: date.optional().describe("Last day to include (default trip end)."),
      type: z
        .enum(["activity", "stay", "transport", "food", "note"])
        .optional(),
    }),
    run: (a, { data: w }) => {
      const trip = tripOf(w, a.tripId),
        s = scenarioOf(trip, a.scenarioId);
      const from = a.from || trip.start,
        to = a.to || trip.end;
      const pick = (e: Entry) => !a.type || e.type === a.type;
      const listed = days(from, to).map((d) => ({
        date: d,
        day: weekday(d),
        entries: entriesOn(s, d)
          .filter((e) => pick(e) && (e.type === "stay" || e.date === d))
          .sort((x, y) =>
            (x.allDay ? "" : x.startTime).localeCompare(
              y.allDay ? "" : y.startTime,
            ),
          )
          .map((e) =>
            e.type === "stay" && e.date !== d
              ? {
                  id: e.id,
                  type: e.type,
                  title: e.title,
                  continuing: `night ${days(e.date, d).length} until ${e.endDate}`,
                }
              : brief(e, w.places),
          ),
      }));
      const outside = s.entries.filter(
        (e) => pick(e) && (e.endDate < trip.start || e.date > trip.end),
      );
      return {
        trip: trip.name,
        scenario: s.name,
        days: listed,
        outsideTripDates: outside.length
          ? outside.map((e) => brief(e, w.places))
          : undefined,
        issues: issuesFor(trip, s, w.places)
          .filter((i) => i.date >= from && i.date <= to)
          .map((i) =>
            clean({
              date: i.date,
              problem: i.title,
              detail: i.detail,
              entryId: i.entryId,
            }),
          ),
      };
    },
  },
  {
    name: "get_entry",
    description: "Full details of one plan entry.",
    input: z.object({ id: z.string() }),
    run: (a, { data: w }) => {
      const { entry, trip, scenario } = findEntry(w, a.id);
      return { trip: trip.name, scenario: scenario.name, entry };
    },
  },
  {
    name: "add_entry",
    description:
      "Add something to the plan: activity, stay (hotel night range), transport (flight/train between cities), food (meal), or note. Time zone and currency default from the country.",
    write: true,
    input: z.object({
      ...where,
      type: z.enum(["activity", "stay", "transport", "food", "note"]),
      ...entryFields,
    }),
    run: (a, { data: w }) => {
      const trip = tripOf(w, a.tripId),
        s = scenarioOf(trip, a.scenarioId);
      const e = emptyEntry(a.date, a.type);
      applyEntry(
        e,
        { ...a, country: a.country || countryOn(s.entries, a.date) },
        w,
      );
      if (a.type === "food" && a.startTime === undefined) {
        e.startTime = "19:00";
        e.endTime = "20:30";
      }
      // A start time alone means a one-hour slot (90 minutes for meals).
      if (
        a.type !== "stay" &&
        a.startTime !== undefined &&
        a.endTime === undefined
      ) {
        const [h, m] = a.startTime.split(":").map(Number);
        const end = Math.min(
          h * 60 + m + (a.type === "food" ? 90 : 60),
          23 * 60 + 59,
        );
        e.endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
      }
      if (
        a.type === "note" &&
        a.allDay === undefined &&
        a.startTime === undefined
      )
        e.allDay = true;
      if (a.type === "transport") {
        if (!a.toCity && a.scope === undefined) e.scope = "local";
        if (a.toCountry === undefined && a.toCity) e.toCountry = e.country;
        e.endTimezone = a.endTimezone || zone(e.toCountry || e.country);
      }
      s.entries.push(e);
      return { added: brief(e, w.places) };
    },
  },
  {
    name: "update_entry",
    description:
      'Change fields of a plan entry. Only the fields given are changed; pass place:"" to unlink a place.',
    write: true,
    input: z.object({
      id: z.string(),
      ...z.object(entryFields).partial().shape,
    }),
    run: (a, { data: w }) => {
      const { entry } = findEntry(w, a.id);
      applyEntry(entry, a, w);
      return { updated: brief(entry, w.places) };
    },
  },
  {
    name: "delete_entry",
    description: "Remove a plan entry.",
    write: true,
    input: z.object({ id: z.string() }),
    run: (a, { data: w }) => {
      const { scenario, index, entry } = findEntry(w, a.id);
      scenario.entries.splice(index, 1);
      for (const e of scenario.entries) {
        if (e.fromStayId === entry.id) delete e.fromStayId;
        if (e.toStayId === entry.id) delete e.toStayId;
      }
      return {
        deleted: { id: entry.id, title: entry.title, date: entry.date },
      };
    },
  },
  {
    name: "list_places",
    description:
      "Saved places (restaurants, hotels, attractions, stations), with IDs to link from entries.",
    input: z.object({
      query: z
        .string()
        .optional()
        .describe("Matches name, native name, address or notes."),
      kind: z
        .enum(["attraction", "restaurant", "hotel", "station", "other"])
        .optional(),
      city: z.string().optional(),
    }),
    run: (a, { data: w }) => {
      const q = a.query?.toLowerCase();
      return {
        places: w.places
          .filter(
            (p) =>
              (!a.kind || p.kind === a.kind) &&
              (!a.city ||
                p.city.toLowerCase().includes(a.city.toLowerCase())) &&
              (!q ||
                [
                  p.name,
                  p.nativeName,
                  p.address,
                  p.nativeAddress,
                  p.notes,
                ].some((v) => v.toLowerCase().includes(q))),
          )
          .sort((x, y) => x.name.localeCompare(y.name))
          .map(placeBrief),
      };
    },
  },
  {
    name: "add_place",
    description:
      "Save a place. Without lat/lng the server finds its location automatically within a few minutes. Use find_place first to get exact details.",
    write: true,
    input: z.object(placeFields),
    run: (a, { data: w }) => {
      const p = emptyPlace();
      p.country = "";
      applyPlace(p, { country: "Japan", ...a });
      w.places.push(p);
      return { added: placeBrief(p) };
    },
  },
  {
    name: "update_place",
    description:
      "Change fields of a saved place. Only the fields given are changed.",
    write: true,
    input: z.object({
      id: z.string().describe("Place ID or exact name."),
      ...z.object(placeFields).partial().shape,
    }),
    run: (a, { data: w }) => {
      const p = findPlace(w, a.id);
      applyPlace(p, a);
      return { updated: placeBrief(p) };
    },
  },
  {
    name: "delete_place",
    description:
      "Remove a saved place. Refused while plan entries link to it, unless unlink is true.",
    write: true,
    input: z.object({
      id: z.string().describe("Place ID or exact name."),
      unlink: z.boolean().optional(),
    }),
    run: (a, { data: w }) => {
      const p = findPlace(w, a.id);
      const linked = w.trips.flatMap((t) =>
        t.scenarios.flatMap((s) => s.entries.filter((e) => e.placeId === p.id)),
      );
      if (linked.length && !a.unlink)
        throw new AgentError(
          `"${p.name}" is linked from: ${linked.map((e) => `${e.title} (${e.date}, ${e.id})`).join("; ")}. Pass unlink:true to remove it anyway.`,
        );
      for (const e of linked) e.placeId = "";
      w.places = w.places.filter((x) => x.id !== p.id);
      return { deleted: { id: p.id, name: p.name }, unlinked: linked.length };
    },
  },
  {
    name: "add_task",
    description: "Add a to-do to a trip (bookings to make, documents to get…).",
    write: true,
    input: z.object({ tripId: where.tripId, ...taskFields }),
    run: (a, { data: w }) => {
      const trip = tripOf(w, a.tripId);
      const task = {
        id: uid(),
        title: a.title,
        due: a.due || "",
        done: a.done || false,
        country: a.country || "",
        url: a.url || "",
        ...(a.today ? { today: true } : {}),
        ...(a.notes ? { notes: a.notes } : {}),
      };
      trip.tasks.push(task);
      return { added: task };
    },
  },
  {
    name: "update_task",
    description: "Change a task, e.g. mark it done.",
    write: true,
    input: z.object({
      id: z.string(),
      ...z.object(taskFields).partial().shape,
    }),
    run: (a, { data: w }) => {
      const { trip, index } = findTask(w, a.id);
      const { id: _, ...patch } = a;
      trip.tasks[index] = { ...trip.tasks[index], ...patch };
      return { updated: trip.tasks[index] };
    },
  },
  {
    name: "delete_task",
    description: "Remove a task.",
    write: true,
    input: z.object({ id: z.string() }),
    run: (a, { data: w }) => {
      const { trip, index } = findTask(w, a.id);
      const [task] = trip.tasks.splice(index, 1);
      return { deleted: task };
    },
  },
  {
    name: "find_place",
    description:
      "Look up a real-world place by name or address (uses the map provider chosen in the app's Settings). Returns coordinates and details to pass to add_place.",
    input: z.object({
      query: z.string().min(1).max(300),
      country: z
        .string()
        .optional()
        .describe('Restrict to a country, e.g. "Japan".'),
      near: z
        .string()
        .optional()
        .describe('Bias toward a saved place (ID or name) or "lat,lng".'),
    }),
    run: async (a, { data: w, lookups }) => {
      const near = a.near ? centre(w, a.near) : undefined;
      const results = await lookups.geocode(
        a.query,
        a.country ? countryCode(a.country) : "",
        near,
      );
      return {
        results: results.slice(0, 8).map((r) =>
          clean({
            name: r.name,
            nativeName: r.nativeName,
            kind: r.kindLabel || r.kind,
            address: r.address,
            lat: r.lat,
            lng: r.lng,
            phone: r.phone,
            url: r.url,
            mapsUrl: r.mapsUrl,
            rating: r.rating,
            ratingCount: r.ratingCount,
          }),
        ),
      };
    },
  },
  {
    name: "search_restaurants",
    description:
      "Restaurants near a saved place or coordinates, nearest first, with cuisine, halal tags, Google rating (when Google is the provider) and a map link. Add one with add_place (kind restaurant) and/or add_entry (type food).",
    input: z.object({
      near: z
        .string()
        .describe('Saved place ID or name (e.g. the hotel), or "lat,lng".'),
      radius: z
        .number()
        .min(50)
        .max(50000)
        .optional()
        .describe("Metres, default 1000."),
      halal: z.boolean().optional().describe("Only halal-tagged places."),
      cuisine: z
        .string()
        .optional()
        .describe('Filter, e.g. "ramen" or "sushi".'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Default 20."),
    }),
    run: async (a, { data: w, lookups }) => {
      const c = centre(w, a.near);
      const all = await lookups.nearby(
        c.lat,
        c.lng,
        Math.round(a.radius || 1000),
        !!a.halal,
      );
      const q = a.cuisine?.toLowerCase();
      const hits = all
        .filter(
          (r) =>
            !q ||
            `${r.cuisine} ${r.name}`
              .toLowerCase()
              .replaceAll("_", " ")
              .includes(q),
        )
        .map((r) => ({ r, km: distance(c, r) ?? 0 }))
        .sort((x, y) => x.km - y.km);
      return {
        centre: c,
        found: hits.length,
        results: hits.slice(0, a.limit || 20).map(({ r, km }) =>
          clean({
            name: r.name,
            nativeName: r.nativeName !== r.name ? r.nativeName : undefined,
            cuisine: r.cuisine.replaceAll("_", " "),
            halal: r.halal,
            distance: `${Math.round(km * 1000)} m`,
            rating:
              r.rating !== undefined
                ? `${r.rating} (${r.ratingCount ?? 0})`
                : undefined,
            address: r.address,
            lat: r.lat,
            lng: r.lng,
            phone: r.phone,
            url: r.url,
            hours: r.openingHours,
            mapsUrl:
              r.source === "google" && r.link
                ? r.link
                : `https://www.google.com/maps/search/${encodeURIComponent(r.nativeName || r.name)}/@${r.lat},${r.lng},18z`,
          }),
        ),
      };
    },
  },
];
function centre(w: Workspace, ref: string) {
  const m = ref.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = Number(m[1]),
      lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  const p = findPlace(w, ref);
  if (p.lat === null || p.lng === null)
    throw new AgentError(
      `"${p.name}" has no location yet. Pass "lat,lng" or use find_place.`,
    );
  return { lat: p.lat, lng: p.lng };
}

export const toolList = () =>
  tools.map((t) => {
    const { $schema: _, ...schema } = z.toJSONSchema(t.input, {
      io: "input",
    }) as Record<string, unknown>;
    return {
      name: t.name,
      description: t.description,
      inputSchema: schema,
      annotations: {
        readOnlyHint: !t.write,
        destructiveHint: t.name.startsWith("delete_"),
      },
    };
  });

export function agent(store: Store, lookups: Lookups, onWrite: () => void) {
  async function call(name: string, raw: unknown) {
    const tool = tools.find((t) => t.name === name);
    if (!tool)
      throw new AgentError(
        `Unknown tool "${name}". Available: ${tools.map((t) => t.name).join(", ")}`,
      );
    const parsed = tool.input.strict().safeParse(raw ?? {});
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      throw new AgentError(
        `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`,
      );
    }
    // Reads and writes are synchronous against SQLite, so a write cannot
    // interleave with another; the revision check guards against devices.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { revision, data } = store.read();
      const draft = structuredClone(data);
      const result = await tool.run(parsed.data, { data: draft, lookups });
      if (!tool.write) return result;
      const valid = WorkspaceSchema.safeParse(draft);
      if (!valid.success) {
        const i = valid.error.issues[0];
        // The path into the whole workspace means little to the caller; name the field.
        const field = i.path.findLast(
          (k) =>
            typeof k === "string" &&
            !["trips", "scenarios", "entries", "places", "tasks"].includes(k),
        );
        throw new AgentError(
          `Not saved: ${field ? String(field) + ": " : ""}${i.message}`,
        );
      }
      const saved = store.write(valid.data, revision);
      if (saved !== null) {
        onWrite();
        return { ...(result as object), revision: saved };
      }
    }
    throw new AgentError("The plan kept changing; try again.");
  }
  return { call };
}

export const instructions =
  "Fieldnotes is a personal travel planner. A workspace holds trips; each trip has scenarios (alternative versions of the plan) containing dated entries (activity, stay, transport, food, note), plus to-do tasks. Saved places (hotels, restaurants, sights) are shared across trips and can be linked from entries. Call get_overview first, then get_itinerary to see the plan and its entry IDs. Dates are YYYY-MM-DD; times are local 24-hour HH:MM in the entry's country. Changes appear in the app on every device straight away.";

// Model Context Protocol over Streamable HTTP, stateless: each POST carries
// one JSON-RPC message and gets a plain JSON reply.
const protocols = ["2025-06-18", "2025-03-26", "2024-11-05"];
type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};
export async function mcpReply(
  run: ReturnType<typeof agent>,
  msg: Rpc,
  version: string,
) {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: msg.id ?? null,
    error: { code, message },
  });
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string")
    return fail(-32600, "Invalid request");
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: protocols.includes(msg.params?.protocolVersion)
          ? msg.params.protocolVersion
          : protocols[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "fieldnotes",
          title: "Fieldnotes travel planner",
          version,
        },
        instructions,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: toolList() });
    case "tools/call":
      try {
        const result = await run.call(msg.params?.name, msg.params?.arguments);
        return reply({
          content: [{ type: "text", text: JSON.stringify(result, null, 1) }],
        });
      } catch (e) {
        if (!(e instanceof AgentError)) console.error("Agent tool failed:", e);
        return reply({
          content: [
            {
              type: "text",
              text:
                e instanceof AgentError
                  ? e.message
                  : "The tool failed unexpectedly.",
            },
          ],
          isError: true,
        });
      }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

// Plain-text guide for agents that are only given the app's address.
export const llmsText = (
  base: string,
) => `# Fieldnotes travel planner — agent interface

${instructions}

## Ways to connect
- MCP (Streamable HTTP): ${base}/mcp
  Claude Code: claude mcp add --transport http fieldnotes ${base}/mcp
- JSON over HTTP: POST ${base}/api/agent/<tool> with a JSON body of arguments
  (Content-Type: application/json). Reply: {"result": ...} or {"error": "..."}.
  GET ${base}/api/agent lists the tools with JSON schemas.
- Command line (Node 18+, no install): node scripts/fieldnotes.mjs <tool> key=value ...
  in the Fieldnotes source folder; FIELDNOTES_URL selects the server.

## Tools
${tools
  .map((t) => {
    const shape = t.input.shape as Record<string, z.ZodType>;
    const args = Object.entries(shape).map(([k, v]) => {
      const opt = v.safeParse(undefined).success;
      return `    - ${k}${opt ? "?" : ""}${v.description ? ": " + v.description : ""}`;
    });
    return `- ${t.name}${t.write ? " (changes the plan)" : ""}: ${t.description}${args.length ? "\n" + args.join("\n") : ""}`;
  })
  .join("\n")}

## Example
curl -X POST ${base}/api/agent/add_entry -H 'Content-Type: application/json' \\
  -d '{"type":"food","title":"Dinner at Ichiran","date":"2026-11-03","startTime":"19:30","city":"Osaka"}'
`;

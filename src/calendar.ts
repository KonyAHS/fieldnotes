// The itinerary as an iCalendar (.ics) file, for Apple Calendar, Google
// Calendar and Outlook. Times are written in UTC (converted from each plan's
// own time zone), so every calendar shows them correctly wherever the phone
// is; hotel stays and all-day plans are whole days.
import {
  type Workspace,
  type Trip,
  type Scenario,
  type Entry,
  type Kind,
  kindOf,
  addDays,
  instant,
  zone,
} from "./model";
export type CalendarOptions = {
  /** Kinds of plans to leave out. */
  hide: Kind[];
  /** Include plans still marked as ideas. */
  ideas: boolean;
  /** Add checklist due dates and cancellation deadlines as all-day events. */
  deadlines: boolean;
};
// Text values escape backslashes, semicolons, commas and line breaks.
const escape = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
// Lines are folded at 75 bytes; continuation lines start with a space.
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}
const utc = (ms: number) =>
  new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const day = (d: string) => d.replace(/-/g, "");
const statusLabel: Record<Entry["status"], string> = {
  idea: "Idea",
  planned: "Planned",
  booked: "Booked",
  done: "Done",
};
function entryEvent(
  e: Entry,
  places: Workspace["places"],
  stamp: string,
): string[] {
  const place = places.find((p) => p.id === e.placeId);
  const tz = e.timezone || zone(e.country);
  const lines = ["BEGIN:VEVENT", `UID:${e.id}@fieldnotes`, `DTSTAMP:${stamp}`];
  if (e.type === "stay" || e.allDay) {
    // All-day ends are exclusive: a stay ends on checkout morning, which
    // calendars show as the last night.
    const end = e.type === "stay" ? e.endDate : addDays(e.endDate, 1);
    lines.push(`DTSTART;VALUE=DATE:${day(e.date)}`);
    lines.push(`DTEND;VALUE=DATE:${day(end)}`);
    lines.push("TRANSP:TRANSPARENT");
  } else {
    const start = instant(e.date, e.startTime, tz);
    let end = instant(
      e.endDate,
      e.endTime,
      (e.type === "transport" && e.endTimezone) || tz,
    );
    // A plan without a real duration still gets a visible slot.
    if (end <= start) end = start + 30 * 60000;
    lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`);
  }
  const route =
    e.type === "transport" && e.toCity && e.toCity !== e.city
      ? `${e.city} → ${e.toCity}`
      : "";
  const title =
    e.type === "stay"
      ? `🛏 ${e.title}`
      : e.status === "idea"
        ? `${e.title} (idea)`
        : e.title;
  lines.push(`SUMMARY:${escape(title)}`);
  const location = place
    ? [...new Set([place.name, place.address].filter(Boolean))].join(", ")
    : route || [e.city, e.country].filter(Boolean).join(", ");
  if (location) lines.push(`LOCATION:${escape(location)}`);
  if (place?.lat != null && place.lng != null)
    lines.push(`GEO:${place.lat};${place.lng}`);
  const details = [
    route,
    e.type === "transport" && [e.mode, e.provider].filter(Boolean).join(" · "),
    `Status: ${statusLabel[e.status]}`,
    e.bookingRef && `Booking reference: ${e.bookingRef}`,
    (e.phone || place?.phone) && `Phone: ${e.phone || place?.phone}`,
    e.ticketUrl && `Ticket: ${e.ticketUrl}`,
    place?.url && `Website: ${place.url}`,
    e.refundDeadline && `Free cancellation until ${e.refundDeadline}`,
    e.notes,
  ].filter(Boolean);
  if (details.length) lines.push(`DESCRIPTION:${escape(details.join("\n"))}`);
  const url = e.ticketUrl || place?.url;
  if (url && /^https?:\/\//.test(url)) lines.push(`URL:${url}`);
  lines.push(
    `CATEGORIES:${escape(kindOf(e))}`,
    `STATUS:${e.status === "idea" ? "TENTATIVE" : "CONFIRMED"}`,
    "END:VEVENT",
  );
  return lines;
}
function allDay(
  uid: string,
  date: string,
  summary: string,
  description: string,
  stamp: string,
) {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}@fieldnotes`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${day(date)}`,
    `DTEND;VALUE=DATE:${day(addDays(date, 1))}`,
    "TRANSP:TRANSPARENT",
    `SUMMARY:${escape(summary)}`,
    ...(description ? [`DESCRIPTION:${escape(description)}`] : []),
    "END:VEVENT",
  ];
}
export function tripCalendar(
  trip: Trip,
  scenario: Scenario,
  places: Workspace["places"],
  options: CalendarOptions,
  now = Date.now(),
) {
  const stamp = utc(now);
  const entries = scenario.entries.filter(
    (e) =>
      (options.ideas || e.status !== "idea") &&
      !options.hide.includes(kindOf(e)),
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fieldnotes//Trip planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(trip.name)}`,
    // How often subscribed calendars check for changes.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...entries.flatMap((e) => entryEvent(e, places, stamp)),
  ];
  if (options.deadlines) {
    for (const t of trip.tasks)
      if (t.due && !t.done)
        lines.push(
          ...allDay(
            `task-${t.id}`,
            t.due,
            `☐ ${t.title}`,
            t.notes || "",
            stamp,
          ),
        );
    for (const e of scenario.entries)
      if (e.refundDeadline && e.status !== "idea")
        lines.push(
          ...allDay(
            `cancel-${e.id}`,
            e.refundDeadline,
            `Last day to cancel: ${e.title}`,
            e.bookingRef ? `Booking reference: ${e.bookingRef}` : "",
            stamp,
          ),
        );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
// The file name for a trip, e.g. "East-Asia.ics".
export const calendarName = (trip: Trip) =>
  (trip.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "trip") +
  ".ics";

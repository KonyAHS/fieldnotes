import ICAL from "ical.js";
import {
  type Entry,
  type Place,
  emptyEntry,
  emptyPlace,
  addDays,
  zone,
  currency,
} from "./model";
export type ImportCandidate = {
  entry: Entry;
  place?: Place;
  selected: boolean;
  sourceUid: string;
};
function calendarTime(t: ICAL.Time, tz: string, fallback: string) {
  const validZone = (() => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    } catch {
      return fallback;
    }
  })();
  if (t.zone.tzid === "UTC") {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: validZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(t.toJSDate());
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      time: `${p.hour}:${p.minute}`,
      zone: validZone,
    };
  }
  const pad = (v: number) => String(v).padStart(2, "0");
  return {
    date: `${t.year}-${pad(t.month)}-${pad(t.day)}`,
    time: `${pad(t.hour)}:${pad(t.minute)}`,
    zone: validZone,
  };
}
export function importCalendar(
  text: string,
  country: string,
  city: string,
  type: Entry["type"],
): ImportCandidate[] {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const c of root.getAllSubcomponents("vtimezone")) {
    const id = c.getFirstPropertyValue("tzid");
    if (id)
      ICAL.TimezoneService.register(
        new ICAL.Timezone({ component: c, tzid: String(id) }),
      );
  }
  return root
    .getAllSubcomponents("vevent")
    .slice(0, 100)
    .map((component): ImportCandidate | null => {
      if (component.hasProperty("rrule"))
        throw Error(
          "Recurring calendars are not supported. Export individual reservations.",
        );
      if (component.getFirstPropertyValue("status") === "CANCELLED")
        return null;
      const event = new ICAL.Event(component);
      if (!event.startDate) throw Error("Calendar event has no start date");
      const tz = String(
        component.getFirstProperty("dtstart")?.getParameter("tzid") ||
          zone(country),
      );
      const start = calendarTime(event.startDate, tz, zone(country)),
        end = calendarTime(event.endDate, tz, zone(country));
      const allDay = event.startDate.isDate;
      const endDate =
        allDay && type !== "stay" ? addDays(end.date, -1) : end.date;
      const sourceUid = event.uid || "";
      const entry: Entry = {
        ...emptyEntry(start.date, type),
        title: event.summary || "Imported reservation",
        country,
        city,
        startTime: allDay ? (type === "stay" ? "15:00" : "09:00") : start.time,
        endTime: allDay ? (type === "stay" ? "11:00" : "18:00") : end.time,
        endDate: endDate < start.date ? start.date : endDate,
        allDay: type === "stay" ? false : allDay,
        timezone: start.zone,
        endTimezone: end.zone,
        currency: currency(country),
        notes: [
          event.description,
          event.location,
          sourceUid ? `Imported calendar UID: ${sourceUid}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
      let place: Place | undefined;
      if (event.location && type === "stay") {
        place = {
          ...emptyPlace(),
          kind: "hotel",
          name: event.summary || "Imported stay",
          address: event.location,
          country,
          city,
        };
        entry.placeId = place.id;
      }
      return {
        entry,
        place,
        selected: type !== "stay" || entry.endDate > entry.date,
        sourceUid,
      };
    })
    .filter((x): x is ImportCandidate => x !== null);
}
function labelled(text: string, labels: string[]) {
  for (const label of labels) {
    const m = text.match(
      new RegExp(`^\\s*(?:${label})\\s*[:：]\\s*(.+)$`, "im"),
    );
    if (m) return m[1].trim();
  }
  return "";
}
function parseDate(value: string) {
  const iso = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  if (!/[a-z]/i.test(value)) return "";
  const n = Date.parse(value);
  return isNaN(n) ? "" : new Date(n).toISOString().slice(0, 10);
}
export function importConfirmation(
  text: string,
  country: string,
  city: string,
): ImportCandidate {
  const title =
    labelled(text, ["Hotel", "Property", "Accommodation", "Listing", "Name"]) ||
    "";
  const checkin = parseDate(
    labelled(text, ["Check[- ]?in", "Arrival", "Start date"]),
  );
  const checkout = parseDate(
    labelled(text, ["Check[- ]?out", "Departure", "End date"]),
  );
  const date = checkin || new Date().toISOString().slice(0, 10);
  const entry = {
    ...emptyEntry(date, "stay"),
    date: checkin,
    title,
    country,
    city,
    endDate: checkout,
    timezone: zone(country),
    endTimezone: zone(country),
    currency: currency(country),
    bookingRef: labelled(text, [
      "Confirmation(?: number| code)?",
      "Booking(?: number| reference)?",
      "Reservation(?: number| code)?",
    ]),
    notes: text,
  };
  const place = {
    ...emptyPlace(),
    kind: "hotel" as const,
    name: title,
    address: labelled(text, ["Address", "Property address"]),
    phone: labelled(text, ["Phone", "Telephone", "Contact number"]),
    country,
    city,
  };
  entry.placeId = place.id;
  return {
    entry,
    place,
    selected: !!checkin && !!checkout && !!title,
    sourceUid: "",
  };
}
export type ReservationEmail = {
  id: string;
  provider: "booking" | "airbnb";
  from: string;
  subject: string;
  date: string;
  text: string;
};
const months =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
// Dates as written in provider emails, e.g. "Wed, 28 Oct 2026",
// "Wednesday, October 28, 2026", "Oct 28" (Airbnb omits the year) or ISO.
export function emailDate(value: string, sent: string) {
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const m =
    value.match(
      new RegExp(`\\b(\\d{1,2})\\s+(${months})\\.?,?\\s*(\\d{4})?`, "i"),
    ) ||
    value.match(
      new RegExp(
        `\\b(${months})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})?`,
        "i",
      ),
    );
  if (!m) return "";
  const [day, month] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  const index = months
    .split("|")
    .findIndex((x) => new RegExp(`^(?:${x})$`, "i").test(month));
  if (index < 0) return "";
  const sentDate = new Date(sent);
  let year = m[3] ? Number(m[3]) : sentDate.getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  let date = `${year}-${pad(index + 1)}-${pad(Number(day))}`;
  // Without a year, a date well before the email was sent means next year.
  if (!m[3] && Date.parse(date) < sentDate.getTime() - 60 * 86400000)
    date = `${++year}-${pad(index + 1)}-${pad(Number(day))}`;
  return isNaN(Date.parse(date)) ? "" : date;
}
// A labelled value on the same line ("Check-in: Wed 28 Oct") or on the lines
// directly below the label, as in HTML emails converted to text.
// With `single`, a value on the label's own line is used alone; otherwise the
// next line is taken.
function nearAll(text: string, labels: string, lines = 3, single = false) {
  const rows = text.split("\n").map((r) => r.trim());
  const label = new RegExp(`^(?:${labels})\\b\\s*[:：]?\\s*(.*)$`, "i");
  const values: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i].match(label);
    if (!m) continue;
    const value =
      single && m[1]
        ? m[1]
        : [m[1], ...rows.slice(i + 1, i + 1 + lines)].filter(Boolean).join(" ");
    if (value) values.push(value);
  }
  return values;
}
const near = (text: string, labels: string, lines = 3, single = false) =>
  nearAll(text, labels, lines, single)[0] || "";
const countryHints: [RegExp, string][] = [
  [/\bjapan\b|日本/i, "Japan"],
  [/\b(?:south )?korea\b|대한민국|한국/i, "Korea"],
  [/\bchina\b|中国|中國/i, "China"],
  [/\bsaudi arabia\b/i, "Saudi Arabia"],
];
export function importEmail(
  mail: ReservationEmail,
  country: string,
  city: string,
): ImportCandidate {
  const text = mail.text;
  const subject = mail.subject.replace(/\s+/g, " ").trim();
  const cancelled = /cancel/i.test(subject);
  const fromSubject =
    subject.match(
      /(?:confirmed|confirmation|booking|reservation)\b.*?\b(?:at|for)\s+(.+?)(?:\s*[-–—|!]|$)/i,
    )?.[1] ||
    subject.match(
      /^(?:reservation confirmed|booking confirmed)\s*[-–—:]\s*(.+)$/i,
    )?.[1] ||
    "";
  const title = (
    labelled(text, ["Property", "Hotel", "Accommodation", "Listing"]) ||
    fromSubject
  )
    .replace(/\s+/g, " ")
    .slice(0, 200)
    .trim();
  const firstDate = (labels: string) =>
    nearAll(text, labels)
      .map((v) => emailDate(v, mail.date))
      .find(Boolean) || "";
  const checkin = firstDate("check[- ]?in|arrival");
  const checkout = firstDate("check[- ]?out|departure");
  const time = (labels: string, fallback: string) => {
    for (const v of nearAll(text, labels)) {
      const m = v.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      if (!m || Number(m[1]) > 23) continue;
      const h = m[3]
        ? (Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)
        : Number(m[1]);
      return `${String(h).padStart(2, "0")}:${m[2]}`;
    }
    return fallback;
  };
  const address = near(text, "address|property address", 1, true)
    .replace(/get directions.*/i, "")
    .trim();
  const detected =
    countryHints.find(([re]) => re.test(address))?.[1] ||
    countryHints.find(([re]) => re.test(subject))?.[1] ||
    country;
  const reference = (
    near(
      text,
      "booking number|confirmation number|confirmation code|reservation code|reservation number",
      1,
      true,
    ).match(/[A-Z0-9][A-Z0-9.\-]{4,}/i)?.[0] || ""
  ).replace(/\.$/, "");
  const provider = mail.provider === "airbnb" ? "Airbnb" : "Booking.com";
  const entry: Entry = {
    ...emptyEntry(checkin || new Date().toISOString().slice(0, 10), "stay"),
    date: checkin,
    endDate: checkout,
    title: title || `${provider} stay`,
    country: detected,
    city,
    startTime: time("check[- ]?in|arrival", "15:00"),
    endTime: time("check[- ]?out|departure", "11:00"),
    timezone: zone(detected),
    endTimezone: zone(detected),
    currency: currency(detected),
    status: "booked",
    bookingRef: reference,
    notes: `${provider} email: ${subject}\nImported email ID: ${mail.id}`,
  };
  const place: Place = {
    ...emptyPlace(),
    kind: "hotel",
    name: entry.title,
    address,
    phone:
      near(text, "phone|telephone|property phone", 1, true).match(
        /\+?[\d][\d\s()-]{6,}\d/,
      )?.[0] || "",
    country: detected,
    city,
  };
  entry.placeId = place.id;
  return {
    entry,
    place,
    selected: !cancelled && !!checkin && !!checkout && checkout > checkin,
    sourceUid: mail.id,
  };
}

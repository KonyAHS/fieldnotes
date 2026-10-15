// Spreadsheets of hotels, restaurants and sights for Google My Maps. Google
// offers no way for other apps to write to a Google Maps list, but a My Maps
// map shows up in the Google Maps app (You › Saved › Maps), and a layer
// imported from a file can later be refreshed from a new copy of that file
// ("Reimport and merge"). Each row has a stable ID column for that.
import {
  type Place,
  type Scenario,
  type Trip,
  type Workspace,
  shortDate,
} from "./model";

export type MapList = "hotels" | "food" | "sights" | "all";
export const mapLists: { id: MapList; name: string; file: string }[] = [
  { id: "hotels", name: "Hotels", file: "Hotels" },
  { id: "food", name: "Restaurants & cafés", file: "Restaurants" },
  { id: "sights", name: "Sights & activities", file: "Sights" },
  { id: "all", name: "All places", file: "Places" },
];
export const mapListHeader = [
  "ID",
  "Name",
  "Location",
  "Category",
  "Dates",
  "Address",
  "Local name",
  "Local address",
  "Phone",
  "Website",
  "Google Maps",
  "Notes",
];
const kindNames: Record<Place["kind"], string> = {
  hotel: "Hotel",
  restaurant: "Restaurant",
  attraction: "Sight",
  station: "Station",
  other: "Other",
};
const inList = (list: MapList, p: Place) =>
  list === "all" ||
  (list === "food" && p.kind === "restaurant") ||
  (list === "sights" && (p.kind === "attraction" || p.kind === "other")) ||
  (list === "hotels" && p.kind === "hotel");
const range = (from: string, to: string) =>
  from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`;
// Coordinates when known (exact), otherwise an address Google can look up.
function location(
  p: Pick<
    Place,
    "lat" | "lng" | "address" | "nativeAddress" | "name" | "city" | "country"
  >,
) {
  if (p.lat !== null && p.lng !== null)
    return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
  return (
    p.address ||
    p.nativeAddress ||
    [p.name, p.city, p.country].filter(Boolean).join(", ")
  );
}
const googleLink = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
// A saved Google Maps link to the exact place, when there is one.
const savedGoogleLink = (p: Place) =>
  [p.url, p.notes]
    .join(" ")
    .match(
      /https:\/\/(?:www\.)?(?:maps\.google\.com\/\?cid=\d+|google\.com\/maps\/place\/[^\s"]+)/,
    )?.[0];
function placeRow(p: Place, name: string, dates: string): string[] {
  const query =
    p.lat !== null
      ? `${p.lat},${p.lng}`
      : [p.nativeName || p.name, p.nativeAddress || p.address || p.city]
          .filter(Boolean)
          .join(" ");
  return [
    p.id,
    name,
    location(p),
    kindNames[p.kind],
    dates,
    p.address,
    p.nativeName,
    p.nativeAddress,
    p.phone,
    p.url,
    savedGoogleLink(p) || googleLink(query),
    p.notes.slice(0, 500),
  ];
}
export type MapListResult = {
  rows: string[][];
  // Rows Google has to find by name because nothing more precise is known.
  unplaced: string[];
};
// Plans in the active scenario visiting each place, as date ranges.
function visits(scenario: Scenario) {
  const by = new Map<string, string[]>();
  for (const e of [...scenario.entries].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    if (!e.placeId || e.status === "idea") continue;
    const end = e.type === "stay" ? e.endDate : e.endDate || e.date;
    const label =
      e.type === "stay"
        ? `${range(e.date, end)} (${days(e.date, end)} night${days(e.date, end) === 1 ? "" : "s"})`
        : range(e.date, end);
    by.set(e.placeId, [...(by.get(e.placeId) || []), label]);
  }
  return by;
}
const days = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
export function mapListRows(
  data: Workspace,
  trip: Trip,
  scenario: Scenario,
  list: MapList,
  onlyPlanned: boolean,
): MapListResult {
  const places = new Map(data.places.map((p) => [p.id, p]));
  const planned = visits(scenario);
  const rows: string[][] = [];
  const unplaced: string[] = [];
  const note = (r: string[], p?: Place) => {
    if (!p || p.lat === null) unplaced.push(r[1]);
    rows.push(r);
  };
  if (list === "hotels") {
    // In stay order and numbered, so the map reads as the route.
    const stays = scenario.entries
      .filter((e) => e.type === "stay" && e.status !== "idea")
      .sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Set<string>();
    stays.forEach((s, i) => {
      const p = places.get(s.placeId);
      const n = `${i + 1}. `;
      if (p) {
        if (seen.has(p.id)) return;
        seen.add(p.id);
        note(placeRow(p, n + p.name, (planned.get(p.id) || []).join("; ")), p);
        return;
      }
      // A stay without a saved place: located by its city.
      const where = [s.city, s.country].filter(Boolean).join(", ");
      note([
        s.id,
        n + s.title,
        where || s.title,
        "Hotel",
        range(s.date, s.endDate),
        "",
        "",
        "",
        s.phone || "",
        "",
        googleLink(`${s.title} ${where}`),
        s.notes.slice(0, 500),
      ]);
    });
    if (onlyPlanned) return { rows, unplaced };
  }
  // Places of this trip: used by any of its scenarios, or in its countries.
  const used = new Set(
    trip.scenarios.flatMap((s) => s.entries.map((e) => e.placeId)),
  );
  const countries = new Set(
    trip.scenarios.flatMap((s) =>
      s.entries.flatMap((e) => [e.country, e.toCountry]),
    ),
  );
  const listed = new Set(rows.map((r) => r[0]));
  const rest = data.places
    .filter(
      (p) =>
        !listed.has(p.id) &&
        inList(list, p) &&
        (onlyPlanned
          ? planned.has(p.id)
          : used.has(p.id) || countries.has(p.country)),
    )
    .sort(
      (a, b) =>
        (planned.get(a.id)?.[0] ? 0 : 1) - (planned.get(b.id)?.[0] ? 0 : 1) ||
        a.country.localeCompare(b.country) ||
        a.city.localeCompare(b.city) ||
        a.name.localeCompare(b.name),
    );
  for (const p of rest)
    note(placeRow(p, p.name, (planned.get(p.id) || []).join("; ")), p);
  return { rows, unplaced };
}
// Quoted CSV. Text that a spreadsheet would run as a formula gets a leading
// apostrophe, except coordinates such as "-33.86, 151.21" and phone numbers.
export const mapListCsv = (rows: string[][]) =>
  "\uFEFF" +
  [mapListHeader, ...rows]
    .map((row) =>
      row
        .map(
          (v) =>
            '"' +
            (/^(?:\s*[=+\-@]|[\t\r])/.test(v) &&
            !/^(-?\d+(\.\d+)?, -?\d+(\.\d+)?|\+[\d ()-]+)$/.test(v)
              ? "'"
              : "") +
            v.replaceAll('"', '""') +
            '"',
        )
        .join(","),
    )
    .join("\r\n");
export const mapListFileName = (trip: Trip, list: MapList) =>
  `${trip.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Trip"} - ${mapLists.find((l) => l.id === list)!.file}.csv`;

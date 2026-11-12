// Stops a journey makes on the way: connections such as Dubai and Colombo on
// a flight from Kuwait to Tokyo, or a change of trains at Shin-Osaka. They
// come from the journey's "Stops on the way" when set, else from its text
// ("KWI 08:35 → DXB 10:55; DXB 12:55 → CMB …", "via Shin-Osaka"), else for
// flights with hub airlines (Emirates, Qatar Airways…) the airline's hub is
// assumed.
import type { Entry } from "./model";
import type { Point } from "./tripRoute";
export type ViaStop = {
  /** Shown name, e.g. "Dubai (DXB)" or "Shin-Osaka". */
  name: string;
  /** Airport code, when the stop is an airport. */
  code: string;
  /** Where to look the stop up when it is not a known airport. */
  city: string;
  country: string;
  point: Point | null;
  arrive: string;
  depart: string;
  /** set: in Stops on the way; stated: in the journey's text; assumed: the
   * airline's hub. */
  source: "set" | "stated" | "assumed";
};
type Airport = [city: string, country: string, lat: number, lng: number];
// Airports likely on this kind of trip: Gulf and Asian hubs, East Asia and
// Europe. Others can still be named as cities.
export const airports: Record<string, Airport> = {
  DMM: ["Dammam", "Saudi Arabia", 26.471, 49.798],
  RUH: ["Riyadh", "Saudi Arabia", 24.958, 46.699],
  JED: ["Jeddah", "Saudi Arabia", 21.68, 39.157],
  MED: ["Medina", "Saudi Arabia", 24.553, 39.705],
  DXB: ["Dubai", "United Arab Emirates", 25.253, 55.366],
  DWC: ["Dubai", "United Arab Emirates", 24.896, 55.161],
  SHJ: ["Sharjah", "United Arab Emirates", 25.329, 55.517],
  AUH: ["Abu Dhabi", "United Arab Emirates", 24.433, 54.651],
  DOH: ["Doha", "Qatar", 25.273, 51.608],
  BAH: ["Bahrain", "Bahrain", 26.271, 50.634],
  KWI: ["Kuwait", "Kuwait", 29.241, 47.969],
  MCT: ["Muscat", "Oman", 23.593, 58.284],
  AMM: ["Amman", "Jordan", 31.723, 35.993],
  CAI: ["Cairo", "Egypt", 30.122, 31.406],
  IST: ["Istanbul", "Turkey", 41.262, 28.742],
  SAW: ["Istanbul", "Turkey", 40.899, 29.309],
  ADD: ["Addis Ababa", "Ethiopia", 8.978, 38.799],
  NBO: ["Nairobi", "Kenya", -1.319, 36.928],
  CMB: ["Colombo", "Sri Lanka", 7.181, 79.884],
  MLE: ["Malé", "Maldives", 4.192, 73.529],
  DEL: ["Delhi", "India", 28.556, 77.1],
  BOM: ["Mumbai", "India", 19.089, 72.868],
  BLR: ["Bengaluru", "India", 13.199, 77.706],
  MAA: ["Chennai", "India", 12.994, 80.171],
  HYD: ["Hyderabad", "India", 17.231, 78.43],
  KHI: ["Karachi", "Pakistan", 24.907, 67.161],
  LHE: ["Lahore", "Pakistan", 31.522, 74.404],
  ISB: ["Islamabad", "Pakistan", 33.549, 72.825],
  DAC: ["Dhaka", "Bangladesh", 23.843, 90.398],
  KTM: ["Kathmandu", "Nepal", 27.697, 85.359],
  SIN: ["Singapore", "Singapore", 1.364, 103.991],
  KUL: ["Kuala Lumpur", "Malaysia", 2.746, 101.71],
  BKK: ["Bangkok", "Thailand", 13.69, 100.75],
  DMK: ["Bangkok", "Thailand", 13.913, 100.607],
  CGK: ["Jakarta", "Indonesia", -6.126, 106.656],
  DPS: ["Bali", "Indonesia", -8.748, 115.167],
  MNL: ["Manila", "Philippines", 14.509, 121.02],
  SGN: ["Ho Chi Minh City", "Vietnam", 10.819, 106.652],
  HAN: ["Hanoi", "Vietnam", 21.221, 105.807],
  HKG: ["Hong Kong", "Hong Kong", 22.308, 113.918],
  MFM: ["Macau", "Macau", 22.15, 113.592],
  TPE: ["Taipei", "Taiwan", 25.078, 121.233],
  ICN: ["Seoul", "Korea", 37.46, 126.441],
  GMP: ["Seoul", "Korea", 37.558, 126.791],
  PUS: ["Busan", "Korea", 35.18, 128.938],
  CJU: ["Jeju", "Korea", 33.511, 126.493],
  NRT: ["Tokyo", "Japan", 35.772, 140.393],
  HND: ["Tokyo", "Japan", 35.549, 139.78],
  KIX: ["Osaka", "Japan", 34.434, 135.244],
  ITM: ["Osaka", "Japan", 34.785, 135.438],
  NGO: ["Nagoya", "Japan", 34.858, 136.805],
  FUK: ["Fukuoka", "Japan", 33.586, 130.451],
  CTS: ["Sapporo", "Japan", 42.775, 141.692],
  OKA: ["Okinawa", "Japan", 26.196, 127.646],
  KOJ: ["Kagoshima", "Japan", 31.803, 130.719],
  PEK: ["Beijing", "China", 40.08, 116.585],
  PKX: ["Beijing", "China", 39.509, 116.411],
  PVG: ["Shanghai", "China", 31.144, 121.808],
  SHA: ["Shanghai", "China", 31.198, 121.336],
  CAN: ["Guangzhou", "China", 23.392, 113.299],
  SZX: ["Shenzhen", "China", 22.64, 113.811],
  ZUH: ["Zhuhai", "China", 22.006, 113.376],
  CTU: ["Chengdu", "China", 30.578, 103.947],
  TFU: ["Chengdu", "China", 30.319, 104.445],
  XIY: ["Xi'an", "China", 34.447, 108.752],
  KMG: ["Kunming", "China", 25.102, 102.929],
  LHR: ["London", "United Kingdom", 51.47, -0.454],
  LGW: ["London", "United Kingdom", 51.153, -0.182],
  STN: ["London", "United Kingdom", 51.885, 0.235],
  LTN: ["London", "United Kingdom", 51.875, -0.368],
  CDG: ["Paris", "France", 49.01, 2.548],
  ORY: ["Paris", "France", 48.723, 2.38],
  AMS: ["Amsterdam", "Netherlands", 52.31, 4.768],
  FRA: ["Frankfurt", "Germany", 50.038, 8.562],
  MUC: ["Munich", "Germany", 48.354, 11.786],
  ZRH: ["Zurich", "Switzerland", 47.458, 8.548],
  VIE: ["Vienna", "Austria", 48.11, 16.57],
  FCO: ["Rome", "Italy", 41.8, 12.239],
  MXP: ["Milan", "Italy", 45.63, 8.723],
  MAD: ["Madrid", "Spain", 40.472, -3.561],
  BCN: ["Barcelona", "Spain", 41.297, 2.078],
  LIS: ["Lisbon", "Portugal", 38.774, -9.134],
  DUB: ["Dublin", "Ireland", 53.421, -6.27],
  CPH: ["Copenhagen", "Denmark", 55.618, 12.656],
  ARN: ["Stockholm", "Sweden", 59.65, 17.919],
  HEL: ["Helsinki", "Finland", 60.317, 24.963],
  OSL: ["Oslo", "Norway", 60.194, 11.1],
  WAW: ["Warsaw", "Poland", 52.166, 20.967],
  ATH: ["Athens", "Greece", 37.936, 23.947],
  BRU: ["Brussels", "Belgium", 50.901, 4.484],
  SVO: ["Moscow", "Russia", 55.973, 37.415],
  JFK: ["New York", "United States", 40.641, -73.778],
  EWR: ["New York", "United States", 40.69, -74.174],
  LAX: ["Los Angeles", "United States", 33.942, -118.408],
  SFO: ["San Francisco", "United States", 37.621, -122.379],
  ORD: ["Chicago", "United States", 41.974, -87.907],
  IAD: ["Washington", "United States", 38.953, -77.456],
  YYZ: ["Toronto", "Canada", 43.678, -79.625],
  SYD: ["Sydney", "Australia", -33.94, 151.175],
  MEL: ["Melbourne", "Australia", -37.669, 144.841],
};
// Airlines whose flights (nearly) all connect at their home airport, by
// flight-number code and by name.
const hubs: [code: string, name: RegExp, hub: string][] = [
  ["EK", /\bEmirates\b/i, "DXB"],
  ["FZ", /\bfly ?dubai\b/i, "DXB"],
  ["QR", /\bQatar Airways\b/i, "DOH"],
  ["EY", /\bEtihad\b/i, "AUH"],
  ["GF", /\bGulf Air\b/i, "BAH"],
  ["WY", /\bOman Air\b/i, "MCT"],
  ["KU", /\bKuwait Airways\b/i, "KWI"],
  ["J9", /\bJazeera\b/i, "KWI"],
  ["G9", /\bAir Arabia\b/i, "SHJ"],
  ["TK", /\bTurkish Airlines\b/i, "IST"],
  ["PC", /\bPegasus\b/i, "SAW"],
  ["UL", /\bSri ?Lankan\b/i, "CMB"],
  ["SQ", /\bSingapore Airlines\b/i, "SIN"],
  ["CX", /\bCathay\b/i, "HKG"],
  ["ET", /\bEthiopian\b/i, "ADD"],
  ["RJ", /\bRoyal Jordanian\b/i, "AMM"],
  ["MS", /\bEgypt ?Air\b/i, "CAI"],
  ["KQ", /\bKenya Airways\b/i, "NBO"],
];
const same = (a: string, b: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const airportStop = (
  code: string,
  source: ViaStop["source"],
  arrive = "",
  depart = "",
): ViaStop => {
  const [city, country, lat, lng] = airports[code];
  return {
    name: `${city} (${code})`,
    code,
    city,
    country,
    point: [lat, lng],
    arrive,
    depart,
    source,
  };
};
const named = (
  name: string,
  e: Entry,
  source: ViaStop["source"],
  arrive = "",
  depart = "",
): ViaStop =>
  airports[name.toUpperCase()] && /^[A-Za-z]{3}$/.test(name)
    ? airportStop(name.toUpperCase(), source, arrive, depart)
    : {
        name,
        code: "",
        city: name,
        country: e.country,
        point: null,
        arrive,
        depart,
        source,
      };
// "DXB 10:55–12:55", "Shin-Osaka", "direct".
function fromField(e: Entry, list: string[]): ViaStop[] {
  return list.flatMap((raw) => {
    const s = raw.trim();
    if (!s || /^(direct|non-?stop|none)$/i.test(s)) return [];
    const times = s.match(/\d{1,2}:\d{2}/g) || [];
    const name = s
      .replace(/\d{1,2}:\d{2}/g, "")
      .replace(/[\s–—-]+$/, "")
      .trim();
    return name ? [named(name, e, "set", times[0] || "", times[1] || "")] : [];
  });
}
// Airport chains in the text: "KWI08:35 → DXB10:55; EK1002 DXB12:55 → CMB…".
// Only the stretch from this journey's origin to its destination counts, so
// notes about a whole ticket (HKG→PKX→LHR on its first flight) add nothing.
function fromChain(e: Entry, text: string): ViaStop[] {
  type Hop = { from: string; at: string; to: string; until: string };
  const hops: Hop[] = [];
  const re =
    /\b([A-Z]{3})\s?(\d{1,2}:\d{2})?\s*(?:→|->|–|—|>)\s*(?=([A-Z]{3})(?![A-Za-z])\s?(\d{1,2}:\d{2})?)/g;
  for (const m of text.matchAll(re))
    if (airports[m[1]] && airports[m[3]])
      hops.push({ from: m[1], at: m[2] || "", to: m[3], until: m[4] || "" });
  const origin = (c: string) =>
    same(airports[c][0], e.city) || e.title.includes(c);
  const end = (c: string) =>
    same(airports[c][0], e.toCity) || e.title.includes(c);
  for (let i = 0; i < hops.length; i++) {
    if (!origin(hops[i].from)) continue;
    const stops: ViaStop[] = [];
    for (let j = i; j < hops.length; j++) {
      if (j > i && hops[j].from !== hops[j - 1].to) break;
      if (end(hops[j].to)) return stops;
      const next = hops[j + 1];
      stops.push(
        airportStop(
          hops[j].to,
          "stated",
          hops[j].until,
          next?.from === hops[j].to ? next.at : "",
        ),
      );
    }
  }
  return [];
}
// "via Shin-Osaka or Hakata", "change at Hakata", "layover in Doha". "via"
// counts only in the title, operator and option ("book via Klook" in notes
// is no stop).
const place = String.raw`(?:the\s+)?([^\s,.;:()/]+(?:[ -][^\s,.;:()/]+){0,3})`;
function fromWords(e: Entry, text: string, short: string): ViaStop[] {
  const out: ViaStop[] = [];
  const matches = [
    ...short.matchAll(new RegExp(String.raw`\bvia\s+` + place, "gi")),
    ...text.matchAll(
      new RegExp(
        String.raw`\b(?:change (?:trains? )?(?:at|in)|transfer (?:at|in)|connect(?:ing|ion)? (?:at|in)|layover (?:at|in)|stopover (?:at|in))\s+` +
          place,
        "gi",
      ),
    ),
  ];
  for (const m of matches) {
    // Capitalised words only: "via Shin-Osaka or Hakata" gives Shin-Osaka.
    const words: string[] = [];
    for (const w of m[1].split(" ")) {
      if (!/^\p{Lu}/u.test(w) || w === "SAME") break;
      words.push(w);
    }
    const name = words.join(" ");
    if (
      !name ||
      same(name, e.city) ||
      same(name, e.toCity) ||
      e.title.includes(name) ||
      out.some((s) => same(s.name, name) || same(s.code, name))
    )
      continue;
    const stop = named(name, e, "stated");
    if (stop.code && (same(stop.city, e.city) || same(stop.city, e.toCity)))
      continue;
    out.push(stop);
  }
  return out;
}
// The hubs of the airlines named, in the order named, other than the ends.
function fromHubs(e: Entry, text: string): ViaStop[] {
  if (/\b(direct|non-?stop)\b/i.test(text)) return [];
  const found: { at: number; hub: string }[] = [];
  for (const [code, name, hub] of hubs) {
    const byCode = new RegExp(`\\b${code}\\s?\\d{2,4}\\b`).exec(text);
    const byName = name.exec(text);
    const at = Math.min(byCode?.index ?? Infinity, byName?.index ?? Infinity);
    if (at < Infinity) found.push({ at, hub });
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.hub))]
    .filter(
      (c) =>
        !same(airports[c][0], e.city) &&
        !same(airports[c][0], e.toCity) &&
        !e.title.includes(c),
    )
    .map((c) => airportStop(c, "assumed"));
}
export function viaStops(e: Entry): ViaStop[] {
  if (e.type !== "transport" || e.scope !== "intercity") return [];
  if (e.via) return fromField(e, e.via);
  const text = [e.title, e.provider, e.option, e.notes]
    .filter(Boolean)
    .join("\n");
  const chain = fromChain(e, text);
  if (chain.length) return chain;
  const words = fromWords(
    e,
    text,
    [e.title, e.provider, e.option].filter(Boolean).join("\n"),
  );
  if (words.length) return words;
  return /Flight/.test(e.mode) ? fromHubs(e, text) : [];
}
// "Dubai (DXB) 10:55–12:55 (2 h)".
export function viaLabel(s: ViaStop) {
  const times =
    s.arrive && s.depart
      ? ` ${s.arrive}–${s.depart}`
      : s.arrive
        ? ` from ${s.arrive}`
        : "";
  let wait = "";
  if (s.arrive && s.depart) {
    const [a, b] = [s.arrive, s.depart].map((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    });
    const min = (b - a + 1440) % 1440;
    wait = ` (${min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ""}` : `${min} min`})`;
  }
  return `${s.name}${times}${wait}`;
}
// For the editor: what would be used without Stops on the way.
export const viaText = (stops: ViaStop[]) =>
  stops
    .map((s) =>
      [s.code || s.name, s.arrive && s.depart ? `${s.arrive}–${s.depart}` : ""]
        .filter(Boolean)
        .join(" "),
    )
    .join(", ");

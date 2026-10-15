// A small still map of one journey between cities: the chosen route drawn
// as on the route map, other options faint, on OpenStreetMap tiles. It is
// plain images and SVG (no map library), so a page of journeys stays light.
import { type Place } from "../model";
import { type Leg, type RouteOption } from "../transport";
import {
  type Locate,
  type Point,
  showOnRouteMap,
  styleKey,
  styles,
} from "../routeGeometry";
import { km, stopKey } from "../tripRoute";
const W = 240,
  H = 150,
  PAD = 22,
  TILE = 256;
// Web Mercator pixels at zoom 0.
const project = ([lat, lng]: Point): [number, number] => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * TILE,
    (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE,
  ];
};
type Line = { points: Point[]; mode: string; faint: boolean };
export function RoutePreview({
  leg,
  places,
  locate,
}: {
  leg: Leg;
  places: Place[];
  locate: Locate;
}) {
  const hotel = (id?: string) => {
    const p = places.find((x) => x.id === id);
    return p && p.lat !== null && p.lng !== null
      ? ([p.lat, p.lng] as Point)
      : null;
  };
  const from = locate.point(
    leg.from,
    leg.fromCountry,
    hotel(leg.fromStay?.placeId),
  );
  const to = locate.point(leg.to, leg.toCountry, hotel(leg.toStay?.placeId));
  // The leg's ends use the hotels; stops in between are looked up.
  const at = (city: string, country: string) =>
    stopKey(city, country) === stopKey(leg.from, leg.fromCountry)
      ? from
      : stopKey(city, country) === stopKey(leg.to, leg.toCountry)
        ? to
        : locate.point(city, country);
  const draw = (o: RouteOption, faint: boolean): Line[] =>
    o.segments.flatMap((s) => {
      const a = at(s.city, s.country),
        b = at(s.toCity, s.toCountry || s.country);
      return a && b
        ? [{ points: locate.path(s.mode, a, b), mode: s.mode, faint }]
        : [];
    });
  const chosen = leg.options.find((o) => o.status !== "alternative");
  const lines: Line[] = [
    ...leg.options
      .filter((o) => o !== chosen)
      .flatMap((o) => draw(o, !!chosen)),
    ...(chosen ? draw(chosen, false) : []),
  ];
  if (!lines.length && from && to)
    lines.push({ points: [from, to], mode: "", faint: false });
  if (!from || !to || !lines.length)
    return <div className="leg-preview empty" aria-hidden />;
  // Longitudes continue from the start, so routes over the date line stay whole.
  const unwrap = (p: Point): Point => [
    p[0],
    p[1] + Math.round((from[1] - p[1]) / 360) * 360,
  ];
  const all = lines.flatMap((l) => l.points.map(unwrap));
  const px = all.map(project);
  const xs = px.map((p) => p[0]),
    ys = px.map((p) => p[1]);
  const [x0, x1, y0, y1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  let z = 1;
  while (
    z < 12 &&
    (x1 - x0) * 2 ** (z + 1) <= W - 2 * PAD &&
    (y1 - y0) * 2 ** (z + 1) <= H - 2 * PAD
  )
    z++;
  const scale = 2 ** z;
  const left = ((x0 + x1) / 2) * scale - W / 2,
    top = ((y0 + y1) / 2) * scale - H / 2;
  const screen = (p: Point) => {
    const [x, y] = project(unwrap(p));
    return `${(x * scale - left).toFixed(1)},${(y * scale - top).toFixed(1)}`;
  };
  const tiles: { key: string; src: string; x: number; y: number }[] = [];
  const n = 2 ** z;
  for (let ty = Math.floor(top / TILE); ty * TILE < top + H; ty++)
    for (let tx = Math.floor(left / TILE); tx * TILE < left + W; tx++)
      if (ty >= 0 && ty < n)
        tiles.push({
          key: `${tx},${ty}`,
          src: `https://tile.openstreetmap.org/${z}/${((tx % n) + n) % n}/${ty}.png`,
          x: tx * TILE - left,
          y: ty * TILE - top,
        });
  const main = lines.filter((l) => !l.faint);
  const distance = main.reduce(
    (sum, l) =>
      sum + l.points.slice(1).reduce((d, p, i) => d + km(l.points[i], p), 0),
    0,
  );
  const vias = main.slice(1).map((l) => l.points[0]);
  return (
    <button
      className="leg-preview"
      onClick={() => showOnRouteMap(all)}
      title="Show this journey on the route map"
      aria-label={`Show ${leg.from} to ${leg.to} on the route map`}
    >
      {navigator.onLine &&
        tiles.map((t) => (
          <img
            key={t.key}
            src={t.src}
            alt=""
            loading="lazy"
            draggable={false}
            style={{ left: t.x, top: t.y }}
            onError={(e) => (e.currentTarget.style.visibility = "hidden")}
          />
        ))}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        {lines.map((l, i) => {
          const style = styles[styleKey(l.mode)];
          return (
            <polyline
              key={i}
              points={l.points.map(screen).join(" ")}
              fill="none"
              stroke={l.faint ? "#6d6a75" : style.color}
              strokeOpacity={l.faint ? 0.45 : 0.95}
              strokeWidth={l.faint ? 2 : style.weight + 0.5}
              strokeDasharray={l.faint ? "4 5" : style.dash}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        {vias.map((p, i) => {
          const [x, y] = screen(p).split(",");
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={3.5}
              fill="#fff"
              stroke="#2c3e35"
              strokeWidth={1.5}
            />
          );
        })}
        {[from, to].map((p, i) => {
          const [x, y] = screen(p).split(",");
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={5.5}
              fill={i ? "#2c3e35" : "#a86944"}
              stroke="#fff"
              strokeWidth={2}
            />
          );
        })}
      </svg>
      {distance > 0 && (
        <span className="leg-preview-km">
          {distance < 10 ? distance.toFixed(1) : Math.round(distance)} km
        </span>
      )}
    </button>
  );
}

// GPX 1.1 track of an OpenStreetMap route, with the ODbL attribution.
const xml = (v: string) =>
  v.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!,
  );
export function gpx(name: string, osmId: number, lines: [number, number][][]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fieldnotes" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${xml(name)}</name><copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/</license></copyright><link href="https://www.openstreetmap.org/relation/${osmId}"/></metadata>
<trk><name>${xml(name)}</name>
${lines.map((l) => `<trkseg>${l.map(([a, b]) => `<trkpt lat="${a}" lon="${b}"/>`).join("")}</trkseg>`).join("\n")}
</trk>
</gpx>
`;
}

// Where plans sit across a timeline day: side-by-side lanes for plans that
// overlap, and plans drawn on top of a long backdrop plan.
import type { Entry } from "./model";
const hour = (t: string) => Number(t.slice(0, 2)) + Number(t.slice(3)) / 60;
// Like Apple Calendar: a plan of two hours or more is a backdrop, and plans
// starting at least half an hour into it are drawn on top of it, indented,
// instead of squeezing both into narrow side-by-side columns.
const hostHours = 2;
const nestAfter = 0.5;
type Item = {
  entry: Entry;
  start: number;
  end: number;
  lane: number;
  lanes: number;
  group: number;
  host: Item | null;
};
// Side-by-side lanes for plans that overlap; `group` numbers each cluster.
function lanes(items: Item[], group: number) {
  let cluster: Item[] = [];
  let clusterEnd = 0;
  const finish = () => {
    group++;
    const count = Math.max(1, ...cluster.map((x) => x.lane + 1));
    cluster.forEach((x) => (x.lanes = count));
    cluster = [];
  };
  for (const item of items) {
    if (item.start >= clusterEnd) {
      finish();
      clusterEnd = 0;
    }
    const used = new Set(
      cluster.filter((x) => x.end > item.start).map((x) => x.lane),
    );
    while (used.has(item.lane)) item.lane++;
    item.group = group;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  finish();
  return group;
}
export function layout(entries: Entry[], date: string, first: number) {
  const items: Item[] = entries
    .filter((e) => e.type !== "stay" && !e.allDay)
    .map((e) => ({
      entry: e,
      start: e.date < date ? first : Math.max(first, hour(e.startTime)),
      end: e.endDate > date ? 24 : Math.min(24, hour(e.endTime)),
      lane: 0,
      lanes: 1,
      group: 0,
      host: null as Item | null,
    }))
    .filter((e) => e.start < 24)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  // Real times decide overlaps: a plan ending at 10:30 and one starting at
  // 10:30 stack in order. The time scale makes short plans tall enough.
  for (const item of items)
    item.end = Math.min(24, Math.max(item.end, item.start + 0.25));
  for (const item of items) {
    const hosts = items.filter(
      (h) =>
        h !== item &&
        !h.host &&
        h.end - h.start >= hostHours &&
        item.start - h.start >= nestAfter &&
        h.end > item.start,
    );
    // The backdrop that started last is the closest one.
    item.host = hosts.sort((a, b) => b.start - a.start)[0] || null;
  }
  // Backdrops and free-standing plans share the day; plans on a backdrop
  // share its indented area and are drawn with it.
  lanes(
    items.filter((x) => !x.host),
    0,
  );
  for (const host of items.filter((x) => !x.host)) {
    const guests = items.filter((x) => x.host === host);
    if (!guests.length) continue;
    lanes(guests, 0);
    guests.forEach((x) => (x.group = host.group));
  }
  return items;
}

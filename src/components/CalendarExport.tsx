import { useState } from "react";
import {
  BedDouble,
  MapPin,
  Utensils,
  TrainFront,
  Bus,
  StickyNote,
  CalendarPlus,
  Download,
  Link,
  Copy,
  Check,
} from "lucide-react";
import { type Trip, type Scenario, type Kind, kindOf } from "../model";
import { Modal } from "./Modal";
const kinds: { id: Kind; label: string; icon: typeof MapPin }[] = [
  { id: "stay", label: "Hotels", icon: BedDouble },
  { id: "activity", label: "Activities", icon: MapPin },
  { id: "food", label: "Food", icon: Utensils },
  { id: "transport", label: "Between cities", icon: TrainFront },
  { id: "local", label: "Local transport", icon: Bus },
  { id: "note", label: "Notes", icon: StickyNote },
];
type Options = { hide: Kind[]; ideas: boolean; deadlines: boolean };
const read = (hidden: Kind[]): Options => {
  try {
    const saved = JSON.parse(localStorage.getItem("fieldnotes-calendar") || "");
    if (saved && Array.isArray(saved.hide)) return saved;
  } catch {
    // First use: start from the itinerary's filters.
  }
  return { hide: hidden, ideas: false, deadlines: true };
};
// Calendar files for Apple Calendar, Google Calendar and Outlook, made by the
// server from the saved plan: import them once, or subscribe so the calendar
// follows later changes.
export function CalendarExport({
  trip,
  scenario,
  hidden,
  onClose,
}: {
  trip: Trip;
  scenario: Scenario;
  /** Kinds hidden in the itinerary; the starting choice. */
  hidden: Kind[];
  onClose: () => void;
}) {
  const [o, setOptions] = useState(() => read(hidden));
  const [copied, setCopied] = useState(false);
  const set = (patch: Partial<Options>) =>
    setOptions((v) => {
      const next = { ...v, ...patch };
      localStorage.setItem("fieldnotes-calendar", JSON.stringify(next));
      return next;
    });
  const toggle = (k: Kind) =>
    set({
      hide: o.hide.includes(k) ? o.hide.filter((x) => x !== k) : [...o.hide, k],
    });
  const count = scenario.entries.filter(
    (e) => (o.ideas || e.status !== "idea") && !o.hide.includes(kindOf(e)),
  ).length;
  const deadlineCount =
    trip.tasks.filter((t) => t.due && !t.done).length +
    scenario.entries.filter((e) => e.refundDeadline && e.status !== "idea")
      .length;
  const query = new URLSearchParams({ trip: trip.id });
  if (o.hide.length) query.set("hide", o.hide.join(","));
  if (o.ideas) query.set("ideas", "1");
  if (!o.deadlines) query.set("deadlines", "0");
  const path = `/api/calendar.ics?${query}`;
  const https = location.protocol === "https:";
  const feed = `${location.origin}${path}`;
  // webcal:// makes Apple devices offer to subscribe.
  const webcal = feed.replace(/^https?:/, "webcal:");
  async function copy() {
    try {
      await navigator.clipboard.writeText(feed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this calendar address", feed);
    }
  }
  return (
    <Modal title="Add to calendar" onClose={onClose} wide>
      <div className="calendar-export">
        <p className="muted">
          Plans from <strong>{scenario.name}</strong> with their times, places,
          booking references and phone numbers. Times follow each place's time
          zone.
        </p>
        <div className="kind-filter" role="group" aria-label="Include">
          <span>Include</span>
          {kinds.map(({ id, label, icon: Icon }) => {
            const on = !o.hide.includes(id);
            return (
              <button
                key={id}
                className={`kind-chip kind-${id} ${on ? "on" : ""}`}
                aria-pressed={on}
                onClick={() => toggle(id)}
              >
                <Icon size={13} />
                {label}
              </button>
            );
          })}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={o.ideas}
            onChange={(e) => set({ ideas: e.target.checked })}
          />
          Include ideas (marked "idea", shown as tentative)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={o.deadlines}
            onChange={(e) => set({ deadlines: e.target.checked })}
          />
          Checklist due dates and last days to cancel ({deadlineCount})
        </label>
        <p className="calendar-count">
          {count} plan{count === 1 ? "" : "s"}
          {o.deadlines &&
            deadlineCount > 0 &&
            ` + ${deadlineCount} reminder${deadlineCount === 1 ? "" : "s"}`}
        </p>
        <section className="calendar-way">
          <h3>Add once</h3>
          <p className="muted">
            On an iPhone or iPad, choose <em>Add All</em>. On a computer, open
            the downloaded file to add it to Apple Calendar or Outlook, or
            import it in Google Calendar (Settings › Import & export). Adding it
            again later updates the same events instead of copying them.
          </p>
          <div className="section-actions">
            <a className="button primary" href={path}>
              <CalendarPlus size={16} /> Open in Calendar
            </a>
            <a className="button" href={`${path}&download=1`}>
              <Download size={16} /> Download .ics
            </a>
          </div>
        </section>
        <section className="calendar-way">
          <h3>Subscribe (keeps up to date)</h3>
          <p className="muted">
            Apple Calendar checks for changes about every hour while this device
            can reach Fieldnotes (for example on your home network or VPN). On a Mac, keep the
            subscription <em>On My Mac</em> rather than iCloud.
            {https
              ? " If tapping Subscribe does nothing, copy the address and add it in Settings › Calendar › Accounts › Add Subscribed Calendar."
              : ""}{" "}
            Google Calendar can't subscribe to it, because Google's servers
            can't reach this server; import the file instead.
          </p>
          <div className="section-actions">
            <a className="button" href={webcal}>
              <Link size={16} /> Subscribe in Apple Calendar
            </a>
            <button className="button" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy address"}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

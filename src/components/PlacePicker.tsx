import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Link2, MapPin, Plus, Search } from "lucide-react";
import { type Place, distance } from "../model";
import {
  type GeoResult,
  type MapsStatus,
  cityPoint,
  geocode,
  isMapsLink,
  mapsStatus,
  placeFrom,
  providerName,
  readMapsLink,
} from "../geo";
type Item =
  | { kind: "none" }
  | { kind: "new" }
  | { kind: "saved"; place: Place }
  | { kind: "online"; place: Place; source: string }
  | { kind: "search" };
const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
// Saved places, searchable and sorted by name, plus online search and
// Google Maps links for places not saved yet.
export function PlacePicker({
  places,
  value,
  pending,
  label,
  allowNew = false,
  newLabel = "New hotel",
  defaults,
  onSelect,
  onPickNew,
}: {
  places: Place[];
  value: string;
  // A place chosen from search that is saved together with the plan.
  pending?: Place | null;
  label: string;
  allowNew?: boolean;
  newLabel?: string;
  defaults: Pick<Place, "kind" | "country" | "city">;
  onSelect: (id: string) => void;
  onPickNew: (p: Place) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "city">("name");
  const [online, setOnline] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<MapsStatus | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void mapsStatus().then(setStatus);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const link = isMapsLink(query);
  // A pasted Google Maps link is read straight away.
  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    setBusy("Reading the Google Maps link…");
    setError("");
    setOnline(null);
    readMapsLink(query)
      .then((r) => {
        if (!cancelled) setOnline([placeFrom(r, defaults)]);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(""));
    return () => {
      cancelled = true;
    };
  }, [query, link]);
  useEffect(() => {
    if (!link) {
      setOnline(null);
      setError("");
    }
    setActive(0);
  }, [query]);
  async function searchOnline() {
    const q = query.trim();
    if (!q) return;
    setBusy(`Searching ${providerName(status)}…`);
    setError("");
    try {
      const near = defaults.city
        ? await cityPoint(defaults.city, defaults.country).catch(() => null)
        : null;
      let found: GeoResult[] = await geocode(q, defaults.country, near || undefined);
      if (!found.length && defaults.country) found = await geocode(q, "", near || undefined);
      setOnline(found.map((r) => placeFrom(r, defaults)));
      if (!found.length) setError("No matches. Try another spelling, or paste a Google Maps link.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy("");
    }
  }
  const saved = useMemo(() => {
    const q = norm(query.trim());
    const matches = link
      ? []
      : places.filter(
          (p) =>
            !q ||
            norm([p.name, p.nativeName, p.city, p.address].join(" ")).includes(
              q,
            ),
        );
    const byName = (a: Place, b: Place) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return matches.sort(
      sort === "city"
        ? (a, b) =>
            (a.city || "~").localeCompare(b.city || "~") || byName(a, b)
        : byName,
    );
  }, [places, query, sort, link]);
  const items: Item[] = [
    ...(!query.trim()
      ? ([{ kind: "none" }, ...(allowNew ? [{ kind: "new" }] : [])] as Item[])
      : []),
    ...saved.map((place): Item => ({ kind: "saved", place })),
    ...(online || []).map(
      (place): Item => ({
        kind: "online",
        place,
        source: link ? "Google Maps link" : providerName(status),
      }),
    ),
    ...(query.trim() && !link && !online ? [{ kind: "search" } as Item] : []),
  ];
  function choose(item: Item) {
    if (item.kind === "search") {
      void searchOnline();
      return;
    }
    if (item.kind === "none") onSelect("");
    else if (item.kind === "new") onSelect("new");
    else if (item.kind === "saved") onSelect(item.place.id);
    else {
      // Reuse a saved place instead of creating a duplicate.
      const same = places.find(
        (p) =>
          norm(p.name) === norm(item.place.name) &&
          (distance(p, item.place) ?? 99) < 0.3,
      );
      if (same) onSelect(same.id);
      else onPickNew(item.place);
    }
    setOpen(false);
    setQuery("");
  }
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const current =
    value === "new"
      ? null
      : pending && pending.id === value
        ? pending
        : places.find((p) => p.id === value);
  const shown =
    value === "new"
      ? pending?.name
        ? `${newLabel}: ${pending.name}`
        : newLabel
      : current
        ? `${current.name}${current.city ? ` · ${current.city}` : ""}`
        : "Choose later";
  let lastCity: string | null = null;
  return (
    <div className="place-picker" ref={root}>
      <button
        type="button"
        className="place-picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <MapPin size={15} />
        <span>{shown}</span>
        {pending && pending.id === value && value !== "new" && (
          <span className="tag">New</span>
        )}
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="place-picker-panel">
          <div className="place-picker-search">
            <Search size={15} />
            <input
              autoFocus
              value={query}
              role="combobox"
              aria-expanded
              aria-controls="place-picker-list"
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder="Search saved places or paste a Google Maps link"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(items.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (items[active]) choose(items[active]);
                } else if (e.key === "Escape") {
                  // Close only the list, not the whole dialog.
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
            />
          </div>
          {!link && (
            <div className="place-picker-tools">
              <span>
                {saved.length} saved {saved.length === 1 ? "place" : "places"}
              </span>
              <div className="segmented">
                <button
                  type="button"
                  className={sort === "name" ? "selected" : ""}
                  onClick={() => setSort("name")}
                >
                  A–Z
                </button>
                <button
                  type="button"
                  className={sort === "city" ? "selected" : ""}
                  onClick={() => setSort("city")}
                >
                  By city
                </button>
              </div>
            </div>
          )}
          <div
            className="place-picker-list"
            id="place-picker-list"
            role="listbox"
            ref={list}
          >
            {items.map((item, i) => {
              const heading =
                item.kind === "saved" &&
                sort === "city" &&
                item.place.city !== lastCity
                  ? (lastCity = item.place.city) || "No city"
                  : item.kind === "online" &&
                      (i === 0 || items[i - 1].kind !== "online")
                    ? `From ${item.source}`
                    : null;
              return (
                <div key={i}>
                  {heading && (
                    <div className="place-picker-heading">{heading}</div>
                  )}
                  <button
                    type="button"
                    role="option"
                    data-index={i}
                    aria-selected={i === active}
                    className={`place-picker-option ${i === active ? "active" : ""} ${
                      item.kind === "saved" && item.place.id === value
                        ? "chosen"
                        : ""
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                  >
                    {item.kind === "none" && <span>Choose later</span>}
                    {item.kind === "new" && (
                      <>
                        <Plus size={14} />
                        <span>{newLabel}</span>
                      </>
                    )}
                    {(item.kind === "saved" || item.kind === "online") && (
                      <>
                        {item.kind === "online" &&
                          (link ? <Link2 size={14} /> : <Plus size={14} />)}
                        <span className="place-picker-name">
                          <strong>{item.place.name}</strong>
                          <small>
                            {item.kind === "saved"
                              ? [item.place.city, item.place.kind]
                                  .filter(Boolean)
                                  .join(" · ")
                              : item.place.address}
                          </small>
                        </span>
                      </>
                    )}
                    {item.kind === "search" && (
                      <>
                        <Search size={14} />
                        <span>
                          Search {providerName(status)} for “{query.trim()}”
                        </span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
            {!items.length && !busy && !error && (
              <p className="place-picker-empty">No saved places match.</p>
            )}
          </div>
          {(busy || error) && (
            <p className={busy ? "place-picker-status" : "error"} role="status">
              {busy || error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

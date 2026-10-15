import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  Share2,
  Copy,
  LoaderCircle,
  CalendarRange,
  List,
  EyeOff,
} from "lucide-react";
import {
  type Trip,
  type Scenario,
  type Entry,
  type Kind,
  kindOf,
  kindLabels,
  addDays,
  days,
  mondayOf,
  shortDate,
} from "../model";
import { Modal } from "./Modal";
import { Timeline, Agenda } from "./Timeline";
type Layout = "calendar" | "list";
type Options = {
  layout: Layout;
  split: boolean;
  ideas: boolean;
  hotels: boolean;
};
type Picture = { url: string; blob: Blob };
type Page = {
  key: string;
  weeks: [string, string][];
  name: string;
  label: string;
  week: number;
  /** Everything the page's picture depends on; unchanged means reuse it. */
  sig: string;
  /** The page under these options, whatever its contents. */
  slot: string;
};
type Props = {
  trip: Trip;
  scenario: Scenario;
  countries: string[];
  /** Kinds of plans hidden in the itinerary, left out of the image too. */
  hidden: Kind[];
};
const noop = () => {};
// The CSS properties copied into the picture. By default every element gets
// all ~400 computed properties, which takes seconds on a phone; the app only
// sets these (browsers resolve the rest, like logical sides, from them).
const styleProperties = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "float",
  "clear",
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-color",
  "border-top-style",
  "border-top-width",
  "border-right-color",
  "border-right-style",
  "border-right-width",
  "border-bottom-color",
  "border-bottom-style",
  "border-bottom-width",
  "border-left-color",
  "border-left-style",
  "border-left-width",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "border-collapse",
  "border-spacing",
  "outline-color",
  "outline-style",
  "outline-width",
  "outline-offset",
  "background-color",
  "background-image",
  "background-position",
  "background-size",
  "background-repeat",
  "background-clip",
  "background-origin",
  "box-shadow",
  "opacity",
  "visibility",
  "overflow-x",
  "overflow-y",
  "clip-path",
  "filter",
  "mix-blend-mode",
  "transform",
  "transform-origin",
  "translate",
  "rotate",
  "scale",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-variant-caps",
  "font-variant-numeric",
  "font-feature-settings",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-transform",
  "text-indent",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-style",
  "text-decoration-thickness",
  "text-underline-offset",
  "text-overflow",
  "text-shadow",
  "white-space-collapse",
  "text-wrap-mode",
  "text-wrap-style",
  "word-break",
  "overflow-wrap",
  "hyphens",
  "-webkit-locale",
  "vertical-align",
  "direction",
  "unicode-bidi",
  "writing-mode",
  "-webkit-line-clamp",
  "-webkit-box-orient",
  "-webkit-text-fill-color",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "order",
  "justify-content",
  "justify-items",
  "justify-self",
  "align-items",
  "align-content",
  "align-self",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-template-areas",
  "grid-auto-flow",
  "grid-auto-columns",
  "grid-auto-rows",
  "grid-column-start",
  "grid-column-end",
  "grid-row-start",
  "grid-row-end",
  "object-fit",
  "object-position",
  "aspect-ratio",
  "list-style-type",
  "list-style-position",
  "table-layout",
  "content",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-opacity",
];
// Browsers refuse very large canvases (iPhones above about 16 megapixels).
const maxPixels = 16_000_000;
// Pictures already drawn, by page contents, and the newest one per page.
// They are also saved in the browser (IndexedDB), so reopening Share is
// instant, even after a reload, and an edit only redraws the weeks it touched.
const drawn = new Map<string, Picture>();
const newest = new Map<string, string>();
const store = <T,>(
  mode: IDBTransactionMode,
  use: (s: IDBObjectStore) => IDBRequest<T>,
) =>
  new Promise<T>((resolve, reject) => {
    const open = indexedDB.open("fieldnotes-share", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("pictures");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = use(
        db.transaction("pictures", mode).objectStore("pictures"),
      );
      request.onsuccess = () => {
        resolve(request.result);
        db.close();
      };
      request.onerror = () => {
        reject(request.error);
        db.close();
      };
    };
  });
type Saved = { slot: string; sig: string; blob: Blob };
// Saved pictures are read once per page load; drawing waits for them.
let restoring: Promise<void> | undefined;
const restore = () =>
  (restoring ||= store<Saved[]>("readonly", (s) => s.getAll())
    .then((saved) => {
      for (const { slot, sig, blob } of saved) {
        if (newest.has(slot)) continue;
        drawn.set(sig, { url: URL.createObjectURL(blob), blob });
        newest.set(slot, sig);
      }
    })
    .catch(() => {
      // Private browsing or no storage: pictures last for the session only.
    }));
const keep = (page: Page, picture: Picture) => {
  const old = newest.get(page.slot);
  if (old && old !== page.sig) {
    const p = drawn.get(old);
    if (p) URL.revokeObjectURL(p.url);
    drawn.delete(old);
  }
  drawn.set(page.sig, picture);
  newest.set(page.slot, page.sig);
  const saved: Saved = { slot: page.slot, sig: page.sig, blob: picture.blob };
  store("readwrite", (s) => s.put(saved, page.slot)).catch(noop);
};
// A short fingerprint of what a page depends on.
const hash = (text: string) => {
  let a = 0xdeadbeef,
    b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a =
    Math.imul(a ^ (a >>> 16), 2246822507) ^
    Math.imul(b ^ (b >>> 13), 3266489909);
  b =
    Math.imul(b ^ (b >>> 16), 2246822507) ^
    Math.imul(a ^ (a >>> 13), 3266489909);
  return (
    (b >>> 0).toString(36) + (a >>> 0).toString(36) + text.length.toString(36)
  );
};
// Background drawing blocks the page for a moment (very noticeable on
// phones), so it waits until nobody has touched the screen for a while.
let lastInput = performance.now();
for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"])
  addEventListener(type, () => (lastInput = performance.now()), {
    capture: true,
    passive: true,
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function whenQuiet(ms: number, stopped: () => boolean) {
  while (!stopped()) {
    const wait = lastInput + ms - performance.now();
    if (wait > 0 || document.visibilityState !== "visible") {
      await sleep(Math.max(wait, 500));
      continue;
    }
    await new Promise((r) =>
      window.requestIdleCallback
        ? window.requestIdleCallback(r, { timeout: 2000 })
        : setTimeout(r, 50),
    );
    if (performance.now() - lastInput >= ms) return;
  }
}
const readOptions = (): Options => {
  let saved: Partial<Options> = {};
  try {
    saved = JSON.parse(localStorage.getItem("fieldnotes-share") || "{}");
  } catch {
    // Start from the defaults.
  }
  return {
    layout: saved.layout || (window.innerWidth < 700 ? "list" : "calendar"),
    split: localStorage.getItem("fieldnotes-share-split") !== "off",
    ideas: !!saved.ideas,
    hotels: saved.hotels ?? true,
  };
};
const saveOptions = (o: Options) => {
  localStorage.setItem(
    "fieldnotes-share",
    JSON.stringify({ layout: o.layout, ideas: o.ideas, hotels: o.hotels }),
  );
  localStorage.setItem("fieldnotes-share-split", o.split ? "on" : "off");
};
// The look of the page, so a theme change redraws the pictures.
// Reading computed styles forces a style pass, so it is done only when the
// chosen theme or the system colour scheme changes.
let themeCache = { key: "", value: "" };
const theme = () => {
  const key = `${document.documentElement.dataset.theme}|${matchMedia("(prefers-color-scheme: dark)").matches}`;
  if (themeCache.key !== key) {
    const css = getComputedStyle(document.body);
    themeCache = {
      key,
      value: ["--bg", "--paper", "--text", "--green", "--clay"]
        .map((v) => css.getPropertyValue(v))
        .concat(css.fontFamily)
        .join(),
    };
  }
  return themeCache.value;
};
// The plan as it is drawn, split into pages with what each depends on.
function usePlan({ trip, scenario, countries, hidden }: Props, o: Options) {
  // What friends see: the itinerary's filters, no alternatives unless asked,
  // hotels optionally anonymous.
  const shown = useMemo(() => {
    const visible = (e: Entry) =>
      (o.ideas || e.status !== "idea") && !hidden.includes(kindOf(e));
    const label = (e: Entry) =>
      e.type === "stay" && !o.hotels
        ? { ...e, title: `Staying in ${e.city || e.country || "town"}` }
        : e;
    const context = {
      ...scenario,
      entries: scenario.entries
        .filter((e) => o.ideas || e.status !== "idea")
        .map(label),
    };
    // The calendar keeps hidden stays: they name each day's city.
    const timeline = {
      ...context,
      entries: context.entries.filter((e) => e.type === "stay" || visible(e)),
    };
    const agenda = {
      ...context,
      entries: context.entries.filter(visible),
    };
    return { context, timeline, agenda };
  }, [scenario, hidden, o.ideas, o.hotels]);
  const look = theme();
  const weekSetting = localStorage.getItem("fieldnotes-weeks");
  const widths = localStorage.getItem(`fieldnotes-widths-${trip.id}`);
  const { weeks, pages } = useMemo(() => {
    const base =
      trip.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") ||
      "trip";
    // Monday-to-Sunday weeks, numbered like the timeline.
    const weeks: [string, string][] = [];
    for (let d = trip.start; d <= trip.end;) {
      const sunday = addDays(mondayOf(d), 6);
      const end = sunday > trip.end ? trip.end : sunday;
      weeks.push([d, end]);
      d = addDays(end, 1);
    }
    const options = [
      o.layout,
      o.split,
      o.ideas,
      o.hotels,
      [...hidden].sort().join("+"),
    ].join("|");
    const common = JSON.stringify([
      options,
      look,
      trip.name,
      trip.start,
      trip.end,
      countries,
      weeks.length,
      weekSetting,
      widths,
    ]);
    const source = o.layout === "calendar" ? shown.timeline : shown.agenda;
    // Plans touching a page (a day either side covers overnight plans).
    const within = (from: string, to: string) =>
      JSON.stringify(
        source.entries.filter(
          (e) =>
            e.date <= addDays(to, 1) &&
            (e.endDate > e.date ? e.endDate : e.date) >= addDays(from, -1),
        ),
      );
    const pages: Page[] = o.split
      ? weeks.map(([from, to], i) => ({
          key: from,
          weeks: [[from, to]],
          name: `${base}-week-${i + 1}.png`,
          label: `Week ${i + 1} · ${shortDate(from)} – ${shortDate(to)}`,
          week: i + 1,
          sig: hash(`${common}${within(from, to)}`),
          slot: `${trip.id}|${options}|${from}`,
        }))
      : [
          {
            key: "all",
            weeks,
            name: `${base}-plan.png`,
            label: "Whole trip",
            week: 0,
            sig: hash(`${common}${JSON.stringify(source.entries)}`),
            slot: `${trip.id}|${options}|all`,
          },
        ];
    return { weeks, pages };
    // Countries arrive as a new list on every render; compare their names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    trip,
    shown,
    countries.join("|"),
    hidden,
    o.layout,
    o.split,
    look,
    weekSetting,
    widths,
  ]);
  return { shown, weeks, pages };
}
// Draws the pages that have no picture yet, off screen, one at a time. In the
// background (quiet) it waits for a pause in using the app before each page.
function useDrawing(
  props: Props,
  plan: ReturnType<typeof usePlan>,
  o: Options,
  quiet: boolean,
) {
  const stage = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  // The page being drawn; only that one is rendered off screen.
  const [target, setTarget] = useState<Page | null>(null);
  const sigs = useRef(new Set<string>());
  sigs.current = new Set(plan.pages.map((p) => p.sig));
  useEffect(() => {
    let live = true;
    restore().then(() => live && setRestored(true));
    return () => {
      live = false;
    };
  }, []);
  const missing = restored ? plan.pages.filter((p) => !drawn.has(p.sig)) : [];
  const missingKey = missing.map((p) => p.sig).join("\n");
  useEffect(() => {
    const page = missing[0];
    if (!page) return;
    let cancelled = false;
    const stopped = () => cancelled;
    setError("");
    const run = async () => {
      if (quiet) await whenQuiet(4000, stopped);
      else await sleep(30);
      if (cancelled) return;
      setTarget(page);
      // Let the copy render and fonts load before drawing it.
      let node: HTMLElement | null | undefined;
      for (let i = 0; i < 60 && !cancelled && !node; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        node = stage.current?.querySelector<HTMLElement>(
          `[data-sig="${page.sig}"]`,
        );
      }
      await document.fonts?.ready;
      const { toBlob } = await import("html-to-image");
      if (!node || cancelled) return;
      const background = getComputedStyle(document.body).getPropertyValue(
        "--bg",
      );
      const width = node.scrollWidth,
        height = node.scrollHeight;
      const blob = await toBlob(node, {
        pixelRatio: Math.min(2, Math.sqrt(maxPixels / (width * height))),
        width,
        height,
        backgroundColor: background,
        cacheBust: false,
        // The app uses system fonts only; skip scanning style sheets for them.
        skipFonts: true,
        includeStyleProperties: styleProperties,
      });
      // A finished picture is kept if the page still looks the same, even if
      // other weeks changed meanwhile.
      if (!blob) throw Error("the browser returned an empty image");
      if (sigs.current.has(page.sig)) {
        keep(page, { url: URL.createObjectURL(blob), blob });
      }
      setTarget(null);
      redraw((n) => n + 1);
    };
    run().catch((e) => {
      setTarget(null);
      if (!cancelled)
        setError(
          `Could not draw the image: ${e instanceof Error ? e.message : String(e)}`,
        );
    });
    return () => {
      cancelled = true;
      // An edit interrupted this page: drop its copy until the next pause.
      setTarget(null);
    };
  }, [missingKey, quiet]);
  const element =
    target &&
    createPortal(
      <div className="share-stage" aria-hidden="true" inert ref={stage}>
        <Capture
          key={target.sig}
          page={target}
          props={props}
          plan={plan}
          layout={o.layout}
          split={o.split}
        />
      </div>,
      document.body,
    );
  return { busy: !restored || missing.length > 0, error, element };
}
function Capture({
  page,
  props: { trip, countries, hidden },
  plan: { shown, weeks },
  layout,
  split,
}: {
  page: Page;
  props: Props;
  plan: ReturnType<typeof usePlan>;
  layout: Layout;
  split: boolean;
}) {
  const total = days(trip.start, trip.end).length;
  return (
    <div className={`share-capture ${layout}`} data-sig={page.sig}>
      <header className="share-head">
        {countries.length > 0 && (
          <div className="country-labels">
            {countries.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        )}
        <h1>{trip.name}</h1>
        <div className="trip-dates">
          {page.week ? (
            <>
              <span className="week-badge">
                Week {page.week} of {weeks.length}
              </span>
              {shortDate(page.weeks[0][0])} — {shortDate(page.weeks[0][1])}{" "}
              {page.weeks[0][0].slice(0, 4)}
            </>
          ) : (
            <>
              {shortDate(trip.start)} — {shortDate(trip.end)}{" "}
              {trip.start.slice(0, 4)} · {total} days
            </>
          )}
        </div>
      </header>
      {layout === "calendar" ? (
        page.weeks.map(([from, to]) => (
          <div className="share-week" key={from}>
            <Timeline
              trip={trip}
              scenario={shown.timeline}
              context={shown.context}
              hideStays={hidden.includes("stay")}
              start={from}
              setStart={noop}
              onEdit={noop}
              onAdd={noop}
              onIssue={noop}
              onMove={noop}
              onStayChange={noop}
              issues={[]}
              exporting
              only={[from, to]}
            />
          </div>
        ))
      ) : (
        <Agenda
          trip={trip}
          scenario={shown.agenda}
          onEdit={noop}
          onAdd={noop}
          exporting
          only={split ? page.weeks[0] : undefined}
          weekHeadings={split ? false : undefined}
        />
      )}
      <footer className="share-foot">Made with fieldnotes</footer>
    </div>
  );
}
// Keeps the shared pictures up to date in the background once Share has been
// used, so opening it shows them straight away. Waits until the app is idle.
export function ShareWarmup(props: Props) {
  const [o] = useState(readOptions);
  const plan = usePlan(props, o);
  const { element } = useDrawing(props, plan, o, true);
  return element || null;
}
// An image of the whole trip to send to friends: a clean copy of the plan is
// drawn off screen, without buttons and warnings, and saved as a PNG.
export function ShareImage({
  onClose,
  ...props
}: Props & { onClose: () => void }) {
  const { trip, hidden } = props;
  const [o, setOptions] = useState(readOptions);
  const set = (patch: Partial<Options>) =>
    setOptions((v) => {
      const next = { ...v, ...patch };
      saveOptions(next);
      return next;
    });
  useEffect(() => localStorage.setItem("fieldnotes-share-used", "1"), []);
  const { layout, split, ideas, hotels } = o;
  const plan = usePlan(props, o);
  const { weeks, pages } = plan;
  const { busy, error: drawError, element } = useDrawing(props, plan, o, false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // Fresh pictures, or the previous one for a page while it is redrawn.
  const shownPictures = pages.map((page) => {
    const fresh = drawn.get(page.sig);
    const stale = fresh ? undefined : drawn.get(newest.get(page.slot) || "");
    return { page, picture: fresh || stale, fresh: !!fresh };
  });
  const images = shownPictures
    .filter((x) => x.fresh)
    .map((x) => ({ ...x.picture!, name: x.page.name, label: x.page.label }));
  const ready = !busy && images.length === pages.length;
  const files = images.map(
    (x) => new File([x.blob], x.name, { type: "image/png" }),
  );
  const canShare = files.length > 0 && !!navigator.canShare?.({ files });
  const canCopy =
    images.length === 1 && "ClipboardItem" in window && window.isSecureContext;
  const saveOne = (x: { url: string; name: string }) => {
    const a = document.createElement("a");
    a.href = x.url;
    a.download = x.name;
    a.click();
  };
  async function saveAll() {
    // Browsers drop downloads started at the same instant; space them out.
    for (const [i, x] of images.entries()) {
      if (i) await new Promise((r) => setTimeout(r, 400));
      saveOne(x);
    }
  }
  async function share() {
    try {
      await navigator.share({ files, title: trip.name });
    } catch {
      // Closing the share sheet is not an error.
    }
  }
  async function copy() {
    if (!images[0]) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": images[0].blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("This browser would not copy the image; download it instead.");
    }
  }
  const left = pages.length - images.length;
  return (
    <Modal title="Share the plan" onClose={onClose} wide>
      <div className="share-options">
        <div className="segmented" role="group" aria-label="Layout">
          <button
            className={layout === "calendar" ? "selected" : ""}
            onClick={() => set({ layout: "calendar" })}
          >
            <CalendarRange size={14} /> Calendar
          </button>
          <button
            className={layout === "list" ? "selected" : ""}
            onClick={() => set({ layout: "list" })}
          >
            <List size={14} /> Day by day
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Images">
          <button
            className={split ? "" : "selected"}
            aria-pressed={!split}
            onClick={() => set({ split: false })}
          >
            One image
          </button>
          <button
            className={split ? "selected" : ""}
            aria-pressed={split}
            onClick={() => set({ split: true })}
          >
            One per week ({weeks.length})
          </button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={hotels}
            onChange={(e) => set({ hotels: e.target.checked })}
          />
          Show hotel names
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={ideas}
            onChange={(e) => set({ ideas: e.target.checked })}
          />
          Include ideas and alternatives
        </label>
      </div>
      <p className="share-note">
        {layout === "calendar"
          ? "A calendar, one week per row."
          : "One day per row, easy to read on a phone."}{" "}
        Warnings, notes and booking details are left out.
      </p>
      {hidden.length > 0 && (
        <p className="share-note share-hidden">
          <EyeOff size={13} /> Following the itinerary filters, left out:{" "}
          {hidden.map((k) => kindLabels[k]).join(", ")}.
        </p>
      )}
      <div className="share-preview">
        {shownPictures.map(({ page, picture, fresh }) => (
          <figure key={page.slot} className={fresh ? "" : "updating"}>
            {pages.length > 1 && (
              <figcaption>
                <span>{page.label}</span>
                {fresh ? (
                  <button
                    className="text-button"
                    onClick={() =>
                      saveOne({ url: picture!.url, name: page.name })
                    }
                  >
                    <Download size={13} /> Save
                  </button>
                ) : (
                  <span className="share-updating">
                    <LoaderCircle size={13} className="spin" />
                    {picture ? "Updating…" : "Drawing…"}
                  </span>
                )}
              </figcaption>
            )}
            {picture ? (
              <img src={picture.url} alt={`${trip.name}: ${page.label}`} />
            ) : (
              <div className="share-placeholder">
                <LoaderCircle size={18} className="spin" /> Drawing…
              </div>
            )}
          </figure>
        ))}
      </div>
      {busy && left > 0 && pages.length > 1 && (
        <p className="share-note">
          Redrawing {left} changed {left === 1 ? "page" : "pages"}; the others
          are ready.
        </p>
      )}
      {(error || drawError) && (
        <p className="sync-message">{error || drawError}</p>
      )}
      <div className="modal-footer">
        {canCopy && (
          <button className="button" disabled={!ready} onClick={copy}>
            <Copy size={15} />
            {copied ? "Copied" : "Copy image"}
          </button>
        )}
        <button
          className="button"
          disabled={!ready}
          onClick={() => void saveAll()}
        >
          <Download size={15} />
          {pages.length > 1 ? `Download all ${pages.length}` : "Download PNG"}
        </button>
        {canShare && (
          <button
            className="button primary"
            disabled={!ready}
            onClick={() => void share()}
          >
            <Share2 size={15} />
            Share…
          </button>
        )}
      </div>
      {element}
    </Modal>
  );
}

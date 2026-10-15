import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  Sunrise,
  CalendarPlus,
  CalendarDays,
  MapPinned,
  GitBranch,
  ListChecks,
  FileText,
  Settings,
  Plus,
  ChevronDown,
  ArrowUpRight,
  Leaf,
  Menu,
  X,
  CloudCheck,
  CloudOff,
  LoaderCircle,
  AlertTriangle,
  Download,
  Upload,
  Check,
  LayoutGrid,
  List,
  RefreshCw,
  Trash2,
  ExternalLink,
  Utensils,
  Mountain,
  TrainFront,
  Undo2,
  Redo2,
  Share2,
  BedDouble,
  MapPin,
  StickyNote,
  Bus,
  Map as MapIcon,
  UserRound,
} from "lucide-react";
import {
  useWorkspace,
  initialize,
  mutate,
  syncNow,
  backup,
  replaceWorkspace,
  resolveConflict,
  undo,
  redo,
  dismissToast,
  notify,
} from "./sync";
import {
  type Entry,
  type Place,
  type Trip,
  type Scenario,
  type Task,
  type Issue,
  WorkspaceSchema,
  emptyEntry,
  emptyPlace,
  addDays,
  days,
  shortDate,
  weekday,
  issuesFor,
  uid,
  zone,
  currency,
  safeUrl,
  type Kind,
  kindOf,
} from "./model";
import {
  EntryEditor,
  PlaceEditor,
  TripEditor,
  newTrip,
  Field,
} from "./components/Editors";
import { MapsSettings } from "./components/MapsSettings";
import { AttachmentStatus } from "./components/Attachments";
import { Timeline, Agenda, EntryIcon, BookingTag } from "./components/Timeline";
import { Modal } from "./components/Modal";
// Tabs load when first opened, so the app starts faster on phones.
const Scenarios = lazy(() =>
  import("./components/Scenarios").then((m) => ({ default: m.Scenarios })),
);
const Visa = lazy(() =>
  import("./components/Visa").then((m) => ({ default: m.Visa })),
);
const Hotels = lazy(() =>
  import("./components/Hotels").then((m) => ({ default: m.Hotels })),
);
const TaskList = lazy(() =>
  import("./components/Tasks").then((m) => ({ default: m.TaskList })),
);
const Transport = lazy(() =>
  import("./components/Transport").then((m) => ({ default: m.Transport })),
);
const opening = (
  <LoaderCircle className="spin" aria-label="Opening" size={20} />
);
const Places = lazy(() =>
  import("./components/Places").then((m) => ({ default: m.Places })),
);
const Food = lazy(() =>
  import("./components/Food").then((m) => ({ default: m.Food })),
);
const Outdoors = lazy(() =>
  import("./components/Outdoors").then((m) => ({ default: m.Outdoors })),
);
const ShareImage = lazy(() =>
  import("./components/Share").then((m) => ({ default: m.ShareImage })),
);
const ShareWarmup = lazy(() =>
  import("./components/Share").then((m) => ({ default: m.ShareWarmup })),
);
const MapsListExport = lazy(() =>
  import("./components/MapsList").then((m) => ({
    default: m.MapsListExport,
  })),
);
const CalendarExport = lazy(() =>
  import("./components/CalendarExport").then((m) => ({
    default: m.CalendarExport,
  })),
);
const ReservationImport = lazy(() =>
  import("./components/Import").then((m) => ({ default: m.ReservationImport })),
);
const Today = lazy(() =>
  import("./components/Today").then((m) => ({ default: m.Today })),
);
type Tab =
  | "today"
  | "plan"
  | "places"
  | "transport"
  | "hotels"
  | "food"
  | "outdoors"
  | "scenarios"
  | "preparation"
  | "visa"
  | "settings";
// Kinds of plans that can be hidden from the itinerary.
const kinds: { id: Kind; label: string; icon: typeof MapPin }[] = [
  { id: "stay", label: "Hotels", icon: BedDouble },
  { id: "activity", label: "Activities", icon: MapPin },
  { id: "food", label: "Food", icon: Utensils },
  { id: "transport", label: "Between cities", icon: TrainFront },
  { id: "local", label: "Local transport", icon: Bus },
  { id: "note", label: "Notes", icon: StickyNote },
];
const navigation = [
  { id: "today", name: "Today", icon: Sunrise },
  { id: "plan", name: "Itinerary", icon: CalendarDays },
  { id: "transport", name: "Transport", icon: TrainFront },
  { id: "hotels", name: "Hotels", icon: BedDouble },
  { id: "places", name: "Places", icon: MapPinned },
  { id: "food", name: "Restaurants", icon: Utensils },
  { id: "outdoors", name: "Hiking & cycling", icon: Mountain },
  { id: "scenarios", name: "Scenarios", icon: GitBranch },
  { id: "preparation", name: "Preparation", icon: ListChecks },
  { id: "visa", name: "Visa schedules", icon: FileText },
];
type Editor =
  | { kind: "entry"; entry: Entry; scenarioId: string }
  | { kind: "place"; place: Place }
  | { kind: "trip"; trip: Trip; isNew?: boolean }
  | { kind: "import" }
  | { kind: "issues" }
  | { kind: "task"; task: Task }
  | null;
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
function Preparation({
  trip,
  scenario,
  onEditTask,
  onEditEntry,
}: {
  trip: Trip;
  scenario: Scenario;
  onEditTask: (t: Task) => void;
  onEditEntry: (e: Entry) => void;
}) {
  const costs = Object.entries(
    scenario.entries
      .filter((e) => e.cost !== null && e.status !== "idea")
      .reduce<Record<string, number>>(
        (v, e) => ({ ...v, [e.currency]: (v[e.currency] || 0) + e.cost! }),
        {},
      ),
  );
  const deadlines = scenario.entries
    .filter((e) => e.refundDeadline)
    .sort((a, b) => a.refundDeadline.localeCompare(b.refundDeadline));
  return (
    <div className="preparation-view">
      <div className="section-actions">
        <h2>Checklist</h2>
      </div>
      <Suspense fallback={opening}>
        <TaskList trip={trip} onEditTask={onEditTask} />
      </Suspense>
      <h2 className="section-heading">Cancellation deadlines</h2>
      <div className="task-list">
        {deadlines.map((e) => (
          <button
            className="task-row deadline"
            key={e.id}
            onClick={() => onEditEntry(e)}
          >
            <EntryIcon type={e.type} />
            <span className="task-title">{e.title}</span>
            <span className="task-due">{shortDate(e.refundDeadline)}</span>
          </button>
        ))}
      </div>
      {!deadlines.length && (
        <div className="empty-state compact-empty">
          No cancellation deadlines added.
        </div>
      )}
      <h2 className="section-heading">Planned costs</h2>
      <div className="cost-cards">
        {costs.map(([currency, total]) => (
          <div className="cost-card" key={currency}>
            <span>{currency}</span>
            <strong>
              {total.toLocaleString("en", { maximumFractionDigits: 2 })}
            </strong>
          </div>
        ))}
      </div>
      {!costs.length && (
        <div className="empty-state compact-empty">
          Add costs to bookings to track your budget.
        </div>
      )}
    </div>
  );
}
function TaskEditor({
  task,
  trip,
  onClose,
}: {
  task: Task;
  trip: Trip;
  onClose: () => void;
}) {
  const [value, setValue] = useState(task);
  const exists = trip.tasks.some((t) => t.id === task.id);
  return (
    <Modal title={exists ? "Edit task" : "Add task"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutate((d) => {
            const t = d.trips.find((t) => t.id === trip.id)!;
            const i = t.tasks.findIndex((t) => t.id === value.id);
            if (i < 0) t.tasks.push(value);
            else t.tasks[i] = value;
          });
          onClose();
        }}
      >
        <div className="form-grid">
          <Field label="Task" full>
            <input
              autoFocus
              required
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={value.due}
              onChange={(e) => setValue({ ...value, due: e.target.value })}
            />
          </Field>
          <Field label="Country">
            <input
              value={value.country}
              onChange={(e) => setValue({ ...value, country: e.target.value })}
            />
          </Field>
          <Field label="Source link" full>
            <input
              value={value.url}
              onChange={(e) => setValue({ ...value, url: e.target.value })}
            />
          </Field>
          <Field label="Notes" full>
            <textarea
              rows={4}
              value={value.notes || ""}
              placeholder="Details, phone numbers, what to confirm…"
              onChange={(e) => setValue({ ...value, notes: e.target.value })}
            />
          </Field>
          <label className="check full">
            <input
              type="checkbox"
              checked={!!value.today}
              onChange={(e) =>
                setValue({ ...value, today: e.target.checked || undefined })
              }
            />
            Work on this today
          </label>
          <label className="check full">
            <input
              type="checkbox"
              checked={value.done}
              onChange={(e) => setValue({ ...value, done: e.target.checked })}
            />
            Done
          </label>
        </div>
        <div className="modal-footer">
          {exists && (
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                mutate((d) => {
                  const t = d.trips.find((t) => t.id === trip.id)!;
                  t.tasks = t.tasks.filter((t) => t.id !== value.id);
                });
                onClose();
              }}
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
          <div className="spacer" />
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">Save task</button>
        </div>
      </form>
    </Modal>
  );
}
export default function App() {
  const state = useWorkspace();
  const data = state.data;
  const [tab, setTab] = useState<Tab>("plan");
  const [hiddenKinds, setHiddenKinds] = useState<Kind[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("fieldnotes-hidden") || "[]");
      return Array.isArray(v)
        ? v.filter((k) => kinds.some((x) => x.id === k))
        : [];
    } catch {
      return [];
    }
  });
  const toggleKind = (k: Kind | "all") => {
    const next =
      k === "all"
        ? []
        : hiddenKinds.includes(k)
          ? hiddenKinds.filter((x) => x !== k)
          : [...hiddenKinds, k];
    setHiddenKinds(next);
    localStorage.setItem("fieldnotes-hidden", JSON.stringify(next));
  };
  const [view, setView] = useState<"timeline" | "agenda">(() =>
    window.innerWidth < 700 ? "agenda" : "timeline",
  );
  const [start, setStart] = useState("");
  const [editor, setEditor] = useState<Editor>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [mapsList, setMapsList] = useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("fieldnotes-theme") || "sage",
  );
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  // Home screen apps need https to work offline (service workers need it).
  const [noOffline] = useState(
    () =>
      !window.isSecureContext &&
      ((navigator as { standalone?: boolean }).standalone === true ||
        matchMedia("(display-mode: standalone)").matches),
  );
  const [restore, setRestore] = useState<object | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const [conflictOpen, setConflictOpen] = useState(false);
  const [foodPlaceId, setFoodPlaceId] = useState("");
  const close = useCallback(() => setEditor(null), []);
  // Ctrl/Cmd+Z undoes the last edit and Ctrl+Shift+Z or Ctrl+Y redoes it.
  // Text fields keep their own undo, and open dialogs are left alone.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const t = e.target as HTMLElement;
      const typing =
        t.isContentEditable ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        (t.tagName === "INPUT" &&
          !["checkbox", "radio", "button", "submit"].includes(
            (t as HTMLInputElement).type,
          ));
      if (typing || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(dismissToast, state.toast.action ? 7000 : 2500);
    return () => clearTimeout(t);
  }, [state.toast]);
  useEffect(() => {
    void initialize();
    const before = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", before);
    let mounted = true;
    if ("serviceWorker" in navigator && !import.meta.env.DEV) {
      void navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (!mounted) return;
          if (reg.waiting) setUpdate(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setUpdate(worker);
            });
          });
          void navigator.serviceWorker.ready.then(() => {
            if (mounted) setOfflineReady(true);
          });
        })
        .catch(() => {});
    }
    const hadController = !!navigator.serviceWorker?.controller;
    const controller = () => {
      if (hadController) window.location.reload();
      else setOfflineReady(true);
    };
    navigator.serviceWorker?.addEventListener("controllerchange", controller);
    return () => {
      mounted = false;
      window.removeEventListener("beforeinstallprompt", before);
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        controller,
      );
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("fieldnotes-theme", theme);
  }, [theme]);
  const trip =
    data?.trips.find((t) => t.id === data.activeTripId) || data?.trips[0];
  const scenario =
    trip?.scenarios.find((s) => s.id === trip.activeScenarioId) ||
    trip?.scenarios[0];
  useEffect(() => {
    if (trip) setStart(trip.start);
  }, [trip?.id, trip?.start]);
  // The itinerary without the kinds of plans hidden above. The timeline keeps
  // hidden stays (they name each day's city) and just leaves out their row.
  const shown = useMemo(() => {
    if (!scenario || !hiddenKinds.length) return scenario;
    const keep = (e: Entry, stays: boolean) =>
      (stays && e.type === "stay") || !hiddenKinds.includes(kindOf(e));
    return {
      timeline: {
        ...scenario,
        entries: scenario.entries.filter((e) => keep(e, true)),
      },
      agenda: {
        ...scenario,
        entries: scenario.entries.filter((e) => keep(e, false)),
      },
    };
  }, [scenario, hiddenKinds]);
  // Cities in the trips, used to fill in a found place's city.
  const tripCities = useMemo(
    () => [
      ...new Set(
        (data?.trips || []).flatMap((t) =>
          t.scenarios.flatMap((s) =>
            s.entries.flatMap((e) => [e.city, e.toCity]),
          ),
        ),
      ),
    ],
    [data?.trips],
  );
  const issues = useMemo(
    () =>
      trip && scenario && data ? issuesFor(trip, scenario, data.places) : [],
    [trip, scenario, data?.places],
  );
  if (!data || !trip || !scenario)
    return (
      <div className="loading-screen">
        <Leaf size={36} />
        <h1>Fieldnotes</h1>
        {state.status === "error" ? (
          <p role="alert">{state.message}</p>
        ) : (
          <LoaderCircle className="spin" size={20} />
        )}
      </div>
    );
  const weekStart =
    start >= trip.start && start <= trip.end ? start : trip.start;
  const activeCountries = [
    ...new Set(
      scenario.entries
        .filter((e) => e.type !== "transport")
        .map((e) => e.country)
        .filter(Boolean),
    ),
  ];
  function selectScenario(s: Scenario) {
    mutate((d) => {
      d.trips.find((t) => t.id === trip!.id)!.activeScenarioId = s.id;
    });
  }
  function edit(e: Entry, scenarioId = scenario!.id) {
    setEditor({ kind: "entry", entry: e, scenarioId });
  }
  function add(
    date = weekStart,
    time?: string,
    type: Entry["type"] = "activity",
  ) {
    const base =
      scenario!.entries.find(
        (e) => e.type === "stay" && e.date <= date && e.endDate > date,
      ) ||
      scenario!.entries.find((e) => e.date === date && e.type !== "transport");
    const entry = {
      ...emptyEntry(date, type),
      country: base?.country || "Japan",
      city: base?.city || "",
      timezone: zone(base?.country || "Japan"),
      endTimezone: zone(base?.country || "Japan"),
      currency: currency(base?.country || "Japan"),
    };
    if (time) {
      entry.startTime = time;
      entry.endTime = `${String(Math.min(23, Number(time.slice(0, 2)) + 2)).padStart(2, "0")}:00`;
    }
    setEditor({ kind: "entry", entry, scenarioId: scenario!.id });
  }
  function fixIssue(issue: Issue) {
    if (issue.entryId) {
      const e = scenario!.entries.find((e) => e.id === issue.entryId);
      if (e) {
        edit(e);
        return;
      }
    }
    if (issue.kind === "night") {
      add(issue.date, undefined, "stay");
      return;
    }
    const entry = {
      ...emptyEntry(issue.date, "transport"),
      title: issue.title,
      fromStayId: issue.fromStayId,
      toStayId: issue.toStayId,
      city: issue.fromCity || "",
      toCity: issue.toCity || "",
      country: issue.country || "Japan",
      toCountry: issue.toCountry || "",
      timezone: zone(issue.country || "Japan"),
      endTimezone: zone(issue.toCountry || issue.country || "Japan"),
      scope:
        issue.kind === "stay-transfer"
          ? ("local" as const)
          : ("intercity" as const),
      currency: currency(issue.country || "Japan"),
    };
    setEditor({ kind: "entry", entry, scenarioId: scenario!.id });
  }
  function planPlace(
    p: Place,
    date = weekStart,
    time?: string,
    endTime?: string,
  ) {
    const type =
      p.kind === "restaurant"
        ? "food"
        : p.kind === "hotel"
          ? "stay"
          : "activity";
    setEditor({
      kind: "entry",
      scenarioId: scenario!.id,
      entry: {
        ...emptyEntry(date, type),
        ...(time && {
          startTime: time,
          endTime:
            endTime ||
            `${String(Math.min(23, Number(time.slice(0, 2)) + 1)).padStart(2, "0")}:${time.slice(3)}`,
        }),
        title: p.name,
        placeId: p.id,
        country: p.country,
        city: p.city,
        timezone: zone(p.country),
        endTimezone: zone(p.country),
        currency: currency(p.country),
      },
    });
  }
  function move(id: string, date: string, time: string) {
    mutate((d) => {
      const e = d.trips
        .find((t) => t.id === trip!.id)!
        .scenarios.find((s) => s.id === scenario!.id)!
        .entries.find((e) => e.id === id);
      if (!e) return;
      const duration =
        Date.parse(e.endDate + "T" + e.endTime + ":00Z") -
        Date.parse(e.date + "T" + e.startTime + ":00Z");
      const end = new Date(Date.parse(date + "T" + time + ":00Z") + duration);
      e.date = date;
      e.startTime = time;
      e.endDate = end.toISOString().slice(0, 10);
      e.endTime = end.toISOString().slice(11, 16);
    });
    const e = scenario!.entries.find((x) => x.id === id);
    if (e && (e.date !== date || e.startTime !== time))
      notify(
        `Moved “${e.title}” to ${weekday(date)} ${shortDate(date)} ${time}`,
      );
  }
  const title =
    tab === "plan"
      ? trip.name
      : tab === "today"
        ? "Today"
        : tab === "transport"
          ? "Getting between cities"
          : tab === "hotels"
            ? "Where you sleep"
            : tab === "places"
              ? "Places"
              : tab === "food"
                ? "Restaurants near your plans"
                : tab === "outdoors"
                  ? "Trails and rides near your plans"
                  : tab === "scenarios"
                    ? "A little room for possibility"
                    : tab === "preparation"
                      ? "Before you go"
                      : tab === "visa"
                        ? "Visa itineraries"
                        : "Make it yours";
  const SaveIcon =
    state.status === "saved"
      ? CloudCheck
      : state.status === "offline"
        ? CloudOff
        : state.status === "conflict" || state.status === "error"
          ? AlertTriangle
          : LoaderCircle;
  const statusLabel = {
    loading: "Opening",
    saved: "Synced",
    saving: "Saving on device",
    syncing: "Syncing",
    offline: "Saved on device",
    conflict: "Sync conflict",
    error: "Storage error",
  }[state.status];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("plan");
          }}
        >
          <span className="brand-mark">
            <Leaf size={24} />
          </span>
          fieldnotes<span className="brand-period">.</span>
        </a>
        <button
          className="icon-button mobile-close"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        >
          <X size={20} />
        </button>
        <div className="trip-selector">
          <select
            aria-label="Select trip"
            value={trip.id}
            onChange={(e) => {
              if (e.target.value === "new") {
                setEditor({ kind: "trip", trip: newTrip(), isNew: true });
                return;
              }
              mutate((d) => {
                d.activeTripId = e.target.value;
              });
            }}
          >
            {data.trips.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
            <option value="new">+ New trip</option>
          </select>
        </div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={`nav-button ${tab === n.id ? "active" : ""}`}
              onClick={() => {
                setTab(n.id as Tab);
                if (n.id === "food" || n.id === "outdoors") setFoodPlaceId("");
                setMobileNav(false);
              }}
            >
              <n.icon size={19} />
              {n.name}
              {n.id === "scenarios" && (
                <span className="nav-count">{trip.scenarios.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-button ${tab === "settings" ? "active" : ""}`}
            onClick={() => {
              setTab("settings");
              setMobileNav(false);
            }}
          >
            <Settings size={18} />
            Settings
          </button>
          <button
            className="nav-button"
            onClick={() => setEditor({ kind: "import" })}
          >
            <Upload size={18} />
            Import reservations
          </button>
          <div className="sidebar-illustration" aria-hidden="true">
            <svg viewBox="0 0 200 114">
              <path
                d="M0 98 39 59 73 92 116 33 200 100v14H0z"
                fill="currentColor"
                opacity=".13"
              />
              <path
                d="m9 110 42-46 29 31 38-44 54 59"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                opacity=".4"
              />
              <circle
                cx="158"
                cy="25"
                r="13"
                fill="currentColor"
                opacity=".2"
              />
              <path
                d="M96 111q-8-16 2-29t-3-19"
                fill="none"
                stroke="currentColor"
                strokeDasharray="3 4"
                opacity=".5"
              />
            </svg>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            My trips<span>/</span>
            {navigation.find((n) => n.id === tab)?.name || "Settings"}
          </div>
          <div className="spacer" />
          <div className="history-buttons">
            <button
              className="icon-button"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              disabled={!state.canUndo}
              onClick={undo}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
              disabled={!state.canRedo}
              onClick={redo}
            >
              <Redo2 size={16} />
            </button>
          </div>
          <button
            className={`save-status ${state.status}`}
            title={
              state.message ||
              "Changes save on this device, then sync in the background"
            }
            onClick={() => {
              if (state.status === "conflict") setConflictOpen(true);
              else void syncNow();
            }}
          >
            <SaveIcon
              size={15}
              className={
                ["saving", "syncing"].includes(state.status) ? "spin" : ""
              }
            />
            {statusLabel}
          </button>
          <button
            className="avatar"
            aria-label="Trip settings"
            onClick={() => setEditor({ kind: "trip", trip })}
          >
            {trip.applicant ? (
              trip.applicant.charAt(0).toUpperCase()
            ) : (
              <UserRound size={17} />
            )}
          </button>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              {tab === "plan" && (
                <div className="country-labels">
                  {activeCountries.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              )}
              <h1>{title}</h1>
              {tab === "plan" && (
                <div className="trip-dates">
                  {shortDate(trip.start)} — {shortDate(trip.end)}{" "}
                  {trip.start.slice(0, 4)}
                  <span className="date-divider" />{" "}
                  {days(trip.start, trip.end).length} days
                  <button
                    className="text-button edit-dates"
                    onClick={() => setEditor({ kind: "trip", trip })}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
            <div className="heading-actions">
              {tab === "plan" && (
                <button className="button" onClick={() => setSharing(true)}>
                  <Share2 size={16} />
                  Share
                </button>
              )}
              {tab === "plan" && (
                <button
                  className="button"
                  title="Add to Apple, Google or Outlook calendar"
                  onClick={() => setExporting(true)}
                >
                  <CalendarPlus size={16} />
                  Calendar
                </button>
              )}
              {(tab === "hotels" || tab === "food" || tab === "places") && (
                <button
                  className="button"
                  title="Make a Google My Maps map you can open in Google Maps"
                  onClick={() => setMapsList(true)}
                >
                  <MapIcon size={16} />
                  Google Maps list
                </button>
              )}
              {tab === "plan" && (
                <button className="button primary" onClick={() => add()}>
                  <Plus size={17} />
                  Add plan
                </button>
              )}
            </div>
          </div>
          {(state.status === "error" || state.status === "conflict") && (
            <div className="notice error" role="alert">
              <AlertTriangle size={17} />
              {state.message}
              {state.status === "conflict" && (
                <button
                  className="text-button"
                  onClick={() => setConflictOpen(true)}
                >
                  Resolve
                </button>
              )}
            </div>
          )}
          {noOffline && (
            <div className="notice">
              <AlertTriangle size={17} />
              This home screen app was added from a plain http:// address, so it
              can't open without a connection. Open the app's https:// address
              in Safari and add that to the home screen instead.
            </div>
          )}
          {update && (
            <div className="notice">
              An update is ready.
              <button
                className="text-button"
                onClick={() => update.postMessage("ACTIVATE_UPDATE")}
              >
                Update app
              </button>
            </div>
          )}
          {tab === "plan" && (
            <>
              <div className="plan-toolbar">
                <div className="scenario-select">
                  <GitBranch size={16} />
                  <select
                    aria-label="Active scenario"
                    value={scenario.id}
                    onChange={(e) =>
                      selectScenario(
                        trip.scenarios.find((s) => s.id === e.target.value)!,
                      )
                    }
                  >
                    {trip.scenarios.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="spacer" />
                <button
                  className={`gaps-summary ${issues.length ? "has-gaps" : ""}`}
                  onClick={() => setEditor({ kind: "issues" })}
                >
                  {issues.length ? (
                    <AlertTriangle size={15} />
                  ) : (
                    <Check size={15} />
                  )}
                  <span>
                    {issues.length
                      ? `${issues.length} things to check`
                      : "All connected"}
                  </span>
                </button>
                <div className="segmented view-picker">
                  <button
                    className={view === "timeline" ? "selected" : ""}
                    onClick={() => setView("timeline")}
                  >
                    <LayoutGrid size={15} />
                    Timeline
                  </button>
                  <button
                    className={view === "agenda" ? "selected" : ""}
                    onClick={() => setView("agenda")}
                  >
                    <List size={15} />
                    Agenda
                  </button>
                </div>
              </div>
              <div
                className="kind-filter"
                role="group"
                aria-label="Show in the itinerary"
              >
                <span>Show</span>
                {kinds.map(({ id, label, icon: Icon }) => {
                  const on = !hiddenKinds.includes(id);
                  const count = scenario.entries.filter(
                    (e) => kindOf(e) === id,
                  ).length;
                  return (
                    <button
                      key={id}
                      className={`kind-chip kind-${id} ${on ? "on" : ""}`}
                      aria-pressed={on}
                      title={
                        on
                          ? `Hide ${label.toLowerCase()}`
                          : `Show ${label.toLowerCase()}`
                      }
                      onClick={() => toggleKind(id)}
                    >
                      <Icon size={13} />
                      {label}
                      <small>{count}</small>
                    </button>
                  );
                })}
                {hiddenKinds.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() => toggleKind("all")}
                  >
                    Show all
                  </button>
                )}
                <span className="booking-legend">
                  <span>
                    <BookingTag state="booked" /> Reserved
                  </span>
                  <span>
                    <BookingTag state="todo" /> Not reserved yet
                  </span>
                </span>
              </div>
              {view === "timeline" ? (
                <Timeline
                  trip={trip}
                  scenario={
                    shown && "timeline" in shown ? shown.timeline : scenario
                  }
                  hideStays={hiddenKinds.includes("stay")}
                  context={scenario}
                  start={weekStart}
                  setStart={setStart}
                  onEdit={edit}
                  onAdd={add}
                  onIssue={fixIssue}
                  onMove={move}
                  places={data.places}
                  onStayChange={(id, date, endDate) =>
                    mutate((d) => {
                      const e = d.trips
                        .find((t) => t.id === trip.id)!
                        .scenarios.find((s) => s.id === scenario.id)!
                        .entries.find((e) => e.id === id);
                      if (e) {
                        e.date = date;
                        e.endDate = endDate;
                      }
                    })
                  }
                  issues={issues}
                />
              ) : (
                <Agenda
                  trip={trip}
                  scenario={
                    shown && "agenda" in shown ? shown.agenda : scenario
                  }
                  context={scenario}
                  places={data.places}
                  onEdit={edit}
                  onAdd={add}
                />
              )}
            </>
          )}
          {tab === "today" && (
            <Suspense fallback={opening}>
              <Today
                trip={trip}
                scenario={scenario}
                places={data.places}
                onEdit={edit}
              />
            </Suspense>
          )}
          {tab === "hotels" && data && (
            <Suspense fallback={opening}>
              <Hotels
                trip={trip}
                scenario={scenario}
                places={data.places}
                onEdit={edit}
              />
            </Suspense>
          )}
          {tab === "transport" && (
            <Suspense fallback={opening}>
              <Transport
                trip={trip}
                scenario={scenario}
                places={data.places}
                onEdit={edit}
                onShowDay={(date) => {
                  setStart(date);
                  setTab("plan");
                }}
              />
            </Suspense>
          )}
          {tab === "places" && (
            <Suspense
              fallback={
                <LoaderCircle
                  className="spin"
                  aria-label="Opening places"
                  size={20}
                />
              }
            >
              <Places
                data={data}
                trip={trip}
                scenario={scenario}
                onEdit={(place) => setEditor({ kind: "place", place })}
                onAddPlan={(p) => planPlace(p)}
                onOpenPlan={edit}
                onFindFood={(p) => {
                  setFoodPlaceId(p.id);
                  setTab("food");
                }}
                onFindTrails={(p) => {
                  setFoodPlaceId(p.id);
                  setTab("outdoors");
                }}
              />
            </Suspense>
          )}
          {tab === "food" && (
            <Suspense
              fallback={
                <LoaderCircle
                  className="spin"
                  aria-label="Opening restaurants"
                  size={20}
                />
              }
            >
              <Food
                key={foodPlaceId}
                data={data}
                trip={trip}
                scenario={scenario}
                initialPlaceId={foodPlaceId}
                onPlan={planPlace}
                onEditPlace={(place) => setEditor({ kind: "place", place })}
              />
            </Suspense>
          )}
          {tab === "outdoors" && (
            <Suspense
              fallback={
                <LoaderCircle
                  className="spin"
                  aria-label="Opening trails"
                  size={20}
                />
              }
            >
              <Outdoors
                key={foodPlaceId}
                data={data}
                trip={trip}
                scenario={scenario}
                initialPlaceId={foodPlaceId}
                onPlan={planPlace}
                onEditPlace={(place) => setEditor({ kind: "place", place })}
              />
            </Suspense>
          )}
          {tab === "scenarios" && (
            <Suspense fallback={opening}>
              <Scenarios trip={trip} onSelect={selectScenario} onEdit={edit} />
            </Suspense>
          )}
          {tab === "preparation" && (
            <Preparation
              trip={trip}
              scenario={scenario}
              onEditTask={(task) => setEditor({ kind: "task", task })}
              onEditEntry={edit}
            />
          )}
          {tab === "visa" && (
            <Suspense fallback={opening}>
              <Visa
                data={data}
                trip={trip}
                scenario={scenario}
                onEditTrip={() => setEditor({ kind: "trip", trip })}
              />
            </Suspense>
          )}
          {tab === "settings" && (
            <div className="settings-view">
              <section className="settings-section">
                <h2>Appearance</h2>
                <div className="theme-options">
                  {[
                    {
                      id: "sage",
                      name: "Sage",
                      colors: ["#354f43", "#e2e7dc", "#c17d58"],
                    },
                    {
                      id: "clay",
                      name: "Clay",
                      colors: ["#745546", "#ece0d4", "#858f65"],
                    },
                    {
                      id: "latte",
                      name: "Latte",
                      colors: ["#665e79", "#e8e4ed", "#c69c74"],
                    },
                    {
                      id: "pine",
                      name: "Pine",
                      colors: ["#9bb596", "#253a30", "#c7926f"],
                    },
                  ].map((t) => (
                    <button
                      key={t.id}
                      className={`theme-option ${theme === t.id ? "chosen" : ""}`}
                      onClick={() => setTheme(t.id)}
                    >
                      <div className="swatches">
                        {t.colors.map((c) => (
                          <span style={{ background: c }} key={c} />
                        ))}
                      </div>
                      {t.name}
                      {theme === t.id && <Check size={15} />}
                    </button>
                  ))}
                </div>
              </section>
              <section className="settings-section">
                <h2>Trip</h2>
                <div className="section-actions">
                  <button
                    className="button"
                    onClick={() => setEditor({ kind: "trip", trip })}
                  >
                    Edit trip
                  </button>
                  <button
                    className="button"
                    onClick={() =>
                      setEditor({ kind: "trip", trip: newTrip(), isNew: true })
                    }
                  >
                    <Plus size={16} />
                    New trip
                  </button>
                  <button
                    className="button"
                    onClick={() => setEditor({ kind: "import" })}
                  >
                    <Upload size={16} />
                    Import reservations
                  </button>
                </div>
              </section>
              <MapsSettings />
              <section className="settings-section">
                <h2>Offline & sync</h2>
                <div className="settings-row">
                  <span>
                    {offlineReady
                      ? "Ready for offline use"
                      : import.meta.env.DEV
                        ? "Offline install available in production"
                        : "Preparing offline app"}
                  </span>
                  {install ? (
                    <button
                      className="button primary"
                      onClick={async () => {
                        await install.prompt();
                        setInstall(null);
                      }}
                    >
                      Install app
                    </button>
                  ) : (
                    <span className="tag">
                      {window.matchMedia("(display-mode: standalone)").matches
                        ? "Installed"
                        : "Browser menu → Install / Add to Home Screen"}
                    </span>
                  )}
                </div>
                <div className="settings-row">
                  <span>{statusLabel}</span>
                  <button className="button" onClick={() => void syncNow()}>
                    <RefreshCw size={16} />
                    Sync now
                  </button>
                </div>
                <AttachmentStatus workspace={data} />
                {state.message && (
                  <p className="sync-message">{state.message}</p>
                )}
              </section>
              <section className="settings-section">
                <h2>Backups</h2>
                <div className="section-actions">
                  <button className="button" onClick={backup}>
                    <Download size={16} />
                    Download backup
                  </button>
                  <label className="button">
                    <Upload size={16} />
                    Restore backup
                    <input
                      className="visually-hidden"
                      type="file"
                      aria-label="Restore backup file"
                      accept=".json"
                      onChange={async (e) => {
                        try {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 5 * 1024 * 1024)
                            throw Error("Backup exceeds 5 MB");
                          const value = JSON.parse(await file.text());
                          WorkspaceSchema.parse(value);
                          setRestore(value);
                          setRestoreError("");
                        } catch (err) {
                          setRestoreError(
                            err instanceof Error
                              ? err.message
                              : "Invalid backup",
                          );
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {restoreError && (
                  <p className="error" role="alert">
                    {restoreError}
                  </p>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
      {editor?.kind === "entry" && (
        <EntryEditor
          key={editor.entry.id}
          trip={trip}
          scenarioId={editor.scenarioId}
          places={data.places}
          initial={editor.entry}
          onClose={close}
          cities={tripCities}
        />
      )}
      {editor?.kind === "place" && (
        <PlaceEditor
          key={editor.place.id}
          initial={editor.place}
          onClose={close}
          cities={tripCities}
        />
      )}
      {editor?.kind === "trip" && (
        <TripEditor
          key={editor.trip.id}
          trip={editor.trip}
          isNew={editor.isNew}
          onClose={close}
        />
      )}
      {editor?.kind === "import" && (
        <Suspense fallback={null}>
          <ReservationImport trip={trip} onClose={close} />
        </Suspense>
      )}
      {editor?.kind === "task" && (
        <TaskEditor
          key={editor.task.id}
          trip={trip}
          task={editor.task}
          onClose={close}
        />
      )}
      {editor?.kind === "issues" && (
        <Modal title="Things to check" onClose={close}>
          <div className="issues-list">
            {issues.map((i) => (
              <button
                key={i.id}
                className="issue-row"
                onClick={() => fixIssue(i)}
              >
                <span className={`issue-icon ${i.kind}`}>
                  <AlertTriangle size={17} />
                </span>
                <span>
                  <strong>{i.title}</strong>
                  <span className="issue-detail">{i.detail}</span>
                  <span>
                    {shortDate(i.date)} ·{" "}
                    {i.kind === "transfer"
                      ? "Add the transport"
                      : i.kind === "stay-transfer"
                        ? "Add the local transfer"
                        : i.kind === "night"
                          ? "Add a stay"
                          : i.kind === "address"
                            ? "Open the stay to add details"
                            : i.kind === "timing"
                              ? "Open the plan to fix times"
                              : "Open the plan to adjust"}
                  </span>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
          {!issues.length && (
            <div className="empty-state">
              Your stays and transfers are connected.
            </div>
          )}
        </Modal>
      )}
      {restore && (
        <Modal title="Restore this backup?" onClose={() => setRestore(null)}>
          <p>
            Your current copy will be downloaded first. The backup replaces all
            trips and places on this device, then syncs to your server.
          </p>
          <div className="modal-footer">
            <button className="button" onClick={() => setRestore(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                backup();
                replaceWorkspace(WorkspaceSchema.parse(restore));
                setRestore(null);
              }}
            >
              Restore backup
            </button>
          </div>
        </Modal>
      )}
      {conflictOpen && state.conflict && (
        <Modal title="Choose a copy" onClose={() => setConflictOpen(false)}>
          <p>
            Both devices changed the plan. Your device copy will be downloaded
            as a backup before either choice.
          </p>
          <div className="modal-footer">
            <button
              className="button"
              onClick={() => {
                void resolveConflict("server");
                setConflictOpen(false);
              }}
            >
              Use server copy
            </button>
            <button
              className="button primary"
              onClick={() => {
                void resolveConflict("device");
                setConflictOpen(false);
              }}
            >
              Use this device’s copy
            </button>
          </div>
        </Modal>
      )}
      {sharing && trip && scenario && (
        <Suspense fallback={null}>
          <ShareImage
            trip={trip}
            scenario={scenario}
            countries={activeCountries}
            hidden={hiddenKinds}
            onClose={() => setSharing(false)}
          />
        </Suspense>
      )}
      {!sharing &&
        trip &&
        scenario &&
        localStorage.getItem("fieldnotes-share-used") && (
          <Suspense fallback={null}>
            <ShareWarmup
              trip={trip}
              scenario={scenario}
              countries={activeCountries}
              hidden={hiddenKinds}
            />
          </Suspense>
        )}
      {mapsList && trip && scenario && (
        <Suspense fallback={null}>
          <MapsListExport
            data={data}
            trip={trip}
            scenario={scenario}
            initial={
              tab === "hotels" ? "hotels" : tab === "food" ? "food" : "all"
            }
            onClose={() => setMapsList(false)}
          />
        </Suspense>
      )}
      {exporting && trip && scenario && (
        <Suspense fallback={null}>
          <CalendarExport
            trip={trip}
            scenario={scenario}
            hidden={hiddenKinds}
            onClose={() => setExporting(false)}
          />
        </Suspense>
      )}
      {state.toast && (
        <div className="toast" role="status" key={state.toast.id}>
          <span>{state.toast.text}</span>
          {state.toast.action && (
            <button
              className="text-button"
              onClick={state.toast.action === "undo" ? undo : redo}
            >
              {state.toast.action === "undo" ? (
                <Undo2 size={14} />
              ) : (
                <Redo2 size={14} />
              )}
              {state.toast.action === "undo" ? "Undo" : "Redo"}
            </button>
          )}
          <button
            className="icon-button small"
            aria-label="Dismiss"
            onClick={dismissToast}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

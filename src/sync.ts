import { useSyncExternalStore } from "react";
import { type Workspace, WorkspaceSchema } from "./model";
import { seedWorkspace } from "./seed";
import { needsLocation, placeSignature } from "./locate";
import { syncFiles } from "./attachments";
import { type Step, apply, describe, same } from "./history";
export type SyncStatus =
  "loading" | "saved" | "saving" | "offline" | "syncing" | "conflict" | "error";
type Stored = {
  data: Workspace;
  baseRevision: number | null;
  pending: boolean;
  edit: number;
};
type State = {
  data: Workspace | null;
  status: SyncStatus;
  message: string;
  conflict: { data: Workspace; revision: number } | null;
  // Short notice after deleting, undoing or redoing, with the opposite action.
  toast: { id: number; text: string; action: "undo" | "redo" | null } | null;
  canUndo: boolean;
  canRedo: boolean;
};
const listeners = new Set<() => void>();
let state: State = {
  data: null,
  status: "loading",
  message: "",
  conflict: null,
  toast: null,
  canUndo: false,
  canRedo: false,
};
let record: Stored | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
let persistence = Promise.resolve();
let syncing = false;
let ready = false;
let retryDelay = 1000;
let storageFailed = false;
let timer: ReturnType<typeof setTimeout> | undefined;
function emit(next: Partial<State>) {
  // Re-rendering the whole app is costly on phones; skip it when the
  // regular background check changes nothing.
  if (
    (Object.keys(next) as (keyof State)[]).every((k) => state[k] === next[k])
  )
    return;
  state = { ...state, ...next };
  listeners.forEach((f) => f());
}
function database() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("fieldnotes", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("workspace");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function read() {
  const db = await database();
  return new Promise<Stored | undefined>((resolve, reject) => {
    const req = db
      .transaction("workspace")
      .objectStore("workspace")
      .get("current");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function persist(snapshot: Stored) {
  const saved = structuredClone(snapshot);
  const write = async () => {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(saved, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  persistence = persistence.catch(() => {}).then(write);
  persistence
    .then(() => {
      storageFailed = false;
    })
    .catch(() => {
      storageFailed = true;
      emit({
        status: "error",
        message: "Device storage failed. Download a backup before closing.",
      });
    });
  return persistence;
}
async function request(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
}
export async function initialize() {
  if (ready) return;
  ready = true;
  try {
    const saved = await read();
    if (saved) {
      WorkspaceSchema.parse(saved.data);
      record = saved;
      emit({ data: saved.data, status: saved.pending ? "offline" : "saved" });
      void syncNow();
    } else {
      try {
        const res = await request("/api/workspace");
        if (!res.ok) throw Error("Server unavailable");
        const remote = await res.json();
        const data = WorkspaceSchema.parse(remote.data);
        record = {
          data,
          baseRevision: remote.revision,
          pending: false,
          edit: 0,
        };
        await persist(record);
        emit({ data, status: "saved" });
        void mergeLocations();
        void syncFiles(data);
      } catch {
        const data = seedWorkspace();
        record = { data, baseRevision: null, pending: false, edit: 0 };
        await persist(record);
        emit({
          data,
          status: "offline",
          message: "Draft loaded on this device. Connect before syncing.",
        });
      }
    }
  } catch (error) {
    emit({
      status: "error",
      message: `Could not open device storage: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
}
let undoStack: Step[] = [];
let redoStack: Step[] = [];
let toastId = 0;
// Save an edited workspace and schedule syncing.
function commit(data: Workspace, extra: Partial<State> = {}) {
  if (!record) return;
  record = { ...record, data, pending: true, edit: record.edit + 1 };
  emit({
    data,
    status: state.conflict ? "conflict" : "saving",
    message: "",
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    ...extra,
  });
  void persist(record).then(() => {
    if (state.status === "saving")
      emit({ status: navigator.onLine ? "syncing" : "offline" });
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 500);
  });
}
export function mutate(change: (draft: Workspace) => void) {
  if (!record) return;
  const before = record.data;
  const data = structuredClone(before);
  change(data);
  const parsed = WorkspaceSchema.safeParse(data);
  if (!parsed.success) {
    emit({ message: parsed.error.issues[0].message });
    return;
  }
  if (same(before, data)) return;
  const label = describe(before, data);
  let extra: Partial<State> = {};
  if (label) {
    const last = undoStack.at(-1);
    const now = Date.now();
    // Typing in a field makes one step, not one per keystroke.
    if (last && last.label === label && now - last.at < 1500) {
      last.after = data;
      last.at = now;
    } else
      undoStack = [...undoStack, { before, after: data, label, at: now }].slice(
        -60,
      );
    redoStack = [];
    if (label.startsWith("Delete"))
      extra = { toast: { id: ++toastId, text: label, action: "undo" } };
  }
  commit(data, extra);
}
function travel(from: Step[], to: Step[], undo: boolean) {
  if (!record) return;
  while (from.length) {
    const step = from.pop()!;
    const next = apply(
      record.data,
      undo ? step.after : step.before,
      undo ? step.before : step.after,
    ) as Workspace;
    // Already reversed by a later change, or no longer valid: skip it.
    if (same(next, record.data) || !WorkspaceSchema.safeParse(next).success)
      continue;
    to.push({ ...step, at: 0 });
    commit(next, {
      toast: {
        id: ++toastId,
        text: `${undo ? "Undid" : "Redid"}: ${step.label}`,
        action: undo ? "redo" : "undo",
      },
    });
    return;
  }
  emit({
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    toast: {
      id: ++toastId,
      text: undo ? "Nothing to undo" : "Nothing to redo",
      action: null,
    },
  });
}
export const undo = () => travel(undoStack, redoStack, true);
export const redo = () => travel(redoStack, undoStack, false);
export const dismissToast = () => emit({ toast: null });
// Confirm an edit made by dragging, with a way to take it back.
export const notify = (text: string) =>
  emit({
    toast: {
      id: ++toastId,
      text,
      action: undoStack.length ? "undo" : null,
    },
  });
export async function syncNow() {
  if (syncing || !record || state.conflict) return;
  syncing = true;
  clearTimeout(timer);
  try {
    await persistence;
    // A routine check with nothing to send stays quiet: no "syncing" status,
    // and the server answers "unchanged" instead of the whole workspace.
    const quiet = !record.pending && record.baseRevision !== null;
    if (!quiet) emit({ status: "syncing", message: "" });
    const res = await request(
      quiet ? `/api/workspace?since=${record.baseRevision}` : "/api/workspace",
    );
    if (!res.ok) throw Error(`Server returned ${res.status}`);
    const remote = await res.json();
    if (remote.unchanged && remote.revision === record.baseRevision) {
      retryDelay = 1000;
      emit({ status: "saved", message: "" });
      return;
    }
    const remoteData = WorkspaceSchema.parse(remote.data);
    if (record.baseRevision === null) {
      if (record.pending) {
        emit({
          status: "conflict",
          conflict: { data: remoteData, revision: remote.revision },
          message:
            "This device has an offline draft. Choose which copy to use.",
        });
        return;
      }
      record = {
        data: remoteData,
        baseRevision: remote.revision,
        pending: false,
        edit: record.edit,
      };
      emit({ data: remoteData, status: "saved" });
      await persist(record);
      return;
    }
    if (!record.pending) {
      if (remote.revision !== record.baseRevision) {
        record = {
          data: remoteData,
          baseRevision: remote.revision,
          pending: false,
          edit: record.edit,
        };
        emit({ data: remoteData, status: "saved" });
        await persist(record);
      } else emit({ status: "saved" });
      return;
    }
    if (remote.revision !== record.baseRevision) {
      emit({
        status: "conflict",
        conflict: { data: remoteData, revision: remote.revision },
        message:
          "Another device changed the plan. Both copies are preserved until you choose.",
      });
      return;
    }
    while (record.pending) {
      const snapshot: Stored = structuredClone(record);
      const put = await request("/api/workspace", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(snapshot.baseRevision),
        },
        body: JSON.stringify({ data: snapshot.data }),
      });
      if (put.status === 409) {
        const conflict = await put.json();
        emit({
          status: "conflict",
          conflict: {
            data: WorkspaceSchema.parse(conflict.data),
            revision: conflict.revision,
          },
          message: "Another device changed the plan.",
        });
        return;
      }
      if (!put.ok) throw Error(`Save failed (${put.status})`);
      const saved = await put.json();
      record = {
        ...record,
        baseRevision: saved.revision,
        pending: record.edit !== snapshot.edit,
      };
      await persist(record);
    }
    retryDelay = 1000;
    emit({ status: "saved" });
  } catch (error) {
    if (storageFailed)
      emit({
        status: "error",
        message: "Device storage failed. Download a backup before closing.",
      });
    else
      emit({
        status: "offline",
        message: navigator.onLine
          ? `Server unreachable. Changes saved on this device. ${error instanceof Error ? error.message : ""}`
          : "Changes saved on this device.",
      });
  } finally {
    syncing = false;
    if (state.status === "saved") {
      void mergeLocations();
      if (record) void syncFiles(record.data);
    }
    if (state.status === "offline" && navigator.onLine) {
      timer = setTimeout(() => void syncNow(), retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  }
}
type PlaceLocation = {
  signature: string;
  lat: number;
  lng: number;
  geo: "auto" | "approx" | "failed";
  address: string;
};
let locationTimer: ReturnType<typeof setTimeout> | undefined;
// Fill in coordinates found by the server's background locator. This is a
// derived local fill, not an edit: it does not mark the workspace pending or
// change its revision, so it cannot conflict with another device. The values
// are saved to the server with the next real edit.
async function mergeLocations() {
  clearTimeout(locationTimer);
  if (!record || !record.data.places.some(needsLocation)) return;
  try {
    const res = await request("/api/locations");
    if (!res.ok) return;
    const found = (await res.json()) as Record<string, PlaceLocation>;
    if (!record) return;
    const data = structuredClone(record.data);
    let changed = false;
    for (const p of data.places) {
      const f = found[p.id];
      if (!needsLocation(p) || !f || f.signature !== placeSignature(p))
        continue;
      changed = true;
      p.geo = f.geo;
      if (f.geo === "failed") continue;
      p.lat = f.lat;
      p.lng = f.lng;
      if (!p.address && f.geo === "auto" && p.kind !== "hotel")
        p.address = f.address;
    }
    if (changed && WorkspaceSchema.safeParse(data).success) {
      record = { ...record, data };
      emit({ data });
      await persist(record);
    }
  } catch {
    // Offline or server unreachable; retried below.
  }
  // Keep checking while the server is still locating places.
  if (record?.data.places.some(needsLocation))
    locationTimer = setTimeout(() => void mergeLocations(), 15000);
}
export function download(
  name: string,
  content: BlobPart,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function backup() {
  if (record)
    download(
      `fieldnotes-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(record.data, null, 2),
    );
}
export async function resolveConflict(choice: "server" | "device") {
  if (!record || !state.conflict) return;
  const remote = state.conflict;
  // Always download the local copy before explicitly resolving a conflict.
  backup();
  record =
    choice === "server"
      ? {
          data: remote.data,
          baseRevision: remote.revision,
          pending: false,
          edit: record.edit + 1,
        }
      : {
          ...record,
          baseRevision: remote.revision,
          pending: true,
          edit: record.edit + 1,
        };
  emit({
    data: record.data,
    conflict: null,
    status: choice === "server" ? "saved" : "syncing",
    message: "",
  });
  await persist(record);
  if (choice === "device") void syncNow();
}
export function replaceWorkspace(data: Workspace) {
  WorkspaceSchema.parse(data);
  mutate((draft) => {
    Object.assign(draft, data);
  });
}
export function useWorkspace() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
  );
}
window.addEventListener("online", () => void syncNow());
window.addEventListener("offline", () => {
  if (record) emit({ status: "offline" });
});
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void syncNow();
});
setInterval(() => {
  if (record && !state.conflict && navigator.onLine) void syncNow();
}, 30000);

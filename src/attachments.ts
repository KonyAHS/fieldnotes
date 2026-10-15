// Device copies of attachment files, so tickets open without a connection.
// Files added on this device wait here until they are uploaded; files added
// on other devices are downloaded in the background after each sync.
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type Attachment,
  type Workspace,
  attachmentsIn,
  maxAttachmentBytes,
  uid,
} from "./model";
type Stored = {
  blob: Blob;
  name: string;
  type: string;
  uploaded: boolean;
  added: number;
};
let dbPromise: Promise<IDBDatabase> | null = null;
function database() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("fieldnotes-files", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction("files", mode);
    const req = run(t.objectStore("files"));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const get = (id: string) => tx<Stored | undefined>("readonly", (s) => s.get(id));
const put = (id: string, v: Stored) => tx("readwrite", (s) => s.put(v, id));
const keys = () => tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
const remove = (id: string) => tx("readwrite", (s) => s.delete(id));
// Which files this device holds, and which still wait to upload, for the UI.
type Local = { have: Set<string>; waiting: Set<string>; busy: boolean };
let local: Local = { have: new Set(), waiting: new Set(), busy: false };
const listeners = new Set<() => void>();
async function refresh(busy = local.busy) {
  const db = await database();
  const have = new Set<string>(),
    waiting = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction("files").objectStore("files").openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      have.add(String(c.key));
      if (!(c.value as Stored).uploaded) waiting.add(String(c.key));
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  local = { have, waiting, busy };
  listeners.forEach((f) => f());
}
export function useLocalFiles() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => local,
  );
}
// Stores a picked file on this device and describes it for the plan.
export async function addFile(file: File): Promise<Attachment> {
  if (file.size > maxAttachmentBytes)
    throw Error(`${file.name} is larger than 25 MB`);
  const id = uid();
  const type = file.type || "application/octet-stream";
  await put(id, {
    blob: file,
    name: file.name,
    type,
    uploaded: false,
    added: Date.now(),
  });
  void refresh();
  // Ask the browser not to clear stored files when space runs low.
  void navigator.storage?.persist?.();
  return {
    id,
    name: (file.name || "attachment").slice(0, 300),
    type: type.slice(0, 300),
    size: file.size,
    added: new Date().toISOString(),
  };
}
export async function fileBlob(a: Attachment): Promise<Blob> {
  const found = await get(a.id).catch(() => undefined);
  if (found) return found.blob;
  const res = await fetch(`/api/attachments/${a.id}`, {
    signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  if (!res?.ok)
    throw Error(
      res
        ? "This file is not on the server yet. It uploads when the device that added it is online."
        : "This file hasn't been downloaded to this device yet. Connect once to make it available offline.",
    );
  const blob = await res.blob();
  await put(a.id, {
    blob,
    name: a.name,
    type: a.type,
    uploaded: true,
    added: Date.now(),
  }).catch(() => {});
  void refresh();
  return blob;
}
export function useFileUrl(a: Attachment | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!a) return;
    let current: string | null = null,
      cancelled = false;
    setUrl(null);
    setError("");
    fileBlob(a)
      .then((b) => {
        if (cancelled) return;
        current = URL.createObjectURL(
          b.type ? b : new Blob([b], { type: a.type }),
        );
        setUrl(current);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [a?.id]);
  return { url, error };
}
let running: Promise<void> | null = null;
let again: Workspace | null = null;
// Uploads waiting files, downloads missing ones and removes files no plan
// uses any more. Runs after each successful sync.
export function syncFiles(w: Workspace) {
  if (running) {
    again = w;
    return running;
  }
  running = (async () => {
    try {
      await refresh(true);
      const wanted = new Map(attachmentsIn(w).map((a) => [a.id, a]));
      for (const id of await keys()) {
        const key = String(id);
        const f = await get(key);
        if (!f) continue;
        if (!f.uploaded) {
          // Files picked in an editor that was cancelled are dropped after a
          // day; files on plans are uploaded.
          if (!wanted.has(key)) {
            if (Date.now() - f.added > 86400000) await remove(key);
            continue;
          }
          const res = await fetch(`/api/attachments/${key}`, {
            method: "PUT",
            headers: {
              "Content-Type": f.type,
              "X-File-Name": encodeURIComponent(f.name),
            },
            body: f.blob,
            signal: AbortSignal.timeout(120000),
          });
          if (!res.ok) throw Error(`Upload failed (${res.status})`);
          await put(key, { ...f, uploaded: true });
        } else if (!wanted.has(key)) await remove(key);
      }
      const have = new Set((await keys()).map(String));
      for (const a of wanted.values()) {
        if (have.has(a.id)) continue;
        const res = await fetch(`/api/attachments/${a.id}`, {
          signal: AbortSignal.timeout(120000),
        });
        // Not uploaded yet by the device that added it; try next time.
        if (!res.ok) continue;
        await put(a.id, {
          blob: await res.blob(),
          name: a.name,
          type: a.type,
          uploaded: true,
          added: Date.now(),
        });
      }
    } catch {
      // Offline or server unreachable; the next sync retries.
    } finally {
      running = null;
      await refresh(false).catch(() => {});
      if (again) {
        const next = again;
        again = null;
        void syncFiles(next);
      }
    }
  })();
  return running;
}
export const fileSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
void refresh().catch(() => {});

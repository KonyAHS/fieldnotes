import { useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { type MapsStatus, mapsStatus } from "../geo";
async function update(change: {
  provider?: "osm" | "google";
  googleKey?: string | null;
}): Promise<MapsStatus> {
  const res = await fetch("/api/maps", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Error(body?.error || "Couldn't save the setting");
  return body;
}
export function MapsSettings() {
  const [status, setStatus] = useState<MapsStatus | null>(null);
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void mapsStatus(true).then(setStatus);
  }, []);
  async function run(change: Parameters<typeof update>[0]) {
    setBusy(true);
    setError("");
    try {
      const next = await update(change);
      setStatus(next);
      // Refresh the shared copy used by search fields.
      void mapsStatus(true);
      setKey("");
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the setting");
    } finally {
      setBusy(false);
    }
  }
  const google = status?.google.configured;
  return (
    <section className="settings-section">
      <h2>Maps & places</h2>
      <div className="settings-row">
        <span>Place search, restaurants and Google Maps links use</span>
        <div className="segmented">
          <button
            className={status?.provider !== "google" ? "selected" : ""}
            disabled={busy || !status}
            onClick={() => void run({ provider: "osm" })}
          >
            OpenStreetMap
          </button>
          <button
            className={status?.provider === "google" ? "selected" : ""}
            disabled={busy || !google}
            title={google ? "" : "Add a Google Maps API key first"}
            onClick={() => void run({ provider: "google" })}
          >
            Google Maps
          </button>
        </div>
      </div>
      {google && !editing ? (
        <div className="settings-row">
          <span>
            <KeyRound size={14} /> Google Maps API key ending{" "}
            <code>{status!.google.hint}</code>, stored on the server only
          </span>
          <div className="section-actions">
            <button className="button" onClick={() => setEditing(true)}>
              Replace
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void run({ googleKey: null })}
            >
              <Trash2 size={15} />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <form
          className="maps-key-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ googleKey: key.trim() });
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="Google Maps API key"
            placeholder="Google Maps API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            className="button primary"
            type="submit"
            disabled={busy || key.trim().length < 20}
          >
            {busy ? "Checking…" : "Save key"}
          </button>
          {editing && (
            <button
              className="button"
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          )}
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="settings-hint">
        OpenStreetMap is free and needs no key. Google Maps usually finds more
        places and has phone numbers, websites and opening hours, but needs an
        API key with <strong>Places API (New)</strong> enabled in Google Cloud,
        and Google bills usage beyond its monthly free allowance. Restrict the
        key to the Places API. The key is checked with one test search, kept in
        a private file on the server and never sent to your browser. Trails and
        the maps themselves always come from OpenStreetMap.
      </p>
    </section>
  );
}

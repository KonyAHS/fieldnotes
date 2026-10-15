import { useEffect, useState } from "react";
import { Upload, ExternalLink, Mail, RefreshCw } from "lucide-react";
import { Modal } from "./Modal";
import { Field, entryLabels } from "./Editors";
import {
  importCalendar,
  importConfirmation,
  importEmail,
  type ImportCandidate,
  type ReservationEmail,
} from "../imports";
import {
  type Trip,
  type Entry,
  EntrySchema,
  zone,
  currency,
  shortDate,
} from "../model";
import { mutate } from "../sync";
export function ReservationImport({
  trip,
  onClose,
}: {
  trip: Trip;
  onClose: () => void;
}) {
  const [mode, setMode] = useState("calendar");
  const [text, setText] = useState("");
  const [country, setCountry] = useState("Japan");
  const [city, setCity] = useState("");
  const [type, setType] = useState<Entry["type"]>("stay");
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<{
    configured: boolean;
    host?: string;
    user?: string;
  } | null>(null);
  const [login, setLogin] = useState({
    host: "imap.gmail.com",
    user: "",
    password: "",
  });
  const [busy, setBusy] = useState("");
  const active = trip.scenarios.find((s) => s.id === trip.activeScenarioId)!;
  useEffect(() => {
    if (mode !== "mailbox" || account) return;
    fetch("/api/mailbox")
      .then((r) => r.json())
      .then(setAccount)
      .catch(() => setError("Server unreachable. Connect to check email."));
  }, [mode]);
  async function api(path: string, method: string, body?: object) {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120000),
    });
    const value = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(value.error || `Request failed (${res.status})`);
    return value;
  }
  async function connect() {
    setBusy("Signing in…");
    setError("");
    try {
      setAccount(await api("/api/mailbox", "PUT", { ...login, port: 993 }));
      setLogin((l) => ({ ...l, password: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect");
    } finally {
      setBusy("");
    }
  }
  async function disconnect() {
    try {
      setAccount(await api("/api/mailbox", "DELETE"));
      setCandidates([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect");
    }
  }
  async function scan() {
    setBusy("Checking your mailbox…");
    setError("");
    try {
      const since = new Date(Date.now() - 365 * 86400000).toISOString();
      const { emails } = (await api("/api/mailbox/scan", "POST", {
        since,
      })) as { emails: ReservationEmail[] };
      const known = (c: ImportCandidate) =>
        active.entries.some(
          (e) =>
            e.notes.includes(`Imported email ID: ${c.sourceUid}`) ||
            (!!c.entry.bookingRef && e.bookingRef === c.entry.bookingRef),
        );
      const items = emails
        .map((m) => importEmail(m, country, city))
        // Keep reservations that touch this trip, or that need a date check.
        .filter(
          (c) =>
            !c.entry.date ||
            !c.entry.endDate ||
            (c.entry.date <= trip.end && c.entry.endDate >= trip.start),
        )
        .map((c) => ({ ...c, selected: c.selected && !known(c) }));
      setCandidates(items);
      if (!items.length)
        setError(
          emails.length
            ? `${emails.length} Booking.com/Airbnb emails found, none for these trip dates.`
            : "No Booking.com or Airbnb emails in the last year.",
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mailbox check failed");
    } finally {
      setBusy("");
    }
  }
  function preview(value = text) {
    try {
      const items =
        mode === "calendar"
          ? importCalendar(value, country, city, type)
          : [importConfirmation(value, country, city)];
      setCandidates(
        items.map((c) => ({
          ...c,
          selected:
            c.selected &&
            (!c.sourceUid ||
              !active.entries.some((e) =>
                e.notes.includes(`Imported calendar UID: ${c.sourceUid}`),
              )),
        })),
      );
      if (!items.length) setError("No reservations found.");
      else setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this file");
    }
  }
  function update(i: number, change: (c: ImportCandidate) => ImportCandidate) {
    setCandidates((v) => v.map((c, j) => (i === j ? change(c) : c)));
  }
  function save() {
    const selected = candidates.filter((c) => c.selected);
    if (!selected.length) {
      setError("Select a reservation to import.");
      return;
    }
    for (const c of selected) {
      const parsed = EntrySchema.safeParse(c.entry);
      if (!parsed.success) {
        setError(
          `${c.entry.title || "Reservation"}: ${parsed.error.issues[0].message}`,
        );
        return;
      }
      if (c.place && !c.place.name.trim()) {
        setError("Enter the property name.");
        return;
      }
    }
    mutate((d) => {
      const scenario = d.trips
        .find((t) => t.id === trip.id)!
        .scenarios.find((s) => s.id === trip.activeScenarioId)!;
      for (const c of selected) {
        scenario.entries.push(c.entry);
        if (c.place) d.places.push(c.place);
      }
    });
    onClose();
  }
  return (
    <Modal title="Import reservations" wide onClose={onClose}>
      <div className="segmented import-modes">
        <button
          className={mode === "calendar" ? "selected" : ""}
          onClick={() => {
            setMode("calendar");
            setCandidates([]);
            setText("");
          }}
        >
          Calendar file
        </button>
        <button
          className={mode === "confirmation" ? "selected" : ""}
          onClick={() => {
            setMode("confirmation");
            setCandidates([]);
            setText("");
          }}
        >
          Confirmation text
        </button>
        <button
          className={mode === "mailbox" ? "selected" : ""}
          onClick={() => {
            setMode("mailbox");
            setCandidates([]);
            setError("");
          }}
        >
          Booking & Airbnb email
        </button>
      </div>
      <div className="form-grid">
        <Field label="Country">
          <input value={country} onChange={(e) => setCountry(e.target.value)} />
        </Field>
        <Field label="City">
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        {mode === "calendar" && (
          <Field label="Import as" full>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Entry["type"])}
            >
              {Object.entries(entryLabels).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {mode === "mailbox" ? (
        <div className="mailbox">
          {!account ? (
            <p className="food-hint">Checking connection…</p>
          ) : account.configured ? (
            <div className="settings-row">
              <span>
                <Mail size={15} /> Connected to <strong>{account.user}</strong>
              </span>
              <div className="spacer" />
              <button className="text-button" onClick={disconnect}>
                Disconnect
              </button>
              <button
                className="button primary"
                onClick={scan}
                disabled={!!busy}
              >
                <RefreshCw size={15} className={busy ? "spin" : ""} />
                {busy || "Find reservations"}
              </button>
            </div>
          ) : (
            <>
              <p className="food-hint">
                Booking.com and Airbnb have no guest-account API, so Fieldnotes
                reads their confirmation emails from your mailbox instead. It
                only searches messages from booking.com and airbnb.com, never
                changes your mail, and shows every reservation for review before
                importing. Use an <strong>app password</strong>: for Gmail, turn
                on 2-Step Verification and create one at{" "}
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google app passwords
                  <ExternalLink size={12} />
                </a>
                . It is stored only on your server and can be revoked anytime.
              </p>
              <div className="form-grid">
                <Field label="Email address">
                  <input
                    type="email"
                    autoComplete="username"
                    value={login.user}
                    onChange={(e) =>
                      setLogin({ ...login, user: e.target.value })
                    }
                  />
                </Field>
                <Field label="App password">
                  <input
                    type="password"
                    autoComplete="off"
                    value={login.password}
                    onChange={(e) =>
                      setLogin({ ...login, password: e.target.value })
                    }
                  />
                </Field>
                <Field label="Mail server (IMAP)" full>
                  <input
                    value={login.host}
                    onChange={(e) =>
                      setLogin({ ...login, host: e.target.value })
                    }
                  />
                </Field>
              </div>
              <button
                className="button primary"
                onClick={connect}
                disabled={!!busy || !login.user || !login.password}
              >
                <Mail size={15} />
                {busy || "Connect mailbox"}
              </button>
            </>
          )}
        </div>
      ) : mode === "calendar" ? (
        <label className="file-drop">
          <Upload size={22} />
          <span>Choose an .ics reservation file</span>
          <input
            aria-label="Reservation calendar file"
            type="file"
            accept=".ics,text/calendar"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 1000000) {
                setError("Choose a file under 1 MB");
                return;
              }
              const value = await file.text();
              setText(value);
              preview(value);
            }}
          />
        </label>
      ) : (
        <>
          <Field label="Paste the confirmation" full>
            <textarea
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "Hotel: …\nCheck-in: 2026-10-28\nCheck-out: 2026-11-01\nAddress: …\nPhone: …\nConfirmation: …"
              }
            />
          </Field>
          <button className="button" onClick={() => preview()}>
            Preview details
          </button>
        </>
      )}
      {candidates.map((c, i) => (
        <div className="import-candidate" key={c.entry.id}>
          <label className="check-field">
            <input
              type="checkbox"
              checked={c.selected}
              onChange={(e) =>
                update(i, (c) => ({ ...c, selected: e.target.checked }))
              }
            />
            Import this reservation
          </label>
          {mode === "mailbox" && (
            <p className="food-hint">
              {c.entry.notes.split("\n")[0]}
              {!c.selected &&
                (/cancel/i.test(c.entry.notes.split("\n")[0])
                  ? " · cancellation"
                  : !c.entry.date || !c.entry.endDate
                    ? " · check the dates"
                    : " · already imported or needs review")}
            </p>
          )}
          <div className="form-grid">
            <Field label="Name" full>
              <input
                value={c.entry.title}
                onChange={(e) =>
                  update(i, (c) => ({
                    ...c,
                    entry: { ...c.entry, title: e.target.value },
                    place: c.place
                      ? { ...c.place, name: e.target.value }
                      : undefined,
                  }))
                }
              />
            </Field>
            <Field label={c.entry.type === "stay" ? "Check-in" : "Date"}>
              <input
                type="date"
                value={c.entry.date}
                onChange={(e) =>
                  update(i, (c) => ({
                    ...c,
                    entry: { ...c.entry, date: e.target.value },
                  }))
                }
              />
            </Field>
            <Field label={c.entry.type === "stay" ? "Checkout" : "End date"}>
              <input
                type="date"
                value={c.entry.endDate}
                onChange={(e) =>
                  update(i, (c) => ({
                    ...c,
                    entry: { ...c.entry, endDate: e.target.value },
                  }))
                }
              />
            </Field>
            <Field label="Country">
              <input
                value={c.entry.country}
                onChange={(e) =>
                  update(i, (c) => ({
                    ...c,
                    entry: {
                      ...c.entry,
                      country: e.target.value,
                      timezone: zone(e.target.value),
                      endTimezone: zone(e.target.value),
                      currency: currency(e.target.value),
                    },
                    place: c.place
                      ? { ...c.place, country: e.target.value }
                      : undefined,
                  }))
                }
              />
            </Field>
            <Field label="City">
              <input
                value={c.entry.city}
                onChange={(e) =>
                  update(i, (c) => ({
                    ...c,
                    entry: { ...c.entry, city: e.target.value },
                    place: c.place
                      ? { ...c.place, city: e.target.value }
                      : undefined,
                  }))
                }
              />
            </Field>
            {c.place && (
              <>
                <Field label="Address" full>
                  <input
                    value={c.place.address}
                    onChange={(e) =>
                      update(i, (c) => ({
                        ...c,
                        place: { ...c.place!, address: e.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Phone">
                  <input
                    value={c.place.phone}
                    onChange={(e) =>
                      update(i, (c) => ({
                        ...c,
                        place: { ...c.place!, phone: e.target.value },
                      }))
                    }
                  />
                </Field>
              </>
            )}
            <Field label="Status">
              <select
                value={c.entry.status}
                onChange={(e) =>
                  update(i, (c) => ({
                    ...c,
                    entry: {
                      ...c.entry,
                      status: e.target.value as Entry["status"],
                    },
                  }))
                }
              >
                <option value="planned">Planned</option>
                <option value="booked">Booked</option>
              </select>
            </Field>
          </div>
        </div>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <details className="form-details">
        <summary>Your provider accounts</summary>
        <p>
          Booking.com and Airbnb don't let other apps sign in to guest accounts.
          Use “Booking & Airbnb email” to import from your confirmations, or
          open your trips directly:
        </p>
        <div className="map-links">
          <a
            href="https://www.booking.com/myreservations.html"
            target="_blank"
            rel="noreferrer"
          >
            Booking.com trips
            <ExternalLink size={13} />
          </a>
          <a
            href="https://www.airbnb.com/trips"
            target="_blank"
            rel="noreferrer"
          >
            Airbnb trips
            <ExternalLink size={13} />
          </a>
        </div>
      </details>
      <div className="modal-footer">
        <div className="spacer" />
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!candidates.some((c) => c.selected)}
          onClick={save}
        >
          Import {candidates.filter((c) => c.selected).length || ""}{" "}
          reservations
        </button>
      </div>
    </Modal>
  );
}

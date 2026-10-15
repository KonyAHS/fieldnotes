import { useState } from "react";
import { Copy, Plus, Check, Pencil, Trash2 } from "lucide-react";
import {
  type Trip,
  type Scenario,
  type Entry,
  cloneScenario,
  uid,
  days,
  entriesOn,
  shortDate,
} from "../model";
import { mutate } from "../sync";
import { Modal } from "./Modal";
import { Field } from "./Editors";
export function Scenarios({
  trip,
  onEdit,
  onSelect,
}: {
  trip: Trip;
  onEdit: (e: Entry, scenarioId: string) => void;
  onSelect: (s: Scenario) => void;
}) {
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>(
    trip.scenarios.slice(0, 2).map((s) => s.id),
  );
  const active = trip.scenarios.find((s) => s.id === trip.activeScenarioId)!;
  function save() {
    if (!editing?.name.trim()) return;
    mutate((d) => {
      const t = d.trips.find((t) => t.id === trip.id)!;
      const i = t.scenarios.findIndex((s) => s.id === editing.id);
      if (i < 0) t.scenarios.push(editing);
      else t.scenarios[i] = editing;
    });
    setEditing(null);
  }
  return (
    <div>
      <div className="section-actions">
        <button
          className="button"
          onClick={() =>
            setEditing(cloneScenario(active, `${active.name} · copy`))
          }
        >
          <Copy size={16} />
          Duplicate active plan
        </button>
        <button
          className="button"
          onClick={() =>
            setEditing({ id: uid(), name: "", description: "", entries: [] })
          }
        >
          <Plus size={16} />
          Blank scenario
        </button>
      </div>
      <div className="scenario-cards">
        {trip.scenarios.map((s) => (
          <article
            key={s.id}
            className={`scenario-card ${s.id === trip.activeScenarioId ? "active" : ""}`}
          >
            <div className="scenario-card-top">
              <h3>{s.name}</h3>
              <button
                className="icon-button"
                aria-label={`Edit ${s.name}`}
                onClick={() => setEditing(structuredClone(s))}
              >
                <Pencil size={15} />
              </button>
              {trip.scenarios.length > 1 && (
                <button
                  className="icon-button"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => setDeleting(s.id)}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            {s.description && <p>{s.description}</p>}
            <div className="scenario-card-bottom">
              <span>{s.entries.length} plans</span>
              <button
                className={`button ${s.id === trip.activeScenarioId ? "active-button" : ""}`}
                onClick={() => onSelect(s)}
              >
                {s.id === trip.activeScenarioId ? (
                  <>
                    <Check size={15} />
                    Active
                  </>
                ) : (
                  "Use this plan"
                )}
              </button>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={compare.includes(s.id)}
                onChange={(e) =>
                  setCompare((v) =>
                    e.target.checked
                      ? [...v, s.id]
                      : v.filter((id) => id !== s.id),
                  )
                }
              />
              Compare
            </label>
          </article>
        ))}
      </div>
      {compare.length > 1 && (
        <div className="comparison">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                {trip.scenarios
                  .filter((s) => compare.includes(s.id))
                  .map((s) => (
                    <th key={s.id}>{s.name}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {days(trip.start, trip.end).map((date) => (
                <tr key={date}>
                  <th>{shortDate(date)}</th>
                  {trip.scenarios
                    .filter((s) => compare.includes(s.id))
                    .map((s) => (
                      <td key={s.id}>
                        {entriesOn(s, date).map((e) => (
                          <button
                            className={`compare-entry event-${e.type}`}
                            key={e.id}
                            onClick={() => onEdit(e, s.id)}
                          >
                            {e.title}
                          </button>
                        ))}
                        {!entriesOn(s, date).length && "—"}
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <Modal title="Scenario" onClose={() => setEditing(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="form-grid">
              <Field label="Name" full>
                <input
                  autoFocus
                  required
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Notes" full>
                <textarea
                  rows={3}
                  value={editing.description}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="modal-footer">
              <div className="spacer" />
              <button
                type="button"
                className="button"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button className="button primary">Save scenario</button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete scenario?" onClose={() => setDeleting(null)}>
          <p>
            This removes this scenario and its plans from all synced devices.
          </p>
          <div className="modal-footer">
            <button className="button" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              className="button danger"
              onClick={() => {
                mutate((d) => {
                  const t = d.trips.find((t) => t.id === trip.id)!;
                  t.scenarios = t.scenarios.filter((s) => s.id !== deleting);
                  if (t.activeScenarioId === deleting)
                    t.activeScenarioId = t.scenarios[0].id;
                });
                setCompare((v) => v.filter((id) => id !== deleting));
                setDeleting(null);
              }}
            >
              Delete scenario
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

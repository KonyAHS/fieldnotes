import { useState } from "react";
import {
  Star,
  GripVertical,
  ExternalLink,
  CalendarDays,
  Plus,
  StickyNote,
  X,
} from "lucide-react";
import {
  type Task,
  type Trip,
  uid,
  safeUrl,
  shortDate,
  weekday,
  taskTripDate,
  dueText,
} from "../model";
import { mutate } from "../sync";
const localToday = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
type Order = "mine" | "date";
// The trip's to-do list: star what to work on today, drag to reorder, and
// set or change due dates right in the list.
export function TaskList({
  trip,
  onEditTask,
}: {
  trip: Trip;
  onEditTask: (t: Task) => void;
}) {
  const today = localToday();
  const [draft, setDraft] = useState("");
  const [order, setOrder] = useState<Order>(
    () =>
      (localStorage.getItem("fieldnotes-task-order") as Order | null) || "mine",
  );
  const [dating, setDating] = useState("");
  const [dragging, setDragging] = useState("");
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const update = (id: string, change: (t: Task) => void) =>
    mutate((d) => {
      const t = d.trips
        .find((x) => x.id === trip.id)!
        .tasks.find((x) => x.id === id);
      if (t) change(t);
    });
  const move = (id: string, target: string, after: boolean) =>
    mutate((d) => {
      const list = d.trips.find((x) => x.id === trip.id)!.tasks;
      const from = list.findIndex((t) => t.id === id);
      if (from < 0 || id === target) return;
      const [task] = list.splice(from, 1);
      const to = list.findIndex((t) => t.id === target);
      list.splice(to < 0 ? list.length : to + (after ? 1 : 0), 0, task);
    });
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    mutate((d) => {
      d.trips
        .find((x) => x.id === trip.id)!
        .tasks.unshift({
          id: uid(),
          title,
          due: "",
          done: false,
          country: "",
          url: "",
        });
    });
    setDraft("");
  };
  // When a task matters: its due date, or else the trip day it names.
  const tripDay = (t: Task) => taskTripDate(t.title, trip);
  const when = (t: Task) => t.due || tripDay(t) || "9999";
  const sorted = (list: Task[]) =>
    order === "date"
      ? [...list].sort((a, b) => when(a).localeCompare(when(b)))
      : list;
  const open = trip.tasks.filter((t) => !t.done);
  const focus = sorted(open.filter((t) => t.today));
  const rest = sorted(open.filter((t) => !t.today));
  const done = trip.tasks.filter((t) => t.done);
  const overdue = open.filter((t) => t.due && t.due < today).length;
  const row = (t: Task) => {
    const day = tripDay(t);
    const late = !t.done && t.due && t.due < today;
    const soon =
      !t.done &&
      t.due &&
      !late &&
      Date.parse(t.due) - Date.parse(today) <= 3 * 86400000;
    return (
      <div
        key={t.id}
        className={`task-row ${t.done ? "done" : ""} ${t.today ? "focus" : ""} ${dragging === t.id ? "dragging" : ""} ${over?.id === t.id ? (over.after ? "drop-after" : "drop-before") : ""}`}
        onDragOver={(e) => {
          if (!dragging || dragging === t.id || order !== "mine") return;
          e.preventDefault();
          const box = e.currentTarget.getBoundingClientRect();
          const after = e.clientY > box.top + box.height / 2;
          if (over?.id !== t.id || over.after !== after)
            setOver({ id: t.id, after });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging && over) move(dragging, over.id, over.after);
          setDragging("");
          setOver(null);
        }}
      >
        {order === "mine" && !t.done ? (
          <span
            className="task-grip"
            draggable
            title="Drag to reorder (Alt+↑/↓ with the keyboard)"
            tabIndex={0}
            aria-label={`Move ${t.title}`}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", t.id);
              setDragging(t.id);
            }}
            onDragEnd={() => {
              setDragging("");
              setOver(null);
            }}
            onKeyDown={(e) => {
              if (!e.altKey) return;
              const list = trip.tasks;
              const i = list.findIndex((x) => x.id === t.id);
              if (e.key === "ArrowUp" && i > 0) {
                e.preventDefault();
                move(t.id, list[i - 1].id, false);
              }
              if (e.key === "ArrowDown" && i < list.length - 1) {
                e.preventDefault();
                move(t.id, list[i + 1].id, true);
              }
            }}
          >
            <GripVertical size={14} />
          </span>
        ) : (
          <span className="task-grip placeholder" />
        )}
        <input
          type="checkbox"
          aria-label={`Complete ${t.title}`}
          checked={t.done}
          onChange={(e) =>
            update(t.id, (x) => {
              x.done = e.target.checked;
              if (x.done) delete x.today;
            })
          }
        />
        {!t.done && (
          <button
            className={`task-star ${t.today ? "on" : ""}`}
            aria-pressed={!!t.today}
            aria-label={t.today ? "Remove from today" : "Work on this today"}
            title={t.today ? "Remove from today" : "Work on this today"}
            onClick={() =>
              update(t.id, (x) => {
                if (x.today) delete x.today;
                else x.today = true;
              })
            }
          >
            <Star size={15} />
          </button>
        )}
        <button className="task-title" onClick={() => onEditTask(t)}>
          {t.title}
          {t.notes?.trim() && (
            <StickyNote
              size={12}
              className="task-has-notes"
              aria-label="Has notes"
            />
          )}
        </button>
        <span className="task-meta">
          {t.country && <span className="tag">{t.country}</span>}
          {day && (
            <span className="task-for" title="The trip day this task is about">
              For {weekday(day)} {shortDate(day)}
            </span>
          )}
          {dating === t.id ? (
            <span className="task-date-edit">
              <input
                type="date"
                autoFocus
                aria-label="Due date"
                value={t.due}
                max={trip.end}
                onChange={(e) => update(t.id, (x) => (x.due = e.target.value))}
                onBlur={() => setDating("")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") setDating("");
                }}
              />
              {t.due && (
                <button
                  className="icon-button small"
                  aria-label="Remove due date"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    update(t.id, (x) => (x.due = ""));
                    setDating("");
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ) : (
            <button
              className={`task-due ${late ? "overdue" : soon ? "soon" : ""} ${t.due ? "" : "unset"}`}
              title={t.due ? "Change the due date" : "Set a due date"}
              onClick={() => setDating(t.id)}
            >
              <CalendarDays size={12} />
              {t.due ? dueText(t.due, today) : "Set due date"}
            </button>
          )}
          {safeUrl(t.url) && (
            <a
              className="icon-button small"
              aria-label={`Open source for ${t.title}`}
              href={safeUrl(t.url)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </span>
      </div>
    );
  };
  return (
    <div className="tasks">
      <div className="task-toolbar">
        <div className="task-add">
          <Plus size={15} />
          <input
            aria-label="New task"
            placeholder="Add a task and press Enter"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
        </div>
        <div className="segmented" role="group" aria-label="Order">
          {(["mine", "date"] as const).map((o) => (
            <button
              key={o}
              className={order === o ? "selected" : ""}
              onClick={() => {
                setOrder(o);
                localStorage.setItem("fieldnotes-task-order", o);
              }}
            >
              {o === "mine" ? "My order" : "By date"}
            </button>
          ))}
        </div>
      </div>
      <p className="task-summary">
        {open.length} to do
        {focus.length > 0 && ` · ${focus.length} for today`}
        {overdue > 0 && <span className="overdue"> · {overdue} overdue</span>}
        {done.length > 0 && ` · ${done.length} done`}
      </p>
      <section className="task-group today-group">
        <h3>
          <Star size={14} /> Today
        </h3>
        {focus.length ? (
          <div className="task-list">{focus.map(row)}</div>
        ) : (
          <p className="task-empty">
            Star a task to keep it here while you work on it today.
          </p>
        )}
      </section>
      <section className="task-group">
        <h3>To do</h3>
        <div className="task-list">{rest.map(row)}</div>
        {!open.length && (
          <div className="empty-state">Your checklist is clear.</div>
        )}
      </section>
      {done.length > 0 && (
        <details className="task-group done-group">
          <summary>Done · {done.length}</summary>
          <div className="task-list">{done.map(row)}</div>
        </details>
      )}
    </div>
  );
}

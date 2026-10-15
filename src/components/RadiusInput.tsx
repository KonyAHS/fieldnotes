import { useEffect, useState } from "react";
// Any search radius, typed in metres or kilometres. The search runs once
// typing pauses or the field is left, not on every keystroke.
export function RadiusInput({
  metres,
  min,
  max,
  onChange,
}: {
  metres: number;
  min: number;
  max: number;
  onChange: (metres: number) => void;
}) {
  const [unit, setUnit] = useState<"m" | "km">(metres < 1000 ? "m" : "km");
  const shown = (m: number, u: "m" | "km") =>
    String(u === "m" ? Math.round(m) : Math.round(m / 10) / 100);
  const [text, setText] = useState(() => shown(metres, unit));
  useEffect(() => setText(shown(metres, unit)), [metres]);
  const parse = (t: string, u: "m" | "km") => {
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? (u === "km" ? n * 1000 : n) : null;
  };
  const value = parse(text, unit);
  const invalid = value === null || value < min || value > max;
  const commit = (t = text, u = unit) => {
    const m = parse(t, u);
    if (m === null) return setText(shown(metres, u));
    const clamped = Math.min(max, Math.max(min, Math.round(m)));
    if (clamped !== m) setText(shown(clamped, u));
    if (clamped !== metres) onChange(clamped);
  };
  useEffect(() => {
    if (invalid || Math.round(value!) === metres) return;
    const timer = setTimeout(() => commit(), 900);
    return () => clearTimeout(timer);
  }, [text, unit]);
  const limit = (m: number) => (m < 1000 ? `${m} m` : `${m / 1000} km`);
  return (
    <span
      className={`radius-input ${invalid ? "invalid" : ""}`}
      title={`Search radius, ${limit(min)} to ${limit(max)}`}
    >
      <span className="radius-label">Within</span>
      <input
        type="number"
        inputMode="decimal"
        aria-label="Search radius"
        min={unit === "m" ? min : min / 1000}
        max={unit === "m" ? max : max / 1000}
        step={unit === "m" ? 50 : 0.5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <select
        aria-label="Radius unit"
        value={unit}
        onChange={(e) => {
          const u = e.target.value as "m" | "km";
          // Keep the same distance when switching units.
          const m = parse(text, unit) ?? metres;
          setUnit(u);
          setText(shown(m, u));
        }}
      >
        <option value="m">m</option>
        <option value="km">km</option>
      </select>
    </span>
  );
}

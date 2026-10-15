import { useState } from "react";
import {
  Printer,
  Download,
  ExternalLink,
  AlertTriangle,
  FileText,
} from "lucide-react";
import {
  type Workspace,
  type Trip,
  type Scenario,
  visaRows,
  visaCountries,
  visaCategories,
  defaultVisaHidden,
  type VisaCategory,
  shortDate,
  csv,
} from "../model";
import { download, mutate } from "../sync";
import { docx, docxType } from "../docx";
// Entry rules depend on nationality and change often; always check official sources.
const guidance: Record<string, string> = {
  Japan:
    "Use this for the MOFA Schedule of Stay. Verify your submitting office's current checklist.",
  Korea:
    "Depending on your passport you may need a visa or K-ETA. Either way, keep your Korean address handy for the e-Arrival card.",
  China:
    "Some passports are visa-free for short stays. A visa application asks for an itinerary with dates, cities and hotel addresses.",
};
export function Visa({
  data,
  trip,
  scenario,
  onEditTrip,
}: {
  data: Workspace;
  trip: Trip;
  scenario: Scenario;
  onEditTrip: () => void;
}) {
  const available = Object.keys(visaCountries).filter((c) =>
    scenario.entries.some(
      (e) =>
        e.status !== "idea" &&
        (e.country === c || (e.type === "transport" && e.toCountry === c)),
    ),
  );
  const [chosen, setChosen] = useState(available[0] || "Japan");
  const country = available.includes(chosen) ? chosen : available[0] || "Japan";
  const info = visaCountries[country];
  const hidden = trip.visaHidden ?? defaultVisaHidden;
  const rows = visaRows(trip, scenario, data.places, country, hidden);
  const toggle = (id: VisaCategory) =>
    mutate((d) => {
      const t = d.trips.find((x) => x.id === trip.id);
      if (!t) return;
      const current = t.visaHidden ?? defaultVisaHidden;
      t.visaHidden = current.includes(id)
        ? current.filter((c) => c !== id)
        : [...current, id];
    });
  const missing = rows.filter((r) => r.missing.length).length;
  const draft = !!missing || !trip.applicant;
  const slug = country.toLowerCase();
  const fileName = `${slug}-${country === "Japan" ? "schedule-of-stay" : "itinerary"}`;
  // Plain Word file for upload portals: no draft mark, bullets or colours.
  const exportWord = () =>
    download(
      `${fileName}.docx`,
      docx({
        title: info.title,
        paragraphs: [
          `${info.intro} ${trip.applicant || "[Applicant name]"} is as follows:`,
          "",
        ],
        table: {
          header: ["Date", "Activity Plan", "Contact", "Accommodation"],
          widths: [1300, 4300, 2000, 2038],
          rows: rows.map((r) => [
            `${shortDate(r.date)} ${r.date.slice(0, 4)}`,
            r.activity,
            r.contact,
            r.accommodation,
          ]),
        },
      }),
      docxType,
    );
  return (
    <div className="visa-view">
      {available.length > 1 && (
        <div className="segmented visa-countries screen-only">
          {available.map((c) => (
            <button
              key={c}
              className={c === country ? "selected" : ""}
              onClick={() => setChosen(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <p className="visa-guidance screen-only">
        {guidance[country]}{" "}
        <a href={info.official} target="_blank" rel="noreferrer">
          {info.officialName}
          <ExternalLink size={12} />
        </a>
      </p>
      <div className="section-actions">
        <button className="button" onClick={onEditTrip}>
          Applicant details
        </button>
        <div className="spacer" />
        <button
          className="button"
          disabled={!rows.length}
          onClick={() =>
            download(
              `${fileName}.csv`,
              csv([
                ["Date", "Activity Plan", "Contact", "Accommodation"],
                ...rows.map((r) => [
                  r.date,
                  r.activity,
                  r.contact,
                  r.accommodation,
                ]),
              ]),
              "text/csv;charset=utf-8",
            )
          }
        >
          <Download size={16} />
          CSV
        </button>
        <button
          className="button"
          disabled={!rows.length}
          onClick={exportWord}
          title="Plain Word document for uploading to visa websites"
        >
          <FileText size={16} />
          Word
        </button>
        <button
          className="button primary"
          disabled={!rows.length}
          onClick={() => window.print()}
        >
          <Printer size={16} />
          {draft ? "Print draft" : "Print / PDF"}
        </button>
      </div>
      <div
        className="visa-include screen-only"
        role="group"
        aria-label="Include in the itinerary"
      >
        <span>Include:</span>
        {visaCategories.map((c) => (
          <button
            key={c.id}
            className={`cuisine-chip ${hidden.includes(c.id) ? "" : "selected"}`}
            aria-pressed={!hidden.includes(c.id)}
            onClick={() => toggle(c.id)}
          >
            {c.label}
          </button>
        ))}
        <small>Hotels, arrival and departure are always listed.</small>
      </div>
      {draft && rows.length > 0 && (
        <div className="notice">
          <AlertTriangle size={17} />
          {!trip.applicant ? "Add applicant name. " : ""}
          {missing > 0 ? `${missing} days need details.` : ""}
        </div>
      )}
      <article
        className={`visa-paper ${draft ? "draft" : ""}`}
        id="visa-document"
      >
        <div className="visa-title">
          <h2>{info.title}</h2>
          {draft && <span className="draft-label">DRAFT</span>}
        </div>
        <p>
          {info.intro} <strong>{trip.applicant || "[Applicant name]"}</strong>{" "}
          is as follows:
        </p>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Activity Plan</th>
              <th>Contact</th>
              <th>Accommodation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td>
                  {shortDate(r.date)}
                  <br />
                  {r.date.slice(0, 4)}
                </td>
                <td>
                  {r.items.length ? (
                    <ul className="visa-plan">
                      {r.items.map((x, i) => (
                        <li key={i}>
                          {x.time && (
                            <span className="visa-time">{x.time}</span>
                          )}
                          <span>
                            {x.label && `${x.label} `}
                            <strong>{x.title}</strong>
                            {x.detail && (
                              <span className="visa-detail">{x.detail}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <em className="visa-todo">{r.activity}</em>
                  )}
                </td>
                <td>
                  {r.contact.split("\n").map((line) => {
                    // "Place: number", shown as a name with its number below.
                    const at = line.lastIndexOf(": ");
                    return at < 0 ? (
                      <span className="visa-phone" key={line}>
                        {line}
                      </span>
                    ) : (
                      <span className="visa-contact" key={line}>
                        <span>{line.slice(0, at)}</span>
                        <span className="visa-phone">{line.slice(at + 2)}</span>
                      </span>
                    );
                  })}
                </td>
                <td>
                  {r.accommodation}
                  {r.missing.length > 0 && (
                    <span className="visa-missing screen-only">
                      Missing: {r.missing.join(", ")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="empty-state">
            Add plans in {country} to create a schedule.
          </p>
        )}
      </article>
    </div>
  );
}

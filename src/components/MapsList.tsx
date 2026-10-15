import { useMemo, useState } from "react";
import { Download, ExternalLink, Share2 } from "lucide-react";
import { Modal } from "./Modal";
import type { Scenario, Trip, Workspace } from "../model";
import { download } from "../sync";
import {
  type MapList,
  mapListCsv,
  mapListFileName,
  mapListRows,
  mapLists,
} from "../mapsList";

const myMaps = "https://www.google.com/maps/d/";
// The address of the owner's map for each trip and list, kept per browser.
const savedKey = (trip: Trip, list: MapList) =>
  `fieldnotes-mymaps-${trip.id}-${list}`;

export function MapsListExport({
  data,
  trip,
  scenario,
  initial,
  onClose,
}: {
  data: Workspace;
  trip: Trip;
  scenario: Scenario;
  initial: MapList;
  onClose: () => void;
}) {
  const [list, setList] = useState<MapList>(initial);
  const [onlyPlanned, setOnlyPlanned] = useState(initial === "hotels");
  const [mapUrl, setMapUrl] = useState(
    () => localStorage.getItem(savedKey(trip, initial)) || "",
  );
  const [shareError, setShareError] = useState("");
  const { rows, unplaced } = useMemo(
    () => mapListRows(data, trip, scenario, list, onlyPlanned),
    [data, trip, scenario, list, onlyPlanned],
  );
  const name = mapListFileName(trip, list);
  const file = () => new File([mapListCsv(rows)], name, { type: "text/csv" });
  const canShare =
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [new File([""], name, { type: "text/csv" })] });
  const choose = (next: MapList) => {
    setList(next);
    setOnlyPlanned(next === "hotels");
    setMapUrl(localStorage.getItem(savedKey(trip, next)) || "");
  };
  const saveUrl = (value: string) => {
    setMapUrl(value);
    const key = savedKey(trip, list);
    if (value.trim()) localStorage.setItem(key, value.trim());
    else localStorage.removeItem(key);
  };
  const validMap = /^https:\/\/(www\.)?google\.[a-z.]+\/maps\/d\//.test(
    mapUrl.trim(),
  );
  return (
    <Modal title="Google Maps list" onClose={onClose}>
      <div className="maps-list">
        <p className="maps-list-intro">
          Google doesn't let other apps change your saved lists, so this makes a
          Google <strong>My Maps</strong> map instead. It shows in the Google
          Maps app under <em>You › Saved › Maps</em>, with every place pinned,
          and you can refresh it from a new file whenever plans change.
        </p>
        <div className="segmented maps-list-picker" role="group">
          {mapLists.map((l) => (
            <button
              key={l.id}
              className={list === l.id ? "selected" : ""}
              aria-pressed={list === l.id}
              onClick={() => choose(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={onlyPlanned}
            onChange={(e) => setOnlyPlanned(e.target.checked)}
          />
          Only places in “{scenario.name}”
          {list === "hotels"
            ? ""
            : " (otherwise every saved place on this trip)"}
        </label>
        <p className="maps-list-count">
          <strong>
            {rows.length} place{rows.length === 1 ? "" : "s"}
          </strong>
          {unplaced.length > 0 &&
            ` · ${unplaced.length} without exact coordinates; Google finds these by address or name`}
        </p>
        <div className="maps-list-actions">
          <button
            className="button primary"
            disabled={!rows.length}
            onClick={() => download(name, mapListCsv(rows), "text/csv")}
          >
            <Download size={15} />
            Download {name}
          </button>
          {canShare && (
            <button
              className="button"
              disabled={!rows.length}
              onClick={async () => {
                setShareError("");
                try {
                  await navigator.share({ files: [file()], title: name });
                } catch (e) {
                  if ((e as Error).name !== "AbortError")
                    setShareError("Sharing failed");
                }
              }}
            >
              <Share2 size={15} />
              Save to Files
            </button>
          )}
        </div>
        {shareError && <p className="error">{shareError}</p>}
        <h3>The first time</h3>
        <ol className="maps-list-steps">
          <li>
            Open{" "}
            <a href={myMaps} target="_blank" rel="noreferrer">
              Google My Maps <ExternalLink size={11} />
            </a>{" "}
            on a computer (the phone app can't import files) and choose{" "}
            <em>Create a new map</em>. Name it, for example “{trip.name} —{" "}
            {mapLists.find((l) => l.id === list)!.file}”.
          </li>
          <li>
            Under <em>Untitled layer</em> choose <em>Import</em> and pick the
            downloaded file.
          </li>
          <li>
            For the position choose <strong>Location</strong>, and for the title
            choose <strong>Name</strong>.
          </li>
          <li>Paste the map's address below to open it from here later.</li>
        </ol>
        <h3>After you change plans</h3>
        <ol className="maps-list-steps">
          <li>Download the file again (same name).</li>
          <li>
            In the map, open the layer's <em>⋮</em> menu, choose{" "}
            <em>Reimport and merge</em> › <em>Replace all items</em>, and pick
            the new file. Removed places disappear and new ones are added.
          </li>
        </ol>
        <label className="field">
          <span>Your My Maps address (kept on this device)</span>
          <input
            type="url"
            inputMode="url"
            placeholder="https://www.google.com/maps/d/edit?mid=…"
            value={mapUrl}
            onChange={(e) => saveUrl(e.target.value)}
          />
        </label>
        <div className="maps-list-actions">
          <a
            className="button"
            href={validMap ? mapUrl.trim() : myMaps}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} />
            {validMap ? "Open my map" : "Open Google My Maps"}
          </a>
        </div>
      </div>
    </Modal>
  );
}

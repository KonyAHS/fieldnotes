// A place's name in the local script, with its pronunciation, for finding it
// in taxi and map apps, and a card to show drivers in their language.
import { useEffect, useState } from "react";
import {
  CarTaxiFront,
  Check,
  Copy,
  Languages,
  LoaderCircle,
  ChevronLeft,
} from "lucide-react";
import type { Place } from "../model";
import {
  type Phrase,
  hasLocal,
  localCode,
  localLanguage,
  readingOf,
} from "../localLanguage";
import { applyLocalName, lookupLocalName } from "../geo";
import { mutate, notify } from "../sync";
import { Modal } from "./Modal";

export function useReading(place: Place | undefined) {
  const [reading, setReading] = useState("");
  const name = place?.nativeName;
  const saved = place?.nativeReading;
  const country = place?.country;
  useEffect(() => {
    let live = true;
    setReading("");
    if (place)
      void readingOf(place).then((r) => {
        if (live) setReading(r);
      });
    return () => {
      live = false;
    };
    // Only the fields the reading depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, saved, country]);
  return reading;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon-button local-copy"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

// Looks up a missing local name on Google Maps and saves it to the place.
function FindLocal({ place }: { place: Place }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const cc = localCode(place.country);
  if (!cc || (!place.googlePlaceId && place.lat === null)) return null;
  return (
    <span className="local-find">
      <button
        className="text-button"
        disabled={busy || !navigator.onLine}
        title={navigator.onLine ? "" : "Needs a connection"}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const found = await lookupLocalName(place, cc);
            let changed = false;
            if (found)
              mutate((d) => {
                const p = d.places.find((x) => x.id === place.id);
                if (p) changed = applyLocalName(p, found);
              });
            if (changed) notify(`Local name saved for ${place.name}.`);
            else setMessage("No local name found nearby.");
          } catch (e) {
            setMessage(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <LoaderCircle size={13} className="spin" />
        ) : (
          <Languages size={13} />
        )}{" "}
        Find local name
      </button>
      {message && <small>{message}</small>}
    </span>
  );
}

// The local name (with copy buttons and pronunciation) of a place; `label`
// marks a journey's start or end.
export function LocalName({
  place,
  label,
  address = true,
}: {
  place: Place;
  label?: string;
  address?: boolean;
}) {
  const reading = useReading(place);
  const lang = localLanguage(place.country);
  const tag = lang?.tag || "und";
  if (!hasLocal(place) && !lang) return null;
  if (!hasLocal(place))
    return (
      <div className="local-name missing">
        {label && <span className="local-label">{label}</span>}
        <span className="local-text">
          <small>{place.name}: no local name saved.</small>
        </span>
        <FindLocal place={place} />
      </div>
    );
  const name = place.nativeName.trim();
  const where = place.nativeAddress.trim();
  return (
    <div className="local-name">
      {label && <span className="local-label">{label}</span>}
      <div className="local-lines">
        {name && (
          <div className="local-line">
            <span className="local-text">
              <strong lang={tag}>{name}</strong>
              {reading && <small className="local-reading">{reading}</small>}
            </span>
            <CopyButton text={name} label="Copy local name" />
          </div>
        )}
        {address && where && (
          <div className="local-line">
            <span className="local-text">
              <span lang={tag} className="local-address">
                {where}
              </span>
            </span>
            <CopyButton text={where} label="Copy local address" />
          </div>
        )}
      </div>
    </div>
  );
}

const airport = (p: Place) =>
  /airport|机场|機場|空港|공항/i.test(`${p.name} ${p.nativeName}`);
const station = (p: Place) =>
  p.kind === "station" || /station|站|駅|역/i.test(`${p.name} ${p.nativeName}`);

// A button that opens the driver card for a place in a country whose
// language is known and whose local name or address is saved.
export function DriverButton({ place }: { place: Place | undefined }) {
  const [open, setOpen] = useState(false);
  if (!place || !localLanguage(place.country) || !hasLocal(place)) return null;
  return (
    <>
      <button className="today-chip driver-chip" onClick={() => setOpen(true)}>
        <CarTaxiFront size={13} /> Show driver
      </button>
      {open && <DriverCard place={place} onClose={() => setOpen(false)} />}
    </>
  );
}

// A large-print message for a taxi driver: where to go, in the local
// language, with the pronunciation and an English translation underneath.
// Other phrases ("stop here", "how much?") can be shown in its place.
export function DriverCard({
  place,
  onClose,
}: {
  place: Place;
  onClose: () => void;
}) {
  const lang = localLanguage(place.country)!;
  const reading = useReading(place);
  const [phrase, setPhrase] = useState<Phrase | null>(null);
  const name = place.nativeName.trim();
  const where = place.nativeAddress.trim();
  const extras = [
    ...(airport(place) ? [lang.airport] : station(place) ? [lang.hurry] : []),
    ...lang.extras,
  ];
  const sayName = reading || place.name;
  return (
    <Modal title="Show the driver" onClose={onClose} className="driver-modal">
      <div className="driver-card" lang={lang.tag}>
        {phrase ? (
          <p className="driver-phrase">{phrase.native}</p>
        ) : (
          <>
            <p className="driver-intro">{lang.intro.native}</p>
            {name && <p className="driver-place">{name}</p>}
            {where && (
              <p className="driver-address">
                {lang.address.native}：{where}
              </p>
            )}
            {!name && !where && (
              <p className="driver-place" lang="en">
                {place.name}
              </p>
            )}
            <p className="driver-thanks">{lang.thanks.native}</p>
          </>
        )}
      </div>
      <div className="driver-help" lang="en">
        <small>{lang.name} · say it</small>
        {phrase ? (
          <>
            <p className="driver-reading">{phrase.reading}</p>
            <p className="driver-english">{phrase.english}</p>
          </>
        ) : (
          <>
            <p className="driver-reading">
              {lang.intro.reading} {sayName}
              {/[.!?:]$/.test(sayName) ? "" : "."} {lang.thanks.reading}
            </p>
            <p className="driver-english">
              {lang.intro.english} {place.name}. {lang.thanks.english}
            </p>
          </>
        )}
      </div>
      <div className="driver-phrases" lang="en">
        {phrase && (
          <button className="button" onClick={() => setPhrase(null)}>
            <ChevronLeft size={15} /> Destination
          </button>
        )}
        {extras.map((x) => (
          <button
            key={x.native}
            className={`button ${phrase === x ? "primary" : ""}`}
            onClick={() => setPhrase(x)}
          >
            {x.english}
          </button>
        ))}
      </div>
    </Modal>
  );
}

import { useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Share2,
  Trash2,
  CloudOff,
  CloudUpload,
  Link2,
  Phone,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { Modal } from "./Modal";
import { FilePreview } from "./FilePreview";
import { mutate } from "../sync";
import {
  type Attachment,
  type Entry,
  type Workspace,
  attachmentsIn,
  attachmentExtension as extension,
  renamedAttachment as renamed,
  phoneLink,
  webLink,
} from "../model";
import {
  addFile,
  fileBlob,
  fileSize,
  syncFiles,
  useFileUrl,
  useLocalFiles,
} from "../attachments";
const isImage = (a: Attachment) => a.type.startsWith("image/");
// The same file can be on several plans (copied scenarios); rename it on all.
function renameEverywhere(id: string, name: string) {
  mutate((d) => {
    for (const t of d.trips)
      for (const s of t.scenarios)
        for (const e of s.entries)
          for (const a of e.attachments || []) if (a.id === id) a.name = name;
  });
}
function RenameField({
  attachment: a,
  onDone,
}: {
  attachment: Attachment;
  onDone: (name: string | null) => void;
}) {
  const ext = extension(a.name);
  const [value, setValue] = useState(
    ext ? a.name.slice(0, -ext.length) : a.name,
  );
  return (
    // Not a <form>: this sits inside the plan editor's form.
    <div className="attachment-rename">
      <input
        autoFocus
        aria-label={`New name for ${a.name}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone(e.key === "Enter" ? value : null);
          }
        }}
      />
      {ext && <span className="attachment-ext">{ext}</span>}
      <button
        type="button"
        className="icon-button"
        aria-label="Save name"
        onClick={() => onDone(value)}
      >
        <Check size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Cancel renaming"
        onClick={() => onDone(null)}
      >
        <X size={15} />
      </button>
    </div>
  );
}
export function AttachmentList({
  items,
  onChange,
}: {
  items: Attachment[];
  onChange: (next: Attachment[]) => void;
}) {
  const local = useLocalFiles();
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [renaming, setRenaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    const added: Attachment[] = [];
    const failed: string[] = [];
    for (const f of [...files]) {
      try {
        added.push(await addFile(f));
      } catch (e) {
        failed.push(e instanceof Error ? e.message : f.name);
      }
    }
    onChange([...items, ...added].slice(0, 30));
    if (failed.length) setError(failed.join(" · "));
    setBusy(false);
  }
  return (
    <div className="attachments">
      {items.map((a) =>
        renaming === a.id ? (
          <div className="attachment-row" key={a.id}>
            <RenameField
              attachment={a}
              onDone={(value) => {
                setRenaming("");
                if (value === null) return;
                const name = renamed(a, value);
                if (name === a.name) return;
                onChange(
                  items.map((x) => (x.id === a.id ? { ...x, name } : x)),
                );
                renameEverywhere(a.id, name);
              }}
            />
          </div>
        ) : (
          <div className="attachment-row" key={a.id}>
            <button
              type="button"
              className="attachment-open"
              onClick={() => setViewing(a)}
            >
              {isImage(a) ? <ImageIcon size={16} /> : <FileText size={16} />}
              <span>
                <strong>{a.name}</strong>
                <small>
                  {fileSize(a.size)} ·{" "}
                  {local.waiting.has(a.id) ? (
                    <span className="attachment-state waiting">
                      <CloudUpload size={11} /> On this device, uploads when
                      online
                    </span>
                  ) : local.have.has(a.id) ? (
                    <span className="attachment-state">Available offline</span>
                  ) : (
                    <span className="attachment-state missing">
                      <CloudOff size={11} /> Not on this device yet
                    </span>
                  )}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Rename ${a.name}`}
              title="Rename"
              onClick={() => setRenaming(a.id)}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${a.name}`}
              onClick={() => onChange(items.filter((x) => x.id !== a.id))}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ),
      )}
      <button
        type="button"
        className="button attachment-add"
        disabled={busy || items.length >= 30}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={15} />
        {busy ? "Adding…" : "Add ticket or file"}
      </button>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        multiple
        aria-label="Add attachment files"
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="attachment-hint">
        PDFs, photos, screenshots, text or Word files up to 25 MB each. Files
        are kept on every device that opens the app, so they open offline.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {viewing && (
        <AttachmentViewer
          attachment={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
// Everything needed on the day: ticket files, where to buy or manage the
// booking, a number to call and the booking reference.
export function TicketDetails({
  entry,
  onChange,
}: {
  entry: Entry;
  onChange: (patch: Partial<Entry>) => void;
}) {
  const url = entry.ticketUrl?.trim() || "";
  const phone = entry.phone?.trim() || "";
  return (
    <div className="ticket-details">
      <div className="ticket-fields">
        <label>
          <span>
            <Link2 size={13} /> Ticket link
          </span>
          <span className="ticket-input">
            <input
              type="url"
              inputMode="url"
              placeholder="Page to buy or manage the ticket"
              value={entry.ticketUrl || ""}
              onChange={(e) => onChange({ ticketUrl: e.target.value })}
            />
            {url && (
              <a
                className="button"
                href={webLink(url)}
                target="_blank"
                rel="noreferrer"
              >
                Open <ExternalLink size={12} />
              </a>
            )}
          </span>
        </label>
        <label>
          <span>
            <Phone size={13} /> Phone
          </span>
          <span className="ticket-input">
            <input
              type="tel"
              placeholder="Operator, agency or hotel"
              value={entry.phone || ""}
              onChange={(e) => onChange({ phone: e.target.value })}
            />
            {phone && (
              <a className="button" href={phoneLink(phone)}>
                Call
              </a>
            )}
          </span>
        </label>
        <label>
          <span>Booking reference</span>
          <input
            placeholder="Confirmation number"
            value={entry.bookingRef}
            onChange={(e) => onChange({ bookingRef: e.target.value })}
          />
        </label>
      </div>
      <AttachmentList
        items={entry.attachments || []}
        onChange={(next) => onChange({ attachments: next })}
      />
    </div>
  );
}
export function AttachmentViewer({
  attachment: a,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  const { url, error } = useFileUrl(a);
  const [shareError, setShareError] = useState("");
  const canShare =
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [new File([""], a.name, { type: a.type })] });
  return (
    <Modal title={a.name} onClose={onClose} wide>
      <div className="attachment-viewer">
        {error ? (
          <p className="notice">{error}</p>
        ) : (
          <FilePreview attachment={a} />
        )}
      </div>
      {shareError && <p className="error">{shareError}</p>}
      <div className="modal-footer">
        <span className="attachment-hint">{fileSize(a.size)}</span>
        <div className="spacer" />
        {canShare && (
          <button
            className="button"
            type="button"
            onClick={async () => {
              try {
                const blob = await fileBlob(a);
                await navigator.share({
                  files: [new File([blob], a.name, { type: a.type })],
                  title: a.name,
                });
              } catch (e) {
                if ((e as Error).name !== "AbortError")
                  setShareError("Sharing failed");
              }
            }}
          >
            <Share2 size={15} />
            Share
          </button>
        )}
        {url && (
          <>
            <a className="button" href={url} download={a.name}>
              <Download size={15} />
              Save
            </a>
            <a
              className="button primary"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={15} />
              Open
            </a>
          </>
        )}
      </div>
    </Modal>
  );
}
// How many attachment files this device holds, for checking before a trip.
export function AttachmentStatus({ workspace }: { workspace: Workspace }) {
  const local = useLocalFiles();
  const all = [
    ...new Map(attachmentsIn(workspace).map((a) => [a.id, a])).values(),
  ];
  if (!all.length) return null;
  const here = all.filter((a) => local.have.has(a.id));
  const waiting = all.filter((a) => local.waiting.has(a.id)).length;
  const missing = all.length - here.length;
  return (
    <div className="settings-row">
      <span>
        <Paperclip size={14} /> Attachments: {here.length} of {all.length}{" "}
        available offline on this device
        {waiting ? ` · ${waiting} waiting to upload` : ""}
        {` (${fileSize(here.reduce((n, a) => n + a.size, 0))})`}
      </span>
      {(missing > 0 || waiting > 0) && (
        <button
          className="button"
          disabled={local.busy}
          onClick={() => void syncFiles(workspace)}
        >
          {local.busy
            ? "Downloading…"
            : missing
              ? "Download now"
              : "Upload now"}
        </button>
      )}
    </div>
  );
}

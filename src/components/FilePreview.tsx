// Shows an attachment inside the app, so tickets and confirmations can be read
// offline on any device. PDFs are drawn with pdf.js because phones only show
// the first page of a PDF placed in a frame.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Attachment } from "../model";
import { fileBlob } from "../attachments";
import {
  readable,
  items,
  shortUrl,
  looksLikeEmail,
  parseEmail,
  htmlText,
} from "../readableText";

export type PreviewKind =
  "image" | "pdf" | "text" | "html" | "docx" | "audio" | "video" | "other";

const textExtensions =
  /\.(txt|text|md|markdown|csv|tsv|json|xml|ics|ical|eml|log|ini|yaml|yml|gpx|kml|vcf)$/i;
export function previewKind(a: Pick<Attachment, "name" | "type">): PreviewKind {
  const type = a.type.toLowerCase();
  const name = a.name.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "text/html" || /\.html?$/.test(name)) return "html";
  if (
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  )
    return "docx";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (
    type.startsWith("text/") ||
    /^application\/(json|xml|ld\+json|gpx\+xml)$/.test(type) ||
    type === "message/rfc822" ||
    textExtensions.test(name)
  )
    return "text";
  return "other";
}

export function FilePreview({ attachment: a }: { attachment: Attachment }) {
  const kind = previewKind(a);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false,
      made = "";
    setBlob(null);
    setUrl("");
    setError("");
    fileBlob(a)
      .then((b) => {
        if (cancelled) return;
        const typed = b.type ? b : new Blob([b], { type: a.type });
        made = URL.createObjectURL(typed);
        setBlob(typed);
        setUrl(made);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [a.id]);
  if (error) return <p className="notice">{error}</p>;
  if (!blob) return <p className="notice">Opening…</p>;
  switch (kind) {
    case "image":
      return <img src={url} alt={a.name} />;
    case "pdf":
      return <PdfPreview blob={blob} />;
    case "text":
      return <TextPreview blob={blob} />;
    case "html":
      return <HtmlPreview blob={blob} title={a.name} />;
    case "docx":
      return <DocxPreview blob={blob} />;
    case "audio":
      return <audio src={url} controls />;
    case "video":
      return <video src={url} controls playsInline />;
    default:
      return (
        <p className="notice">
          This file type can't be shown here. Use Open or Save below.
        </p>
      );
  }
}

// Text with tappable web links (shown short), email addresses and phone
// numbers.
const linkable =
  /(https?:\/\/[^\s<>"'\]]+[^\s<>"'\].,;:!?)]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\+\d[\d ()-]{6,}\d)/g;
function Linked({ text, short = false }: { text: string; short?: boolean }) {
  const parts = text.split(linkable);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
        if (p.startsWith("http"))
          return (
            <a key={i} href={p} target="_blank" rel="noreferrer" title={p}>
              {short ? shortUrl(p) : p}
            </a>
          );
        if (p.includes("@"))
          return (
            <a key={i} href={`mailto:${p}`}>
              {p}
            </a>
          );
        return (
          <a key={i} href={`tel:${p.replace(/[^\d+]/g, "")}`}>
            {p}
          </a>
        );
      })}
    </>
  );
}
async function readText(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Most files are UTF-8; Japanese confirmations are sometimes Shift_JIS.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("shift_jis").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}
// Text files and saved emails: a tidied, readable version by default, the
// file exactly as saved on request (and the email's own layout for .eml).
function TextPreview({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<"readable" | "layout" | "original">(
    "readable",
  );
  useEffect(() => {
    let cancelled = false;
    void readText(blob).then((t) => !cancelled && setText(t));
    return () => {
      cancelled = true;
    };
  }, [blob]);
  const email = useMemo(
    () => (text && looksLikeEmail(text) ? parseEmail(text) : null),
    [text],
  );
  const tidy = useMemo(() => {
    if (text === null) return null;
    if (!email) return readable(text.slice(0, 500_000));
    const r = readable(
      (email.text || (email.html ? htmlText(email.html) : "")).slice(
        0,
        500_000,
      ),
    );
    return {
      ...r,
      title: email.subject || r.title,
      meta: [
        email.from && { label: "From", value: email.from },
        email.date && { label: "Date", value: localDate(email.date) },
        ...r.meta,
      ].filter((m): m is { label: string; value: string } => !!m),
    };
  }, [text, email]);
  if (text === null || !tidy) return <p className="notice">Opening…</p>;
  if (!text.trim()) return <p className="notice">This file is empty.</p>;
  return (
    <div className="file-text-preview">
      <div className="segmented file-text-mode">
        <button
          className={mode === "readable" ? "selected" : ""}
          onClick={() => setMode("readable")}
        >
          Readable
        </button>
        {email?.html && (
          <button
            className={mode === "layout" ? "selected" : ""}
            onClick={() => setMode("layout")}
          >
            Email layout
          </button>
        )}
        <button
          className={mode === "original" ? "selected" : ""}
          onClick={() => setMode("original")}
        >
          Original
        </button>
      </div>
      {mode === "readable" && (
        <article className="file-text readable-text">
          {tidy.title && <h3>{tidy.title}</h3>}
          {!!tidy.meta.length && (
            <p className="readable-meta">
              {tidy.meta.map((m) => (
                <span key={m.label}>
                  {m.label}: {m.value}
                </span>
              ))}
            </p>
          )}
          {items(tidy.blocks).map((it, i) =>
            it.kind === "pair" ? (
              <p key={i} className="readable-pair">
                <span>{it.label}</span>
                <strong>
                  <Linked text={it.value} short />
                </strong>
              </p>
            ) : (
              <p key={i}>
                {it.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    <Linked text={l} short />
                  </Fragment>
                ))}
              </p>
            ),
          )}
        </article>
      )}
      {mode === "layout" && email?.html && (
        <HtmlFrame html={email.html} title={email.subject || "Email"} />
      )}
      {mode === "original" && (
        <pre className="file-text">
          <Linked text={text.slice(0, 500_000)} />
        </pre>
      )}
    </div>
  );
}
function localDate(value: string) {
  const t = Date.parse(value);
  return Number.isNaN(t)
    ? value
    : new Date(t).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

// Saved web pages and HTML emails. Scripts don't run and nothing is loaded
// from the internet, so the page looks the same offline.
function HtmlPreview({ blob, title }: { blob: Blob; title: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readText(blob).then((t) => !cancelled && setHtml(t));
    return () => {
      cancelled = true;
    };
  }, [blob]);
  if (html === null) return <p className="notice">Opening…</p>;
  return <HtmlFrame html={html} title={title} />;
}
function HtmlFrame({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      title={title}
      srcDoc={
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank">` +
        html
      }
      sandbox="allow-popups allow-popups-to-escape-sandbox"
    />
  );
}

// Each page drawn to fit the width, one after another.
function PdfPreview({ blob }: { blob: Blob }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ pages: number; error: string }>({
    pages: 0,
    error: "",
  });
  useEffect(() => {
    let cancelled = false;
    let destroy = () => {};
    const el = box.current!;
    el.replaceChildren();
    void (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
          cMapUrl: __PDFJS_BASE__ + "cmaps/",
          cMapPacked: true,
          standardFontDataUrl: __PDFJS_BASE__ + "standard_fonts/",
          wasmUrl: __PDFJS_BASE__ + "wasm/",
          enableXfa: false,
        });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        if (cancelled) return;
        const total = Math.min(doc.numPages, 60);
        setState({ pages: doc.numPages, error: "" });
        const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
        for (let n = 1; n <= total && !cancelled; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const width = Math.max(el.clientWidth - 16, 200);
          const viewport = page.getViewport({ scale: width / base.width });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.setAttribute("aria-label", `Page ${n} of ${doc.numPages}`);
          el.append(canvas);
          await page.render({
            canvas,
            viewport,
            transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          }).promise;
        }
      } catch (e) {
        if (!cancelled)
          setState({
            pages: 0,
            error:
              e instanceof Error && e.name === "PasswordException"
                ? "This PDF is password protected. Use Open or Save below."
                : "This PDF couldn't be shown here. Use Open or Save below.",
          });
      }
    })();
    return () => {
      cancelled = true;
      destroy();
    };
  }, [blob]);
  return (
    <div className="pdf-preview">
      {state.error && <p className="notice">{state.error}</p>}
      {!state.error && !state.pages && <p className="notice">Opening…</p>}
      <div ref={box} className="pdf-pages" />
      {state.pages > 60 && (
        <p className="attachment-hint">
          Showing the first 60 of {state.pages} pages.
        </p>
      )}
    </div>
  );
}

// Word documents: the text of each paragraph and table cell, without layout.
function DocxPreview({ blob }: { blob: Blob }) {
  const [paras, setParas] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    docxText(blob)
      .then((p) => !cancelled && setParas(p))
      .catch(
        () =>
          !cancelled &&
          setError(
            "This document couldn't be shown here. Use Open or Save below.",
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [blob]);
  if (error) return <p className="notice">{error}</p>;
  if (!paras) return <p className="notice">Opening…</p>;
  return (
    <div className="file-text docx-text">
      {paras.map((p, i) => (p ? <p key={i}>{p}</p> : <br key={i} />))}
    </div>
  );
}
export async function docxText(blob: Blob) {
  const xml = await unzipEntry(blob, "word/document.xml");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return [...doc.getElementsByTagNameNS(W, "p")].map((p) => {
    let out = "";
    for (const el of p.getElementsByTagNameNS(W, "*")) {
      if (el.localName === "t") out += el.textContent || "";
      else if (el.localName === "tab") out += "\t";
      else if (el.localName === "br") out += "\n";
    }
    return out;
  });
}
// Reads one file from a zip archive (stored or deflated).
async function unzipEntry(blob: Blob, path: string) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  let end = buf.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw Error("Not a zip file");
  let at = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(buf.subarray(at + 46, at + 46 + nameLength));
    if (name === path) {
      const start =
        local +
        30 +
        view.getUint16(local + 26, true) +
        view.getUint16(local + 28, true);
      const data = buf.subarray(start, start + size);
      if (method === 0) return decoder.decode(data);
      if (method !== 8) throw Error("Unsupported compression");
      const stream = new Blob([data])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).text();
    }
    at += 46 + nameLength + extra + comment;
  }
  throw Error("Missing " + path);
}

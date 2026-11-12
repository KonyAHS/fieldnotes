// Turns saved emails and plain-text tickets into something readable on a
// phone. Confirmation emails converted to text keep the HTML layout's leftovers:
// hundreds of blank lines, deep indentation, image addresses in brackets,
// sentences broken after every few words and padding spaces from tables.

export type Readable = {
  title: string;
  meta: { label: string; value: string }[];
  /** Paragraphs, each a list of lines. */
  blocks: string[][];
};

const headerLine = /^(subject|from|to|cc|date|sent|received):[ \t]*(.*)$/i;
const imageRef =
  /\[(?:[^\]\s]*\/)?[^\]\s/]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^\]]*)?\]/gi;
const months =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\.?$/i;
const glue =
  /\b(?:to|on|of|and|or|the|a|an|your|for|in|at|with|from|by|is|are|was|we|you|that|this|our|will|be|has|have|as|per|if|any|please|than|into|via)$/i;
const cjk = /[぀-ヿ㐀-鿿가-힯＀-￯]/;
const sentenceEnd = /[.!?。！？]$/;

function cleanLine(line: string) {
  let l = line
    .replace(imageRef, "")
    .replace(/\[cid:[^\]]*\]/gi, "")
    .replace(/^\s*�+\s*/, "▪ ")
    .replace(/�+/g, "")
    .trim();
  // List markers from text emails.
  l = l.replace(/^[*•·-]\s+/, "• ");
  // Table padding: wide gaps become one em space, double spaces one space.
  l = l.replace(/[ \t]{3,}|\t+/g, " ").replace(/ {2}/g, " ");
  // Lines of nothing but separators or a stray bracket.
  if (/^[\s_=~*\-–—|.·•:]*$/.test(l) && l !== ":") return "";
  if (/^\[\s*\]$/.test(l)) return "";
  return l;
}

const words = (s: string) => s.length;
function joins(
  prev: string,
  next: string,
  across = false,
): "" | " " | null {
  if (/^[,.;!?)\]）、。」』%]/.test(next)) return "";
  if (next === ":" || /^:\s/.test(next)) return "";
  if (/^https?:\/\//.test(next) || /https?:\/\/\S+$/.test(prev)) return null;
  if (/^•/.test(next)) return null;
  // Across a blank line only clearly unfinished sentences continue.
  if (across) {
    if (/:$/.test(prev)) return null;
    return (/[a-z]$/.test(prev) && /^[a-z]/.test(next)) ||
      (glue.test(prev) && !/^[A-Z]{2}/.test(next))
      ? " "
      : null;
  }
  if (/[,(\[（「『&]$/.test(prev) && !/^(dear|hi|hello|hey)\b/i.test(prev))
    return " ";
  if (/:$/.test(prev) && words(prev) <= 40 && words(next) <= 40) return " ";
  if (/[a-z]$/.test(prev) && /^[a-z]/.test(next)) return " ";
  if (glue.test(prev) && !/^\d+$/.test(prev)) return " ";
  if (months.test(prev) && /^\d/.test(next) && words(next) <= 12) return " ";
  // Hard-wrapped Japanese/Chinese text.
  if (
    prev.length >= 40 &&
    cjk.test(prev.slice(-1)) &&
    !sentenceEnd.test(prev) &&
    cjk.test(next[0] || "")
  )
    return "";
  return null;
}

export function readable(raw: string): Readable {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍⁠﻿͏­]/g, "");
  let lines = text.split("\n");
  // Header lines added when the email was saved ("Subject:", "Received:").
  let title = "";
  const meta: Readable["meta"] = [];
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && headerLine.test(lines[0])) {
    while (lines.length && headerLine.test(lines[0])) {
      const [, name, value] = lines.shift()!.match(headerLine)!;
      const key = name.toLowerCase();
      if (key === "subject" && !title) title = value.trim();
      else if (value.trim())
        meta.push({
          label: key === "received" || key === "sent" ? "Date" : cap(key),
          value: key === "received" || key === "date" ? when(value) : value,
        });
    }
  }
  lines = lines.map(cleanLine);
  // Paragraphs are separated by blank lines; lines inside one are joined
  // where a sentence was cut.
  const blocks: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) blocks.push(current);
    current = [];
  };
  for (const l of lines) {
    if (!l) {
      flush();
      continue;
    }
    const prev = current.at(-1);
    const how = prev === undefined ? null : joins(prev, l);
    if (prev !== undefined && how !== null)
      current[current.length - 1] = prev + how + l;
    else current.push(l);
  }
  flush();
  // Sentences split across blank lines too ("We confirm\n\nthat you…").
  const merged: string[][] = [];
  for (const b of blocks) {
    const last = merged.at(-1);
    const tail = last?.at(-1);
    const how = tail === undefined ? null : joins(tail, b[0], true);
    if (last && tail !== undefined && how !== null) {
      last[last.length - 1] = tail + how + b[0];
      last.push(...b.slice(1));
    } else merged.push([...b]);
  }
  // The same paragraph twice in a row (text and image alternatives).
  const out = merged.filter(
    (b, i) => i === 0 || b.join("\n") !== merged[i - 1].join("\n"),
  );
  if (title && out[0]?.length === 1 && out[0][0] === title) out.shift();
  return { title, meta, blocks: out };
}

// Labels and values on lines of their own, as receipts converted from HTML
// tables come out ("Fare" … "JPY 9400.00"), shown side by side.
export type Item =
  | { kind: "pair"; label: string; value: string }
  | { kind: "text"; lines: string[] };
const isLabel = (s: string) =>
  s.length <= 40 && /[a-z]/.test(s) && !/\d/.test(s) && !/[.!?。]$/.test(s);
const isValue = (s: string) =>
  s.length <= 40 &&
  (/\d/.test(s) || /^(n\/?a|none|yes|no|free|included|-)$/i.test(s));
export function items(blocks: string[][]): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i],
      b = blocks[i + 1];
    if (a.length === 1 && b?.length === 1 && isLabel(a[0]) && isValue(b[0])) {
      out.push({ kind: "pair", label: a[0].replace(/:$/, ""), value: b[0] });
      i++;
    } else out.push({ kind: "text", lines: a });
  }
  return out;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
function when(value: string) {
  const t = Date.parse(value.trim());
  if (Number.isNaN(t)) return value.trim();
  return new Date(t).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Short label for a long web address: its site and the start of the path.
export function shortUrl(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    const label = host + (path.length > 1 ? path : "");
    return label.length > 42 ? label.slice(0, 40) + "…" : label;
  } catch {
    return url.length > 42 ? url.slice(0, 40) + "…" : url;
  }
}

// --- Saved .eml files (MIME) -------------------------------------------------

export type Email = {
  subject: string;
  from: string;
  to: string;
  date: string;
  text: string;
  html: string;
};

export const looksLikeEmail = (s: string) =>
  /^(?:[\w-]+:.*\r?\n(?:[ \t].*\r?\n)*)+/.test(s) &&
  /^(mime-version|content-type):/im.test(s.slice(0, 20000).split(/\r?\n\r?\n/)[0]);

function split(part: string) {
  const at = part.search(/\r?\n\r?\n/);
  if (at < 0) return { head: part, body: "" };
  const gap = part.slice(at).match(/^\r?\n\r?\n/)![0].length;
  return { head: part.slice(0, at), body: part.slice(at + gap) };
}
function headers(head: string) {
  const map: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m && !(m[1].toLowerCase() in map)) map[m[1].toLowerCase()] = m[2];
  }
  return map;
}
const param = (value: string, name: string) =>
  value.match(new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, "i"))?.[1] || "";
function decodeBytes(bytes: Uint8Array, charset: string) {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
const latin1 = (s: string) =>
  Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
function base64(s: string) {
  try {
    return latin1(atob(s.replace(/[^A-Za-z0-9+/=]/g, "")));
  } catch {
    return new Uint8Array();
  }
}
function quotedPrintable(s: string, underscores = false) {
  const t = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      out.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (underscores && c === "_") out.push(32);
    else out.push(...enc.encode(c));
  }
  return Uint8Array.from(out);
}
// =?utf-8?B?...?= words in subjects and names.
export function decodeWords(value: string) {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, cs, kind, data) =>
      decodeBytes(
        kind.toLowerCase() === "b"
          ? base64(data)
          : quotedPrintable(data, true),
        cs,
      ),
    );
}
function body(text: string, h: Record<string, string>) {
  const encoding = (h["content-transfer-encoding"] || "").toLowerCase();
  const charset = param(h["content-type"] || "", "charset");
  if (encoding === "base64") return decodeBytes(base64(text), charset);
  if (encoding === "quoted-printable")
    return decodeBytes(quotedPrintable(text), charset);
  return text;
}

export function parseEmail(raw: string): Email {
  const { head, body: rest } = split(raw);
  const h = headers(head);
  const found = { text: "", html: "" };
  const walk = (hh: Record<string, string>, content: string, depth: number) => {
    const type = (hh["content-type"] || "text/plain").toLowerCase();
    if (type.startsWith("multipart/") && depth < 8) {
      const boundary = param(hh["content-type"], "boundary");
      if (!boundary) return;
      const parts = content.split(`--${boundary}`).slice(1);
      for (const p of parts) {
        if (p.startsWith("--")) break;
        const s = split(p.replace(/^\r?\n/, ""));
        walk(headers(s.head), s.body, depth + 1);
      }
    } else if (/attachment/i.test(hh["content-disposition"] || "")) {
      return;
    } else if (type.startsWith("text/plain") && !found.text) {
      found.text = body(content, hh);
    } else if (type.startsWith("text/html") && !found.html) {
      found.html = body(content, hh);
    }
  };
  walk(h, rest, 0);
  return {
    subject: decodeWords(h.subject || ""),
    from: decodeWords(h.from || ""),
    to: decodeWords(h.to || ""),
    date: h.date || "",
    ...found,
  };
}

// Text of an HTML email, for the readable view when there is no plain part.
export function htmlText(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style,script,head,title").forEach((e) => e.remove());
  doc.querySelectorAll("br").forEach((e) => e.replaceWith("\n"));
  doc
    .querySelectorAll("p,div,tr,li,h1,h2,h3,h4,h5,h6,table,section")
    .forEach((e) => {
      e.prepend("\n");
      e.append("\n");
    });
  doc.querySelectorAll("td,th").forEach((e) => e.append("   "));
  doc.querySelectorAll("a[href^='http']").forEach((a) => {
    const href = a.getAttribute("href")!;
    if (a.textContent?.trim() && !a.textContent.includes(href))
      a.append(` ${href}`);
  });
  return doc.body?.textContent || "";
}

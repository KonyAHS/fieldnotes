import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { docx, docxDocument } from "../src/docx.ts";

const content = {
  title: "Schedule of Stay",
  paragraphs: ["The schedule of stay in Japan of A & B <test> is as follows:"],
  table: {
    header: ["Date", "Activity Plan", "Contact", "Accommodation"],
    widths: [1300, 4300, 2000, 2038],
    rows: [
      [
        "1 Nov 2026",
        "09:00 Museum\nLunch",
        "Hotel: 03-1234",
        "東京ホテル\nAddress",
      ],
    ],
  },
};

test("Word document escapes text and splits cell lines into paragraphs", () => {
  const xml = docxDocument(content);
  assert.match(xml, /A &amp; B &lt;test&gt;/);
  assert.match(
    xml,
    /09:00 Museum<\/w:t><\/w:r><\/w:p><w:p><w:r><w:t xml:space="preserve">Lunch/,
  );
  assert.match(xml, /東京ホテル/);
  assert.doesNotMatch(xml, /w:numPr|w:color w:val="(?!000000)/);
});

test("docx is a valid stored zip with the required parts", () => {
  const bytes = docx(content);
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const len = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(local + 26, true);
    const data = bytes.subarray(
      local + 30 + nameLen,
      local + 30 + nameLen + size,
    );
    assert.equal(view.getUint32(at + 16, true), crc32(data));
    names.push(
      new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + len)),
    );
    at += 46 + len;
  }
  assert.deepEqual(names.sort(), [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/_rels/document.xml.rels",
    "word/document.xml",
    "word/styles.xml",
  ]);
});

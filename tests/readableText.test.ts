import { test } from "node:test";
import assert from "node:assert/strict";
import { readable, items, parseEmail, shortUrl } from "../src/readableText.ts";

test("tidies text converted from HTML emails", () => {
  const raw = [
    "Subject: Your booking",
    "Received: 2026-10-12T17:15:00.000Z",
    "",
    "",
    "   ",
    "Airline [https://x.example/banner.jpg]",
    "",
    "Hi Sam,",
    "",
    "",
    "We confirm",
    "that",
    "you are travelling to",
    "Seoul on",
    "3rd Apr",
    "2027,",
    "Saturday.",
    "",
    " ",
    "Fare",
    "",
    "",
    "JPY 12000.00",
    "",
    "Carry On Baggage",
    ":",
    "Small Personal Item",
    "      Order number: X1      payment complete: today",
    "��Hotels",
  ].join("\n");
  const r = readable(raw);
  assert.equal(r.title, "Your booking");
  assert.equal(r.meta[0].label, "Date");
  assert.deepEqual(r.blocks[0], ["Airline"]);
  assert.deepEqual(r.blocks[1], ["Hi Sam,"]);
  assert.deepEqual(r.blocks[2], [
    "We confirm that you are travelling to Seoul on 3rd Apr 2027, Saturday.",
  ]);
  assert.deepEqual(items(r.blocks)[3], {
    kind: "pair",
    label: "Fare",
    value: "JPY 12000.00",
  });
  assert.deepEqual(r.blocks.at(-1), [
    "Carry On Baggage: Small Personal Item",
    "Order number: X1 payment complete: today",
    "▪ Hotels",
  ]);
});

test("joins hard-wrapped Japanese lines", () => {
  const long = "お支払い完了後にメールでお知らせします。宿泊前に受け取ったお支払いに関する他のリクエストがあれば報告し、支払いのリンクをクリックしないでくださ";
  const r = readable(`   ${long}\n   い。次の文です。`);
  assert.deepEqual(r.blocks, [[long + "い。次の文です。"]]);
});

test("reads a MIME email", () => {
  const raw = [
    "From: =?utf-8?B?5LiJ5Lqk?= <a@b.jp>",
    "Subject: =?utf-8?Q?Caf=C3=A9_booking?=",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Caf=C3=A9 at 10:00 =",
    "today",
    "--b1",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("<p>Hi</p>").toString("base64"),
    "--b1--",
  ].join("\r\n");
  const e = parseEmail(raw);
  assert.equal(e.subject, "Café booking");
  assert.equal(e.from, "三交 <a@b.jp>");
  assert.equal(e.text.trim(), "Café at 10:00 today");
  assert.equal(e.html, "<p>Hi</p>");
});

test("shortens long links", () => {
  assert.equal(
    shortUrl("https://www.hkexpress.com/en-hk/?utm_campaign=itinerary"),
    "hkexpress.com/en-hk",
  );
});

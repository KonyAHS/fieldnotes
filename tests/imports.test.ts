import { test } from "node:test";
import assert from "node:assert/strict";
import { importCalendar, importConfirmation } from "../src/imports.ts";
import { importEmail, emailDate } from "../src/imports.ts";
const calendar = (event: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:test123\r\nSUMMARY:Tokyo hotel\r\n${event}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
test("all-day hotel checkout stays exclusive, all-day activities end inclusive", () => {
  const text = calendar(
    "DTSTART;VALUE=DATE:20261028\r\nDTEND;VALUE=DATE:20261101\r\nLOCATION:1-2 Tokyo",
  );
  const stay = importCalendar(text, "Japan", "Tokyo", "stay")[0];
  assert.equal(stay.entry.endDate, "2026-11-01");
  assert.equal(stay.place?.address, "1-2 Tokyo");
  const activity = importCalendar(text, "Japan", "Tokyo", "activity")[0];
  assert.equal(activity.entry.endDate, "2026-10-31");
});
test("UTC calendar times become destination wall times", () => {
  const c = importCalendar(
    calendar("DTSTART:20261028T090000Z\r\nDTEND:20261028T100000Z"),
    "Japan",
    "Tokyo",
    "activity",
  )[0];
  assert.equal(c.entry.startTime, "18:00");
  assert.equal(c.entry.endTime, "19:00");
  assert.equal(c.entry.timezone, "Asia/Tokyo");
});
test("IANA zone parameters are retained, canceled entries excluded and recurrence rejected", () => {
  const c = importCalendar(
    calendar(
      "DTSTART;TZID=Asia/Seoul:20261028T090000\r\nDTEND;TZID=Asia/Seoul:20261028T100000",
    ),
    "Japan",
    "Tokyo",
    "activity",
  )[0];
  assert.equal(c.entry.timezone, "Asia/Seoul");
  assert.equal(c.entry.startTime, "09:00");
  assert.equal(
    importCalendar(
      calendar(
        "DTSTART:20261028T090000Z\r\nDTEND:20261028T100000Z\r\nSTATUS:CANCELLED",
      ),
      "Japan",
      "Tokyo",
      "activity",
    ).length,
    0,
  );
  assert.throws(() =>
    importCalendar(
      calendar(
        "DTSTART:20261028T090000Z\r\nDTEND:20261028T100000Z\r\nRRULE:FREQ=DAILY",
      ),
      "Japan",
      "Tokyo",
      "activity",
    ),
  );
});
test("confirmation extracts explicit dates/address/reference; ambiguous numbers need review", () => {
  const c = importConfirmation(
    "Hotel: Test\nCheck-in: 2026-10-28\nCheck-out: 2026-11-01\nAddress: Test address\nPhone: +81 123\nConfirmation: ABC",
    "Japan",
    "Tokyo",
  );
  assert.equal(c.selected, true);
  assert.equal(c.entry.date, "2026-10-28");
  assert.equal(c.entry.bookingRef, "ABC");
  assert.equal(c.place?.phone, "+81 123");
  const unsafe = importConfirmation(
    "Hotel: Test\nCheck-in: 10/11/26\nCheck-out: 12/11/26",
    "Japan",
    "Tokyo",
  );
  assert.equal(unsafe.selected, false);
  assert.equal(unsafe.entry.date, "");
  assert.equal(unsafe.entry.endDate, "");
});
test("Booking.com email: property, dates, times, address, reference and country", () => {
  const c = importEmail(
    {
      id: "<a@booking.com>",
      provider: "booking",
      from: "noreply@booking.com",
      subject: "Your booking is confirmed at Hotel Gracery Shinjuku",
      date: "2026-09-01T10:00:00Z",
      text: [
        "Thanks! Your booking is confirmed.",
        "Hotel Gracery Shinjuku",
        "Check-in time",
        "From 14:00",
        "Check-in",
        "Wednesday, October 28, 2026",
        "from 15:00",
        "Check-out",
        "Sunday, November 1, 2026",
        "until 11:00",
        "Booking number: 4011.522.981",
        "Address: 1-19-1 Kabukicho, Shinjuku, Tokyo, 160-8466, Japan",
        "Phone: +81 3-6833-2489",
      ].join("\n"),
    },
    "Korea",
    "",
  );
  assert.equal(c.entry.title, "Hotel Gracery Shinjuku");
  assert.equal(c.entry.date, "2026-10-28");
  assert.equal(c.entry.endDate, "2026-11-01");
  assert.equal(c.entry.startTime, "14:00");
  assert.equal(c.entry.endTime, "11:00");
  assert.equal(c.entry.bookingRef, "4011.522.981");
  assert.equal(c.entry.country, "Japan");
  assert.equal(c.entry.timezone, "Asia/Tokyo");
  assert.equal(c.place?.phone, "+81 3-6833-2489");
  assert.ok(c.place?.address.startsWith("1-19-1 Kabukicho"));
  assert.equal(c.selected, true);
});
test("Airbnb email without years rolls into the next year; cancellations are not selected", () => {
  const mail = {
    id: "<b@airbnb.com>",
    provider: "airbnb" as const,
    from: "automated@airbnb.com",
    subject: "Reservation confirmed - Cosy flat near Haeundae",
    date: "2026-12-10T10:00:00Z",
    text: [
      "Check-in",
      "Fri, Jan 8",
      "3:00 PM",
      "Checkout",
      "Mon, Jan 11",
      "11:00 AM",
      "Confirmation code",
      "HMQ2X9ABCD",
      "Address",
      "12 Haeundae-ro, Busan, South Korea",
    ].join("\n"),
  };
  const c = importEmail(mail, "Japan", "Busan");
  assert.equal(c.entry.title, "Cosy flat near Haeundae");
  assert.equal(c.entry.date, "2027-01-08");
  assert.equal(c.entry.endDate, "2027-01-11");
  assert.equal(c.entry.startTime, "15:00");
  assert.equal(c.entry.endTime, "11:00");
  assert.equal(c.entry.bookingRef, "HMQ2X9ABCD");
  assert.equal(c.entry.country, "Korea");
  assert.equal(
    importEmail({ ...mail, subject: "Reservation cancelled" }, "Japan", "")
      .selected,
    false,
  );
  assert.equal(emailDate("Oct 28", "2026-09-01T00:00:00Z"), "2026-10-28");
});

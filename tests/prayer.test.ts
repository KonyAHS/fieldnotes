import { test } from "node:test";
import assert from "node:assert/strict";
import { prayerTimes, qibla } from "../src/prayer.ts";
// Within two minutes of published timetables (sunset and solar noon).
const near = (hours: number | null, clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  assert.ok(hours !== null);
  assert.ok(Math.abs(hours * 60 - (h * 60 + m)) <= 2, `${hours} vs ${clock}`);
};
test("Dhuhr and Maghrib follow the sun in local time", () => {
  const tokyo = prayerTimes("2026-10-30", 35.6895, 139.6917, "Asia/Tokyo");
  near(tokyo.dhuhr, "11:25");
  near(tokyo.maghrib, "16:48");
  const riyadh = prayerTimes("2026-06-21", 24.7136, 46.6753, "Asia/Riyadh");
  near(riyadh.dhuhr, "11:55");
  near(riyadh.maghrib, "18:45");
});
test("no Maghrib when the sun does not set", () => {
  assert.equal(
    prayerTimes("2026-06-21", 78.22, 15.65, "Arctic/Longyearbyen").maghrib,
    null,
  );
});
test("Fajr at the Umm al-Qura angle", () => {
  near(
    prayerTimes("2026-06-21", 24.7136, 46.6753, "Asia/Riyadh").fajr,
    "03:34",
  );
  near(
    prayerTimes("2026-01-01", 21.4225, 39.8262, "Asia/Riyadh").fajr,
    "05:37",
  );
});
test("no Fajr when the night never gets dark enough", () => {
  assert.equal(
    prayerTimes("2026-06-21", 59.33, 18.07, "Europe/Stockholm").fajr,
    null,
  );
});
test("qibla bearing from published values", () => {
  // Tokyo 293°, Seoul 286°, Beijing 279°, London 119°.
  const close = (a: number, b: number) =>
    assert.ok(Math.abs(a - b) <= 1, `${a} vs ${b}`);
  close(qibla(35.6895, 139.6917), 293);
  close(qibla(37.5665, 126.978), 286);
  close(qibla(39.9042, 116.4074), 279);
  close(qibla(51.5074, -0.1278), 119);
});

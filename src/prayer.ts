// Prayer times worked out from the sun's position (the method used by
// praytimes.org): Dhuhr at solar noon, Maghrib at sunset (the same in every
// common calculation method) and Fajr when the sun is 18.5° below the
// horizon before sunrise, as in the Umm al-Qura calendar.
import { instant } from "./model";
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const fix = (a: number, b: number) => ((a % b) + b) % b;
function sun(jd: number) {
  const d = jd - 2451545;
  const g = fix(357.529 + 0.98560028 * d, 360);
  const q = fix(280.459 + 0.98564736 * d, 360);
  const l = fix(
    q + 1.915 * Math.sin(rad(g)) + 0.02 * Math.sin(rad(2 * g)),
    360,
  );
  const e = 23.439 - 0.00000036 * d;
  const ra =
    fix(
      deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(l)), Math.cos(rad(l)))),
      360,
    ) / 15;
  return {
    declination: deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(l)))),
    equation: q / 15 - ra,
  };
}
const fajrAngle = 18.5;
// Hours after local midnight (in the given IANA time zone), or null when the
// sun does not set (Maghrib) or the sky never gets dark enough (Fajr).
export function prayerTimes(
  date: string,
  lat: number,
  lng: number,
  timezone: string,
) {
  const [y, m, d] = date.split("-").map(Number);
  const jd = Date.UTC(y, m - 1, d) / 86400000 + 2440587.5 - lng / 360;
  const offset =
    (Date.parse(`${date}T12:00:00Z`) - instant(date, "12:00", timezone)) /
    3600000;
  const noon = (t: number) => fix(12 - sun(jd + t).equation, 24);
  const local = (t: number) => t + offset - lng / 15;
  const dhuhr = noon(0.5);
  // When the sun is the given angle below the horizon, before (-1) or after
  // (1) noon, with its position at about time t (hours / 24).
  const below = (angle: number, side: -1 | 1, t: number) => {
    const { declination } = sun(jd + t);
    const c =
      (-Math.sin(rad(angle)) -
        Math.sin(rad(declination)) * Math.sin(rad(lat))) /
      (Math.cos(rad(declination)) * Math.cos(rad(lat)));
    if (Math.abs(c) > 1) return null;
    return noon(t) + (side * deg(Math.acos(c))) / 15;
  };
  // Refine once with the sun's position at the first estimate.
  const refined = (angle: number, side: -1 | 1, guess: number) => {
    const first = below(angle, side, guess / 24);
    const time = first === null ? null : below(angle, side, first / 24);
    return time === null ? null : local(time);
  };
  return {
    fajr: refined(fajrAngle, -1, 5),
    dhuhr: local(dhuhr),
    maghrib: refined(0.833, 1, 18),
  };
}
// Direction of the Kaaba from a point, in degrees clockwise from true north
// (the initial great-circle bearing, as compass and qibla apps give it).
const kaaba = { lat: 21.422487, lng: 39.826206 };
export function qibla(lat: number, lng: number) {
  const φ = rad(lat),
    φk = rad(kaaba.lat),
    Δλ = rad(kaaba.lng - lng);
  const y = Math.sin(Δλ);
  const x = Math.cos(φ) * Math.tan(φk) - Math.sin(φ) * Math.cos(Δλ);
  return fix(deg(Math.atan2(y, x)), 360);
}

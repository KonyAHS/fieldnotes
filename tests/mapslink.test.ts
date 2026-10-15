import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMapsLink,
  resolveMapsLink,
  LinkError,
} from "../server/mapslink.ts";
const parse = (s: string) => parseMapsLink(new URL(s));
test("reads the place pin rather than the map centre", () => {
  const l = parse(
    "https://www.google.com/maps/place/Tokyo+Tower/@35.6585805,139.7454329,17z/data=!3m1!4b1!4m6!3m5!1s0x60188bbd9009ec09:0x481a93f0d2a409dd!8m2!3d35.6585805!4d139.7454329!16zL20vMDE1Nnh2",
  );
  assert.equal(l.name, "Tokyo Tower");
  assert.equal(l.lat, 35.6585805);
  assert.equal(l.lng, 139.7454329);
});
test("decodes non-Latin names and prefers the !3d!4d pin", () => {
  const l = parse(
    "https://www.google.co.jp/maps/place/%E6%9D%B1%E4%BA%AC%E9%A7%85/@35.68,139.76,15z/data=!4m6!3m5!8m2!3d35.6812362!4d139.7671248",
  );
  assert.equal(l.name, "東京駅");
  assert.equal(l.lat, 35.6812362);
});
test("reads search links and coordinates queries", () => {
  const a = parse(
    "https://www.google.com/maps/search/?api=1&query=Gyeongbokgung%20Palace%2C%20Seoul&query_place_id=ChIJod7tSseifDUR9hXHLFNGMIs",
  );
  assert.equal(a.name, "Gyeongbokgung Palace");
  assert.equal(a.placeId, "ChIJod7tSseifDUR9hXHLFNGMIs");
  const b = parse("https://maps.google.com/?q=31.2304,121.4737");
  assert.equal(b.lat, 31.2304);
  assert.equal(b.lng, 121.4737);
  assert.equal(b.name, "");
});
test("ignores the centre of a bare map view", () => {
  const l = parse("https://www.google.com/maps/@35.0,139.0,12z");
  assert.equal(l.lat, null);
});
const deps = (redirect: string) => ({
  fetch: (async () =>
    new Response(null, {
      status: 302,
      headers: { location: redirect },
    })) as typeof fetch,
  geocode: async () => [],
  reverse: async (lat: number, lng: number) => ({
    lat,
    lng,
    name: "Somewhere",
    address: "1 Street, Kyoto",
    kind: "attraction",
  }),
  google: null,
});
test("follows short links to Google Maps", async () => {
  const p = await resolveMapsLink(
    "https://maps.app.goo.gl/abc123",
    deps(
      "https://www.google.com/maps/place/Kinkaku-ji/@35.03,135.72,17z/data=!3d35.0393!4d135.7292",
    ),
  );
  assert.equal(p.name, "Kinkaku-ji");
  assert.equal(p.lat, 35.0393);
  assert.equal(p.address, "1 Street, Kyoto");
});
test("refuses links that leave Google", async () => {
  await assert.rejects(
    resolveMapsLink(
      "https://maps.app.goo.gl/abc123",
      deps("http://192.168.1.10:81/"),
    ),
    LinkError,
  );
  await assert.rejects(
    resolveMapsLink("https://example.com/maps/place/X", deps("")),
    LinkError,
  );
});

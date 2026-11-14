import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPlace, mapLinks, placeMaps, placeIdFromLink } from "../src/model.ts";
import { directionsUrl } from "../src/dayRoute.ts";

const base = {
  ...emptyPlace(),
  name: "Tokyo Tower",
  city: "Tokyo",
  address: "4-2-8 Shibakoen, Minato",
  lat: 35.658581,
  lng: 139.745433,
};

test("opens the saved map entries when IDs are known", () => {
  const m = placeMaps({
    ...base,
    googlePlaceId: "ChIJxyz1234567890",
    applePlaceId: "I5F2E0A1B3C4D6E78",
  });
  assert.match(m.google, /query_place_id=ChIJxyz1234567890/);
  assert.match(m.googleWay, /destination_place_id=ChIJxyz1234567890/);
  assert.equal(m.apple, "https://maps.apple.com/place?place-id=I5F2E0A1B3C4D6E78");
  assert.match(m.appleWay, /^https:\/\/maps\.apple\.com\/directions\?destination=35\.658581,139\.745433&destination-place-id=I5F2E0A1B3C4D6E78$/);
});

test("falls back to searching near the place", () => {
  const m = placeMaps(base);
  assert.match(m.apple, /^https:\/\/maps\.apple\.com\/search\?query=Tokyo%20Tower%20Tokyo&center=35\.658581,139\.745433$/);
  assert.match(m.googleWay, /destination=35\.658581,139\.745433/);
});

test("reads place IDs from shared links", () => {
  assert.deepEqual(
    placeIdFromLink("https://maps.apple.com/place?place-id=I5F2E0A1B3C4D6E78&address=x"),
    { applePlaceId: "I5F2E0A1B3C4D6E78" },
  );
  assert.deepEqual(placeIdFromLink("https://maps.apple.com/?auid=1234567890&ll=1,2"), {
    applePlaceId: "auid:1234567890",
  });
  assert.deepEqual(
    placeIdFromLink("https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJabcdefghij"),
    { googlePlaceId: "ChIJabcdefghij" },
  );
  assert.deepEqual(placeIdFromLink("not a link"), {});
});

test("adds Amap for places in mainland China", () => {
  const m = placeMaps({ ...base, country: "China", lat: 22.6103, lng: 114.0302, name: "Shenzhen North" });
  assert.equal(m.local[0].name, "Amap");
  assert.match(m.local[0].place, /^https:\/\/uri\.amap\.com\/marker\?position=114\.0302,22\.6103&.*coordinate=wgs84/);
  assert.match(m.local[0].way!, /^https:\/\/uri\.amap\.com\/navigation\?to=114\.0302,22\.6103,.*mode=bus/);
  assert.deepEqual(placeMaps(base).local, []);
});

test("leaves Google Maps out in mainland China", () => {
  const china = { ...base, country: "China", lat: 22.6103, lng: 114.0302, name: "Shenzhen North" };
  const m = placeMaps(china);
  assert.equal(m.google, undefined);
  assert.equal(m.googleWay, undefined);
  assert.ok(m.apple);
  assert.ok(!mapLinks(china).some((l) => l.name === "Google Maps"));
  assert.equal(mapLinks(china)[0].name, "Amap");
  assert.ok(placeMaps({ ...china, country: "Hong Kong" }).google);
  assert.match(directionsUrl([22.6, 114.0], [22.5, 114.1], true), /^https:\/\/uri\.amap\.com\/navigation\?from=114,22\.6&to=114\.1,22\.5/);
  assert.match(directionsUrl([22.6, 114.0], [22.5, 114.1]), /google\.com\/maps\/dir/);
});

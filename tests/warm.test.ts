import test from "node:test";
import assert from "node:assert/strict";
import { weatherTargets } from "../server/warm.ts";

const data = {
  activeTripId: "t",
  places: [
    { id: "hotel", lat: 35.681, lng: 139.767 },
    { id: "museum", lat: 35.684, lng: 139.771 },
    { id: "far", lat: 34.7, lng: 135.5 },
    { id: "unplaced", lat: null, lng: null },
  ],
  trips: [
    {
      id: "t",
      start: "2030-05-01",
      end: "2030-05-20",
      activeScenarioId: "s",
      scenarios: [
        {
          id: "s",
          entries: [
            {
              type: "stay",
              date: "2030-05-01",
              endDate: "2030-05-20",
              placeId: "hotel",
            },
            {
              type: "activity",
              date: "2030-05-02",
              endDate: "2030-05-02",
              placeId: "museum",
            },
            {
              type: "activity",
              date: "2030-05-03",
              endDate: "2030-05-03",
              placeId: "far",
            },
            {
              type: "activity",
              date: "2030-05-12",
              endDate: "2030-05-12",
              placeId: "far",
            },
            {
              type: "activity",
              date: "2030-05-03",
              endDate: "2030-05-03",
              placeId: "far",
              status: "idea",
            },
            {
              type: "activity",
              date: "2030-05-03",
              endDate: "2030-05-03",
              placeId: "unplaced",
            },
          ],
        },
      ],
    },
  ],
};

test("weather is prefetched for hotels ahead and plans around today", () => {
  const targets = weatherTargets(data, "2030-05-02");
  const on = (d: string) => targets.filter((t) => t.date === d);
  // The museum shares the hotel's cache cell on its day: one request.
  assert.equal(on("2030-05-02").length, 1);
  assert.equal(on("2030-05-03").length, 2);
  // Beyond a few days only the hotel is kept warm.
  assert.equal(on("2030-05-12").length, 1);
  assert.equal(on("2030-05-01").length, 1);
  assert.ok(
    targets.every((t) => t.date >= "2030-05-01" && t.date <= "2030-05-17"),
  );
});

test("nothing is prefetched outside the trip or without an active trip", () => {
  assert.deepEqual(weatherTargets(data, "2031-01-01"), []);
  assert.deepEqual(weatherTargets({ trips: [] }, "2030-05-02"), []);
});

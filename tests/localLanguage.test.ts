import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chineseToPinyin,
  hangulToRoman,
  kanaToRomaji,
  localCode,
  localLanguage,
  readingOf,
} from "../src/localLanguage.ts";
import { emptyPlace, placeMaps } from "../src/model.ts";

test("pinyin for Chinese names, tidy punctuation", async () => {
  assert.equal(await chineseToPinyin("广州南站"), "Guǎng zhōu nán zhàn");
  assert.equal(
    await chineseToPinyin("上海虹桥站如家酒店（虹桥路店）"),
    "Shàng hǎi hóng qiáo zhàn rú jiā jiǔ diàn (hóng qiáo lù diàn)",
  );
  assert.equal(await chineseToPinyin("Tokyo"), null);
});

test("romaji from kana only; kanji need a saved reading", () => {
  assert.equal(kanaToRomaji("きっぷ"), "Kippu");
  assert.equal(kanaToRomaji("カード"), "Kaado");
  assert.equal(kanaToRomaji("さんいん"), "San'in");
  assert.equal(kanaToRomaji("東京駅"), null);
});

test("Korean romanization with carried and nasal finals", () => {
  assert.equal(hangulToRoman("감사합니다"), "Gamsahamnida");
  assert.equal(hangulToRoman("서울역"), "Seouryeok");
  assert.equal(hangulToRoman("명동"), "Myeongdong");
});

test("saved reading wins; languages by country", async () => {
  const p = { ...emptyPlace(), country: "Japan", nativeName: "東京駅" };
  assert.equal(await readingOf(p), "");
  assert.equal(
    await readingOf({ ...p, nativeReading: "Tōkyō-eki" }),
    "Tōkyō-eki",
  );
  assert.equal(localLanguage("Hong Kong")?.name, "Cantonese");
  assert.equal(localLanguage("United Kingdom"), null);
  assert.equal(localCode("China"), "cn");
});

test("Amap links open the app directly", () => {
  const m = placeMaps({
    ...emptyPlace(),
    name: "Guangzhou South",
    nativeName: "广州南站",
    country: "China",
    lat: 22.99,
    lng: 113.27,
  });
  const amap = m.local.find((l) => l.name === "Amap")!;
  assert.match(
    amap.app!.ios,
    /^iosamap:\/\/viewMap\?.*lat=22\.99&lon=113\.27&dev=1/,
  );
  assert.match(
    amap.wayApp!.android,
    /^amapuri:\/\/route\/plan\/\?.*dlat=22\.99/,
  );
  assert.match(amap.wayApp!.ios, /^iosamap:\/\/path\?.*t=1/);
});

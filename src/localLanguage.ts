// Local names for getting around: which language a country's drivers speak,
// short phrases to show them, and how to pronounce a place's local name
// (pinyin, Jyutping, romaji or romanized Korean).
import type { Place } from "./model";

export type Phrase = { native: string; reading: string; english: string };
export type LocalLanguage = {
  /** BCP 47 tag for the local text, so phones pick the right font. */
  tag: string;
  name: string;
  /** What the pronunciation is written in. */
  reading: string;
  /** Introduces the destination: "Please take me here:". */
  intro: Phrase;
  address: Phrase;
  thanks: Phrase;
  airport: Phrase;
  hurry: Phrase;
  /** Other things often needed in a taxi. */
  extras: Phrase[];
};
const p = (native: string, reading: string, english: string): Phrase => ({
  native,
  reading,
  english,
});
const mandarin: LocalLanguage = {
  tag: "zh-CN",
  name: "Mandarin",
  reading: "pinyin",
  intro: p(
    "您好，请送我到这里：",
    "Nín hǎo, qǐng sòng wǒ dào zhèlǐ:",
    "Hello, please take me here:",
  ),
  address: p("地址", "dìzhǐ", "Address"),
  thanks: p("谢谢！", "Xièxie!", "Thank you!"),
  airport: p(
    "请送我到出发层。",
    "Qǐng sòng wǒ dào chūfā céng.",
    "Please take me to the departures level.",
  ),
  hurry: p(
    "我们要赶火车，时间有点紧。",
    "Wǒmen yào gǎn huǒchē, shíjiān yǒudiǎn jǐn.",
    "We have a train to catch and are a little short on time.",
  ),
  extras: [
    p("请在这里停车。", "Qǐng zài zhèlǐ tíngchē.", "Please stop here."),
    p(
      "请等我一下，我马上回来。",
      "Qǐng děng wǒ yíxià, wǒ mǎshàng huílái.",
      "Please wait for me, I'll be right back.",
    ),
    p("请打表。", "Qǐng dǎ biǎo.", "Please use the meter."),
    p("多少钱？", "Duōshao qián?", "How much is it?"),
    p(
      "可以用支付宝或微信付款吗？",
      "Kěyǐ yòng Zhīfùbǎo huò Wēixìn fùkuǎn ma?",
      "Can I pay with Alipay or WeChat?",
    ),
    p(
      "我们有行李，请打开后备箱。",
      "Wǒmen yǒu xíngli, qǐng dǎkāi hòubèixiāng.",
      "We have luggage, please open the boot.",
    ),
    p("可以给我发票吗？", "Kěyǐ gěi wǒ fāpiào ma?", "Can I have a receipt?"),
  ],
};
const cantonese: LocalLanguage = {
  tag: "zh-HK",
  name: "Cantonese",
  reading: "Jyutping",
  intro: p(
    "你好，唔該送我去呢度：",
    "nei5 hou2, m4 goi1 sung3 ngo5 heoi3 ni1 dou6:",
    "Hello, please take me here:",
  ),
  address: p("地址", "dei6 zi2", "Address"),
  thanks: p("唔該晒！", "m4 goi1 saai3!", "Thank you!"),
  airport: p(
    "唔該去離境大堂。",
    "m4 goi1 heoi3 lei4 ging2 daai6 tong4.",
    "To the departures hall, please.",
  ),
  hurry: p(
    "我哋趕火車，時間有啲緊。",
    "ngo5 dei6 gon2 fo2 ce1, si4 gaan3 jau5 di1 gan2.",
    "We have a train to catch and are a little short on time.",
  ),
  extras: [
    p("唔該呢度停。", "m4 goi1 ni1 dou6 ting4.", "Please stop here."),
    p(
      "唔該等我一陣，我好快返嚟。",
      "m4 goi1 dang2 ngo5 jat1 zan6, ngo5 hou2 faai3 faan1 lai4.",
      "Please wait for me, I'll be right back.",
    ),
    p("幾多錢？", "gei2 do1 cin2?", "How much is it?"),
    p(
      "可唔可以用八達通或者信用卡俾錢？",
      "ho2 m4 ho2 ji5 jung6 baat3 daat6 tung1 waak6 ze2 seon3 jung6 kaat1 bei2 cin2?",
      "Can I pay by Octopus or credit card?",
    ),
    p(
      "我哋有行李，唔該開尾箱。",
      "ngo5 dei6 jau5 hang4 lei5, m4 goi1 hoi1 mei5 soeng1.",
      "We have luggage, please open the boot.",
    ),
    p(
      "唔該俾張收據我。",
      "m4 goi1 bei2 zoeng1 sau1 geoi3 ngo5.",
      "A receipt, please.",
    ),
  ],
};
const japanese: LocalLanguage = {
  tag: "ja",
  name: "Japanese",
  reading: "romaji",
  intro: p(
    "すみません、ここまでお願いします。",
    "Sumimasen, koko made onegaishimasu.",
    "Excuse me, please take me here.",
  ),
  address: p("住所", "jūsho", "Address"),
  thanks: p("ありがとうございます。", "Arigatō gozaimasu.", "Thank you."),
  airport: p(
    "出発ロビーまでお願いします。",
    "Shuppatsu robī made onegaishimasu.",
    "To the departures hall, please.",
  ),
  hurry: p(
    "電車に乗るので、少し急いでいます。",
    "Densha ni noru node, sukoshi isoide imasu.",
    "We have a train to catch and are a little short on time.",
  ),
  extras: [
    p("ここで止めてください。", "Koko de tomete kudasai.", "Please stop here."),
    p(
      "少し待っていてください。すぐ戻ります。",
      "Sukoshi matte ite kudasai. Sugu modorimasu.",
      "Please wait a moment, I'll be right back.",
    ),
    p("いくらですか？", "Ikura desu ka?", "How much is it?"),
    p("カードで払えますか？", "Kādo de haraemasu ka?", "Can I pay by card?"),
    p(
      "荷物があります。トランクを開けてください。",
      "Nimotsu ga arimasu. Toranku o akete kudasai.",
      "We have luggage, please open the boot.",
    ),
    p(
      "領収書をお願いします。",
      "Ryōshūsho o onegaishimasu.",
      "A receipt, please.",
    ),
  ],
};
const korean: LocalLanguage = {
  tag: "ko",
  name: "Korean",
  reading: "romanization",
  intro: p(
    "기사님, 여기로 가 주세요.",
    "Gisanim, yeogiro ga juseyo.",
    "Driver, please take me here.",
  ),
  address: p("주소", "juso", "Address"),
  thanks: p("감사합니다!", "Gamsahamnida!", "Thank you!"),
  airport: p(
    "출국장으로 가 주세요.",
    "Chulgukjang-euro ga juseyo.",
    "To departures, please.",
  ),
  hurry: p(
    "기차를 타야 해서 좀 급해요.",
    "Gichareul taya haeseo jom geupaeyo.",
    "We have a train to catch and are a little short on time.",
  ),
  extras: [
    p("여기서 세워 주세요.", "Yeogiseo sewo juseyo.", "Please stop here."),
    p(
      "잠깐만 기다려 주세요. 금방 올게요.",
      "Jamkkanman gidaryeo juseyo. Geumbang olgeyo.",
      "Please wait a moment, I'll be right back.",
    ),
    p("얼마예요?", "Eolmayeyo?", "How much is it?"),
    p(
      "카드로 계산할 수 있어요?",
      "Kadeuro gyesanhal su isseoyo?",
      "Can I pay by card?",
    ),
    p(
      "짐이 있어요. 트렁크 좀 열어 주세요.",
      "Jimi isseoyo. Teureongkeu jom yeoreo juseyo.",
      "We have luggage, please open the boot.",
    ),
    p("영수증 주세요.", "Yeongsujeung juseyo.", "A receipt, please."),
  ],
};
const byCountry: Record<string, LocalLanguage> = {
  china: mandarin,
  "hong kong": cantonese,
  macau: cantonese,
  macao: cantonese,
  japan: japanese,
  korea: korean,
  "south korea": korean,
};
export const localLanguage = (country: string): LocalLanguage | null =>
  byCountry[country.trim().toLowerCase()] || null;

// Two-letter codes the server's local-name lookup understands.
const codes: Record<string, string> = {
  china: "cn",
  "hong kong": "hk",
  macau: "mo",
  macao: "mo",
  japan: "jp",
  korea: "kr",
  "south korea": "kr",
};
export const localCode = (country: string) =>
  codes[country.trim().toLowerCase()] || "";

// Whether a place has something worth showing in the local script.
export const hasLocal = (p: Place) =>
  Boolean(p.nativeName.trim() || p.nativeAddress.trim());

// ---- Pronunciation ----

const han = /[㐀-鿿豈-﫿]/;
const kana = /[぀-ヿ]/;
const hangul = /[가-힣]/;

// Kana to Hepburn romaji. Kanji have many readings, so names with kanji
// need their reading entered by hand.
const kanaTable: Record<string, string> = {};
(() => {
  const rows =
    "あ a い i う u え e お o か ka き ki く ku け ke こ ko さ sa し shi す su せ se そ so た ta ち chi つ tsu て te と to な na に ni ぬ nu ね ne の no は ha ひ hi ふ fu へ he ほ ho ま ma み mi む mu め me も mo や ya ゆ yu よ yo ら ra り ri る ru れ re ろ ro わ wa を o ん n が ga ぎ gi ぐ gu げ ge ご go ざ za じ ji ず zu ぜ ze ぞ zo だ da ぢ ji づ zu で de ど do ば ba び bi ぶ bu べ be ぼ bo ぱ pa ぴ pi ぷ pu ぺ pe ぽ po ぁ a ぃ i ぅ u ぇ e ぉ o ゔ vu " +
    "きゃ kya きゅ kyu きょ kyo しゃ sha しゅ shu しょ sho ちゃ cha ちゅ chu ちょ cho にゃ nya にゅ nyu にょ nyo ひゃ hya ひゅ hyu ひょ hyo みゃ mya みゅ myu みょ myo りゃ rya りゅ ryu りょ ryo ぎゃ gya ぎゅ gyu ぎょ gyo じゃ ja じゅ ju じょ jo びゃ bya びゅ byu びょ byo ぴゃ pya ぴゅ pyu ぴょ pyo " +
    "しぇ she ちぇ che じぇ je てぃ ti でぃ di ふぁ fa ふぃ fi ふぇ fe ふぉ fo うぃ wi うぇ we";
  const parts = rows.split(" ").filter(Boolean);
  for (let i = 0; i < parts.length; i += 2) kanaTable[parts[i]] = parts[i + 1];
})();
export function kanaToRomaji(text: string): string | null {
  if (han.test(text) || !kana.test(text)) return null;
  // Katakana to hiragana (the long-vowel mark stays).
  const s = text.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const two = kanaTable[s.slice(i, i + 2)];
    if (two) {
      out += two;
      i++;
      continue;
    }
    const c = s[i];
    if (c === "っ" || c === "ッ") {
      const next = kanaTable[s.slice(i + 1, i + 3)] || kanaTable[s[i + 1]];
      if (next) out += next.startsWith("ch") ? "t" : next[0];
      continue;
    }
    if (c === "ー") {
      out += out.match(/[aeiou]$/)?.[0] || "";
      continue;
    }
    if (c === "ん") {
      const next = kanaTable[s.slice(i + 1, i + 3)] || kanaTable[s[i + 1]];
      out += next && /^[aeiouy]/.test(next) ? "n'" : "n";
      continue;
    }
    if (c === "・") {
      out += " ";
      continue;
    }
    out += kanaTable[c] ?? c;
  }
  return out.replace(/^./, (c) => c.toUpperCase());
}

// Hangul to Revised Romanization. Sound changes between syllables are only
// partly followed, so the result is close rather than exact.
const initials = "g kk n d tt r m b pp s ss - j jj ch k t p h".split(" ");
const vowels =
  "a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i".split(" ");
const finals = "- k k k n n n t l k m l l l p l m p p t t ng t t k t p t".split(
  " ",
);
// A final consonant carried over to a following vowel.
const carried =
  "- g kk ks n nj nh d r lg lm lb ls lt lp lh m b bs s ss - j ch k t p -".split(
    " ",
  );
export function hangulToRoman(text: string): string | null {
  if (!hangul.test(text)) return null;
  const syl = [...text].map((c) => {
    const code = c.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return null;
    return {
      i: Math.floor(code / 588),
      v: Math.floor((code % 588) / 28),
      f: code % 28,
    };
  });
  let out = "";
  [...text].forEach((c, n) => {
    const s = syl[n];
    if (!s) {
      out += c;
      return;
    }
    const prev = syl[n - 1];
    const next = syl[n + 1];
    // A silent ㅇ takes the previous final's sound (added with that final).
    if (s.i !== 11) out += prev?.f === 8 && s.i === 5 ? "l" : initials[s.i];
    out += vowels[s.v];
    if (!s.f) return;
    let f = finals[s.f];
    if (next?.i === 11) f = s.f === 21 ? "ng" : carried[s.f];
    else if (next && s.f === 8 && next.i === 5) f = "l";
    // Nasal before ㄴ/ㅁ: 합니다 → hamnida.
    else if (next && (next.i === 2 || next.i === 6))
      f = ({ k: "ng", t: "n", p: "m" } as Record<string, string>)[f] || f;
    out += f.replace("-", "");
  });
  return out.replace(/^./, (c) => c.toUpperCase());
}

// Pinyin is worked out with pinyin-pro, loaded only when first needed.
let pinyinLib: Promise<typeof import("pinyin-pro")> | null = null;
export async function chineseToPinyin(text: string): Promise<string | null> {
  if (!han.test(text)) return null;
  pinyinLib ||= import("pinyin-pro");
  const { pinyin } = await pinyinLib;
  const out = pinyin(text, { toneType: "symbol", nonZh: "consecutive" })
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/\s*\(\s*/g, " (")
    .replace(/\s*\)\s*/g, ") ")
    .replace(/\s*[·・]\s*/g, " · ")
    .replace(/\s*([，,、：:])\s*/g, (_, c: string) =>
      "，、".includes(c) ? ", " : c === "：" ? ": " : `${c} `,
    )
    .replace(/\s+/g, " ")
    .trim();
  return out.replace(/^./, (c) => c.toUpperCase());
}

// How to say a place's local name: the saved reading, else one worked out
// from the name (Mandarin pinyin, kana and Hangul; not kanji or Cantonese).
export async function readingOf(
  place: Pick<Place, "nativeName" | "nativeReading" | "country">,
): Promise<string> {
  if (place.nativeReading?.trim()) return place.nativeReading.trim();
  const name = place.nativeName.trim();
  if (!name) return "";
  const lang = localLanguage(place.country);
  try {
    if (lang === mandarin) return (await chineseToPinyin(name)) || "";
    if (lang === japanese) return kanaToRomaji(name) || "";
    if (lang === korean) return hangulToRoman(name) || "";
  } catch {
    // Offline before the pinyin data was ever loaded: no reading.
  }
  return "";
}

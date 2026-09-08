/**
 * Deterministic transliteration into the Latin alphabet.
 *
 * This exists to power a *clue*, not to teach spelling, so approximate is fine
 * — but it must be deterministic, because two players buying the same clue must
 * see the same string. Where a script cannot be transliterated without a
 * dictionary (Japanese kanji, whose readings are context-dependent), we return
 * `null` rather than guessing.
 */

import type { ScriptFamily } from '../../src/content/types.ts';

// --- Cyrillic -------------------------------------------------------------
// Russian and Ukrainian assign different sounds to shared letters (г is /g/ in
// Russian but /ɦ/ in Ukrainian; и is /i/ in Russian but /ɪ/ in Ukrainian), so
// they need separate tables. A single "Cyrillic" table would be wrong for one.

const RUS: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const UKR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye', ж: 'zh', з: 'z',
  и: 'y', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ь: '', ю: 'yu', я: 'ya',
};

function romanizeCyrillic(word: string, table: Record<string, string>): string {
  let out = '';
  for (const ch of word.toLowerCase()) {
    if (ch in table) out += table[ch];
    else if (/['’\u02BC-]/.test(ch)) out += ch === '-' ? '-' : '';
    else out += ch;
  }
  return out;
}

// --- Japanese kana --------------------------------------------------------
// Hepburn-ish. Digraphs must be tried before single kana, hence the length sort.

const KANA: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'wo', ん: 'n',
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo',
};

const KANA_KEYS = Object.keys(KANA).sort((a, b) => b.length - a.length);
const RE_KANJI = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

function romanizeKana(word: string): string | null {
  // Kanji readings are context-dependent and need a dictionary. Refuse rather
  // than emit a plausible-looking wrong answer to a player who paid for it.
  if (RE_KANJI.test(word)) return null;

  let out = '';
  let i = 0;
  while (i < word.length) {
    // Sokuon: っ geminates the following consonant (きって -> kitte).
    if (word[i] === 'っ') {
      const rest = romanizeKana(word.slice(i + 1));
      if (rest === null) return null;
      return out + (rest[0] ?? '') + rest;
    }
    const key = KANA_KEYS.find((k) => word.startsWith(k, i));
    if (!key) return null;
    out += KANA[key];
    i += key.length;
  }
  return out;
}

// --- Korean Hangul --------------------------------------------------------
// Revised Romanization, computed by decomposing the precomposed syllable block.
// This omits inter-syllable assimilation (e.g. 신라 is properly "Silla", not
// "sinra"), which is acceptable for a hint but is documented here so nobody
// mistakes it for a full RR implementation.

const RR_INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const RR_MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const RR_FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'p', 't', 't', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

function romanizeHangul(word: string): string | null {
  let out = '';
  for (const ch of word) {
    const code = ch.codePointAt(0)!;
    if (code < HANGUL_BASE || code > HANGUL_LAST) {
      if (/['’\u02BC-]/.test(ch)) continue;
      return null; // non-syllable jamo or stray character
    }
    const offset = code - HANGUL_BASE;
    out += RR_INITIAL[Math.floor(offset / 588)];
    out += RR_MEDIAL[Math.floor((offset % 588) / 28)];
    out += RR_FINAL[offset % 28];
  }
  return out;
}

/**
 * Romanize `word` for `language`.
 * Returns `null` when no faithful deterministic transliteration exists, and for
 * Latin-script languages (where the written form already *is* Latin).
 */
export function romanize(word: string, language: string, script: ScriptFamily): string | null {
  switch (script) {
    case 'latin':
      return null;
    case 'cyrillic':
      return romanizeCyrillic(word, language === 'ukr' ? UKR : RUS);
    case 'japanese':
      return romanizeKana(word);
    case 'hangul':
      return romanizeHangul(word);
  }
}

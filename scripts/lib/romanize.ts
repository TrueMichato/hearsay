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


// --- Devanagari -----------------------------------------------------------
//
// Devanagari is an *abugida*: each consonant letter carries an inherent /a/
// unless a following vowel sign replaces it or a virama (्) cancels it. That
// makes transliteration genuinely mechanical, unlike the scripts below, so an
// honest romanization is derivable here without a pronunciation dictionary.

const DEVA_CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ṅ',
  च: 'c', छ: 'ch', ज: 'j', झ: 'jh', ञ: 'ñ',
  ट: 'ṭ', ठ: 'ṭh', ड: 'ḍ', ढ: 'ḍh', ण: 'ṇ',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm',
  य: 'y', र: 'r', ल: 'l', व: 'v',
  श: 'ś', ष: 'ṣ', स: 's', ह: 'h',
  ळ: 'ḷ', क़: 'q', ख़: 'x', ग़: 'ġ', ज़: 'z', ड़: 'ṛ', ढ़: 'ṛh', फ़: 'f',
};

/** Independent vowel letters, used word-initially. */
const DEVA_VOWELS: Record<string, string> = {
  अ: 'a', आ: 'ā', इ: 'i', ई: 'ī', उ: 'u', ऊ: 'ū',
  ऋ: 'ṛ', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऍ: 'ê', ऑ: 'ô',
};

/** Dependent vowel signs, which replace a consonant's inherent /a/. */
const DEVA_MATRAS: Record<string, string> = {
  'ा': 'ā', 'ि': 'i', 'ी': 'ī', 'ु': 'u', 'ू': 'ū',
  'ृ': 'ṛ', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'ê', 'ॉ': 'ô',
};

const DEVA_SIGNS: Record<string, string> = {
  'ं': 'ṃ', 'ः': 'ḥ', 'ँ': 'ṁ', '़': '',
};

const DEVA_VIRAMA = '\u094D';

function romanizeDevanagari(word: string): string | null {
  let out = '';
  const chars = [...word.normalize('NFC')];

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];

    if (DEVA_CONSONANTS[c] !== undefined) {
      out += DEVA_CONSONANTS[c];
      const next = chars[i + 1];
      if (next === DEVA_VIRAMA) {
        i++; // virama cancels the inherent vowel; emit nothing
      } else if (next !== undefined && DEVA_MATRAS[next] !== undefined) {
        out += DEVA_MATRAS[next];
        i++;
      } else if (next !== undefined && next === '\u093C') {
        // nukta already folded into the composed consonant above
      } else {
        out += 'a'; // the inherent vowel
      }
      continue;
    }

    if (DEVA_VOWELS[c] !== undefined) {
      out += DEVA_VOWELS[c];
      continue;
    }
    if (DEVA_SIGNS[c] !== undefined) {
      out += DEVA_SIGNS[c];
      continue;
    }
    if (c === '-' || c === "'" || c === '\u2019') {
      out += c;
      continue;
    }
    // An unmapped character means the transliteration would be misleading.
    return null;
  }

  return out.length > 0 ? out : null;
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
    case 'devanagari':
      return romanizeDevanagari(word);

    // The remaining scripts have no *faithful deterministic* transliteration,
    // and returning a plausible-looking wrong one would be worse than returning
    // nothing: romanization is sold to the player as a clue, so it has to be
    // trustworthy.
    //
    //  - Arabic and Hebrew are abjads. Short vowels are simply not written, so
    //    the same letters spell several different words and no algorithm can
    //    recover the vowels without a dictionary or morphological analysis.
    //  - Han characters encode meaning, not sound. Deriving pinyin needs a
    //    character-to-reading dictionary, and many characters are polyphonic,
    //    so the reading depends on the word rather than the character.
    case 'arabic':
    case 'hebrew':
    case 'han':
      return null;
  }
}

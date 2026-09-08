# Hearsay

A browser game about telling languages apart **by ear**.

Sixteen tiles. Each one plays a single word spoken by a native speaker. Group
them by language. The languages are chosen to sound alike — Spanish against
Portuguese against Italian, Russian against Polish against Ukrainian, Japanese
against Korean — so guessing from a stray familiar word will not save you.

---

## If you are new to any of this

This section explains the ideas the project is built on. Skip it if you already
know them.

**What "the stack" means.** A modern web app is usually assembled from a few
independent tools rather than one framework:

- **Vite** is the *build tool*. Browsers cannot run TypeScript or JSX directly,
  so Vite translates your source into plain JavaScript. In development it also
  runs a server that swaps changed code into the running page instantly.
- **React** is the *UI library*. Instead of writing "find this element and
  change its text", you write a function that returns what the screen *should*
  look like for the current data, and React works out the minimal set of DOM
  changes. Those functions are called components.
- **TypeScript** is JavaScript with type annotations. It catches whole classes
  of mistakes — a misspelled field, a function called with the wrong arguments —
  before the code ever runs.
- **Tailwind** is a *styling* approach. Rather than writing CSS in a separate
  file, you compose small utility classes directly in the markup:
  `rounded-xl bg-slate-800 p-3` instead of inventing a class name and defining
  it elsewhere.
- **Dexie** is a friendly wrapper over **IndexedDB**, the database every browser
  ships with. It stores structured data on the player's own machine and survives
  closing the tab.
- **vite-plugin-pwa** turns the site into a **PWA** (Progressive Web App): it
  generates a *service worker*, a script the browser keeps running alongside the
  page that can answer network requests from a local cache. That is what makes
  the game work with no connection.

**What "local-first" means here.** There is no server, no account, no sync.
Every score, every statistic, every coin lives in IndexedDB on the device that
earned it. The upside is privacy and offline play; the trade-off is that
clearing site data really does erase everything, and progress does not follow
you to another device.

---

## Playing

```bash
npm install
npm run dev          # http://localhost:5173
```

Three difficulties:

| Mode | Buckets | What you are told | Which languages |
| --- | --- | --- | --- |
| Easy | 3–4, labelled | The language names | All from **different** similarity groups |
| Medium | 3–4, unlabelled | Nothing — just separate them | At most **one** confusable pair |
| Hard | none | Not even how many languages there are (2–5) | Deliberately **one tight cluster**, 75% of the time |

**Difficulty controls the languages, not just the scaffolding.** An earlier
version varied only the buckets — whether they existed and whether they were
labelled — and drew languages the same way at every level. An Easy round duly
dealt Spanish / Portuguese / Catalan / Italian: the four hardest languages in
the corpus to tell apart, served with training wheels. Labelled buckets do not
make an impossible task easy. Each language therefore carries a **similarity
group** in `scripts/content.config.ts` (`romance`, `slavic`, `east-asian`,
`germanic`, `turkic`, `basque`), and `SIMILARITY_POLICY` in `src/game/board.ts`
says how much confusability each difficulty may serve. Because the rule is
written against that metadata rather than a hardcoded list of language triples,
adding languages keeps it correct.

**Interaction is tap-to-select, then tap a group.** Deliberately *not* HTML5
drag-and-drop, which behaves badly on touch screens and is close to impossible
to operate with a keyboard or screen reader. Everything works from the keyboard:
arrow keys move around the grid, <kbd>Enter</kbd> plays and selects a tile, and
<kbd>1</kbd>–<kbd>5</kbd> drop the selection into a group.

A round is addressable: `#/play/easy/<seed>` always deals the same sixteen
clips. That is what the end-to-end tests use, and it is what a daily challenge
would be built on.

### Why tiles have no text

Showing the written word would break the game. `shch` is unmistakably Russian
on the page; the point is to hear it. Text is therefore something you **buy** —
the clue shop sells a tile's spelling, its romanisation, its language, or a
colour-coding that groups tiles without naming the languages. Clues cost coins,
coins come from good rounds, so a clue is a real trade.

### Why nothing in the browser spells out the answer

Clips used to be called `ita-0013` and live at `/audio/ita/ita-0013.opus`. The
id went into the DOM as a test hook and the path went into the network tab, so
anyone with developer tools open could read every answer before a note played.
That is worse than spoiling one round: the clue shop sells information the
browser was giving away, so the whole in-game economy was priced against
nothing.

Every clip now has an **opaque id** — the first 12 hex characters of
`sha256(language ␀ word ␀ speaker)` — and audio is stored flat at
`/audio/<id>.opus` with no language in the path. The id is *derived from
content*, not random, which matters twice over: re-running the pipeline
reproduces exactly the same filenames, so the corpus does not churn in git, and
IndexedDB keys survive a regeneration.

This is not cryptography. The manifest still maps ids to languages, because the
app needs it, and a determined player can read it. The goal is that nothing in
the DOM, the URL bar or the network tab *casually* announces the answer. The
manifest is also sorted by id rather than by language, so its natural order
leaks nothing either.

---

## Where the audio comes from

Every clip is a real recording by a volunteer native speaker, taken from
[Lingua Libre](https://lingualibre.org/) via Wikimedia Commons.

Browser speech synthesis was rejected deliberately: the available voices differ
by device and operating system, so two players would hear materially different
games and no score or statistic would be comparable.

**Licences vary per file.** The current corpus is CC0 ×285, CC BY-SA 4.0 ×199
and CC BY 4.0 ×76. CC BY and CC BY-SA both *require* naming the author and
linking the licence, so per-clip licence, speaker and source URL are captured in
the manifest and rendered on the in-app credits page. That page is a legal
obligation, not decoration. Because the repository is public, the audio is also
redistributed independently of the running app, so the pipeline additionally
emits [`ATTRIBUTION.md`](./ATTRIBUTION.md) — the same per-clip credits in a form
that travels with the files. The clips are modified (trimmed,
loudness-normalised, metadata-stripped, re-encoded to Opus), so the CC BY-SA
ones are redistributed under CC BY-SA 4.0 as ShareAlike requires.

### Regenerating the corpus

```bash
npm run content            # all configured languages
npm run content -- rus pol # just these two
```

Scaling to more languages is a change to `scripts/content.config.ts` and nothing
else. Recording counts for the candidate languages are noted there in comments.
That claim has now been exercised rather than asserted: the corpus grew from ten
languages to **fourteen** (560 clips, 94 distinct speakers, 2.6 MB) by editing
that file alone. The four additions — German, Swedish, Turkish, Basque — were
not decoration. Easy takes one language per similarity group, so with only three
groups a four-bucket Easy board was arithmetically impossible; the additions
brought the corpus to six groups.

Requires `ffmpeg`; the pipeline falls back to the `ffmpeg-static` npm binary and
fails with instructions if neither is available.

### Curation heuristics

Random dictionary entries make a bad game. A Japanese entry like オタマトーン
("otamatone") sounds cross-linguistic and turns a round into a coin flip. Words
are therefore filtered, and **every rejection is counted and printed**, so the
filters can be audited instead of trusted:

| Rejected | Why |
| --- | --- |
| Multi-word entries | The game is one word per tile |
| Leading or trailing hyphen | A bound morpheme (`секс-`, `dar-`) — a prefix, not a word |
| Digits, stray punctuation | Not a spoken word |
| Wrong script for the language | Mis-filed upload |
| Latin letters in a non-Latin language | Romanised entry or loanword |
| Capitalised words (Latin/Cyrillic only) | Proper nouns. In German this also discards every ordinary noun — kept anyway, see below |
| ALL CAPS | Acronyms |
| **Any katakana, in Japanese** | Katakana *is* the loanword script. Cost 187 rejections and removed the オタマトーン class wholesale |
| Too short / too long | Bounds are script-aware: Latin and Cyrillic 3–14, Japanese 1 (if it contains kanji) to 6, Hangul 2–6 |
| Over a speaker's quota | See below |
| Implausible duration | Truncated or silent recordings |

Two subtleties worth knowing:

- **The order of the checks matters, not just the outcome.** The Latin-script
  test runs *before* the length test. Both reject `Shokubutsu`, so play is
  unaffected either way — but with the checks the other way round the tally
  reports it as "too long", and an audit trail that lies is worse than none.
- **Speakers are round-robined, not taken in order.** Otherwise a language
  becomes one contributor's voice and the player learns that person rather than
  the language.
- **German pays a real price for the proper-noun filter, and keeps it anyway.**
  German capitalises *every* noun, so the capitalisation rule throws away German
  nouns wholesale — 3,740 rejections, the highest of any language. It stays,
  because case is the only dictionary-free signal for a proper noun, and a board
  of names is far worse than a board without nouns: names travel between
  languages, so "Berlin" is no evidence of German at all. With 26,112 recordings
  to draw on, German still filled its full 40 words from verbs, adjectives and
  adverbs. The cost was affordable; the check was worth keeping.

### A sampling trap worth knowing about

Lingua Libre content arrives in **batches with a shared character**. Sampling
only the newest Russian uploads returned a batch that was around 85% multi-word
phrases and starved the language to 10 usable words out of 40. The fetcher now
draws half from the newest end of a category and half from the oldest, so no
single upload session can dominate a language.

### Why the audio is committed

The source WAVs total 48 MB. Transcoded to Opus the whole corpus is **2.6 MB —
an 18× reduction**, smaller than a couple of photographs. That is cheap enough
to commit, and committing it buys two things worth more than the bytes: genuine
offline-first play, and a deterministic corpus, so every player gets the same
game. Runtime fetching with Cache API storage would have saved 2.6 MB in the
repository and cost both.

Audio is also **loudness-normalised**. That is a fairness measure rather than
polish: if one language's contributors happened to record louder, volume becomes
an accidental tell. Metadata is stripped for the same reason — the answer should
not be readable in the network tab.

---

## Scoring

Easy and Medium are straightforward: +100 for a tile in the right bucket, −60
for a wrong one, nothing for a tile you left alone, then a difficulty multiplier
(×1, ×1.25, ×1.5). Skipping is never punished, and a negative score mints no
coins.

Hard needs a different model, because the player's group names are arbitrary —
"Group A" is not an answer, only a claim that these tiles belong together. So
Hard scores **pairs**: for every pair of tiles, being grouped together scores
positively if they share a language and negatively if they do not, and splitting
one language across two groups costs half as much. The result is normalised
against a perfect board, so a five-language round is worth the same as a
two-language one when played perfectly.

Confusion data still works in Hard mode: each player group is mapped to its
majority language, so "you put Korean in your Japanese pile" is recoverable even
though you never named the piles.

---

## Statistics

Because the interesting question is not "what did you score" but "which
languages do you confuse", the schema models that from the start:

- a **confusion matrix** — rows are the language played, columns the language
  you answered, so the off-diagonal cells name your specific weak pairs
- per-language accuracy, day and win streaks, improvement over time, and which
  clues you lean on

The Dexie schema is versioned. The rule, written in `src/db/database.ts`, is
that **an existing `version(n)` block is never edited** — you add a new one — so
a returning player migrates through every intermediate step rather than meeting
a schema their data has never seen. A round is written in a single transaction,
so closing the tab mid-write cannot record a round but lose the streak.

---

## Verification

The brief for this project asked for proof rather than assurances, so:

```bash
npm run typecheck   # tsc across app, scripts and tests
npm run lint        # oxlint
npm test            # 55 unit tests
npm run e2e         # 11 tests in a real browser, against the production build
```

The end-to-end suite plays complete rounds at all three difficulties, checks the
scoring arithmetic (including negative scores, and that a negative score mints
no coins), completes a round using only the keyboard, reloads the page to prove
statistics really came back out of IndexedDB, measures tap targets on a 375 px
viewport, and **switches the network off** to play a full round offline.

Audio is asserted from the media clock, not from a CSS class: tiles expose
`data-played`, which flips only when the browser fires `timeupdate` past zero
seconds. A `play()` call that silently failed would leave it `false`.

### Every gate has been watched failing

A check that has never failed is not evidence that it works. Each of these was
broken at its real call site, observed failing, and restored:

| Gate | Deliberate break | Result |
| --- | --- | --- |
| Manifest integrity | Blanked one clip's `license` | `cat-0008 has no licence` |
| Manifest integrity | Deleted `spa-0003.opus` | `missing audio for spa-0003` |
| Scoring | Removed the `Math.max(0, …)` coin clamp | 3 failures, `expected -38 to be +0` |
| Board generation | Relaxed cluster viability to `>= 2` | `expected 2 to be >= 3` |
| Curation ordering | Swapped the Latin and length checks | got `too-long`, wanted `latin-in-non-latin-script` |
| Audio playback | Pointed tiles at a non-existent file | `data-played` stayed `false` |
| Offline | Dropped `opus` from the precache globs | precache fell 412 → 12 entries, offline round failed |
| Mobile tap targets | Forced the board to 8 columns | `tap target width … Received: 36.875` |
| **Tile DOM leak** | Added `data-language={tile.language}` to `Tile.tsx` | `tile-f6fdf85d3e54 leaks "ces"` (4 tests) |
| **Audio URL leak** | Restored `audio/${clip.language}/…` in `toClipTile` | `audio URL leaks "cat": /audio/cat/d689bb2b107c.opus` |
| **Easy similarity ceiling** | `easy.maxPerCluster` 1 → 2 | `expected 2 to be 1` |
| **Medium pair limit** | `medium.clustersAtMax` 1 → 2 | `expected 2 to be 1` |
| **The reported bug itself** | Routed Easy/Medium back through the Hard draw | 3 similarity tests failed |
| **Hard cluster bias** | `CLUSTER_BIAS` 0.75 → 0 | `expected 0.033 to be greater than 0.5` |
| **Manifest ordering** | Re-sorted clips by language | `expected 0.025 to be greater than 0.7` |
| **Orphan audio** | Created a stale `public/audio/ita/ita-0001.opus` | `audio/ita/ is a stale per-language directory` |
| **Non-opaque id** | Set one clip id back to `rus-0001` | `rus-0001 is not an opaque id` |
| **Mis-split filename** | Made `refineWord` ignore the authoritative speaker | `expected 'walker-epíteto' to be 'epíteto'` |
| **Bound morpheme** | Removed the leading/trailing-hyphen check | `expected { ok: true } to deeply equal { reason: 'bound-morpheme' }` |

The last two are unusual: they were watched failing **against the shipped
corpus**, not a planted example. Both were written after reading the generated
`ATTRIBUTION.md` and noticing it credited a real contributor,
`Wikipedian-walker`, next to the word "walker-epíteto" — which is not a word.
The Lingua Libre filename `LL-Q1321 (spa)-Wikipedian-walker-epíteto.wav` is
genuinely ambiguous, and the parser split it at the first hyphen. Commons
resolves the ambiguity in each file's `Artist` metadata, so the pipeline now
re-splits once the speaker's real name is known. The same read turned up three
bound morphemes — `секс-`, `dar-`, `сексо-` — prefixes that are never spoken
alone and make a poor tile.

One break is more interesting than the rest. Relaxing `easy.maxPerCluster` from
1 to 2 did **not** fail the main "never two same-cluster languages on Easy"
test — with six clusters and at most four buckets, the greedy picker never needs
a second pass, so the number was not load-bearing on the shipped corpus. The
code was right; the test was not proving what it claimed. A second test now runs
the same policy against a deliberately thin two-cluster corpus, where the
constraint has to bite. **A mutation that survives is a question, not a
verdict.**

---

## Renaming

The product name lives in exactly one place: `src/config/branding.ts`. It flows
into the page title, the PWA manifest, the Wikimedia `User-Agent` and the
IndexedDB database name.

One caveat: because the database name is derived from the brand slug, renaming
the game **starts a fresh database** and existing players appear to lose their
history. If the name ever changes, add a migration that copies the old database
first.

---

## Layout

```
scripts/            content pipeline (fetch, curate, transcode, manifest)
  content.config.ts languages, clusters, rate limits — the scaling knob
  lib/curate.ts     word filtering; decides whether rounds are fair
src/
  config/branding.ts  the one place the name is written
  content/            manifest + shared types (build-time and runtime)
  game/               board generation, scoring, clues — pure, no React
  db/                 versioned Dexie schema and derived statistics
  components/         board, tiles, group tray, clue shop, results
  pages/              home, play, stats, credits
e2e/                  browser verification
public/audio/         the Opus corpus
```

## Attribution

Recordings by Lingua Libre contributors, via Wikimedia Commons, under CC0,
CC BY 4.0 and CC BY-SA 4.0. Per-clip credits are in the app under **Credits**.

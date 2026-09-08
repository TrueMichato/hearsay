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

| Mode | Buckets | What you are told |
| --- | --- | --- |
| Easy | 3–4, labelled | The language names |
| Medium | 3–4, unlabelled | Nothing — just separate them |
| Hard | none | Not even how many languages there are (2–5) |

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

---

## Where the audio comes from

Every clip is a real recording by a volunteer native speaker, taken from
[Lingua Libre](https://lingualibre.org/) via Wikimedia Commons.

Browser speech synthesis was rejected deliberately: the available voices differ
by device and operating system, so two players would hear materially different
games and no score or statistic would be comparable.

**Licences vary per file.** The current corpus is CC0 ×201, CC BY-SA 4.0 ×109
and CC BY 4.0 ×90. CC BY and CC BY-SA both *require* naming the author and
linking the licence, so per-clip licence, speaker and source URL are captured in
the manifest and rendered on the in-app credits page. That page is a legal
obligation, not decoration.

### Regenerating the corpus

```bash
npm run content            # all configured languages
npm run content -- rus pol # just these two
```

Scaling to more languages is a change to `scripts/content.config.ts` and nothing
else. Recording counts for the candidate languages are noted there in comments.

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
| Digits, stray punctuation | Not a spoken word |
| Wrong script for the language | Mis-filed upload |
| Latin letters in a non-Latin language | Romanised entry or loanword |
| Capitalised words (Latin/Cyrillic only) | Proper nouns. Keyed off script, because German capitalises every noun |
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

### A sampling trap worth knowing about

Lingua Libre content arrives in **batches with a shared character**. Sampling
only the newest Russian uploads returned a batch that was around 85% multi-word
phrases and starved the language to 10 usable words out of 40. The fetcher now
draws half from the newest end of a category and half from the oldest, so no
single upload session can dominate a language.

### Why the audio is committed

The source WAVs total 34 MB. Transcoded to Opus the whole corpus is **1.5 MB — a
23× reduction**, smaller than a single photograph. That is cheap enough to
commit, and committing it buys two things worth more than the bytes: genuine
offline-first play, and a deterministic corpus, so every player gets the same
game. Runtime fetching with Cache API storage would have saved 1.5 MB in the
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

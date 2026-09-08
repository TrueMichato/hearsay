# Hearsay

A browser game about telling languages apart **by ear**.

Sixteen tiles. Each one plays a single word spoken by a native speaker. Group
them by language. The languages are chosen to sound alike — Spanish against
Portuguese against Italian, Russian against Polish against Ukrainian, Japanese
against Korean — so guessing from a stray familiar word will not save you.

**▶ Play it: <https://truemichato.github.io/hearsay/>** — works on a phone, and
works offline once you have opened it.

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

**Licences vary per file.** A tile is assembled from three source recordings,
so licences are counted per *source*: CC0 ×636, CC BY-SA 4.0 ×531, CC BY 4.0
×150 and CC BY-SA 3.0 ×3, across 1,320 source recordings. A tile inherits the
most restrictive licence of its constituents. CC BY and CC BY-SA both *require*
naming the author and linking the licence, so per-*source* licence, speaker and
URL are captured in the manifest and rendered on the in-app credits page. That
page is a legal obligation, not decoration. Because the repository is public,
the audio is also redistributed independently of the running app, so the
pipeline additionally emits [`ATTRIBUTION.md`](./ATTRIBUTION.md) — the same
per-source credits in a form that travels with the files.

The unit of attribution is the source recording, never the tile, and getting
that wrong is easy to miss. When a tile became an utterance of three recordings,
both the credits page and `ATTRIBUTION.md` carried on emitting one entry per
tile: 440 links where 1,320 were owed, dropping two authors in three and
misstating the licence of the two it dropped. Nothing looked broken — the pages
rendered, the links worked, the licence tally added up to a plausible number.
Only counting entries against the manifest found it, which is why both are now
gated on exactly that count. The clips are modified (trimmed,
loudness-normalised, metadata-stripped, re-encoded to Opus), so the CC BY-SA
ones are redistributed under CC BY-SA 4.0 as ShareAlike requires.

### Why a tile is three words, not one

The first prototype played a single word per tile. Measured across that corpus
the median clip was **0.73 s**, and 253 of 560 were under 0.7 s. Players said the
game felt arbitrary, and they were right — but the cause was content, not
encoding.

Telling languages apart by ear relies on **prosody**: the rhythm of syllables,
where stress lands, the melody of the intonation contour, and which sound
sequences a language even permits. Almost none of that is audible in four
tenths of a second. The player hears a fragment and guesses.

A tile is now an utterance of **three words by the same speaker in the same
language**, joined by a 250 ms pause. Same voice within a tile, different voices
across tiles. The current corpus measures:

| | min | p10 | median | p90 | max |
|---|---|---|---|---|---|
| tile duration (s) | 2.00 | 2.40 | 3.17 | 4.34 | 5.54 |

Nothing under 2 s, enforced by `MIN_TILE_DURATION_S`: a tile whose words are
predicted to fall short is rejected before it is ever encoded, and the
round-robin forms another from the remaining words.

Every source word keeps its own attribution. A tile derives from three files
whose licences genuinely differ, so `ClipMeta.sources[]` records the word,
speaker, licence and source URL of each, and the credits page lists all of them
individually.

### Onset clipping, measured rather than assumed

Silence trimming used a `-45 dB` peak threshold. Soft onsets — fricatives like
/f/ and /s/, aspirated stops, a quiet initial /h/ — can sit below that and get
chopped, which makes a word sound truncated. Rather than assume, the two
thresholds were compared with `silencedetect` across 140 cached recordings:

> median difference 6.7 ms, p75 82 ms, p90 187 ms, max 299 ms —
> **31% of clips were losing more than 50 ms of onset.**

At that scale the discarded audio is speech, not room tone. The chain now trims
at `-55 dB` and keeps a 40 ms lead-in pad. Loudness normalisation is also
two-pass rather than single-pass, because single-pass `loudnorm` is only
approximate and inconsistent loudness between tiles is itself a "bad sound"
symptom — and, more importantly, a fairness problem, since volume must not
become an unintended tell.

### Regenerating the corpus

```bash
npm run content            # all configured languages
npm run content -- rus pol # just these two
```

Scaling to more languages is a change to `scripts/content.config.ts` and nothing
else. Recording counts for the candidate languages are noted there in comments.
That claim has now been exercised twice rather than asserted. The corpus grew
from ten languages to fourteen, and then to **twenty-two** — 440 tiles, 1,320
source recordings, **296 distinct speakers**, 4.8 MB — by editing that file
alone.

The second expansion was about reach, not count. Eleven of the fourteen shipped
languages were European, and **French was missing entirely** despite having the
largest corpus on Lingua Libre at 433,889 recordings. The roster now adds
French, Arabic, Mandarin, Hindi, Hebrew, Romanian, Dutch and Indonesian, so a
game about telling the world's languages apart draws on more than one continent.
Indonesian was not on the request list: it turned up during verification with
7,104 recordings and a wide contributor base, and cost nothing to add.

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

### Choosing which languages appear

Difficulty controls two independent things, and both had to be made explicit
after a real complaint about each.

**Similarity.** An Easy round once served Spanish / Portuguese / Catalan /
Italian — the four most confusable Romance languages in the corpus. Scaffolding
is not difficulty when the underlying task is impossible. Every language now
carries a `cluster`, and Easy takes at most one language per cluster; Hard
deliberately leans *into* a cluster.

**Recognisability.** An Easy round then served Polish / Basque / Swedish. Three
unrelated families, so perfectly legal under the similarity rule, yet most
players cannot name Basque and so have nothing to reason with. Languages now
also carry a `familiarity` tier — `household`, `known`, `obscure`. Easy draws
only from `household`; Medium adds `known`; Hard allows everything, where "what
even *is* that?" is the intended feeling.

The two constraints are independent and both apply. The policy lives in
`src/game/language-policy.ts`, deliberately separate from board construction.

### The speaker floor, and what the corpus actually allows

With too few voices a player learns the *people* rather than the language, which
quietly turns per-language accuracy into a measure of voice recall. The target
is 10 distinct speakers per language.

Whether that is reachable is a fact about Lingua Libre, not a knob. It is
volunteer-recorded, and several languages were contributed by a handful of
people. So the pipeline measures the ceiling itself — distinct speakers holding
at least a tile's worth of *curated* words — and applies two separate rules:

- Falling short of what the corpus can supply is a **pipeline regression** and
  fails the build.
- Being at the ceiling but under the target is **reported, not failed**.
- Falling under `ABSOLUTE_MIN_SPEAKERS` means the language should not ship.

This matters because curation, not selection, is what removes voices: German has
84 contributors in its category but only 31 survive curation, since German
capitalises every noun and the proper-noun filter is necessarily blunt.

Vietnamese was requested for the roster and is deliberately **absent**: it
yields only four usable speakers, and including it would have satisfied the
roster request while defeating the diversity requirement made alongside it.

### A sampling trap worth knowing about

Lingua Libre content arrives in **batches with a shared character**. Sampling
only the newest Russian uploads returned a batch that was around 85% multi-word
phrases and starved the language to 10 usable words out of 40. The fetcher now
draws half from the newest end of a category and half from the oldest, so no
single upload session can dominate a language.

A second, worse version of the same trap cost a full rebuild. Commons returns
category members sorted by **file title**, and a Lingua Libre title embeds the
speaker *before* the word:

```
LL-Q7737 (rus)-Tatiana Kerbush-словарь.wav
               ^^^^^^^^^^^^^^
```

Members therefore arrive in contiguous alphabetical blocks *per speaker*, so
capping enumeration does not sample a language — it truncates the **contributor
roster**. A 6,000-member Russian pool contained exactly 10 distinct speakers,
drawn from a category of 34,359 recordings. The pipeline was not sampling
Russian; it was sampling the first ten Russians alphabetically.

This produced no error, and every summary count looked healthy. Only the speaker
floor surfaced it. Raising `CANDIDATE_POOL_SIZE` took Russian from 5 usable
speakers to 20.

### Why the audio is committed

Transcoded to Opus the whole corpus is **4.8 MB** for 440 tiles — around 11 KB
per tile, smaller than a single photograph. That is cheap enough to commit, and
committing it buys two things worth more than the bytes: genuine offline-first
play, and a deterministic corpus, so every player gets the same game. Runtime
fetching with Cache API storage would have saved those megabytes and cost both.

Tiles are four times longer than the single words they replaced, which would
have quadrupled the payload at the old bitrate. The Opus bitrate was dropped
from 32k to 24k to absorb most of that, chosen by measurement rather than
taste — see `OPUS_BITRATE` in `scripts/content.config.ts` for the energy-loss
figures in the fricative and formant bands that decided it.

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
| **Composite source leak** | Rendered `sources[].sourceUrl` in a tile `title` via a manifest lookup | 5 leak tests failed, incl. the composite-source gate |
| **Clip id leak** | Set one clip id to `ita-0013` | `clip id ita-0013 leaks its language` |
| **Audio path leak** | Bucketed one clip as `audio/<lang>/…` | 3 failures |
| **Manifest ordering** | Sorted clips by language | ordering gate failed |
| **Speaker collapse** | Gave every Korean tile one speaker name | 2 failures |
| **Short tile** | Set one tile's duration to 1.2 s | duration gate failed |
| **Missing per-source licence** | Blanked one `sources[].license` | attribution gate failed |
| **Missing per-source URL** | Blanked one `sources[].sourceUrl` | 2 failures |
| **Utterance/source mismatch** | Set `clip.word` to `tampered` | attribution gate failed |
| **Two voices in one tile** | Changed one source's speaker | one-voice gate failed |
| **Easy similarity (thin corpus)** | `easy.maxPerCluster` 1 → 2 | `doubled a cluster` on the scarce fixture |
| **Hard cluster freedom** | `hard.maxPerCluster` ∞ → 1 | `maxLanguagesFor` gate failed |
| **Easy familiarity** | Added `obscure` to `FAMILIARITY_POLICY.easy` | `served … which players cannot name` |
| **Per-word credits** | Rendered only `sources[0]` on the credits page | credits gate failed |

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

One break is more interesting than the rest, and it recurred. Relaxing
`easy.maxPerCluster` from 1 to 2 did **not** fail the main "never two
same-cluster languages on Easy" test: with more clusters available than a board
has buckets, the greedy picker satisfies the board on its first pass and never
reaches the code the constant governs. The code was right; the test was not
proving what it claimed.

It is worth being precise about why this came back. A thin-corpus test had
already been added the first time — but as the roster grew from 14 languages to
22, that fixture stopped being thin *relative to the board*, and the mutant
survived again. **A gate can rot into a tautology without anyone touching it.**
The fixture is now pinned to two clusters against four buckets, so the
constraint has to bite regardless of how large the real corpus becomes.

Mutating `SIMILARITY_POLICY.hard` surfaced a related problem: `chooseLanguages`
short-circuits Hard through `CLUSTER_BIAS` and never consults the picker, so
that entry looked like dead configuration and nothing observed it. It is live in
`maxLanguagesFor`, which now has a test.

**A mutation that survives is a question, not a verdict.**

---

## Deployment

The live site is a GitHub **project page**, served from
`https://truemichato.github.io/hearsay/` rather than a domain root. That
subpath is the whole difficulty, and it fails in an unhelpful way: the HTML
still loads, so a deploy looks successful, while every asset 404s and the
player gets a board that renders and makes no sound.

Vite's `base` therefore comes from a `BASE_PATH` environment variable,
defaulting to `/` so `npm run dev` and `npm run preview` keep working at the
root. Vite rewrites `index.html` and asset URLs itself, but three things do not
follow `base` automatically:

- **`navigateFallback`** must carry the base. Workbox matches it against a real
  URL, so a bare `index.html` looks at the domain root and the offline
  navigation fallback silently never fires.
- **`scope` and `start_url`** in the web app manifest must sit under the base.
  A scope of `/` on a project page claims the whole `github.io` domain, which
  the browser rejects, making the app uninstallable.
- **Audio** resolves through `import.meta.env.BASE_URL`, which is why clips
  survive the move. The Workbox precache manifest is relative to the service
  worker at `/hearsay/sw.js`, so it resolves correctly on its own.

Hash routing (`#/play/easy/<seed>`) was already the right choice here: Pages has
no server-side rewrite, so a path-based route would 404 on a cold deep link.

`.github/workflows/deploy.yml` runs typecheck, lint, unit tests and Playwright
in a job the deploy `needs`, so a broken build cannot ship. `BASE_PATH` is
derived from `GITHUB_REPOSITORY` rather than hardcoded, so a rename or a fork
deploys correctly with no edit, and a guard step fails the build if
`dist/index.html` did not pick the base up.

### Verifying a deploy

A green checkmark is not evidence the game works.

```bash
SITE=https://truemichato.github.io/hearsay/ npm run verify:deploy
```

Against the live site this loads a cold deep link at a 390×844 mobile viewport
and asserts that every clip fetches 200/206, that tiles genuinely decode and
play, that a full round scores exactly, that the service worker registers under
the right scope, that stats survive a reload, that the app works offline, that
tap targets clear 44 px, and that no language code appears in tile DOM or audio
URLs.

It was broken once to confirm it detects the subpath trap. Removing `BASE_URL`
from `useBoardAudio` produced `16 requests 404d` and `only 0/16 tiles played`
— while the score was still a correct `+1280`. That is exactly why "the page
rendered" cannot be the test.

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

# Hearsay — design contract

The world is a **shortwave receiver**. You are sitting at a radio set, sweeping a
band, hearing voices you cannot place, and deciding which ones come from the same
transmitter. Every decision below serves that one idea.

This file is the contract. If you change the interface, change this too.

---

## 1. Why a radio, and not "a dark theme with an orange accent"

The game is *listen to a signal, work out where it came from*. That is literally
what shortwave listening is, so the metaphor is not decoration bolted on top — it
is a description of the mechanic.

It also solved a concrete problem. The old board was sixteen identical grey
squares with sixteen identical speaker icons. Nothing told one tile from another,
so a player could not remember which clip was which, in a game that is entirely
about remembering clips. Drawing each clip's **real waveform** gives all sixteen
tiles a legitimate reason to look different — and a waveform is exactly what a
radio would show you.

**The rule that keeps this from collapsing into neon-on-black:** most text on
screen is *printed ink on metal*, not light. Legends are a warm off-white
(`--color-legend`, a dusty tan). Glow is reserved for what is genuinely live —
the tuned station, the filed count, the transmit button. If everything glows,
nothing means anything.

---

## 2. The materials

Defined once in `src/index.css`. Everything else consumes these; nothing invents
its own colour.

| Token | Value | What it is |
| --- | --- | --- |
| `--color-chassis` | `#0c0906` | The case the set is built in. Page background. |
| `--color-panel` | `#191209` | The faceplate screwed onto the chassis. |
| `--color-engrave` | `#0a0705` | Recessed cuts in the faceplate. |
| `--color-hairline` | `#4a3722` | The lit edge of a milled cut. All borders. |
| `--color-ink` | `#f8ecd8` | Silkscreened lettering. Primary text. |
| `--color-legend` | `#b39a76` | Smaller printed legends. Secondary text. |
| `--color-legend-dim` | `#7d6949` | Legends that do not apply right now. |
| `--color-signal` | `#ffa724` | **Light.** Amber. Only for what is live. |
| `--color-signal-deep` | `#b96f0c` | Amber seen through smoked glass. |
| `--color-ember` | `#ff5b2b` | Held / staged. Hotter than signal, deliberately. |
| `--color-phosphor` | `#6fe3a8` | Correct. The only green in the world. |
| `--color-fault` | `#ff6a5e` | Wrong, and negative scores. |

CSS classes that behave like physical materials, not like styles:

- `.chassis`, `.panel`, `.engrave` — the three depths of metal.
- `.well`, `.well-tuned`, `.well-held` — a recess a station sits in, unlit / backlit / filled.
- `.grain::after` — a fine brushed-metal texture overlay.

Type has three roles, and only three:

- `.nameplate` — Big Shoulders. Stamped into the case. Headings and buttons.
- `.readout` — Chivo Mono, tabular figures. Anything a meter would show. Numbers must never reflow as they count.
- `.legend` — 10px, uppercase, `0.16em` tracking. Printed labels **of two or three words**. Never a sentence — tracked uppercase is unreadable at sentence length.

Fonts live in `src/assets/fonts/` and are imported with a *relative* URL, so Vite
hashes them and rewrites the path for the `/hearsay/` subpath. A `public/fonts/`
absolute URL would silently 404 on the deployed site. Latin-only `unicode-range`
is deliberate: clue text in Cyrillic, kana or hangul must fall through to the
system font rather than render as tofu.

---

## 3. The interaction model (this is the important part)

The original bug: **tapping a tile both played it and selected it.** To compare
sixteen clips you naturally tap all sixteen — and end up with all sixteen
selected, so the next button press files the entire board into one language.

The fix is not a better toggle. It is separating the two verbs, because the brief
requires that *replaying a clip must never silently change what is selected* —
which rules out any double-tap or tap-again scheme.

- **A tile is listen-only.** Tap it, or focus it and press Enter, and it plays. It never files anything. It never stages anything.
- **Exactly one station is "tuned"** — the cursor. Tapping or arrowing to a tile tunes it.
- **Hold is the only writer to the staging set.** The Hold button in the tuner strip, or the `M` key. Nothing else can add to it.
- **Group buttons commit.** They file the held set if it is non-empty, otherwise the tuned station. Filing clears the held set and keeps the cursor where it is.

So: listening is free and unlimited, staging is one explicit button, and
committing is a second explicit button. Filing many tiles at once is still one
press — it is just deliberate now instead of accidental.

**Arrow keys deliberately do not play audio.** A screen-reader user sweeping the
grid would have the screen reader and the clip talking over each other. Arrows
move and tune silently; Enter listens. This is a real accessibility decision, not
an oversight.

### Four state channels, four different senses

A tile can be heard, tuned, held and filed **all at once**, so the four states
cannot share a channel. Each gets its own:

| State | Channel | How it looks |
| --- | --- | --- |
| **Heard** | *shape* | Flat noise floor becomes the clip's real waveform. Hearing a clip develops its picture. |
| **Tuned** | *light* | Backlit well, amber bezel, `scale-[1.05]`. |
| **Held** | *fill* | The well fills with ember. |
| **Filed** | *badge* | A group tag clamped over the top-right edge. |

The old build rendered "played" and "selected" as the same blue ring, and the
`aria-label` never changed at all. Now the label is rebuilt from the same four
facts: `"Station 6 of 16, heard, held for filing, filed under Group C. Press to
listen."` A screen-reader user gets exactly what a sighted user gets.

---

## 4. The leak rule — do not break this

`e2e/leak.spec.ts` scans **every attribute, every `textContent` and every
`innerHTML` of every tile** for language names, using whole-word matching. The
whole game collapses if a tile's markup names its own language.

**Any attribute you add to a tile must be numeric or opaque.** Station numbers,
booleans and group letters are safe. Never put a language, a locale code, a file
name or an audio URL anywhere on a tile.

## 5. The DOM contract with `scripts/verify-deploy.mjs`

That script is not editable from the interface side, and it finds group buttons
by testing `textContent.trim().startsWith(languageName)`. So in `GroupTray`, the
**label text must come first in the DOM.** The number badge is moved to the left
visually with CSS `order`, not by reordering the markup. If you rearrange that
button and the deploy check starts failing on `[data-testid="undefined"]`, this
is why.

---

## 6. Motion

Motion is used for exactly three jobs: confirming an action, showing that
something is live, and marking a moment. Not for decoration.

`tune-in` (a station takes focus), `carrier` (audio is playing), `sweep` (the
tuner is scanning), `lamp-on` (a panel wakes), `needle-settle` (the score lands),
`drift` (the home dial never sits perfectly still, like a real receiver).

Every one of them is switched off wholesale by the `prefers-reduced-motion` block
at the bottom of `src/index.css`, and `e2e/motion.spec.ts` walks the real pages
with that media feature emulated and fails if anything is still animating. That
gate was proven by planting a violation; the note is in the file.

---

## 7. Onboarding

There was none. A new player met sixteen grey squares, three language names, an
unexplained coin badge and a disabled button.

The manual (`src/components/Coach.tsx`, steps in `src/game/tutorial.ts`) teaches
by watching, not by lecturing. Six short steps advance when the player *does* the
thing — hear a station, notice nothing was filed, file one, hold two, open the
shop, transmit. Each step has an optional `done` predicate; when it is satisfied
the step advances by itself, and `Next` is only offered on steps that have no
predicate to satisfy.

It is an **in-flow block placed directly after the header**, not an overlay. An
overlay covered the tiles it was telling you to press; making it
`pointer-events-none` just moved the problem to its own buttons. A block cannot
cover anything by construction.

First run is detected from Dexie (`tutorialSeenAt`). It is skippable at any time
and reopenable from the `?` button in the header, forever.

---

## 8. Layout at 390×844

The reference viewport. Header, band meter, the 4×4 grid, the tuner strip, the
group bank, transmit — in that order, and it fits without scrolling on Easy and
Medium. Hard scrolls slightly once a fourth group exists, which is acceptable
because the player created that row themselves.

Tap targets measure 86×86 on the grid. The old build wasted roughly the bottom
third of the screen; the tuner strip now occupies it and does real work.

---

## 9. What must not be hardcoded

A parallel workstream owns the audio corpus and the language roster. Clips are
getting longer and the roster is growing. **Build against the manifest.** Never
hardcode a clip count, a clip duration, or a language set. The waveform renderer
normalises to a fixed bar count so a 1s clip and a 4s clip both fill their tile.

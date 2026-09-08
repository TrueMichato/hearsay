import { useCallback, useEffect, useMemo, useState } from 'react';
import manifestJson from '../content/manifest.json';
import type { ContentManifest } from '../content/types';
import { Board } from '../components/Board';
import { GroupTray } from '../components/GroupTray';
import { ClueShop } from '../components/ClueShop';
import { ResultsPanel } from '../components/ResultsPanel';
import { TunerStrip } from '../components/TunerStrip';
import { Coach } from '../components/Coach';
import { TUTORIAL_STEPS } from '../game/tutorial';
import { generateRound, GROUP_LABELS } from '../game/board';
import { randomSeed } from '../game/rng';
import { scoreRound, type RoundResult } from '../game/scoring';
import {
  CLUE_PALETTE,
  colorGroupIndex,
  emptyClueState,
  purchaseClue,
  type ClueId,
} from '../game/clues';
import type { Assignment, Bucket, Difficulty } from '../game/types';
import { recordRound, markTutorialSeen } from '../db/database';
import { useProfile } from '../hooks/useProfile';
import { useBoardAudio } from '../hooks/useBoardAudio';
import { useWaveforms } from '../hooks/useWaveforms';

const manifest = manifestJson as ContentManifest;

/** Hard mode starts with two empty groups and allows up to five. */
const HARD_INITIAL_GROUPS = 2;
const HARD_MAX_GROUPS = 5;

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export interface PlayProps {
  difficulty: Difficulty;
  onExit: () => void;
}

export function Play({
  difficulty,
  initialSeed,
  tutorial = false,
  onExit,
}: PlayProps & { initialSeed?: string; tutorial?: boolean }) {
  const [seed, setSeed] = useState(() => initialSeed ?? randomSeed());

  // Remounting per seed is what keeps every round-scoped piece of state — the
  // assignment, the clues bought, the loaded audio — from leaking into the next
  // round. It replaces a pile of "reset on change" effects with one `key`.
  return (
    <RoundView
      key={seed}
      difficulty={difficulty}
      seed={seed}
      tutorial={tutorial}
      onExit={onExit}
      onPlayAgain={() => setSeed(randomSeed())}
    />
  );
}

function RoundView({
  difficulty,
  seed,
  tutorial,
  onExit,
  onPlayAgain,
}: PlayProps & { seed: string; tutorial: boolean; onPlayAgain: () => void }) {
  const profile = useProfile();

  const round = useMemo(
    () => generateRound(manifest, { difficulty, seed }),
    [difficulty, seed],
  );

  const [assignment, setAssignment] = useState<Assignment>({});
  /**
   * Stations deliberately held back so several can be filed in one press.
   *
   * This is the *only* multi-selection in the game, and nothing but the Hold
   * control writes to it. That is the fix for the original bug: listening used
   * to write here, so comparing all sixteen clips selected all sixteen.
   */
  const [held, setHeld] = useState<Set<string>>(new Set());
  /** The station the filing bank is pointed at. Null until the player acts. */
  const [tunedId, setTunedId] = useState<string | null>(null);
  const [clueState, setClueState] = useState(emptyClueState);
  const [shopOpen, setShopOpen] = useState(false);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [startedAt] = useState(() => Date.now());
  const [step, setStep] = useState(tutorial ? 0 : -1);
  const [hardGroups, setHardGroups] = useState<Bucket[]>(() =>
    difficulty === 'hard'
      ? Array.from({ length: HARD_INITIAL_GROUPS }, (_, i) => ({
          id: `group-${i}`,
          language: null,
          label: `Group ${GROUP_LABELS[i]}`,
        }))
      : [],
  );

  const audio = useBoardAudio(round.tiles);
  const peaks = useWaveforms(round.tiles);

  // Coins are derived, never mirrored. `clueState.spent` is the round's running
  // tab; once the round is banked, `recordRound` has already folded that tab
  // into the stored balance, so subtracting it again would double-charge.
  const banked = profile?.coins ?? 0;
  const coins = result ? banked : banked - clueState.spent;

  const buckets = difficulty === 'hard' ? hardGroups : round.buckets;

  /**
   * What the filing bank will act on: every held station, or else the tuned one.
   *
   * Holding is opt-in, so the common path — listen, file, listen, file — never
   * involves a selection at all.
   */
  const target = useMemo(
    () => (held.size > 0 ? [...held] : tunedId ? [tunedId] : []),
    [held, tunedId],
  );

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const bucketId of Object.values(assignment)) {
      out[bucketId] = (out[bucketId] ?? 0) + 1;
    }
    return out;
  }, [assignment]);

  const bucketLabels = useMemo(
    () => Object.fromEntries(buckets.map((b) => [b.id, b.label.replace(/^Group /, '')])),
    [buckets],
  );

  const clueColors = useMemo(() => {
    if (!clueState.colorCoded) return {};
    return Object.fromEntries(
      round.tiles.map((t) => [
        t.id,
        CLUE_PALETTE[colorGroupIndex(round, t.language) % CLUE_PALETTE.length],
      ]),
    );
  }, [clueState.colorCoded, round]);

  const revealedLanguages = useMemo(() => {
    const out: Record<string, string> = {};
    for (const tileId of clueState.revealedLanguages) {
      const tile = round.tiles.find((t) => t.id === tileId);
      if (tile) {
        out[tileId] = manifest.languages.find((l) => l.id === tile.language)?.name ?? tile.language;
      }
    }
    return out;
  }, [clueState.revealedLanguages, round.tiles]);

  const toggleHold = useCallback(() => {
    if (!tunedId) return;
    setHeld((prev) => {
      const next = new Set(prev);
      if (next.has(tunedId)) next.delete(tunedId);
      else next.add(tunedId);
      setAnnouncement(next.has(tunedId) ? 'Station held.' : 'Station released.');
      return next;
    });
  }, [tunedId]);

  const assignTarget = useCallback(
    (bucketId: string) => {
      if (target.length === 0) return;
      const bucket = buckets.find((b) => b.id === bucketId);
      setAssignment((prev) => {
        const next = { ...prev };
        for (const id of target) next[id] = bucketId;
        return next;
      });
      setAnnouncement(
        `${target.length} station${target.length === 1 ? '' : 's'} filed under ${bucket?.label ?? 'group'}.`,
      );
      setHeld(new Set());
    },
    [buckets, target],
  );

  const unassignTarget = useCallback(() => {
    if (target.length === 0) return;
    setAssignment((prev) => {
      const next = { ...prev };
      for (const id of target) delete next[id];
      return next;
    });
    setAnnouncement(
      `${target.length} station${target.length === 1 ? '' : 's'} taken back out.`,
    );
    setHeld(new Set());
  }, [target]);

  const addGroup = useCallback(() => {
    setHardGroups((prev) => {
      if (prev.length >= HARD_MAX_GROUPS) return prev;
      const index = prev.length;
      return [...prev, { id: `group-${index}`, language: null, label: `Group ${GROUP_LABELS[index]}` }];
    });
  }, []);

  const buyClue = useCallback(
    (id: ClueId) => {
      const outcome = purchaseClue(clueState, coins, round, id, tunedId ?? undefined);
      if (!outcome.ok) {
        setAnnouncement(
          outcome.reason === 'insufficient-coins'
            ? 'Not enough coins for that clue.'
            : outcome.reason === 'needs-tile'
              ? 'Tune a station first.'
              : 'That clue is already active.',
        );
        return;
      }
      setClueState(outcome.state);
      setAnnouncement('Clue purchased.');
      // Close the shop on success. Every clue pays out on the board behind this
      // panel, so leaving it open means the player spends coins and sees
      // nothing until they think to dismiss it.
      setShopOpen(false);
    },
    [clueState, coins, round, tunedId],
  );

  const submit = useCallback(async () => {
    const scored = scoreRound(round, assignment);
    setResult(scored);

    await recordRound({
      round: {
        roundId: round.id,
        seed: round.seed,
        difficulty: round.difficulty,
        languages: round.languages,
        score: scored.score,
        correct: scored.correct,
        wrong: scored.wrong,
        unassigned: scored.unassigned,
        accuracy: scored.accuracy,
        coinsEarned: scored.coinsEarned,
        coinsSpent: clueState.spent,
        durationMs: Date.now() - startedAt,
      },
      confusion: scored.confusion,
      perLanguage: scored.perLanguage,
      cluePurchases: clueState.purchases.map((p) => ({ id: p.id, cost: p.cost })),
    });
  }, [assignment, clueState, round, startedAt]);

  const placed = Object.keys(assignment).length;
  const total = round.tiles.length;
  const tunedIndex = tunedId ? round.tiles.findIndex((t) => t.id === tunedId) : -1;
  const tunedTile = tunedIndex >= 0 ? round.tiles[tunedIndex] : null;

  /**
   * The guided round advances on what the player actually did, never on a timer.
   * A step whose `done` predicate is already true when it opens is skipped, so
   * a returning player is never told to do something they have just done.
   */
  const facts = useMemo(
    () => ({
      heard: audio.heard.size,
      placed,
      held: held.size,
      shopOpened: clueState.purchases.length > 0 || shopOpen,
    }),
    [audio.heard.size, clueState.purchases.length, held.size, placed, shopOpen],
  );

  // Which step is actually on screen. Derived rather than stored: a step whose
  // goal is already satisfied is skipped past during render, so a player who
  // ran ahead of the manual never gets told to do something they just did, and
  // there is no flash of a stale step while an effect catches up.
  const shownStep = useMemo(() => {
    if (step < 0) return -1;
    let at = step;
    while (at < TUTORIAL_STEPS.length && TUTORIAL_STEPS[at].done?.(facts)) at += 1;
    return at;
  }, [facts, step]);

  const manualOpen = shownStep >= 0 && shownStep < TUTORIAL_STEPS.length;

  // Persisting that the manual has been seen is a write to IndexedDB — a real
  // external system — so it belongs in an effect. It fires once, when the last
  // step is passed or the player skips out.
  useEffect(() => {
    if (step >= 0 && shownStep >= TUTORIAL_STEPS.length) void markTutorialSeen();
  }, [shownStep, step]);

  return (
    <div className="chassis mx-auto flex min-h-full w-full max-w-lg flex-col gap-2.5 p-3 pb-5">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExit}
          className="legend well flex h-9 items-center gap-1 rounded px-2.5 text-[color:var(--color-legend)] transition-colors hover:text-[color:var(--color-signal)]"
        >
          <span aria-hidden="true">←</span> Back
        </button>

        <p className="nameplate flex-1 text-center text-lg text-[color:var(--color-ink)]">
          {DIFFICULTY_LABEL[difficulty]} band
          {clueState.languageCountRevealed && (
            <span className="readout ml-1.5 text-[11px] font-bold text-[color:var(--color-signal)]">
              {round.languages.length} LANGS
            </span>
          )}
        </p>

        <button
          type="button"
          onClick={() => setStep(0)}
          aria-label="Open the manual"
          data-testid="open-manual"
          className="legend well flex h-9 w-9 items-center justify-center rounded text-[color:var(--color-legend)] transition-colors hover:text-[color:var(--color-signal)]"
        >
          ?
        </button>

        <button
          type="button"
          onClick={() => setShopOpen(true)}
          data-testid="open-shop"
          aria-label={`Clue shop. ${coins} coins.`}
          className="well flex h-9 items-center gap-1.5 rounded px-2.5 transition-colors hover:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
        >
          <span className="legend text-[color:var(--color-legend)]">Clues</span>
          <span className="readout text-sm font-bold text-[color:var(--color-signal)]">{coins}</span>
        </button>
      </header>
      {manualOpen && (
        <Coach
          step={shownStep}
          onNext={() => setStep(shownStep + 1)}
          onSkip={() => setStep(TUTORIAL_STEPS.length)}
        />
      )}


      <BandMeter placed={placed} total={total} heard={audio.heard.size} />

      {/* Screen readers hear every filing; sighted players see the counters. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {audio.error && (
        <p
          role="alert"
          className="legend rounded border border-[color:var(--color-fault)]/50 bg-[color:var(--color-fault)]/10 px-3 py-2 normal-case text-[color:var(--color-fault)]"
        >
          {audio.error}
        </p>
      )}

      <div className="engrave rounded-lg p-2">
        <Board
          tiles={round.tiles}
          assignment={assignment}
          marked={held}
          heard={audio.heard}
          tunedId={tunedId}
          playing={audio.playing}
          progress={audio.progress}
          loaded={audio.loaded}
          progressed={audio.progressed}
          peaks={peaks}
          bucketLabels={bucketLabels}
          clueColors={clueColors}
          revealedWords={new Set(clueState.revealedWords)}
          revealedRomanizations={new Set(clueState.revealedRomanizations)}
          revealedLanguages={revealedLanguages}
          onTune={setTunedId}
          onPlay={audio.play}
          onToggleHold={toggleHold}
          onQuickAssign={(index) => {
            const bucket = buckets[index];
            if (bucket) assignTarget(bucket.id);
          }}
        />
      </div>

      <TunerStrip
        station={tunedIndex >= 0 ? tunedIndex + 1 : null}
        peaks={tunedTile ? (peaks[tunedTile.id] ?? null) : null}
        heard={tunedId ? audio.heard.has(tunedId) : false}
        playing={audio.playing !== null && audio.playing === tunedId}
        progress={audio.progress}
        held={tunedId ? held.has(tunedId) : false}
        filedUnder={
          tunedId && assignment[tunedId] ? (bucketLabels[assignment[tunedId]] ?? null) : null
        }
        heldCount={held.size}
        onReplay={() => tunedId && audio.play(tunedId)}
        onToggleHold={toggleHold}
        onReleaseAll={() => setHeld(new Set())}
      />

      <GroupTray
        buckets={buckets}
        counts={counts}
        targetCount={target.length}
        targetIsHeld={held.size > 0}
        canAddGroup={difficulty === 'hard' && hardGroups.length < HARD_MAX_GROUPS}
        canUnassign={target.some((id) => assignment[id])}
        onAssign={assignTarget}
        onAddGroup={addGroup}
        onUnassignTarget={unassignTarget}
      />

      <button
        type="button"
        onClick={submit}
        disabled={placed === 0}
        data-testid="submit-round"
        className={[
          'nameplate mt-auto w-full rounded-lg py-3.5 text-lg tracking-[0.06em] transition-[box-shadow,background-color] duration-200',
          placed === 0
            ? 'well cursor-not-allowed text-[color:var(--color-legend-dim)]'
            : 'bg-[color:var(--color-signal)] text-[#140e07] shadow-[0_6px_22px_-8px_rgb(255_167_36/0.9)] hover:bg-[color:var(--color-ink)]',
        ].join(' ')}
      >
        {placed === 0 ? 'File a station to transmit' : `Transmit — ${placed} of ${total}`}
      </button>

      <ClueShop
        open={shopOpen}
        coins={coins}
        difficulty={difficulty}
        state={clueState}
        tunedStation={tunedIndex >= 0 ? tunedIndex + 1 : null}
        languageCount={round.languages.length}
        onBuy={buyClue}
        onClose={() => setShopOpen(false)}
      />

      {result && (
        <ResultsPanel
          round={round}
          result={result}
          languages={manifest.languages}
          onPlayAgain={onPlayAgain}
          onHome={onExit}
        />
      )}
    </div>
  );
}

/**
 * Progress, as a receiver's signal-strength meter.
 *
 * The original board had no progress indicator at all, so a player mid-round
 * could not tell whether they had filed four stations or fourteen without
 * counting tiles. Each segment is one station; a filed segment is lit, a heard
 * one is dim but present, an untouched one is dark.
 */
function BandMeter({ placed, total, heard }: { placed: number; total: number; heard: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="legend shrink-0" aria-hidden="true">
        Filed
      </span>
      {/* One segment per station. Filed segments are lit; heard-but-unfiled
          ones only smoulder, which has to be a large enough gap to read at
          3px tall — an earlier version used a slightly deeper amber and looked
          identical to "filed" next to a counter that said none were. */}
      <span
        aria-hidden="true"
        className="engrave flex h-3.5 flex-1 items-center gap-[2px] rounded-sm px-1"
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-[1px] transition-colors duration-300"
            style={{
              backgroundColor:
                i < placed
                  ? 'var(--color-signal)'
                  : i < heard
                    ? 'rgb(255 167 36 / 0.26)'
                    : 'rgb(255 226 178 / 0.07)',
              boxShadow: i < placed ? '0 0 5px -1px var(--color-signal-deep)' : undefined,
            }}
          />
        ))}
      </span>
      <span
        aria-hidden="true"
        className="readout shrink-0 text-xs font-bold text-[color:var(--color-signal)]"
      >
        {placed}/{total}
      </span>
      <span role="status" className="sr-only">
        {placed} of {total} stations filed, {heard} heard.
      </span>
    </div>
  );
}

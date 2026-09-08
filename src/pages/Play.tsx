import { useCallback, useMemo, useState } from 'react';
import manifestJson from '../content/manifest.json';
import type { ContentManifest } from '../content/types';
import { Board } from '../components/Board';
import { GroupTray } from '../components/GroupTray';
import { ClueShop } from '../components/ClueShop';
import { ResultsPanel } from '../components/ResultsPanel';
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
import { recordRound } from '../db/database';
import { useProfile } from '../hooks/useProfile';
import { useBoardAudio } from '../hooks/useBoardAudio';

const manifest = manifestJson as ContentManifest;

/** Hard mode starts with two empty groups and allows up to five. */
const HARD_INITIAL_GROUPS = 2;
const HARD_MAX_GROUPS = 5;

export interface PlayProps {
  difficulty: Difficulty;
  onExit: () => void;
}

export function Play({ difficulty, onExit }: PlayProps) {
  const [seed, setSeed] = useState(randomSeed);

  // Remounting per seed is what keeps every round-scoped piece of state — the
  // assignment, the clues bought, the loaded audio — from leaking into the next
  // round. It replaces a pile of "reset on change" effects with one `key`.
  return (
    <RoundView
      key={seed}
      difficulty={difficulty}
      seed={seed}
      onExit={onExit}
      onPlayAgain={() => setSeed(randomSeed())}
    />
  );
}

function RoundView({
  difficulty,
  seed,
  onExit,
  onPlayAgain,
}: PlayProps & { seed: string; onPlayAgain: () => void }) {
  const profile = useProfile();

  const round = useMemo(
    () => generateRound(manifest, { difficulty, seed }),
    [difficulty, seed],
  );

  const [assignment, setAssignment] = useState<Assignment>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clueState, setClueState] = useState(emptyClueState);
  const [shopOpen, setShopOpen] = useState(false);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [startedAt] = useState(() => Date.now());
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

  // Coins are derived, never mirrored. `clueState.spent` is the round's running
  // tab; once the round is banked, `recordRound` has already folded that tab
  // into the stored balance, so subtracting it again would double-charge.
  const banked = profile?.coins ?? 0;
  const coins = result ? banked : banked - clueState.spent;

  const buckets = difficulty === 'hard' ? hardGroups : round.buckets;

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

  const toggleSelect = useCallback((tileId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tileId)) next.delete(tileId);
      else next.add(tileId);
      return next;
    });
  }, []);

  const assignSelected = useCallback(
    (bucketId: string) => {
      if (selected.size === 0) return;
      const bucket = buckets.find((b) => b.id === bucketId);
      setAssignment((prev) => {
        const next = { ...prev };
        for (const id of selected) next[id] = bucketId;
        return next;
      });
      setAnnouncement(
        `${selected.size} tile${selected.size === 1 ? '' : 's'} moved to ${bucket?.label ?? 'group'}.`,
      );
      setSelected(new Set());
    },
    [buckets, selected],
  );

  const unassignSelected = useCallback(() => {
    setAssignment((prev) => {
      const next = { ...prev };
      for (const id of selected) delete next[id];
      return next;
    });
    setAnnouncement(`${selected.size} tile${selected.size === 1 ? '' : 's'} removed from groups.`);
    setSelected(new Set());
  }, [selected]);

  const addGroup = useCallback(() => {
    setHardGroups((prev) => {
      if (prev.length >= HARD_MAX_GROUPS) return prev;
      const index = prev.length;
      return [...prev, { id: `group-${index}`, language: null, label: `Group ${GROUP_LABELS[index]}` }];
    });
  }, []);

  const buyClue = useCallback(
    (id: ClueId) => {
      const tileId = selected.size === 1 ? [...selected][0] : undefined;
      const outcome = purchaseClue(clueState, coins, round, id, tileId);
      if (!outcome.ok) {
        setAnnouncement(
          outcome.reason === 'insufficient-coins'
            ? 'Not enough coins for that clue.'
            : outcome.reason === 'needs-tile'
              ? 'Select exactly one tile first.'
              : 'That clue is already active.',
        );
        return;
      }
      setClueState(outcome.state);
      setAnnouncement('Clue purchased.');
    },
    [clueState, coins, round, selected],
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
  const difficultyLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[difficulty];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-3 p-3 pb-6">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onExit}
          className="rounded-lg px-2 py-1 text-sm text-slate-300 hover:text-white"
        >
          ← Back
        </button>
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
          {difficultyLabel}
          {clueState.languageCountRevealed && ` · ${round.languages.length} languages`}
        </span>
        <button
          type="button"
          onClick={() => setShopOpen(true)}
          data-testid="open-shop"
          className="rounded-lg bg-amber-500/15 px-3 py-1.5 text-sm font-bold text-amber-300 tabular-nums hover:bg-amber-500/25"
        >
          {coins} 🪙
        </button>
      </header>

      {/* Screen readers hear every assignment; sighted players see the badges. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {audio.error && (
        <p role="alert" className="rounded-lg bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
          {audio.error}
        </p>
      )}

      <Board
        tiles={round.tiles}
        assignment={assignment}
        selected={selected}
        playing={audio.playing}
        loaded={audio.loaded}
        bucketLabels={bucketLabels}
        clueColors={clueColors}
        revealedWords={new Set(clueState.revealedWords)}
        revealedRomanizations={new Set(clueState.revealedRomanizations)}
        revealedLanguages={revealedLanguages}
        onToggleSelect={toggleSelect}
        onPlay={audio.play}
        onQuickAssign={(index) => {
          const bucket = buckets[index];
          if (bucket) assignSelected(bucket.id);
        }}
      />

      <GroupTray
        buckets={buckets}
        counts={counts}
        selectedCount={selected.size}
        canAddGroup={difficulty === 'hard' && hardGroups.length < HARD_MAX_GROUPS}
        onAssign={assignSelected}
        onAddGroup={addGroup}
        onClearSelection={() => setSelected(new Set())}
        onUnassignSelected={unassignSelected}
      />

      <button
        type="button"
        onClick={submit}
        disabled={placed === 0}
        data-testid="submit-round"
        className="mt-auto w-full rounded-xl bg-sky-500 py-3.5 text-base font-bold text-slate-900 hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
      >
        {placed === 0 ? 'Place some tiles first' : `Submit ${placed} of 16`}
      </button>

      <ClueShop
        open={shopOpen}
        coins={coins}
        difficulty={difficulty}
        state={clueState}
        selectedCount={selected.size}
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

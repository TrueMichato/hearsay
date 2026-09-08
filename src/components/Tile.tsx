import { memo } from 'react';
import type { BoardTile } from '../game/types';

export interface TileProps {
  tile: BoardTile;
  index: number;
  selected: boolean;
  playing: boolean;
  loaded: boolean;
  /** Short label of the group this tile sits in, e.g. "A" or "Spanish". */
  assignedLabel: string | null;
  /** Colour from the colour-code clue, if bought. */
  clueColor: string | null;
  /** Word revealed by the "show the writing" clue. */
  revealedWord: string | null;
  revealedRomanization: string | null;
  /** Language name revealed by the "name that language" clue. */
  revealedLanguage: string | null;
  /** Whether this tile owns the grid's single tab stop (roving tabindex). */
  isTabStop: boolean;
  onActivate: () => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * One audio tile.
 *
 * Tiles are audio-only by design: printing the word would let a player read the
 * language off the orthography instead of hearing it. Any text you see here got
 * there because the player *bought* a clue.
 *
 * Accessibility notes:
 *  - It is a real `<button>`, so Enter/Space work for free.
 *  - `aria-pressed` communicates selection, which is a toggle, not navigation.
 *  - The `aria-label` spells out position and assignment, because the visual
 *    badge in the corner means nothing to a screen-reader user.
 */
export const Tile = memo(function Tile({
  tile,
  index,
  selected,
  playing,
  loaded,
  assignedLabel,
  clueColor,
  revealedWord,
  revealedRomanization,
  revealedLanguage,
  isTabStop,
  onActivate,
  onFocus,
  onKeyDown,
}: TileProps) {
  const position = `Tile ${index + 1} of 16`;
  const state = assignedLabel ? `assigned to ${assignedLabel}` : 'not assigned';
  const revealed = [revealedWord, revealedRomanization, revealedLanguage]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      role="gridcell"
      aria-pressed={selected}
      aria-label={`${position}, ${state}${revealed ? `, revealed: ${revealed}` : ''}. Activate to play the audio.`}
      tabIndex={isTabStop ? 0 : -1}
      onClick={onActivate}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      data-testid={`tile-${tile.id}`}
      data-tile-index={index}
      className={[
        'relative flex aspect-square min-h-[64px] w-full flex-col items-center justify-center gap-1',
        'rounded-2xl border-2 p-1 transition-colors duration-150',
        'touch-manipulation select-none',
        selected
          ? 'border-sky-400 bg-sky-950'
          : assignedLabel
            ? 'border-slate-500 bg-slate-800'
            : 'border-slate-700 bg-slate-800/60 hover:bg-slate-700',
        playing ? 'animate-pulse-ring' : '',
      ].join(' ')}
      style={clueColor ? { backgroundColor: `${clueColor}26`, borderColor: clueColor } : undefined}
    >
      {/* Assignment badge. `aria-hidden` because the label above already says it. */}
      {assignedLabel && (
        <span
          aria-hidden="true"
          className="absolute top-1 left-1 rounded-md bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-bold text-sky-300"
        >
          {assignedLabel.length > 3 ? assignedLabel.slice(0, 3) : assignedLabel}
        </span>
      )}

      <SpeakerIcon playing={playing} loaded={loaded} />

      {(revealedWord || revealedRomanization || revealedLanguage) && (
        <span aria-hidden="true" className="w-full px-0.5 text-center leading-tight">
          {revealedWord && <span className="block truncate text-[11px] text-slate-100">{revealedWord}</span>}
          {revealedRomanization && (
            <span className="block truncate text-[10px] text-slate-400 italic">{revealedRomanization}</span>
          )}
          {revealedLanguage && (
            <span className="block truncate text-[10px] font-semibold text-amber-300">{revealedLanguage}</span>
          )}
        </span>
      )}
    </button>
  );
});

function SpeakerIcon({ playing, loaded }: { playing: boolean; loaded: boolean }) {
  if (!loaded) {
    return <span aria-hidden="true" className="h-5 w-5 animate-pulse rounded-full bg-slate-600" />;
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`h-6 w-6 ${playing ? 'text-sky-300' : 'text-slate-400'}`}
      fill="currentColor"
    >
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      {playing && <path d="M14.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />}
      <path d="M16.5 6a8 8 0 0 1 0 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity={playing ? 1 : 0.5} />
    </svg>
  );
}

import { memo } from 'react';
import type { BoardTile } from '../game/types';
import { Waveform } from './Waveform';
import type { Peaks } from '../hooks/useWaveforms';

export interface TileProps {
  tile: BoardTile;
  index: number;
  total: number;
  /** The tile the controls below the board are pointed at. Exactly one, or none. */
  tuned: boolean;
  /** Deliberately held back for a batch filing. Never set by listening. */
  marked: boolean;
  /** The player has played this clip at least once. */
  heard: boolean;
  playing: boolean;
  loaded: boolean;
  /** True once this clip's media clock has actually advanced. */
  progressed: boolean;
  /** 0-1 playhead, only meaningful while `playing`. */
  progress: number;
  peaks: Peaks | null;
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
 * Shortens a group label to a tag that fits a tile corner.
 *
 * Truncating the front of the string breaks the moment groups are unnamed:
 * "Group A", "Group B" and "Group C" all collapse to "Gro", so every filed tile
 * on Medium and Hard would carry an identical badge. Taking the last word first
 * gives "A", "B" and "C" there, and still gives "Bas" for Basque.
 */
function shortTag(label: string): string {
  const last = label.trim().split(/\s+/).at(-1) ?? label;
  return last.length > 3 ? last.slice(0, 3) : last;
}

/**
 * One station on the band.
 *
 * ## Pressing a tile only ever listens
 *
 * This is the rule the whole redesign turns on. In the first version a tap both
 * played a clip *and* selected it, so a player comparing all sixteen clips —
 * the obvious thing to do — ended up with all sixteen selected, and one press
 * of a group button filed the entire board under a single language. Listening
 * now commits to nothing: it plays the clip and points the controls below the
 * board at this tile. Filing is a separate press on a separate control.
 *
 * ## Four states, four different channels
 *
 * A player has to tell these apart at a glance, mid-round, on a phone. So each
 * uses a different visual channel rather than four shades of one ring:
 *
 *   heard    the *shape* channel — a flat noise floor becomes the clip's own
 *            waveform. An unheard tile has no shape at all.
 *   tuned    the *light* channel — the well is backlit and its bezel lit amber.
 *   held     the *fill* channel — the tile inverts to ember with a HOLD tag.
 *   filed    the *badge* channel — a group tag clamped over the top edge.
 *
 * Any combination stays readable: a held, heard, filed tile shows an ember
 * fill, a real waveform and a tag, all at once.
 *
 * ## Accessibility
 *
 *  - A real `<button>`, so Enter and Space work without help.
 *  - `aria-pressed` tracks *held*, which is the genuine toggle. It deliberately
 *    no longer tracks "played": playing is an event, not a state.
 *  - The `aria-label` states heard, held and filed in words, so a screen-reader
 *    user gets the same map of the band a sighted player has. Losing track of
 *    what you have already heard is fatal in a game built on comparing sounds
 *    from memory, and the old label never changed at all.
 */
export const Tile = memo(function Tile({
  tile,
  index,
  total,
  tuned,
  marked,
  heard,
  playing,
  loaded,
  progressed,
  progress,
  peaks,
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
  const station = String(index + 1).padStart(2, '0');
  const revealed = [revealedWord, revealedRomanization, revealedLanguage]
    .filter(Boolean)
    .join(', ');

  const label = [
    `Station ${index + 1} of ${total}`,
    heard ? 'heard' : 'not heard yet',
    marked ? 'held for filing' : null,
    assignedLabel ? `filed under ${assignedLabel}` : 'not filed',
    tuned ? 'tuned' : null,
    revealed ? `revealed: ${revealed}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      role="gridcell"
      aria-pressed={marked}
      aria-label={`${label}. Press to listen.`}
      tabIndex={isTabStop ? 0 : -1}
      onClick={onActivate}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      data-testid={`tile-${tile.id}`}
      data-tile-index={index}
      data-played={progressed ? 'true' : 'false'}
      data-heard={heard ? 'true' : 'false'}
      data-tuned={tuned ? 'true' : 'false'}
      data-held={marked ? 'true' : 'false'}
      className={[
        'relative flex aspect-square min-h-[56px] w-full flex-col items-center justify-center',
        'overflow-hidden rounded-[7px] px-1 transition-[background-color,box-shadow,transform] duration-200',
        'touch-manipulation select-none',
        marked ? 'well-held' : tuned ? 'well-tuned' : 'well',
        tuned ? 'scale-[1.05]' : '',
      ].join(' ')}
    >
      {/* Station number, engraved into the panel above the readout. */}
      <span
        aria-hidden="true"
        className={[
          'readout absolute top-1 left-1.5 text-[9px] leading-none font-semibold tracking-[0.08em] transition-colors',
          marked
            ? 'text-[color:var(--color-ember)]'
            : tuned
              ? 'text-[color:var(--color-signal)]'
              : heard
                ? 'text-[color:var(--color-legend)]'
                : 'text-[color:var(--color-legend-dim)]',
        ].join(' ')}
      >
        {station}
      </span>

      {/* Filing tag, clamped over the top edge like a label on a cassette. */}
      {assignedLabel && (
        <span
          aria-hidden="true"
          className="readout absolute top-0 right-0 rounded-bl-[6px] px-1.5 py-[3px] text-[9px] leading-none font-bold"
          style={{
            backgroundColor: clueColor ?? 'var(--color-hairline)',
            color: clueColor ? '#140e07' : 'var(--color-ink)',
          }}
        >
          {shortTag(assignedLabel)}
        </span>
      )}

      {!loaded ? (
        <span
          aria-hidden="true"
          className="anim-carrier h-[2px] w-8 rounded-full bg-[color:var(--color-legend-dim)]"
        />
      ) : (
        <Waveform
          peaks={peaks}
          silent={!heard}
          progress={playing ? progress : undefined}
          tone={marked ? 'ember' : heard ? 'signal' : 'dim'}
          className={[
            'h-7 w-full transition-opacity duration-300',
            assignedLabel && !tuned && !marked ? 'opacity-50' : 'opacity-100',
          ].join(' ')}
        />
      )}

      {/* Clue text. Native scripts need the system stack, not the latin-only
          nameplate face, so this block sets its own family. */}
      {(revealedWord || revealedRomanization || revealedLanguage) && (
        <span
          aria-hidden="true"
          className="mt-0.5 w-full px-0.5 text-center leading-tight"
          style={{ fontFamily: 'var(--font-sans)' }}
        >
          {revealedWord && (
            <span className="block truncate text-[10px] text-[color:var(--color-ink)]">
              {revealedWord}
            </span>
          )}
          {revealedRomanization && (
            <span className="block truncate text-[9px] text-[color:var(--color-legend)] italic">
              {revealedRomanization}
            </span>
          )}
          {revealedLanguage && (
            <span className="block truncate text-[9px] font-bold text-[color:var(--color-signal)]">
              {revealedLanguage}
            </span>
          )}
        </span>
      )}

      {/* Carrier lamp: lit only while this station is actually sounding. */}
      {playing && (
        <span
          aria-hidden="true"
          className="anim-lamp pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-[color:var(--color-signal)]"
        />
      )}
    </button>
  );
});

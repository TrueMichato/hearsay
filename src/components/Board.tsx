import { useCallback, useEffect, useRef, useState } from 'react';
import { Tile } from './Tile';
import type { Assignment, BoardTile } from '../game/types';
import type { Peaks } from '../hooks/useWaveforms';

const COLUMNS = 4;

export interface BoardProps {
  tiles: BoardTile[];
  assignment: Assignment;
  /** Tiles held back for a batch filing. Never changed by listening. */
  marked: Set<string>;
  /** Tiles the player has played at least once. */
  heard: Set<string>;
  /** The tile the controls below the board act on, or null before any action. */
  tunedId: string | null;
  playing: string | null;
  /** 0-1 playhead of whatever is sounding. */
  progress: number;
  loaded: Set<string>;
  /** Tile ids whose audio has verifiably advanced. Surfaced for tests. */
  progressed: Set<string>;
  peaks: Record<string, Peaks>;
  /** Bucket id -> short label shown on the tile tag. */
  bucketLabels: Record<string, string>;
  clueColors: Record<string, string>;
  revealedWords: Set<string>;
  revealedRomanizations: Set<string>;
  revealedLanguages: Record<string, string>;
  /** Point the controls at a tile. Called on tap and on keyboard focus. */
  onTune: (tileId: string) => void;
  onPlay: (tileId: string) => void;
  /** Toggle the tuned tile's hold. Bound to the M key. */
  onToggleHold: () => void;
  /** Keyboard accelerator: file the current target into the Nth group. */
  onQuickAssign: (groupIndex: number) => void;
}

/**
 * The band: a 4x4 grid of stations.
 *
 * ## The interaction model
 *
 * There is exactly one **cursor** — the tuned station. Pointing at a tile and
 * playing it are the same gesture; filing it is a different control entirely.
 *
 *   press a tile / Enter / Space   listen, and tune the controls to it
 *   arrow keys                     move the cursor (silently — see below)
 *   M                              hold the tuned tile back for a batch filing
 *   1-5                            file the target into that group
 *
 * "The target" is the held tiles if any are held, otherwise the tuned tile.
 * That is what lets a player file sixteen tiles one at a time with no selection
 * bookkeeping at all, while still being able to say "these four together".
 *
 * ## Why arrow keys do not play
 *
 * Sweeping a dial and hearing stations go by is the tempting version, and it is
 * wrong for the people who need the keyboard most: a screen-reader user moving
 * across the grid would have speech and audio talking over each other. Arrows
 * move and announce; Enter listens. The cursor still follows focus, so the
 * number keys always act on the tile the reader just described.
 *
 * The grid remains a single tab stop (a "roving tabindex"), so a keyboard user
 * does not press Tab sixteen times to get past the board.
 */
export function Board({
  tiles,
  assignment,
  marked,
  heard,
  tunedId,
  playing,
  progress,
  loaded,
  progressed,
  peaks,
  bucketLabels,
  clueColors,
  revealedWords,
  revealedRomanizations,
  revealedLanguages,
  onTune,
  onPlay,
  onToggleHold,
  onQuickAssign,
}: BoardProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const shouldRefocus = useRef(false);

  useEffect(() => {
    if (!shouldRefocus.current) return;
    shouldRefocus.current = false;
    const target = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-tile-index="${focusIndex}"]`,
    );
    target?.focus();
  }, [focusIndex]);

  const moveFocus = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(tiles.length - 1, next));
      shouldRefocus.current = true;
      setFocusIndex(clamped);
      onTune(tiles[clamped].id);
    },
    [onTune, tiles],
  );

  const handleKeyDown = useCallback(
    (index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          moveFocus(index + 1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          moveFocus(index - 1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          moveFocus(index + COLUMNS);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveFocus(index - COLUMNS);
          break;
        case 'Home':
          event.preventDefault();
          moveFocus(0);
          break;
        case 'End':
          event.preventDefault();
          moveFocus(tiles.length - 1);
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          onToggleHold();
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          event.preventDefault();
          onQuickAssign(Number(event.key) - 1);
          break;
        default:
          break;
      }
    },
    [moveFocus, onQuickAssign, onToggleHold, tiles.length],
  );

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label="Stations. Arrow keys move, Enter listens, M holds a station back, number keys file it into a group."
      aria-rowcount={Math.ceil(tiles.length / COLUMNS)}
      aria-colcount={COLUMNS}
      className="grid grid-cols-4 gap-2"
    >
      {tiles.map((tile, index) => (
        <Tile
          key={tile.id}
          tile={tile}
          index={index}
          total={tiles.length}
          tuned={tunedId === tile.id}
          marked={marked.has(tile.id)}
          heard={heard.has(tile.id)}
          playing={playing === tile.id}
          progress={progress}
          loaded={loaded.has(tile.id)}
          progressed={progressed.has(tile.id)}
          peaks={peaks[tile.id] ?? null}
          assignedLabel={assignment[tile.id] ? (bucketLabels[assignment[tile.id]] ?? null) : null}
          clueColor={clueColors[tile.id] ?? null}
          revealedWord={revealedWords.has(tile.id) ? tile.word : null}
          revealedRomanization={
            revealedRomanizations.has(tile.id) ? (tile.romanization ?? '—') : null
          }
          revealedLanguage={revealedLanguages[tile.id] ?? null}
          isTabStop={index === focusIndex}
          onFocus={() => {
            setFocusIndex(index);
            onTune(tile.id);
          }}
          onActivate={() => {
            // Listening, and only listening. What is held never changes here.
            onTune(tile.id);
            onPlay(tile.id);
          }}
          onKeyDown={handleKeyDown(index)}
        />
      ))}
    </div>
  );
}

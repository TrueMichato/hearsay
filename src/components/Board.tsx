import { useCallback, useEffect, useRef, useState } from 'react';
import { Tile } from './Tile';
import type { Assignment, BoardTile } from '../game/types';

const COLUMNS = 4;

export interface BoardProps {
  tiles: BoardTile[];
  assignment: Assignment;
  selected: Set<string>;
  playing: string | null;
  loaded: Set<string>;
  /** Bucket id -> short label shown on the tile badge. */
  bucketLabels: Record<string, string>;
  clueColors: Record<string, string>;
  revealedWords: Set<string>;
  revealedRomanizations: Set<string>;
  revealedLanguages: Record<string, string>;
  onToggleSelect: (tileId: string) => void;
  onPlay: (tileId: string) => void;
  /** Keyboard accelerator: assign the current selection to the Nth group. */
  onQuickAssign: (groupIndex: number) => void;
}

/**
 * The 4x4 board.
 *
 * Interaction is **tap-to-select, then tap a group** — deliberately not HTML5
 * drag-and-drop, which is unreliable on touch devices and effectively
 * impossible to operate with a keyboard or screen reader.
 *
 * Keyboard model: the grid is a single tab stop (a "roving tabindex"). Once
 * focus is inside, arrow keys move between tiles, Enter/Space plays and selects,
 * and number keys 1-5 assign the selection to a group. Without the roving
 * tabindex a keyboard user would have to press Tab sixteen times to get past
 * the board.
 */
export function Board({
  tiles,
  assignment,
  selected,
  playing,
  loaded,
  bucketLabels,
  clueColors,
  revealedWords,
  revealedRomanizations,
  revealedLanguages,
  onToggleSelect,
  onPlay,
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
    },
    [tiles.length],
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
    [moveFocus, onQuickAssign, tiles.length],
  );

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label="Audio tiles. Use the arrow keys to move, Enter to play and select, and number keys to assign to a group."
      aria-rowcount={4}
      aria-colcount={COLUMNS}
      className="grid grid-cols-4 gap-2 sm:gap-3"
    >
      {tiles.map((tile, index) => (
        <Tile
          key={tile.id}
          tile={tile}
          index={index}
          selected={selected.has(tile.id)}
          playing={playing === tile.id}
          loaded={loaded.has(tile.id)}
          assignedLabel={assignment[tile.id] ? (bucketLabels[assignment[tile.id]] ?? null) : null}
          clueColor={clueColors[tile.id] ?? null}
          revealedWord={revealedWords.has(tile.id) ? tile.word : null}
          revealedRomanization={
            revealedRomanizations.has(tile.id) ? (tile.romanization ?? '—') : null
          }
          revealedLanguage={revealedLanguages[tile.id] ?? null}
          isTabStop={index === focusIndex}
          onFocus={() => setFocusIndex(index)}
          onActivate={() => {
            onPlay(tile.id);
            onToggleSelect(tile.id);
          }}
          onKeyDown={handleKeyDown(index)}
        />
      ))}
    </div>
  );
}

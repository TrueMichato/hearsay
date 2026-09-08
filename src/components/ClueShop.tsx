import { CLUES, type ClueDefinition, type ClueId, type ClueState } from '../game/clues';
import type { Difficulty } from '../game/types';

export interface ClueShopProps {
  open: boolean;
  coins: number;
  difficulty: Difficulty;
  state: ClueState;
  /** How many tiles are selected — tile-scoped clues need exactly one. */
  selectedCount: number;
  languageCount: number;
  onBuy: (id: ClueId) => void;
  onClose: () => void;
}

/**
 * The clue shop.
 *
 * This is where the "no text on tiles" rule gets its release valve. A player who
 * is genuinely stuck can buy their way to information, but it costs coins they
 * earned by playing well — so the shortcut has a price and cannot become the
 * default way to play.
 */
export function ClueShop({
  open,
  coins,
  difficulty,
  state,
  selectedCount,
  languageCount,
  onBuy,
  onClose,
}: ClueShopProps) {
  if (!open) return null;

  const available = CLUES.filter((clue) => clue.availableIn.includes(difficulty));

  const ownedState = (clue: ClueDefinition): string | null => {
    if (clue.id === 'colorCode' && state.colorCoded) return 'Active';
    if (clue.id === 'revealLanguageCount' && state.languageCountRevealed) {
      return `${languageCount} languages`;
    }
    return null;
  };

  const blockedReason = (clue: ClueDefinition): string | null => {
    if (ownedState(clue)) return null;
    if (clue.scope === 'tile' && selectedCount !== 1) return 'Select exactly one tile';
    if (coins < clue.cost) return 'Not enough coins';
    return null;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Clue shop"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-slate-900 p-4 shadow-2xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Clue shop</h2>
          <span className="rounded-lg bg-amber-500/15 px-2 py-1 text-sm font-bold text-amber-300 tabular-nums">
            {coins} coins
          </span>
        </div>

        <p className="mb-3 text-xs text-slate-400">
          Tiles stay silent about what they say. Buy information here — but you earn coins by
          scoring well, so guessing with your ears is always the cheaper strategy.
        </p>

        <ul className="space-y-2">
          {available.map((clue) => {
            const owned = ownedState(clue);
            const blocked = blockedReason(clue);
            return (
              <li key={clue.id}>
                <button
                  type="button"
                  disabled={Boolean(owned || blocked)}
                  onClick={() => onBuy(clue.id)}
                  data-testid={`clue-${clue.id}`}
                  aria-label={`${clue.name}, ${clue.cost} coins. ${clue.description} ${owned ?? blocked ?? ''}`}
                  className="flex w-full items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/70 p-3 text-left enabled:hover:border-sky-500 enabled:hover:bg-slate-800 disabled:opacity-55"
                >
                  <span aria-hidden="true" className="text-xl leading-none">
                    {clue.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{clue.name}</span>
                      <span className="shrink-0 text-xs font-bold text-amber-300 tabular-nums">
                        {clue.cost}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">{clue.description}</span>
                    {(owned || blocked) && (
                      <span className="mt-1 block text-[11px] font-medium text-slate-500">
                        {owned ?? blocked}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-slate-700 py-3 text-sm font-semibold hover:bg-slate-600"
        >
          Back to the board
        </button>
      </div>
    </div>
  );
}

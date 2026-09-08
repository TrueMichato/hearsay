import { useEffect, useRef } from 'react';
import { CLUES, type ClueDefinition, type ClueId, type ClueState } from '../game/clues';
import type { Difficulty } from '../game/types';

export interface ClueShopProps {
  open: boolean;
  coins: number;
  difficulty: Difficulty;
  state: ClueState;
  /** 1-based number of the tuned station; tile-scoped clues need one. */
  tunedStation: number | null;
  languageCount: number;
  onBuy: (id: ClueId) => void;
  onClose: () => void;
}

/**
 * The clue shop, as the receiver's decoder drawer.
 *
 * This is where the "no text on tiles" rule gets its release valve. A player who
 * is genuinely stuck can buy their way to information, but it costs coins they
 * earned by playing well — so the shortcut has a price and cannot become the
 * default way to play.
 *
 * It is a real modal, unlike the coach panel: it is a self-contained task that
 * spends a resource, so focus belongs inside it until the player is done. Escape
 * closes it and focus returns to the board.
 */
export function ClueShop({
  open,
  coins,
  difficulty,
  state,
  tunedStation,
  languageCount,
  onBuy,
  onClose,
}: ClueShopProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

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
    if (clue.scope === 'tile' && tunedStation === null) return 'Tune a station first';
    if (coins < clue.cost) return 'Not enough coins';
    return null;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Clue shop"
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#050301]/85 sm:items-center"
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="panel grain anim-tune-in relative max-h-[86vh] w-full max-w-md overflow-y-auto rounded-t-xl p-4 sm:rounded-xl"
      >
        <div className="relative z-10">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h2 className="nameplate text-2xl text-[color:var(--color-ink)]">Decoder</h2>
            <span className="readout text-lg font-bold text-[color:var(--color-signal)]">
              {coins}
              <span className="legend ml-1 text-[color:var(--color-legend)]">coins</span>
            </span>
          </div>

          <p className="mb-3 text-xs leading-relaxed text-[color:var(--color-legend)]">
            Stations say nothing about themselves. Buy information here — but coins come from
            scoring well, so trusting your ears is always the cheaper strategy.
            {tunedStation !== null && (
              <span className="text-[color:var(--color-signal)]">
                {' '}
                Station clues apply to station {String(tunedStation).padStart(2, '0')}.
              </span>
            )}
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
                    className="well flex w-full items-start gap-3 rounded-lg p-3 text-left transition-shadow enabled:hover:shadow-[inset_0_0_0_1.5px_var(--color-signal)] disabled:opacity-45"
                  >
                    <span aria-hidden="true" className="text-xl leading-none">
                      {clue.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="nameplate text-base text-[color:var(--color-ink)]">
                          {clue.name}
                        </span>
                        <span className="readout shrink-0 text-sm font-bold text-[color:var(--color-signal)]">
                          {clue.cost}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-[color:var(--color-legend)]">
                        {clue.description}
                      </span>
                      {(owned || blocked) && (
                        <span className="legend mt-1.5 block text-[color:var(--color-ember)]">
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
            className="nameplate mt-4 w-full rounded-lg bg-[color:var(--color-signal)] py-3 text-lg tracking-[0.06em] text-[#140e07]"
          >
            Back to the band
          </button>
        </div>
      </div>
    </div>
  );
}

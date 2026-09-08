import type { Bucket } from '../game/types';

export interface GroupTrayProps {
  buckets: Bucket[];
  counts: Record<string, number>;
  /**
   * How many tiles the next press will file. 0 disables the bank, 1 is the
   * tuned station, more than 1 means held stations.
   */
  targetCount: number;
  /** True when the target is the held set rather than the tuned station. */
  targetIsHeld: boolean;
  /** Hard mode lets the player add groups; labelled modes do not. */
  canAddGroup: boolean;
  onAssign: (bucketId: string) => void;
  onAddGroup: () => void;
  onUnassignTarget: () => void;
  /** True when the target is already filed, so unfiling is meaningful. */
  canUnassign: boolean;
}

/**
 * The filing bank: the row of groups a station gets filed into.
 *
 * These are the only controls that change what is filed. Pressing one takes
 * whatever the tuner is pointed at — the tuned station, or every held station —
 * and commits it. That is the whole of the game's commitment surface, and it is
 * physically separate from the board so that comparing clips can never file
 * anything by accident.
 *
 * On Easy these are labelled with real language names; on Medium they are
 * anonymous ("Group A"); on Hard they do not exist until the player creates
 * them. All three are this same component, because the gesture is identical.
 */
export function GroupTray({
  buckets,
  counts,
  targetCount,
  targetIsHeld,
  canAddGroup,
  onAssign,
  onAddGroup,
  onUnassignTarget,
  canUnassign,
}: GroupTrayProps) {
  const armed = targetCount > 0;

  return (
    <section aria-label="Filing bank" className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="legend">File under</h2>
        <span aria-live="polite" className="legend text-[color:var(--color-legend-dim)]">
          {!armed
            ? 'nothing tuned'
            : targetIsHeld
              ? `${targetCount} held stations`
              : 'the tuned station'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {buckets.map((bucket, index) => (
          <button
            key={bucket.id}
            type="button"
            onClick={() => onAssign(bucket.id)}
            disabled={!armed}
            data-testid={`bucket-${bucket.id}`}
            aria-label={`${bucket.label}. ${counts[bucket.id] ?? 0} stations filed here. ${
              armed ? `Press to file ${targetCount}.` : 'Tune a station first.'
            }`}
            className={[
              'panel group relative flex min-h-[52px] items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-left',
              'transition-[box-shadow,transform] duration-150',
              armed
                ? 'enabled:active:translate-y-px enabled:hover:shadow-[inset_0_0_0_1.5px_var(--color-signal),0_4px_14px_-6px_rgb(255_167_36/0.6)]'
                : 'opacity-45',
            ].join(' ')}
          >
            {/* The label comes first in the DOM so the button's text content
                begins with the group name — the deploy verifier identifies
                buckets that way, and CSS `order` puts the engraved number-key
                accelerator back on the left where a front panel would have it. */}
            <span className="order-2 min-w-0 flex-1">
              <span className="nameplate block truncate text-[15px] leading-tight text-[color:var(--color-ink)]">
                {bucket.label}
              </span>
            </span>
            {index < 5 && (
              <span
                aria-hidden="true"
                className="well readout order-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold text-[color:var(--color-legend)]"
              >
                {index + 1}
              </span>
            )}
            <span
              aria-hidden="true"
              className="readout order-3 shrink-0 text-base font-bold"
              style={{
                color:
                  (counts[bucket.id] ?? 0) > 0
                    ? 'var(--color-signal)'
                    : 'var(--color-legend-dim)',
              }}
            >
              {counts[bucket.id] ?? 0}
            </span>
          </button>
        ))}

        {canAddGroup && (
          <button
            type="button"
            onClick={onAddGroup}
            // Adding a group is secondary to filing into one, so it stays a
            // quiet dashed outline rather than competing with the real groups.
            style={{ borderColor: 'var(--color-hairline)' }}
            className="legend flex min-h-[52px] items-center justify-center rounded-lg border border-dashed px-3 py-2 text-[color:var(--color-legend-dim)] transition-colors hover:text-[color:var(--color-signal)]"
          >
            + New group
          </button>
        )}
      </div>

      {canUnassign && (
        <button
          type="button"
          onClick={onUnassignTarget}
          data-testid="unfile"
          className="legend inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-hairline)] px-3 py-1.5 text-[color:var(--color-legend)] transition-colors hover:border-[color:var(--color-ember)] hover:text-[color:var(--color-ember)]"
        >
          <span aria-hidden="true">↩</span>
          Take {targetCount > 1 ? `these ${targetCount}` : 'this one'} back out
        </button>
      )}
    </section>
  );
}

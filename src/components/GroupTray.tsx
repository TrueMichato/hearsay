import type { Bucket } from '../game/types';

export interface GroupTrayProps {
  buckets: Bucket[];
  counts: Record<string, number>;
  /** How many tiles are selected and waiting to be placed. */
  selectedCount: number;
  /** Hard mode lets the player add groups; labelled modes do not. */
  canAddGroup: boolean;
  onAssign: (bucketId: string) => void;
  onAddGroup: () => void;
  onClearSelection: () => void;
  onUnassignSelected: () => void;
}

/**
 * The row of groups a player drops tiles into.
 *
 * On Easy these are labelled with real language names; on Medium they are
 * anonymous ("Group A"); on Hard they do not exist until the player creates
 * them. All three cases are the same component, because the interaction — select
 * tiles, then press a group — is identical.
 */
export function GroupTray({
  buckets,
  counts,
  selectedCount,
  canAddGroup,
  onAssign,
  onAddGroup,
  onClearSelection,
  onUnassignSelected,
}: GroupTrayProps) {
  const hasSelection = selectedCount > 0;

  return (
    <section aria-label="Groups" className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span aria-live="polite">
          {hasSelection
            ? `${selectedCount} tile${selectedCount === 1 ? '' : 's'} selected — choose a group`
            : 'Tap tiles to listen and select'}
        </span>
        {hasSelection && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onUnassignSelected}
              className="rounded-lg px-2 py-1 text-slate-300 underline-offset-2 hover:underline"
            >
              Unassign
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              className="rounded-lg px-2 py-1 text-slate-300 underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {buckets.map((bucket, index) => (
          <button
            key={bucket.id}
            type="button"
            onClick={() => onAssign(bucket.id)}
            disabled={!hasSelection}
            data-testid={`bucket-${bucket.id}`}
            aria-label={`${bucket.label}. ${counts[bucket.id] ?? 0} tiles. ${
              hasSelection ? `Press to move ${selectedCount} selected here.` : 'Select tiles first.'
            }`}
            className={[
              'flex min-h-[56px] items-center justify-between gap-2 rounded-xl border-2 px-3 py-2 text-left transition-colors',
              hasSelection
                ? 'border-sky-500 bg-sky-950/60 hover:bg-sky-900'
                : 'border-slate-700 bg-slate-800/60',
              'disabled:cursor-not-allowed disabled:opacity-60',
            ].join(' ')}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{bucket.label}</span>
              {/* The number-key accelerator is only worth advertising for the
                  first five groups, which is also the maximum the game allows. */}
              {index < 5 && (
                <span aria-hidden="true" className="text-[10px] text-slate-400">
                  press {index + 1}
                </span>
              )}
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 rounded-lg bg-slate-900/70 px-2 py-1 text-xs font-bold tabular-nums"
            >
              {counts[bucket.id] ?? 0}
            </span>
          </button>
        ))}

        {canAddGroup && (
          <button
            type="button"
            onClick={onAddGroup}
            className="flex min-h-[56px] items-center justify-center rounded-xl border-2 border-dashed border-slate-600 px-3 py-2 text-sm text-slate-300 hover:border-slate-400 hover:text-white"
          >
            + New group
          </button>
        )}
      </div>
    </section>
  );
}

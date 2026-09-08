import { useLiveQuery } from 'dexie-react-hooks';
import { getProfile, type ProfileRecord } from '../db/database';

/**
 * The player's wallet and streaks, kept live.
 *
 * `useLiveQuery` re-runs its query whenever the underlying IndexedDB tables
 * change, so a coin spent on one screen updates every other screen without any
 * global state library.
 */
export function useProfile(): ProfileRecord | undefined {
  // Read-only on purpose: `useLiveQuery` runs its query inside a read-only
  // transaction, so creating a missing profile here would throw a DexieError
  // and blank the screen. The row is written for the first time by recordRound.
  return useLiveQuery(() => getProfile(), []);
}

import { useLiveQuery } from 'dexie-react-hooks';
import { db, getProfile, PROFILE_ID, type ProfileRecord } from '../db/database';

/**
 * The player's wallet and streaks, kept live.
 *
 * `useLiveQuery` re-runs its query whenever the underlying IndexedDB tables
 * change, so a coin spent on one screen updates every other screen without any
 * global state library.
 */
export function useProfile(): ProfileRecord | undefined {
  return useLiveQuery(async () => {
    const existing = await db.profile.get(PROFILE_ID);
    return existing ?? (await getProfile());
  }, []);
}

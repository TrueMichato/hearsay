import Dexie, { type Table } from 'dexie';
import { BRAND_SLUG } from '../config/branding';

/**
 * Local-first persistence.
 *
 * Everything the player has ever done lives in IndexedDB on their own device.
 * There is no server, no account, and nothing leaves the machine.
 *
 * ## Why the schema is versioned
 *
 * IndexedDB is a real database with a real migration story. Dexie models this
 * with numbered versions: each `db.version(n).stores({...})` describes the
 * indexes at that version, and an optional `.upgrade()` transforms existing
 * rows. If you change a schema *without* bumping the version, players who
 * already have data get an inconsistent database — or Dexie throws and the app
 * appears to have eaten their history.
 *
 * The rule for this file: **never edit an existing `version(n)` block.** Add a
 * new one. Old blocks are a historical record that lets a player who has not
 * opened the app in a year upgrade cleanly through every intermediate step.
 */

/** One completed round. The append-only event log everything else derives from. */
export interface RoundRecord {
  id?: number;
  /** Deterministic round id (`<seed>-<difficulty>`), so a round can be replayed. */
  roundId: string;
  seed: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Languages that were on the board. */
  languages: string[];
  score: number;
  correct: number;
  wrong: number;
  unassigned: number;
  accuracy: number;
  coinsEarned: number;
  coinsSpent: number;
  /** Wall-clock milliseconds from board shown to round submitted. */
  durationMs: number;
  playedAt: number;
  /** `YYYY-MM-DD` in local time. Indexed so daily-streak queries are cheap. */
  playedDay: string;
}

/**
 * Aggregated confusion counts: how often the player heard `actual` and said
 * `guessed`. The diagonal (actual === guessed) is correct answers.
 *
 * This is stored aggregated *as well as* inside each round record. The
 * aggregate makes the stats screen O(1) to render; the per-round copy means the
 * aggregate can always be rebuilt if it ever drifts.
 */
export interface ConfusionRecord {
  /** Compound primary key `[actual+guessed]`. */
  actual: string;
  guessed: string;
  count: number;
}

/** Rolling per-language accuracy. */
export interface LanguageStatRecord {
  language: string;
  correct: number;
  total: number;
  lastPlayedAt: number;
}

/** Which clues the player relies on. */
export interface ClueUsageRecord {
  clueId: string;
  timesBought: number;
  coinsSpent: number;
}

/** Single-row table holding the player's wallet and streaks. */
export interface ProfileRecord {
  /** Always `singleton`. */
  id: string;
  coins: number;
  totalRounds: number;
  totalScore: number;
  bestScore: number;
  /** Consecutive days with at least one round. */
  dayStreak: number;
  bestDayStreak: number;
  /** Consecutive rounds at or above `WIN_STREAK_ACCURACY`. */
  winStreak: number;
  bestWinStreak: number;
  lastPlayedDay: string | null;
  createdAt: number;
}

export const PROFILE_ID = 'singleton';

/** Coins granted to a brand-new player so the clue shop is reachable early. */
export const STARTING_COINS = 60;

/** Accuracy at or above which a round extends the win streak. */
export const WIN_STREAK_ACCURACY = 0.75;

export class HearsayDatabase extends Dexie {
  rounds!: Table<RoundRecord, number>;
  confusions!: Table<ConfusionRecord, [string, string]>;
  languageStats!: Table<LanguageStatRecord, string>;
  clueUsage!: Table<ClueUsageRecord, string>;
  profile!: Table<ProfileRecord, string>;

  constructor() {
    // The database name is derived from branding so a rename does not orphan
    // the player's data under an old name by accident — but note that renaming
    // the product *will* start a fresh database. See the README ("Renaming").
    super(`${BRAND_SLUG}-db`);

    // --- v1: initial schema -------------------------------------------------
    // Index rules of thumb: the first field is the primary key, later fields are
    // secondary indexes. Only index what you actually query or sort by; every
    // index costs write time.
    this.version(1).stores({
      rounds: '++id, roundId, difficulty, playedAt, playedDay',
      confusions: '[actual+guessed], actual, guessed',
      languageStats: 'language, lastPlayedAt',
      clueUsage: 'clueId',
      profile: 'id',
    });

    // --- Adding v2 later? ---------------------------------------------------
    // Copy this shape; do NOT edit the block above.
    //
    //   this.version(2)
    //     .stores({ rounds: '++id, roundId, difficulty, playedAt, playedDay, mode' })
    //     .upgrade((tx) => tx.table('rounds').toCollection().modify((r) => {
    //       r.mode = 'classic';
    //     }));
  }
}

export const db = new HearsayDatabase();

/** Read the profile, creating it on first run. */
/**
 * A brand-new player's profile, as a plain value.
 *
 * Deliberately pure. Reading the profile must never write, because the UI reads
 * it through a Dexie live query, and live queries run in a read-only
 * transaction — a write there throws. It also means simply opening the app
 * leaves no trace on disk until the player actually finishes a round.
 */
export function newProfile(): ProfileRecord {
  return {
    id: PROFILE_ID,
    coins: STARTING_COINS,
    totalRounds: 0,
    totalScore: 0,
    bestScore: 0,
    dayStreak: 0,
    bestDayStreak: 0,
    winStreak: 0,
    bestWinStreak: 0,
    lastPlayedDay: null,
    createdAt: Date.now(),
  };
}

/** Reads the stored profile, falling back to a fresh one. Never writes. */
export async function getProfile(): Promise<ProfileRecord> {
  return (await db.profile.get(PROFILE_ID)) ?? newProfile();
}

export async function setCoins(coins: number): Promise<void> {
  const profile = await getProfile();
  await db.profile.put({ ...profile, coins: Math.max(0, Math.round(coins)) });
}

/** Local-time `YYYY-MM-DD`. Deliberately local, not UTC: streaks are about the player's day. */
export function dayKey(at: number = Date.now()): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whether `day` is exactly one calendar day after `previous`. */
function isConsecutiveDay(previous: string, day: string): boolean {
  const prev = new Date(`${previous}T00:00:00`);
  const next = new Date(`${day}T00:00:00`);
  return Math.round((next.getTime() - prev.getTime()) / 86_400_000) === 1;
}

export interface RecordRoundInput {
  round: Omit<RoundRecord, 'id' | 'playedAt' | 'playedDay'>;
  confusion: Record<string, Record<string, number>>;
  perLanguage: Record<string, { correct: number; total: number }>;
  cluePurchases: { id: string; cost: number }[];
}

/**
 * Persist a completed round and fold it into every aggregate.
 *
 * All writes happen in ONE Dexie transaction. If the tab is closed mid-write,
 * IndexedDB rolls the whole thing back rather than leaving the round recorded
 * but the streak un-incremented.
 */
export async function recordRound(input: RecordRoundInput): Promise<ProfileRecord> {
  const playedAt = Date.now();
  const playedDay = dayKey(playedAt);

  return db.transaction(
    'rw',
    [db.rounds, db.confusions, db.languageStats, db.clueUsage, db.profile],
    async () => {
      await db.rounds.add({ ...input.round, playedAt, playedDay });

      for (const [actual, row] of Object.entries(input.confusion)) {
        for (const [guessed, count] of Object.entries(row)) {
          const existing = await db.confusions.get([actual, guessed]);
          await db.confusions.put({ actual, guessed, count: (existing?.count ?? 0) + count });
        }
      }

      for (const [language, stat] of Object.entries(input.perLanguage)) {
        const existing = await db.languageStats.get(language);
        await db.languageStats.put({
          language,
          correct: (existing?.correct ?? 0) + stat.correct,
          total: (existing?.total ?? 0) + stat.total,
          lastPlayedAt: playedAt,
        });
      }

      for (const purchase of input.cluePurchases) {
        const existing = await db.clueUsage.get(purchase.id);
        await db.clueUsage.put({
          clueId: purchase.id,
          timesBought: (existing?.timesBought ?? 0) + 1,
          coinsSpent: (existing?.coinsSpent ?? 0) + purchase.cost,
        });
      }

      const profile = (await db.profile.get(PROFILE_ID)) ?? newProfile();

      const dayStreak =
        profile.lastPlayedDay === playedDay
          ? profile.dayStreak
          : profile.lastPlayedDay && isConsecutiveDay(profile.lastPlayedDay, playedDay)
            ? profile.dayStreak + 1
            : 1;

      const winStreak =
        input.round.accuracy >= WIN_STREAK_ACCURACY ? profile.winStreak + 1 : 0;

      const updated: ProfileRecord = {
        ...profile,
        coins: Math.max(0, profile.coins - input.round.coinsSpent + input.round.coinsEarned),
        totalRounds: profile.totalRounds + 1,
        totalScore: profile.totalScore + input.round.score,
        bestScore: Math.max(profile.bestScore, input.round.score),
        dayStreak,
        bestDayStreak: Math.max(profile.bestDayStreak, dayStreak),
        winStreak,
        bestWinStreak: Math.max(profile.bestWinStreak, winStreak),
        lastPlayedDay: playedDay,
      };
      await db.profile.put(updated);
      return updated;
    },
  );
}

/** Wipe all local data. The only "delete my account" this app needs. */
export async function resetAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.rounds, db.confusions, db.languageStats, db.clueUsage, db.profile],
    async () => {
      await Promise.all([
        db.rounds.clear(),
        db.confusions.clear(),
        db.languageStats.clear(),
        db.clueUsage.clear(),
        db.profile.clear(),
      ]);
    },
  );
}

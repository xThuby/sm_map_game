import { MAX_GUESSES } from './session';

export const STORAGE_KEY = 'sm-map-game/stats/v1';

export interface RoomStat {
  attempts: number;
  solved: number;
  /** Total guesses spent across those attempts, for ranking how costly a room has been. */
  guesses: number;
}

export interface Stats {
  played: number;
  lost: number;
  /** Rooms solved on each guess: index 0 is a first-guess win. */
  byGuess: number[];
  rooms: Record<string, RoomStat>;
  /** Points banked over every room ever played, lost ones included at zero. */
  points: number;
  /**
   * How many rooms those points are spread over. Not the same as `played`: stats saved
   * before points existed count towards one and not the other.
   */
  pointedRooms: number;
  /** The best round total. A score is a round's, not a room's. */
  bestRound: number;
}

export interface RoomOutcome {
  roomId: number;
  roomName: string;
  solved: boolean;
  guessesUsed: number;
  /** What the room was worth once the hints bought on it were paid for. */
  points: number;
}

export interface Bar {
  label: string;
  count: number;
  /** Percentage of everything played, so a graph needs no second pass. */
  share: number;
}

export interface StrugglingRoom {
  name: string;
  attempts: number;
  solved: number;
  /** Percentage solved. */
  rate: number;
  averageGuesses: number;
}

export function emptyStats(): Stats {
  return {
    played: 0, lost: 0, byGuess: Array(MAX_GUESSES).fill(0), rooms: {},
    points: 0, pointedRooms: 0, bestRound: 0,
  };
}

/** Returns new stats rather than changing the ones given. */
export function recordRoom(stats: Stats, outcome: RoomOutcome): Stats {
  const byGuess = [...stats.byGuess];
  if (outcome.solved) {
    const at = Math.min(Math.max(outcome.guessesUsed, 1), MAX_GUESSES) - 1;
    byGuess[at] = (byGuess[at] ?? 0) + 1;
  }
  const before = stats.rooms[outcome.roomName] ?? { attempts: 0, solved: 0, guesses: 0 };
  return {
    ...stats,
    played: stats.played + 1,
    lost: stats.lost + (outcome.solved ? 0 : 1),
    points: stats.points + outcome.points,
    pointedRooms: stats.pointedRooms + 1,
    byGuess,
    rooms: {
      ...stats.rooms,
      [outcome.roomName]: {
        attempts: before.attempts + 1,
        solved: before.solved + (outcome.solved ? 1 : 0),
        guesses: before.guesses + outcome.guessesUsed,
      },
    },
  };
}

/** Returns new stats rather than changing the ones given. */
export function recordRound(stats: Stats, points: number): Stats {
  return { ...stats, bestRound: Math.max(stats.bestRound, points) };
}

/** Points a room has been worth on average, rounded. Rooms never got count as zero. */
export function averagePoints(stats: Stats): number {
  if (stats.pointedRooms === 0) return 0;
  return Math.round(stats.points / stats.pointedRooms);
}

/** Percentage of rooms solved, rounded. */
export function winRate(stats: Stats): number {
  if (stats.played === 0) return 0;
  return Math.round(((stats.played - stats.lost) / stats.played) * 100);
}

/** One bar per guess, plus a final bar for rooms that were never got. */
export function guessHistogram(stats: Stats): Bar[] {
  const counts = [...stats.byGuess, stats.lost];
  return counts.map((count, i) => ({
    label: i < MAX_GUESSES ? String(i + 1) : 'X',
    count,
    share: stats.played === 0 ? 0 : Math.round((count / stats.played) * 100),
  }));
}

/**
 * The rooms going worst, least often solved first, then by how many guesses they cost.
 * Rooms always solved on the first guess are left out: there is nothing to work on there.
 */
export function strugglingRooms(stats: Stats, limit: number): StrugglingRoom[] {
  return Object.entries(stats.rooms)
    .map(([name, r]) => ({
      name,
      attempts: r.attempts,
      solved: r.solved,
      rate: Math.round((r.solved / r.attempts) * 100),
      averageGuesses: r.guesses / r.attempts,
    }))
    .filter((r) => r.rate < 100 || r.averageGuesses > 1)
    .sort((a, b) => a.rate - b.rate || b.averageGuesses - a.averageGuesses
      || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Points arrived after stats did, so they are optional here: a save from before them is
 * worth keeping, and loadStats fills the missing fields in with nothing banked.
 */
function isStats(value: unknown): value is Partial<Stats> & Stats {
  const s = value as Stats | null;
  return !!s && typeof s.played === 'number' && typeof s.lost === 'number'
    && Array.isArray(s.byGuess) && s.byGuess.every((n) => typeof n === 'number')
    && typeof s.rooms === 'object' && s.rooms !== null
    && ['points', 'pointedRooms', 'bestRound'].every((k) => {
      const v = (s as unknown as Record<string, unknown>)[k];
      return v === undefined || typeof v === 'number';
    });
}

/**
 * A saved histogram to the width a room allows today. The width follows the points, so a
 * save from a different one is padded or folded into its last bar rather than discarded.
 */
function widen(byGuess: number[]): number[] {
  const bars = Array(MAX_GUESSES).fill(0) as number[];
  for (const [i, count] of byGuess.entries()) {
    const at = Math.min(i, MAX_GUESSES - 1);
    bars[at] = (bars[at] ?? 0) + count;
  }
  return bars;
}

/**
 * Reading storage can throw outright, not just come back empty — a private window, or site
 * data blocked. Stats are a convenience, so every failure just means starting fresh.
 */
export function loadStats(storage: Storage | null): Stats {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptyStats();
    const parsed: unknown = JSON.parse(raw);
    if (!isStats(parsed)) return emptyStats();
    return { ...emptyStats(), ...parsed, byGuess: widen(parsed.byGuess ?? []) };
  } catch {
    return emptyStats();
  }
}

export function saveStats(storage: Storage | null, stats: Stats): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Nothing to be done, and losing stats is not worth interrupting a game for.
  }
}

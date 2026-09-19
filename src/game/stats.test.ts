import { describe, it, expect } from 'vitest';
import {
  emptyStats, recordRoom, recordRound, winRate, hintHistogram, strugglingRooms,
  averagePoints, loadStats, saveStats, STORAGE_KEY, MOST_HINTS,
} from './stats';
import type { Stats } from './stats';
import { MAX_GUESSES } from './costs';

const solve = (stats: Stats, name: string, hints: number, points = 100, guesses = 1) =>
  recordRoom(stats, {
    roomId: name.length, roomName: name, solved: true, guessesUsed: guesses, points,
    hintsUsed: hints,
  });
const lose = (stats: Stats, name: string) => recordRoom(stats, {
  roomId: name.length, roomName: name, solved: false, guessesUsed: MAX_GUESSES, points: 0,
  hintsUsed: MOST_HINTS,
});

describe('recordRoom', () => {
  it('starts empty', () => {
    const s = emptyStats();
    expect(s.played).toBe(0);
    expect(s.lost).toBe(0);
    expect(s.byHints.every((n: number) => n === 0)).toBe(true);
  });

  it('counts a win against the hints it took', () => {
    const s = solve(emptyStats(), 'The Moat', 3);
    expect(s.byHints[3]).toBe(1);
    expect(s.played).toBe(1);
    expect(s.lost).toBe(0);
  });

  /** Naming a room with no help at all is the first bar, not a missing one. */
  it('counts a win with no hints into the first bar', () => {
    const s = solve(emptyStats(), 'The Moat', 0);
    expect(s.byHints[0]).toBe(1);
  });

  it('counts a loss separately from any number of hints', () => {
    const s = lose(emptyStats(), 'The Moat');
    expect(s.lost).toBe(1);
    expect(s.byHints.every((n: number) => n === 0)).toBe(true);
  });

  it('leaves the stats it was given untouched', () => {
    const before = emptyStats();
    solve(before, 'The Moat', 1);
    expect(before.played).toBe(0);
  });

  it('keeps a tally per room', () => {
    let s = emptyStats();
    s = solve(s, 'The Moat', 0, 100, 2);
    s = lose(s, 'The Moat');
    expect(s.rooms['The Moat']).toEqual({ attempts: 2, solved: 1, guesses: 2 + MAX_GUESSES });
  });
});

describe('winRate', () => {
  it('is zero before anything has been played', () => {
    expect(winRate(emptyStats())).toBe(0);
  });

  it('is the share of rooms solved', () => {
    let s = emptyStats();
    s = solve(s, 'A', 1);
    s = solve(s, 'B', 4);
    s = lose(s, 'C');
    s = lose(s, 'D');
    expect(winRate(s)).toBe(50);
  });
});

describe('hintHistogram', () => {
  /** None through every hint there is, and one more for the rooms never got. */
  it('has a bar for every number of hints and one for a loss', () => {
    expect(hintHistogram(emptyStats())).toHaveLength(MOST_HINTS + 2);
  });

  it('labels the first bar none and the last a loss', () => {
    const bars = hintHistogram(emptyStats());
    expect(bars[0]?.label).toBe('0');
    expect(bars[MOST_HINTS]?.label).toBe(String(MOST_HINTS));
    expect(bars[bars.length - 1]?.label).toBe('X');
  });

  it('counts each outcome into its own bar', () => {
    let s = emptyStats();
    s = solve(s, 'A', 0);
    s = solve(s, 'B', 0);
    s = solve(s, 'C', 3);
    s = lose(s, 'D');
    const bars = hintHistogram(s);
    expect(bars[0]?.count).toBe(2);
    expect(bars[3]?.count).toBe(1);
    expect(bars[bars.length - 1]?.count).toBe(1);
  });

  it('gives each bar its share, so a graph can be drawn without re-totalling', () => {
    let s = emptyStats();
    s = solve(s, 'A', 0);
    s = solve(s, 'B', 2);
    expect(hintHistogram(s)[0]?.share).toBe(50);
  });

  it('gives every bar a zero share when nothing has been played', () => {
    expect(hintHistogram(emptyStats()).every((b) => b.share === 0)).toBe(true);
  });
});

describe('strugglingRooms', () => {
  /** Rooms you get wrong, worst first; a room played once and lost is the clearest case. */
  it('puts the least often solved first', () => {
    let s = emptyStats();
    s = lose(s, 'Hard');
    s = solve(s, 'Easy', 1);
    expect(strugglingRooms(s, 5)[0]?.name).toBe('Hard');
  });

  it('breaks a tie on how many guesses they cost', () => {
    let s = emptyStats();
    s = solve(s, 'Slow', 0, 100, 5);
    s = solve(s, 'Quick', 0, 100, 1);
    const [first] = strugglingRooms(s, 5);
    expect(first?.name).toBe('Slow');
  });

  it('returns at most the number asked for', () => {
    let s = emptyStats();
    for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) s = lose(s, n);
    expect(strugglingRooms(s, 5)).toHaveLength(5);
  });

  it('leaves out rooms that have always been solved first go', () => {
    let s = emptyStats();
    s = solve(s, 'Perfect', 1);
    s = solve(s, 'Perfect', 1);
    expect(strugglingRooms(s, 5)).toEqual([]);
  });

  it('reports enough to judge the room by', () => {
    let s = emptyStats();
    s = lose(s, 'Hard');
    s = solve(s, 'Hard', 4);
    expect(strugglingRooms(s, 5)[0]).toMatchObject({
      name: 'Hard', attempts: 2, solved: 1,
    });
  });
});

describe('points', () => {
  it('starts with nothing banked', () => {
    expect(emptyStats().points).toBe(0);
    expect(emptyStats().bestRound).toBe(0);
    expect(averagePoints(emptyStats())).toBe(0);
  });

  it('banks what each room was worth', () => {
    const s = solve(solve(emptyStats(), 'The Moat', 1, 100), 'Watering Hole', 2, 40);
    expect(s.points).toBe(140);
  });

  it('averages over every room played, lost ones included', () => {
    const s = lose(solve(emptyStats(), 'The Moat', 1, 90), 'Watering Hole');
    expect(averagePoints(s)).toBe(45);
  });

  /**
   * Rooms played before points existed have none, and there is no telling what they were
   * worth. Counting them would hold the average near zero for good, so the average is over
   * the rooms that were actually scored.
   */
  it('averages only over the rooms that were scored', () => {
    const before = solve(solve(emptyStats(), 'The Moat', 1), 'Watering Hole', 1) as Stats;
    const unscored: Stats = { ...before, points: 0, pointedRooms: 0 };
    const s = solve(unscored, 'Volcano Room', 1, 80);
    expect(s.played).toBe(3);
    expect(averagePoints(s)).toBe(80);
  });

  it('rounds the average to a whole point', () => {
    const s = solve(solve(emptyStats(), 'The Moat', 1, 100), 'Watering Hole', 2, 45);
    expect(averagePoints(s)).toBe(73);
  });

  /** A score is a round's total, so the best one is a round's, not a room's. */
  it('remembers the best round', () => {
    const s = recordRound(recordRound(emptyStats(), 410), 380);
    expect(s.bestRound).toBe(410);
  });

  it('takes a better round when one comes along', () => {
    const s = recordRound(recordRound(emptyStats(), 380), 410);
    expect(s.bestRound).toBe(410);
  });

  it('leaves the stats it was given untouched', () => {
    const before = emptyStats();
    recordRound(before, 500);
    expect(before.bestRound).toBe(0);
  });
});

describe('storage', () => {
  const fakeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => { map.set(k, v); },
      removeItem: (k) => { map.delete(k); },
      clear: () => { map.clear(); },
      key: () => null,
      get length() { return map.size; },
    } as Storage;
  };

  it('round-trips', () => {
    const store = fakeStorage();
    const s = solve(emptyStats(), 'The Moat', 2);
    saveStats(store, s);
    expect(loadStats(store)).toEqual(s);
  });

  it('starts fresh when there is nothing stored', () => {
    expect(loadStats(fakeStorage())).toEqual(emptyStats());
  });

  it('starts fresh rather than throwing on rubbish', () => {
    const store = fakeStorage();
    store.setItem(STORAGE_KEY, 'not json at all');
    expect(loadStats(store)).toEqual(emptyStats());
  });

  /** Stats saved before points existed are worth keeping; they just have none banked. */
  it('reads stats saved before points existed', () => {
    const store = fakeStorage();
    const old = solve(emptyStats(), 'The Moat', 2) as Partial<Stats>;
    delete old.points;
    delete old.bestRound;
    store.setItem(STORAGE_KEY, JSON.stringify(old));
    const loaded = loadStats(store);
    expect(loaded.points).toBe(0);
    expect(loaded.bestRound).toBe(0);
    expect(loaded.played).toBe(1);
  });

  /**
   * The histogram counted guesses once and counts hints now. A save from before that keeps
   * everything else and starts the histogram empty: the old counts answered another question.
   */
  it('reads stats saved when the histogram counted guesses', () => {
    const store = fakeStorage();
    const old = { ...solve(emptyStats(), 'The Moat', 2), byHints: undefined, byGuess: [0, 1, 0] };
    store.setItem(STORAGE_KEY, JSON.stringify(old));
    const loaded = loadStats(store);
    expect(loaded.byHints).toHaveLength(MOST_HINTS + 1);
    expect(loaded.byHints.every((n: number) => n === 0)).toBe(true);
    expect(loaded.played).toBe(1);
    expect(loaded.points).toBe(100);
  });

  it('folds a histogram saved at a greater width into its last bar', () => {
    const store = fakeStorage();
    const wide = {
      ...solve(emptyStats(), 'The Moat', 2),
      byHints: [...Array(MOST_HINTS + 1).fill(0), 3, 4],
    };
    store.setItem(STORAGE_KEY, JSON.stringify(wide));
    const loaded = loadStats(store);
    expect(loaded.byHints).toHaveLength(MOST_HINTS + 1);
    expect(loaded.byHints[MOST_HINTS]).toBe(7);
  });

  it('starts fresh when the stored shape is wrong', () => {
    const store = fakeStorage();
    store.setItem(STORAGE_KEY, JSON.stringify({ played: 'lots' }));
    expect(loadStats(store)).toEqual(emptyStats());
  });

  /** Private windows and blocked site data make storage throw on access, not return null. */
  it('survives storage that throws', () => {
    const hostile = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    } as unknown as Storage;
    expect(loadStats(hostile)).toEqual(emptyStats());
    expect(() => saveStats(hostile, emptyStats())).not.toThrow();
  });

  it('survives having no storage at all', () => {
    expect(loadStats(null)).toEqual(emptyStats());
    expect(() => saveStats(null, emptyStats())).not.toThrow();
  });
});

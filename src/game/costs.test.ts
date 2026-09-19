import { describe, it, expect } from 'vitest';
import {
  AUTO_HINTS, HINT_COSTS, HINT_ORDER, MAX_GUESSES, NAME_LETTER_SHARE, STARTING_POINTS,
  WRONG_GUESS_COST,
} from './costs';

/**
 * The prices are meant to be tweaked. These are the two things that tweaking them must not
 * break, stated as tests so that changing a number in costs.ts says so rather than quietly
 * making the game worse.
 */
describe('the prices', () => {
  const sweep = HINT_ORDER.reduce((sum, kind) => sum + HINT_COSTS[kind], 0);

  /**
   * A player who needs every hint should still take something for naming the room — that is
   * the case the hints exist for. Priced at or above a room, the last purchase leaves nothing
   * to win and the hint stops being a way out.
   *
   * One of each: name letters go on selling until they cannot be paid for, so there is no
   * fixed price for the lot.
   */
  it('leave something to win after buying one of every hint', () => {
    expect(sweep).toBeLessThan(STARTING_POINTS);
  });

  /** Half a name is a hint. All of it is the answer. */
  it('never uncover more than half a name', () => {
    expect(NAME_LETTER_SHARE).toBeGreaterThan(0);
    expect(NAME_LETTER_SHARE).toBeLessThanOrEqual(0.5);
  });

  /** Otherwise MAX_GUESSES is not a whole number of guesses. */
  it('divide a room into whole guesses', () => {
    expect(STARTING_POINTS % WRONG_GUESS_COST).toBe(0);
    expect(MAX_GUESSES).toBe(STARTING_POINTS / WRONG_GUESS_COST);
  });

  /** A wrong answer is never the cheap way to a hint it hands over. */
  it('charge more for a wrong answer than for the hint it throws in', () => {
    for (const kind of AUTO_HINTS) {
      expect(HINT_COSTS[kind], kind).toBeLessThan(WRONG_GUESS_COST);
    }
  });

  it('name a real hint in every list', () => {
    expect(HINT_ORDER.slice().sort()).toEqual(Object.keys(HINT_COSTS).sort());
    for (const kind of AUTO_HINTS) expect(HINT_ORDER).toContain(kind);
  });
});

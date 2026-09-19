/**
 * Every number the game is priced by, in one place, so the balance can be tuned without
 * reading the rules that enforce it.
 *
 * A TypeScript file rather than JSON on purpose: `HINT_COSTS` is keyed by `HintKind`, so
 * dropping a hint or misspelling one is a compile error rather than a silent zero.
 *
 * Two invariants worth keeping in mind when changing anything here. Every hint together
 * should come to less than `STARTING_POINTS`, or a player who needs all of them walks away
 * with nothing for naming the room — the case the hints exist for. And `WRONG_GUESS_COST`
 * should divide `STARTING_POINTS`, or `MAX_GUESSES` stops being a whole number of guesses.
 */

export type HintKind = 'area' | 'enemies' | 'neighbour' | 'diagram' | 'name';

/** Least to most generous, which is also the order they are listed in. */
export const HINT_ORDER: HintKind[] = ['area', 'enemies', 'neighbour', 'diagram', 'name'];

/** What a room is worth if it is named without buying a thing. */
export const STARTING_POINTS = 100;

/**
 * What a wrong answer costs. There is no guess allowance — guesses come out of the same
 * purse as hints, so being wrong is priced rather than rationed.
 */
export const WRONG_GUESS_COST = 10;

/** The most guesses a room can take: any more and the points are gone. */
export const MAX_GUESSES = STARTING_POINTS / WRONG_GUESS_COST;

/** How many letters of the name the hint will sell, one purchase each. */
export const NAME_LETTERS = 2;

/**
 * What each hint costs — for the name, what each of its letters costs, so the whole name
 * comes to 50.
 *
 * Everything together comes to 95, so a player who buys the lot still takes 5 points for
 * naming the room. Knowing the room and not being able to name it is the case this is all
 * for: the way out of it has to be affordable, and it has to leave something behind.
 */
export const HINT_COSTS: Record<HintKind, number> = {
  area: 5,
  enemies: 5,
  neighbour: 15,
  diagram: 20,
  name: 25,
};

/**
 * What a wrong answer throws in, in order — the first wrong answer gives the first of these
 * that is not already showing, the second the next, and after that the ten buys nothing.
 *
 * Both cost 5 to ask for and 10 to be given, which is the right way round: the hint is a
 * consolation for the guess, not a cheaper route to the hint.
 */
export const AUTO_HINTS: HintKind[] = ['area', 'enemies'];

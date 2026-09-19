import { describe, it, expect } from 'vitest';
import {
  createSession, shuffleBag, MAX_GUESSES, HINT_ORDER, HINT_COSTS, STARTING_POINTS,
  NAME_LETTERS, WRONG_GUESS_COST, nameHint, ROUND_LENGTH,
} from './session';
import { loadRooms } from '../rooms';
import { TOURNAMENT_SETTINGS } from '../render/renderer';

const rooms = loadRooms();
const seeded = (seed: number) => {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
};
/** A run of distinct wrong answers: naming one already given is refused, not charged. */
const wrongRun = (except: string) => {
  const names = rooms.filter((r) => r.name !== except).map((r) => r.name);
  let at = 0;
  return () => { at += 1; return names[at - 1] as string; };
};

/** How many letters of the real name a mask is showing. */
const uncovered = (mask: string, name: string): number =>
  [...mask].filter((ch, i) => ch !== '_' && /[A-Za-z0-9]/.test(name[i] as string)).length;

const only = (name: string, seed = 1) => createSession({
  rooms: rooms.filter((r) => r.name === name),
  settings: TOURNAMENT_SETTINGS, random: seeded(seed),
});
/**
 * A one-room session draws nothing from the shuffle bag, so whatever this hands back goes
 * straight to the letter picker — which is the only place a session rolls a die.
 */
const rolling = (name: string, random: () => number) => createSession({
  rooms: rooms.filter((r) => r.name === name), settings: TOURNAMENT_SETTINGS, random,
});

describe('shuffleBag', () => {
  it('deals every item once before repeating any', () => {
    const bag = shuffleBag([1, 2, 3, 4, 5], seeded(1));
    expect([...Array.from({ length: 5 }, () => bag.take())].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('refills once exhausted', () => {
    const bag = shuffleBag([1, 2, 3], seeded(7));
    expect(new Set(Array.from({ length: 9 }, () => bag.take()))).toEqual(new Set([1, 2, 3]));
  });
});

describe('guesses', () => {
  it('starts with nothing guessed, no hints, and full points', () => {
    const s = only('Volcano Room');
    expect(s.guessesUsed()).toBe(0);
    expect(s.hints()).toEqual([]);
    expect(s.points()).toBe(STARTING_POINTS);
    expect(s.state()).toBe('guessing');
  });

  it('ends the room as soon as the answer is right', () => {
    const s = only('Volcano Room');
    expect(s.guess('Volcano Room').correct).toBe(true);
    expect(s.state()).toBe('solved');
    expect(s.guessesUsed()).toBe(1);
    expect(s.points()).toBe(STARTING_POINTS);
  });

  /** Guesses are paid for out of the same purse as hints. */
  it('charges ten points for a wrong answer', () => {
    const s = only('Volcano Room');
    s.guess('Landing Site');
    expect(s.guessesUsed()).toBe(1);
    expect(s.points()).toBe(STARTING_POINTS - WRONG_GUESS_COST);
    expect(s.state()).toBe('guessing');
  });

  /**
   * Ten points buys the area hint, which is five if you ask for it. The premium is the
   * point: the hint is a consolation for the guess, not a cheaper way to get one.
   */
  it('throws in the area hint with the first wrong answer', () => {
    const s = only('Volcano Room');
    s.guess('Landing Site');
    expect(s.hints().map((h) => h.kind)).toEqual(['area']);
    expect(s.points()).toBe(STARTING_POINTS - WRONG_GUESS_COST);
  });

  it('throws in the enemies hint with the second', () => {
    const s = only('Volcano Room');
    const wrong = wrongRun('Volcano Room');
    s.guess(wrong());
    s.guess(wrong());
    expect(s.hints().map((h) => h.kind)).toEqual(['area', 'enemies']);
    expect(s.points()).toBe(STARTING_POINTS - WRONG_GUESS_COST * 2);
  });

  it('takes the ten and gives nothing after that', () => {
    const s = only('Volcano Room');
    const wrong = wrongRun('Volcano Room');
    for (let i = 0; i < 3; i += 1) s.guess(wrong());
    expect(s.hints().map((h) => h.kind)).toEqual(['area', 'enemies']);
    expect(s.points()).toBe(STARTING_POINTS - WRONG_GUESS_COST * 3);
  });

  /** No point handing over something already paid for; the next one along is given instead. */
  it('gives the next hint that was not already bought', () => {
    const s = only('Volcano Room');
    s.buyHint('area');
    s.guess('Landing Site');
    expect(s.hints().map((h) => h.kind)).toEqual(['area', 'enemies']);
    expect(s.points()).toBe(STARTING_POINTS - HINT_COSTS.area - WRONG_GUESS_COST);
  });

  it('is lost once the points run out', () => {
    const s = only('Volcano Room');
    const wrong = wrongRun('Volcano Room');
    for (let i = 0; i < MAX_GUESSES; i += 1) {
      if (s.state() === 'guessing') s.guess(wrong());
    }
    expect(s.points()).toBe(0);
    expect(s.state()).toBe('lost');
  });

  /** Ten a guess out of a hundred: ten guesses is all a room can take, hints aside. */
  it('allows no more guesses than the points cover', () => {
    const s = only('Volcano Room');
    const wrong = wrongRun('Volcano Room');
    expect(MAX_GUESSES).toBe(STARTING_POINTS / WRONG_GUESS_COST);
    for (let i = 0; i < MAX_GUESSES - 1; i += 1) s.guess(wrong());
    expect(s.state()).toBe('guessing');
    expect(s.points()).toBe(WRONG_GUESS_COST);
    s.guess(wrong());
    expect(s.state()).toBe('lost');
  });

  /** The shared purse means buying everything leaves no room to be wrong. Accepted. */
  it('can leave a player who bought everything unable to afford a wrong answer', () => {
    const s = only('Volcano Room');
    for (const kind of HINT_ORDER) s.buyHint(kind);
    for (let i = 1; i < NAME_LETTERS; i += 1) s.buyHint('name');
    expect(s.points()).toBe(0);
    s.guess('Landing Site');
    expect(s.state()).toBe('lost');
  });

  /** Giving up is the way out of a room you cannot name. It spends no guess doing it. */
  it('ends the room when given up on, without spending a guess', () => {
    const s = only('Volcano Room');
    s.guess('Landing Site');
    s.giveUp();
    expect(s.state()).toBe('lost');
    expect(s.guessesUsed()).toBe(1);
  });

  it('refuses further guesses once the room is over', () => {
    const s = only('Volcano Room');
    s.guess('Volcano Room');
    expect(() => s.guess('Landing Site')).toThrow();
    expect(() => s.giveUp()).toThrow();
    expect(() => s.buyHint('area')).toThrow();
  });

  it('remembers the rooms already tried and found wrong', () => {
    const s = only('Volcano Room');
    expect(s.wrongGuesses()).toEqual([]);
    s.guess('Landing Site');
    s.guess('The Moat');
    expect(s.wrongGuesses().map((r) => r.name)).toEqual(['Landing Site', 'The Moat']);
  });

  /** A room already ruled out is not a new guess, so it costs nothing and changes nothing. */
  it('refuses a room already guessed, and charges nothing for it', () => {
    const s = only('Volcano Room');
    s.guess('Landing Site');
    const before = s.points();
    const grade = s.guess('Landing Site');
    expect(grade.repeat).toBe(true);
    expect(grade.correct).toBe(false);
    expect(grade.answer?.name).toBe('Landing Site');
    expect(s.points()).toBe(before);
    expect(s.guessesUsed()).toBe(1);
  });

  it('does not list the same room twice', () => {
    const s = only('Volcano Room');
    s.guess('Landing Site');
    s.guess('Landing Site');
    expect(s.wrongGuesses().map((r) => r.name)).toEqual(['Landing Site']);
  });

  it('charges for the next new room after a repeat', () => {
    const s = only('Volcano Room');
    s.guess('Landing Site');
    s.guess('Landing Site');
    s.guess('The Moat');
    expect(s.points()).toBe(STARTING_POINTS - WRONG_GUESS_COST * 2);
    expect(s.wrongGuesses().map((r) => r.name)).toEqual(['Landing Site', 'The Moat']);
  });

  /** An alias for a room already guessed is the same room, and is refused the same way. */
  it('sees through an alias to the room already guessed', () => {
    const s = only('Volcano Room');
    s.guess('Lower Norfair Escape Power Bomb Room');
    expect(s.guess('The Jail').repeat).toBe(true);
  });

  it('marks a fresh guess as no repeat', () => {
    const s = only('Volcano Room');
    expect(s.guess('Landing Site').repeat).toBe(false);
    expect(s.guess('Volcano Room').repeat).toBe(false);
  });

  it('does not count the right answer, or one that names no room, among them', () => {
    const s = only('Volcano Room');
    s.guess('not a room at all');
    s.guess('Volcano Room');
    expect(s.wrongGuesses()).toEqual([]);
  });

  it('forgets what was tried on the room before', () => {
    const s = only('Volcano Room');
    s.guess('Landing Site');
    s.giveUp();
    s.next();
    expect(s.wrongGuesses()).toEqual([]);
  });

  it('costs nothing for an answer that names no room', () => {
    const s = only('Volcano Room');
    const grade = s.guess('nonsense that is not a room');
    expect(grade.correct).toBe(false);
    expect(grade.recognised).toBe(false);
    expect(s.guessesUsed()).toBe(0);
    expect(s.points()).toBe(STARTING_POINTS);
    expect(s.hints()).toEqual([]);
  });

  it('suggests a near miss without charging for it', () => {
    const s = only('Volcano Room');
    const grade = s.guess('Volcanoe Room');
    expect(grade.suggestion?.name).toBe('Volcano Room');
    expect(s.points()).toBe(STARTING_POINTS);
  });

  /**
   * Look-alikes used to count, because nothing on screen separated them. The hints separate
   * them now and any of them can be bought, so naming the wrong twin is simply wrong.
   */
  it('refuses a room that merely looks identical to the one shown', () => {
    const s = only('Wave Beam Room');
    const grade = s.guess('Ice Beam Room');
    expect(grade.correct).toBe(false);
    expect(s.state()).toBe('guessing');
    expect(s.points()).toBe(STARTING_POINTS - WRONG_GUESS_COST);
  });

  /** Still worth naming them on the reveal: that a twin exists is worth knowing. */
  it('still names the rooms it cannot be told apart from', () => {
    const s = only('Wave Beam Room');
    expect(s.group().map((r) => r.name)).toContain('Ice Beam Room');
    expect(s.guess('Ice Beam Room').group.map((r) => r.name)).toContain('Ice Beam Room');
  });

  it('accepts an alias', () => {
    expect(only('Lower Norfair Escape Power Bomb Room').guess('The Jail').correct).toBe(true);
  });
});

describe('buying hints', () => {
  /** The name is priced per letter, so it is the only one that costs twice. */
  it('prices the hints as advertised', () => {
    expect(HINT_COSTS).toEqual({ area: 5, enemies: 10, neighbour: 15, diagram: 20, name: 25 });
  });

  /**
   * Every hint is always within reach — the lot comes to exactly a hundred. What it costs to
   * take them all is the room itself: it is still there to name, and worth nothing when you
   * do. Buying does not end a room, though, or the last purchase would be a trap.
   */
  it('leaves nothing at all when every hint is bought, and the room still in play', () => {
    const s = only('Volcano Room');
    for (const kind of HINT_ORDER) {
      expect(s.offers().find((o) => o.kind === kind)?.affordable, kind).toBe(true);
      s.buyHint(kind);
    }
    for (let i = 1; i < NAME_LETTERS; i += 1) s.buyHint('name');
    expect(s.points()).toBe(0);
    expect(s.state()).toBe('guessing');
    expect(s.offers().every((o) => o.bought)).toBe(true);
  });

  it('still lets the room be named for nothing after that', () => {
    const s = only('Volcano Room');
    for (const kind of HINT_ORDER) s.buyHint(kind);
    for (let i = 1; i < NAME_LETTERS; i += 1) s.buyHint('name');
    expect(s.guess('Volcano Room').correct).toBe(true);
    expect(s.state()).toBe('solved');
    expect(s.points()).toBe(0);
  });

  it('offers every hint from the start, priced and unbought', () => {
    const s = only('Volcano Room');
    expect(s.offers().map((o) => o.kind)).toEqual(HINT_ORDER);
    expect(s.offers().every((o) => !o.bought && o.affordable)).toBe(true);
    expect(s.offers().map((o) => o.cost)).toEqual(HINT_ORDER.map((k) => HINT_COSTS[k]));
  });

  it('reveals only what was bought, and charges for it', () => {
    const s = only('Volcano Room');
    s.buyHint('enemies');
    expect(s.hints().map((h) => h.kind)).toEqual(['enemies']);
    expect(s.points()).toBe(STARTING_POINTS - HINT_COSTS.enemies);
  });

  /** No schedule: the name is buyable first if that is what you are missing. */
  it('lets hints be bought in any order', () => {
    const s = only('Volcano Room');
    s.buyHint('name');
    expect(s.hints().map((h) => h.kind)).toEqual(['name']);
    expect(s.points()).toBe(STARTING_POINTS - HINT_COSTS.name);
  });

  /** One letter, somewhere — not the first letter of every word, which gave away far more. */
  it('sells one letter of the name at a time, wherever it falls', () => {
    const s = only('Volcano Room');
    expect(s.nameLetters()).toBe(0);
    expect(s.nameMask()).toBe('_______ ____');

    s.buyHint('name');
    expect(s.nameLetters()).toBe(1);
    expect(uncovered(s.nameMask(), 'Volcano Room')).toBe(1);

    s.buyHint('name');
    expect(s.nameLetters()).toBe(2);
    expect(uncovered(s.nameMask(), 'Volcano Room')).toBe(2);
    expect(s.points()).toBe(STARTING_POINTS - HINT_COSTS.name * 2);
  });

  /** Any letter of the name, not a fixed one: the low roll takes the first, the high the last. */
  it('picks the letter from anywhere in the name', () => {
    const low = rolling('Volcano Room', () => 0);
    low.buyHint('name');
    expect(low.nameMask()).toBe('V______ ____');

    const high = rolling('Volcano Room', () => 0.999);
    high.buyHint('name');
    expect(high.nameMask()).toBe('_______ ___m');
  });

  it('never uncovers the same letter twice', () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const s = rolling('Volcano Room', () => roll);
      s.buyHint('name');
      const first = s.nameMask();
      s.buyHint('name');
      expect(uncovered(s.nameMask(), 'Volcano Room'), `roll ${roll}`).toBe(2);
      expect(s.nameMask(), `roll ${roll}`).not.toBe(first);
    }
  });

  it('only ever uncovers letters, never the spaces and punctuation already showing', () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const s = rolling("Crocomire's Room", () => roll);
      s.buyHint('name');
      s.buyHint('name');
      const mask = s.nameMask();
      expect(mask, `roll ${roll}`).toHaveLength("Crocomire's Room".length);
      expect(mask[9], `roll ${roll}`).toBe("'");
      expect(mask[11], `roll ${roll}`).toBe(' ');
      expect(uncovered(mask, "Crocomire's Room"), `roll ${roll}`).toBe(2);
    }
  });

  it('stops selling letters at the limit', () => {
    const s = only('Volcano Room');
    for (let i = 0; i < NAME_LETTERS; i += 1) s.buyHint('name');
    expect(() => s.buyHint('name')).toThrow(/already/i);
    expect(s.points()).toBe(STARTING_POINTS - HINT_COSTS.name * NAME_LETTERS);
  });

  it('shows the whole name once the room is over', () => {
    const s = only('Volcano Room');
    s.giveUp();
    expect(s.nameMask()).toBe('Volcano Room');
  });

  it('counts the name as bought only once every letter is paid for', () => {
    const s = only('Volcano Room');
    s.buyHint('name');
    expect(s.offers().find((o) => o.kind === 'name')?.bought).toBe(false);
    expect(s.offers().find((o) => o.kind === 'name')?.affordable).toBe(true);
    s.buyHint('name');
    expect(s.offers().find((o) => o.kind === 'name')?.bought).toBe(true);
    expect(s.offers().find((o) => o.kind === 'name')?.affordable).toBe(false);
  });

  it('lists what has been bought in a settled order, whatever order it was bought in', () => {
    const s = only('Volcano Room');
    s.buyHint('neighbour');
    s.buyHint('area');
    expect(s.hints().map((h) => h.kind)).toEqual(['area', 'neighbour']);
  });

  it('will not sell the same hint twice', () => {
    const s = only('Volcano Room');
    s.buyHint('area');
    expect(() => s.buyHint('area')).toThrow(/already/i);
    expect(s.points()).toBe(STARTING_POINTS - HINT_COSTS.area);
  });

  it('marks what has been bought', () => {
    const s = only('Volcano Room');
    s.buyHint('area');
    expect(s.offers().find((o) => o.kind === 'area')?.bought).toBe(true);
    expect(s.offers().find((o) => o.kind === 'enemies')?.bought).toBe(false);
  });

  it('keeps what was left when the room is solved', () => {
    const s = only('Volcano Room');
    s.buyHint('area');
    s.guess('Volcano Room');
    expect(s.points()).toBe(STARTING_POINTS - HINT_COSTS.area);
  });

  it('resets the name letters on the next room', () => {
    const s = only('Volcano Room');
    s.buyHint('name');
    s.guess('Volcano Room');
    s.next();
    expect(s.nameLetters()).toBe(0);
    expect(s.nameMask()).toBe('_______ ____');
  });

  it('is worth nothing once the room is lost', () => {
    const s = only('Volcano Room');
    const wrong = wrongRun('Volcano Room');
    s.buyHint('area');
    for (let i = 0; i < MAX_GUESSES; i += 1) if (s.state() === 'guessing') s.guess(wrong());
    expect(s.state()).toBe('lost');
    expect(s.points()).toBe(0);
  });

  it('is worth nothing once given up on', () => {
    const s = only('Volcano Room');
    s.giveUp();
    expect(s.points()).toBe(0);
  });

  it('shows every hint once the room is over, bought or not', () => {
    const s = only('Volcano Room');
    s.giveUp();
    expect(s.hints().map((h) => h.kind)).toEqual(HINT_ORDER);
  });
});

describe('hints', () => {
  const allHints = (name: string) => {
    const s = only(name);
    s.giveUp();
    return new Map(s.hints().map((h) => [h.kind, h.text]));
  };

  it('names the original map area', () => {
    expect(allHints('Volcano Room').get('area')).toContain('Norfair');
  });

  it('lists the enemies', () => {
    expect(allHints('Volcano Room').get('enemies')).toContain('Fune');
  });

  it('says so plainly for a room with no enemies', () => {
    expect(allHints('Crateria Map Room').get('enemies')).toMatch(/no enemies/i);
  });

  it('names every connecting room, without labouring where they come from', () => {
    const text = allHints('Volcano Room').get('neighbour') ?? '';
    for (const n of ['Kronic Boost Room', 'Spiky Platforms Tunnel']) expect(text).toContain(n);
    expect(text).not.toMatch(/original map|vanilla/i);
  });

  it('offers the room diagram', () => {
    expect(allHints('Volcano Room').get('diagram')).toContain('VolcanoRoom_116.png');
  });

  /** The most expensive, and the most generous: the name itself, once it is over. */
  it('gives up the whole name once the room is over', () => {
    expect(allHints('Volcano Room').get('name')).toBe('Volcano Room');
  });

  it('gives a diagram url that is absolute and pinned', () => {
    const s = only('Volcano Room');
    s.buyHint('diagram');
    const diagram = s.hints().find((h) => h.kind === 'diagram');
    expect(diagram?.imageUrl).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/vg-json-data\//);
  });
});

describe('scoring and progress', () => {
  const make = () => createSession({
    rooms, settings: TOURNAMENT_SETTINGS, random: seeded(11),
  });

  it('counts a room solved on the first guess as a clean solve', () => {
    const s = make();
    s.guess(s.current().name);
    expect(s.score()).toEqual({ asked: 1, solved: 1, guessesUsed: 1 });
  });

  it('counts guesses used across a room', () => {
    const s = make();
    const wrong = wrongRun(s.current().name);
    s.guess(wrong());
    s.guess(wrong());
    s.guess(s.current().name);
    expect(s.score()).toEqual({ asked: 1, solved: 1, guessesUsed: 3 });
  });

  it('counts a lost room as asked but not solved', () => {
    const s = make();
    s.giveUp();
    expect(s.score()).toEqual({ asked: 1, solved: 0, guessesUsed: 0 });
  });

  it('resets guesses, hints and points on the next room', () => {
    const s = make();
    s.buyHint('area');
    s.guess(s.current().name);
    s.next();
    expect(s.guessesUsed()).toBe(0);
    expect(s.hints()).toEqual([]);
    expect(s.points()).toBe(STARTING_POINTS);
    expect(s.state()).toBe('guessing');
  });

  it('refuses to move on while the room is still in play', () => {
    const s = make();
    expect(() => s.next()).toThrow();
  });
});

describe('nameHint', () => {
  /** Nothing given away at all: the shape of the name, and not one letter of it. */
  it('masks every letter when nothing has been bought', () => {
    expect(nameHint('Landing Site', new Set())).toBe('_______ ____');
    expect(nameHint('Metroid Room 1', new Set())).toBe('_______ ____ _');
  });

  it('uncovers exactly the characters it is given', () => {
    expect(nameHint('Landing Site', new Set([0]))).toBe('L______ ____');
    expect(nameHint('Landing Site', new Set([4, 9]))).toBe('____i__ _i__');
  });

  /** Spaces and punctuation are the shape of the name, and are never a letter to buy. */
  it('leaves the spaces and punctuation showing throughout', () => {
    expect(nameHint("Crocomire's Room", new Set())).toBe("_________'_ ____");
    expect(nameHint('Pre-Map Flyway', new Set())).toBe('___-___ ______');
  });

  it('keeps the name its own length whatever is showing', () => {
    for (const room of loadRooms()) {
      expect(nameHint(room.name, new Set()), room.name).toHaveLength(room.name.length);
      expect(nameHint(room.name, new Set([0, 1])), room.name).toHaveLength(room.name.length);
    }
  });

  it('never leaks a letter that was not asked for', () => {
    for (const room of loadRooms()) {
      const masked = nameHint(room.name, new Set([2]));
      for (const [i, ch] of [...masked].entries()) {
        const real = room.name[i] as string;
        if (!/[A-Za-z0-9]/.test(real)) { expect(ch).toBe(real); continue; }
        expect(ch, `${room.name} at ${i}`).toBe(i === 2 ? real : '_');
      }
    }
  });
});

describe('rounds', () => {
  const make = (seed = 3) => createSession({
    rooms, settings: TOURNAMENT_SETTINGS, random: seeded(seed),
  });
  const playRound = (s: ReturnType<typeof make>, finish: (s: ReturnType<typeof make>) => void) => {
    for (let i = 0; i < ROUND_LENGTH - 1; i += 1) { finish(s); s.next(); }
    finish(s);
  };
  const giveUp = (s: ReturnType<typeof make>) => s.giveUp();
  const solve = (s: ReturnType<typeof make>) => { s.guess(s.current().name); };

  it('is not over before it has begun', () => {
    const s = make();
    expect(s.roundComplete()).toBe(false);
    expect(s.roundNumber()).toBe(1);
  });

  it('is over after the round length of rooms', () => {
    const s = make();
    playRound(s, giveUp);
    expect(s.roundComplete()).toBe(true);
  });

  it('counts the room in play once it is finished with', () => {
    const s = make();
    for (let i = 0; i < ROUND_LENGTH - 1; i += 1) { s.giveUp(); s.next(); }
    expect(s.roundComplete()).toBe(false);
    s.giveUp();
    expect(s.roundComplete()).toBe(true);
  });

  it('refuses another room until the next round is started', () => {
    const s = make();
    playRound(s, giveUp);
    expect(() => s.next()).toThrow(/round/i);
  });

  it('hands back the rooms of the round just played', () => {
    const s = make();
    playRound(s, giveUp);
    const round = s.roundResults();
    expect(round).toHaveLength(ROUND_LENGTH);
    expect(round.every((r) => r.solved === false)).toBe(true);
  });

  it('starts the next round clean', () => {
    const s = make();
    playRound(s, giveUp);
    s.startRound();
    expect(s.roundComplete()).toBe(false);
    expect(s.roundNumber()).toBe(2);
    expect(s.roundResults()).toEqual([]);
    expect(s.state()).toBe('guessing');
    expect(s.guessesUsed()).toBe(0);
    expect(s.roundPoints()).toBe(0);
  });

  it('will not start another round in the middle of one', () => {
    const s = make();
    expect(() => s.startRound()).toThrow(/round/i);
  });

  it('keeps every room played across rounds available to look back at', () => {
    const s = make();
    playRound(s, giveUp);
    s.startRound();
    expect(s.played()).toHaveLength(ROUND_LENGTH);
  });

  it('records what each room cost and what it was worth', () => {
    const s = make();
    s.buyHint('area');
    s.guess(s.current().name);
    s.next();
    expect(s.played()[0]).toMatchObject({
      solved: true, guessesUsed: 1, points: STARTING_POINTS - HINT_COSTS.area,
    });
  });

  it('adds up the points over the round', () => {
    const s = make();
    playRound(s, solve);
    expect(s.roundPoints()).toBe(STARTING_POINTS * ROUND_LENGTH);
  });

  it('counts a room towards the round total as soon as it is over', () => {
    const s = make();
    expect(s.roundPoints()).toBe(0);
    s.guess(s.current().name);
    expect(s.roundPoints()).toBe(STARTING_POINTS);
  });

  it('adds nothing for a room that was never got', () => {
    const s = make();
    s.buyHint('area');
    s.giveUp();
    expect(s.roundPoints()).toBe(0);
  });
});

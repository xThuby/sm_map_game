import { describe, it, expect } from 'vitest';
import {
  createSession, shuffleBag, MAX_GUESSES, HINT_ORDER, HINT_COSTS, STARTING_POINTS,
  nameHint, ROUND_LENGTH,
} from './session';
import { loadRooms } from '../rooms';
import { TOURNAMENT_SETTINGS } from '../render/renderer';

const rooms = loadRooms();
const seeded = (seed: number) => {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
};
const only = (name: string, seed = 1) => createSession({
  rooms: rooms.filter((r) => r.name === name),
  settings: TOURNAMENT_SETTINGS, random: seeded(seed),
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
  it('starts with every guess unspent, no hints, and full points', () => {
    const s = only('Volcano Room');
    expect(s.guessesLeft()).toBe(MAX_GUESSES);
    expect(s.hints()).toEqual([]);
    expect(s.points()).toBe(STARTING_POINTS);
    expect(s.state()).toBe('guessing');
  });

  it('ends the room as soon as the answer is right', () => {
    const s = only('Volcano Room');
    expect(s.guess('Volcano Room').correct).toBe(true);
    expect(s.state()).toBe('solved');
    expect(s.guessesLeft()).toBe(MAX_GUESSES - 1);
  });

  /** Guesses and hints are separate currencies now: a wrong answer gives nothing away. */
  it('spends a guess when wrong, and reveals nothing', () => {
    const s = only('Volcano Room');
    s.guess('Landing Site');
    expect(s.guessesLeft()).toBe(MAX_GUESSES - 1);
    expect(s.hints()).toEqual([]);
    expect(s.points()).toBe(STARTING_POINTS);
    expect(s.state()).toBe('guessing');
  });

  it('is lost once every guess is spent', () => {
    const s = only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES; i += 1) s.guess('Landing Site');
    expect(s.guessesLeft()).toBe(0);
    expect(s.state()).toBe('lost');
  });

  /** Giving up is the way out of a room you cannot name, and it costs the rest of the round
   * nothing but the points. It does not pretend the guesses were spent. */
  it('ends the room when given up on, without spending the guesses', () => {
    const s = only('Volcano Room');
    s.guess('Landing Site');
    s.giveUp();
    expect(s.state()).toBe('lost');
    expect(s.guessesLeft()).toBe(MAX_GUESSES - 1);
  });

  it('refuses further guesses once the room is over', () => {
    const s = only('Volcano Room');
    s.guess('Volcano Room');
    expect(() => s.guess('Landing Site')).toThrow();
    expect(() => s.giveUp()).toThrow();
    expect(() => s.buyHint('area')).toThrow();
  });

  it('does not spend a guess on an answer that names no room', () => {
    const s = only('Volcano Room');
    const grade = s.guess('nonsense that is not a room');
    expect(grade.correct).toBe(false);
    expect(grade.recognised).toBe(false);
    expect(s.guessesLeft()).toBe(MAX_GUESSES);
    expect(s.hints()).toEqual([]);
  });

  it('suggests a near miss without spending a guess', () => {
    const s = only('Volcano Room');
    const grade = s.guess('Volcanoe Room');
    expect(grade.suggestion?.name).toBe('Volcano Room');
    expect(s.guessesLeft()).toBe(MAX_GUESSES);
  });

  it('accepts a room that looks identical to the one shown', () => {
    const s = only('Wave Beam Room');
    const grade = s.guess('Ice Beam Room');
    expect(grade.correct).toBe(true);
    expect(grade.group.map((r) => r.name).sort()).toContain('Ice Beam Room');
  });

  it('accepts an alias', () => {
    expect(only('Lower Norfair Escape Power Bomb Room').guess('The Jail').correct).toBe(true);
  });
});

describe('buying hints', () => {
  it('prices the hints as advertised', () => {
    expect(HINT_COSTS).toEqual({ area: 10, enemies: 10, neighbour: 20, diagram: 30, name: 50 });
  });

  /**
   * Every hint at once costs more than a room is worth, so buying is a real choice rather
   * than a schedule. Knowing the room but not its name should be buyable; knowing nothing
   * and buying everything should not.
   */
  it('costs more to buy every hint than a room is worth', () => {
    const total = HINT_ORDER.reduce((sum, kind) => sum + HINT_COSTS[kind], 0);
    expect(total).toBeGreaterThan(STARTING_POINTS);
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

  it('stops offering what there is no longer the money for', () => {
    const s = only('Volcano Room');
    s.buyHint('name');
    s.buyHint('diagram');
    expect(s.points()).toBe(20);
    expect(s.offers().find((o) => o.kind === 'neighbour')?.affordable).toBe(true);
    s.buyHint('neighbour');
    expect(s.points()).toBe(0);
    expect(s.offers().some((o) => o.affordable)).toBe(false);
  });

  it('refuses a hint there are no points for, and charges nothing', () => {
    const s = only('Volcano Room');
    s.buyHint('name');
    s.buyHint('diagram');
    s.buyHint('neighbour');
    expect(() => s.buyHint('area')).toThrow(/points/i);
    expect(s.points()).toBe(0);
    expect(s.hints().map((h) => h.kind)).not.toContain('area');
  });

  it('keeps what was left when the room is solved', () => {
    const s = only('Volcano Room');
    s.buyHint('area');
    s.guess('Volcano Room');
    expect(s.points()).toBe(STARTING_POINTS - HINT_COSTS.area);
  });

  it('is worth nothing once the room is lost', () => {
    const s = only('Volcano Room');
    s.buyHint('area');
    for (let i = 0; i < MAX_GUESSES; i += 1) s.guess('Landing Site');
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

  /** The most expensive, and the most generous: the shape of the name itself. */
  it('sketches the name', () => {
    expect(allHints('Volcano Room').get('name')).toBe('V______ R___');
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
    const wrong = rooms.find((r) => r.id !== s.current().id) as { name: string };
    s.guess(wrong.name);
    s.guess(wrong.name);
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
    expect(s.guessesLeft()).toBe(MAX_GUESSES);
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
  it('shows the first letter of each word and hides the rest', () => {
    expect(nameHint('Landing Site')).toBe('L______ S___');
    expect(nameHint('The Moat')).toBe('T__ M___');
  });

  it('keeps the punctuation, which is part of the shape', () => {
    expect(nameHint("Crocomire's Room")).toBe("C________'_ R___");
  });

  /** A word is what the spaces separate, so a hyphen does not start a new one. */
  it('gives away only one letter of a hyphenated word', () => {
    expect(nameHint('Pre-Map Flyway')).toBe('P__-___ F_____');
  });

  it('leaves a single-character word as itself', () => {
    expect(nameHint('Metroid Room 1')).toBe('M______ R___ 1');
  });

  it('never leaks a letter beyond the first of a word', () => {
    for (const room of loadRooms()) {
      const masked = nameHint(room.name);
      expect(masked).toHaveLength(room.name.length);
      for (const [i, ch] of [...masked].entries()) {
        if (ch === '_') continue;
        const before = room.name[i - 1];
        const isWordStart = i === 0 || !/[A-Za-z0-9]/.test(before ?? '');
        expect(isWordStart || !/[A-Za-z0-9]/.test(ch), `${room.name} at ${i}`).toBe(true);
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
    expect(s.guessesLeft()).toBe(MAX_GUESSES);
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

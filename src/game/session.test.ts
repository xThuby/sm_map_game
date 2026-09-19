import { describe, it, expect } from 'vitest';
import { createSession, shuffleBag, MAX_GUESSES, HINT_ORDER } from './session';
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
  it('starts with all guesses unspent and no hints', () => {
    const s = only('Volcano Room');
    expect(s.guessesLeft()).toBe(MAX_GUESSES);
    expect(s.hints()).toEqual([]);
    expect(s.state()).toBe('guessing');
  });

  it('ends the room as soon as the answer is right', () => {
    const s = only('Volcano Room');
    expect(s.guess('Volcano Room').correct).toBe(true);
    expect(s.state()).toBe('solved');
    expect(s.guessesLeft()).toBe(MAX_GUESSES - 1);
  });

  it('spends a guess and reveals the next hint when wrong', () => {
    const s = only('Volcano Room');
    s.guess('Landing Site');
    expect(s.guessesLeft()).toBe(MAX_GUESSES - 1);
    expect(s.hints()).toHaveLength(1);
    expect(s.state()).toBe('guessing');
  });

  it('spends a guess for a hint when skipped, without an answer', () => {
    const s = only('Volcano Room');
    s.skip();
    expect(s.guessesLeft()).toBe(MAX_GUESSES - 1);
    expect(s.hints()).toHaveLength(1);
  });

  it('reveals hints in order as guesses are spent', () => {
    const s = only('Volcano Room');
    s.skip();
    expect(s.hints().map((h) => h.kind)).toEqual(['area']);
    s.skip();
    expect(s.hints().map((h) => h.kind)).toEqual(['area', 'enemies']);
  });

  /**
   * The diagram has to be on screen while the last guess is made, not delivered alongside
   * the answer, so the third spent guess reveals both remaining hints.
   */
  it('has every hint showing before the final guess', () => {
    const s = only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES - 1; i += 1) s.skip();
    expect(s.guessesLeft()).toBe(1);
    expect(s.hints().map((h) => h.kind)).toEqual(HINT_ORDER);
  });

  it('is lost once every guess is spent', () => {
    const s = only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES; i += 1) s.skip();
    expect(s.guessesLeft()).toBe(0);
    expect(s.state()).toBe('lost');
  });

  it('shows every hint once the room is lost', () => {
    const s = only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES; i += 1) s.skip();
    expect(s.hints().map((h) => h.kind)).toEqual(HINT_ORDER);
  });

  it('refuses further guesses once the room is over', () => {
    const s = only('Volcano Room');
    s.guess('Volcano Room');
    expect(() => s.guess('Landing Site')).toThrow();
    expect(() => s.skip()).toThrow();
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

describe('hints', () => {
  const allHints = (name: string) => {
    const s = only(name);
    for (let i = 0; i < MAX_GUESSES; i += 1) s.skip();
    return new Map(s.hints().map((h) => [h.kind, h.text]));
  };

  it('names the vanilla area first', () => {
    expect(allHints('Volcano Room').get('area')).toContain('Norfair');
  });

  it('lists the enemies second', () => {
    expect(allHints('Volcano Room').get('enemies')).toContain('Fune');
  });

  it('says so plainly for a room with no enemies', () => {
    expect(allHints('Crateria Map Room').get('enemies')).toMatch(/no enemies/i);
  });

  it('names a vanilla neighbour third', () => {
    const text = allHints('Volcano Room').get('neighbour') ?? '';
    expect(['Kronic Boost Room', 'Spiky Platforms Tunnel'].some((n) => text.includes(n)))
      .toBe(true);
  });

  it('offers the room diagram last', () => {
    expect(allHints('Volcano Room').get('diagram')).toContain('VolcanoRoom_116.png');
  });

  it('gives a diagram url that is absolute and pinned', () => {
    const s = only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES; i += 1) s.skip();
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
    s.skip();
    s.skip();
    s.guess(s.current().name);
    expect(s.score()).toEqual({ asked: 1, solved: 1, guessesUsed: 3 });
  });

  it('counts a lost room as asked but not solved', () => {
    const s = make();
    for (let i = 0; i < MAX_GUESSES; i += 1) s.skip();
    expect(s.score()).toEqual({ asked: 1, solved: 0, guessesUsed: MAX_GUESSES });
  });

  it('resets guesses and hints on the next room', () => {
    const s = make();
    s.guess(s.current().name);
    s.next();
    expect(s.guessesLeft()).toBe(MAX_GUESSES);
    expect(s.hints()).toEqual([]);
    expect(s.state()).toBe('guessing');
  });

  it('refuses to move on while the room is still in play', () => {
    const s = make();
    expect(() => s.next()).toThrow();
  });
});

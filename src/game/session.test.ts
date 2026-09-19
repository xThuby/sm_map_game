import { describe, it, expect } from 'vitest';
import { createSession, shuffleBag } from './session';
import { loadRooms } from '../rooms';
import { TOURNAMENT_SETTINGS } from '../render/renderer';

const rooms = loadRooms();
const seeded = (seed: number) => {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
};

describe('shuffleBag', () => {
  it('deals every item once before repeating any', () => {
    const bag = shuffleBag([1, 2, 3, 4, 5], seeded(1));
    const first = Array.from({ length: 5 }, () => bag.take());
    expect([...first].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('refills once exhausted', () => {
    const bag = shuffleBag([1, 2, 3], seeded(7));
    const drawn = Array.from({ length: 9 }, () => bag.take());
    expect(drawn).toHaveLength(9);
    expect(new Set(drawn)).toEqual(new Set([1, 2, 3]));
  });

  it('is deterministic for a given seed', () => {
    const a = Array.from({ length: 6 }, () => shuffleBagOf(1).take());
    const b = Array.from({ length: 6 }, () => shuffleBagOf(1).take());
    expect(a).toEqual(b);
  });
});

function shuffleBagOf(seed: number) {
  return shuffleBag([1, 2, 3, 4, 5, 6], seeded(seed));
}

describe('createSession', () => {
  const make = (seed = 1) =>
    createSession({ rooms, settings: TOURNAMENT_SETTINGS, random: seeded(seed) });

  it('starts by asking about a room', () => {
    const s = make();
    expect(s.state()).toBe('asking');
    expect(rooms).toContain(s.current());
  });

  it('accepts the room name and counts it correct', () => {
    const s = make();
    const grade = s.answer(s.current().name);
    expect(grade.correct).toBe(true);
    expect(s.state()).toBe('revealed');
    expect(s.score()).toEqual({ asked: 1, correct: 1 });
  });

  it('accepts an alias', () => {
    const s = createSession({
      rooms: rooms.filter((r) => r.name === 'Lower Norfair Escape Power Bomb Room'),
      settings: TOURNAMENT_SETTINGS, random: seeded(3),
    });
    expect(s.answer('The Jail').correct).toBe(true);
  });

  /** Two rooms that paint identically cannot be told apart, so either name is right. */
  it('accepts any room that looks identical to the one shown', () => {
    const s = createSession({
      rooms: rooms.filter((r) => r.name === 'Wave Beam Room'),
      settings: TOURNAMENT_SETTINGS, random: seeded(5),
    });
    const grade = s.answer('Ice Beam Room');
    expect(grade.correct).toBe(true);
    expect(grade.group.map((r) => r.name).sort()).toEqual(['Ice Beam Room', 'Wave Beam Room']);
  });

  it('marks a different room wrong and still reveals the answer', () => {
    const s = createSession({
      rooms: rooms.filter((r) => r.name === 'Landing Site'),
      settings: TOURNAMENT_SETTINGS, random: seeded(2),
    });
    const grade = s.answer('The Moat');
    expect(grade.correct).toBe(false);
    expect(grade.answer?.name).toBe('The Moat');
    expect(s.score()).toEqual({ asked: 1, correct: 0 });
  });

  it('offers a suggestion for a near miss rather than accepting it', () => {
    const s = createSession({
      rooms: rooms.filter((r) => r.name === 'Volcano Room'),
      settings: TOURNAMENT_SETTINGS, random: seeded(4),
    });
    const grade = s.answer('Volcanoe Room');
    expect(grade.correct).toBe(false);
    expect(grade.suggestion?.name).toBe('Volcano Room');
  });

  it('can be given up on, which reveals without scoring a point', () => {
    const s = make();
    const grade = s.reveal();
    expect(grade.correct).toBe(false);
    expect(s.score()).toEqual({ asked: 1, correct: 0 });
    expect(s.state()).toBe('revealed');
  });

  it('moves to another room on next', () => {
    const s = make();
    s.answer('nonsense');
    s.next();
    expect(s.state()).toBe('asking');
    expect(s.score().asked).toBe(1);
  });

  it('refuses to answer twice for the same room', () => {
    const s = make();
    s.answer(s.current().name);
    expect(() => s.answer(s.current().name)).toThrow();
  });

  it('works through the whole pool without repeating', () => {
    const s = make();
    const seen: number[] = [];
    for (let i = 0; i < rooms.length; i += 1) {
      seen.push(s.current().id);
      s.reveal();
      s.next();
    }
    expect(new Set(seen).size).toBe(rooms.length);
  });
});

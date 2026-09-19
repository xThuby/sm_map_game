import { buildNameIndex, resolveName, suggestName } from './matching';
import type { NameIndex } from './matching';
import { equivalenceGroup, loadRooms } from '../rooms';
import type { RenderSettings, Room } from '../types';

export interface Grade {
  correct: boolean;
  /** The room the player's answer named, if it named one at all. */
  answer: Room | null;
  /** Every room indistinguishable from the one shown, including it. */
  group: Room[];
  /** What they probably meant, when the answer was close but not a name. */
  suggestion: Room | null;
}

export interface Bag<T> {
  take(): T;
}

/**
 * Deals every item once before repeating any, so a short session never asks the same room
 * twice while others go unseen.
 */
export function shuffleBag<T>(items: readonly T[], random: () => number): Bag<T> {
  let remaining: T[] = [];
  const refill = () => {
    remaining = [...items];
    for (let i = remaining.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j] as T, remaining[i] as T];
    }
  };
  return {
    take() {
      if (remaining.length === 0) refill();
      return remaining.pop() as T;
    },
  };
}

export interface SessionOptions {
  /** The rooms this session asks about. May be a filtered subset. */
  rooms: Room[];
  settings: RenderSettings;
  random?: () => number;
  /**
   * Every room whose name counts as a valid answer. Defaults to the whole game: filtering a
   * session to one area restricts what gets asked, not what the player is allowed to type.
   */
  answerable?: Room[];
}

export interface Session {
  current(): Room;
  state(): 'asking' | 'revealed';
  answer(input: string): Grade;
  /** Give up: reveals the room and counts it as asked but not correct. */
  reveal(): Grade;
  next(): void;
  score(): { asked: number; correct: number };
  lastGrade(): Grade | null;
}

export function createSession(options: SessionOptions): Session {
  const { rooms, settings, random = Math.random, answerable = loadRooms() } = options;
  if (rooms.length === 0) throw new Error('A session needs at least one room');

  const index: NameIndex = buildNameIndex(answerable);
  const bag = shuffleBag(rooms, random);

  let room = bag.take();
  let grade: Grade | null = null;
  let asked = 0;
  let correct = 0;

  /**
   * Graded against every room that paints the same pixels, not just the one asked about:
   * when two rooms are indistinguishable there is nothing on screen that could separate
   * them, so both answers are right.
   */
  const gradeAnswer = (input: string): Grade => {
    const group = equivalenceGroup(room, settings);
    const named = resolveName(input, index);
    return {
      correct: named !== null && group.some((r) => r.id === named.id),
      answer: named,
      group,
      suggestion: named === null ? (suggestName(input, index)?.room ?? null) : null,
    };
  };

  const settle = (result: Grade): Grade => {
    if (grade !== null) throw new Error('This room has already been answered');
    grade = result;
    asked += 1;
    if (result.correct) correct += 1;
    return result;
  };

  return {
    current: () => room,
    state: () => (grade === null ? 'asking' : 'revealed'),
    answer: (input) => settle(gradeAnswer(input)),
    reveal: () => settle({
      correct: false, answer: null, group: equivalenceGroup(room, settings), suggestion: null,
    }),
    next() {
      room = bag.take();
      grade = null;
    },
    score: () => ({ asked, correct }),
    lastGrade: () => grade,
  };
}

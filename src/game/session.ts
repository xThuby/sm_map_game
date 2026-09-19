import { buildNameIndex, resolveName, suggestName } from './matching';
import type { NameIndex } from './matching';
import { equivalenceGroup, loadRooms } from '../rooms';
import type { RenderSettings, Room } from '../types';

/**
 * Four guesses, each spent one costing you the next hint. Modelled on the daily
 * guess-the-thing games: skipping buys a hint rather than abandoning the room.
 */
export const MAX_GUESSES = 4;

export type HintKind = 'area' | 'enemies' | 'neighbour' | 'diagram';

/** Least to most generous. The diagram gives the room away, so it comes last. */
export const HINT_ORDER: HintKind[] = ['area', 'enemies', 'neighbour', 'diagram'];

/**
 * How many hints are showing once this many guesses have been spent.
 *
 * The third spent guess reveals two, so the room diagram is on screen while the player makes
 * their final guess rather than arriving with the answer, where it could not be acted on.
 */
const HINTS_AFTER: number[] = [0, 1, 2, HINT_ORDER.length, HINT_ORDER.length];

const CDN = 'https://cdn.jsdelivr.net/gh/vg-json-data/sm-json-data';
/** Pinned so the URL is immutable and the CDN can cache it indefinitely. */
const SM_JSON_COMMIT = 'f0a990339a2d234ed8d3ae6234c855a016aae021';

export interface Hint {
  kind: HintKind;
  label: string;
  text: string;
  /** Set on the diagram hint: the room as it looks in game. */
  imageUrl?: string;
}

export interface Grade {
  correct: boolean;
  /** False when the input named no room at all, which does not cost a guess. */
  recognised: boolean;
  answer: Room | null;
  /** Every room indistinguishable from the one shown, including it. */
  group: Room[];
  suggestion: Room | null;
}

export interface Bag<T> {
  take(): T;
}

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

function hintFor(kind: HintKind, room: Room, random: () => number): Hint {
  switch (kind) {
    case 'area':
      return { kind, label: 'Vanilla area', text: room.area };
    case 'enemies': {
      if (room.enemies.length === 0) {
        return { kind, label: 'Enemies', text: 'This room has no enemies.' };
      }
      const list = room.enemies
        .map((e) => (e.quantity > 1 ? `${e.quantity} ${e.name}` : e.name))
        .join(', ');
      return { kind, label: 'Enemies', text: list };
    }
    case 'neighbour': {
      if (room.neighbours.length === 0) {
        return { kind, label: 'Connects to', text: 'Nothing, on the vanilla map.' };
      }
      const pick = room.neighbours[Math.floor(random() * room.neighbours.length)] as string;
      return { kind, label: 'Connects to', text: `${pick}, on the vanilla map.` };
    }
    case 'diagram':
      return {
        kind,
        label: 'The room itself',
        text: room.diagram ?? 'No diagram for this room.',
        ...(room.diagram ? { imageUrl: `${CDN}@${SM_JSON_COMMIT}/${room.diagram}` } : {}),
      };
  }
}

export interface SessionOptions {
  /** The rooms this session asks about. May be a filtered subset. */
  rooms: Room[];
  settings: RenderSettings;
  random?: () => number;
  /**
   * Every room whose name counts as a valid answer. Defaults to the whole game: filtering a
   * session to one area restricts what gets asked, not what the player may type.
   */
  answerable?: Room[];
}

export type RoomState = 'guessing' | 'solved' | 'lost';

export interface Session {
  current(): Room;
  state(): RoomState;
  guessesLeft(): number;
  hints(): Hint[];
  /** Every room indistinguishable from the current one, including it. */
  group(): Room[];
  guess(input: string): Grade;
  /** Spend a guess to buy the next hint, without naming a room. */
  skip(): void;
  next(): void;
  score(): { asked: number; solved: number; guessesUsed: number };
  lastGrade(): Grade | null;
}

export function createSession(options: SessionOptions): Session {
  const { rooms, settings, random = Math.random, answerable = loadRooms() } = options;
  if (rooms.length === 0) throw new Error('A session needs at least one room');

  const index: NameIndex = buildNameIndex(answerable);
  const bag = shuffleBag(rooms, random);

  let room = bag.take();
  let spent = 0;
  let solved = false;
  let grade: Grade | null = null;
  let asked = 1;
  let totalSolved = 0;
  let totalGuesses = 0;

  const state = (): RoomState => {
    if (solved) return 'solved';
    return spent >= MAX_GUESSES ? 'lost' : 'guessing';
  };

  const revealed = (): Hint[] => {
    // A lost room shows everything; otherwise follow the schedule.
    const shown = state() === 'lost'
      ? HINT_ORDER.length
      : (HINTS_AFTER[Math.min(spent, HINTS_AFTER.length - 1)] as number);
    return HINT_ORDER.slice(0, shown).map((kind) => hintFor(kind, room, random));
  };

  const requirePlaying = () => {
    if (state() !== 'guessing') throw new Error('This room is already over');
  };

  const spend = () => {
    spent += 1;
    totalGuesses += 1;
  };

  return {
    current: () => room,
    state,
    guessesLeft: () => Math.max(MAX_GUESSES - spent, 0),
    hints: revealed,
    group: () => equivalenceGroup(room, settings),
    lastGrade: () => grade,

    /**
     * Graded against every room that paints the same pixels, not just the one asked about:
     * when two rooms are indistinguishable there is nothing on screen that could separate
     * them, so both answers are right.
     */
    guess(input) {
      requirePlaying();
      const named = resolveName(input, index);
      const group = equivalenceGroup(room, settings);
      const result: Grade = {
        correct: named !== null && group.some((r) => r.id === named.id),
        recognised: named !== null,
        answer: named,
        group,
        suggestion: named === null ? (suggestName(input, index)?.room ?? null) : null,
      };
      grade = result;

      // Typing something that names no room at all is a slip, not a guess.
      if (!result.recognised) return result;

      spend();
      if (result.correct) {
        solved = true;
        totalSolved += 1;
      }
      return result;
    },

    skip() {
      requirePlaying();
      grade = null;
      spend();
    },

    next() {
      if (state() === 'guessing') throw new Error('This room is still in play');
      room = bag.take();
      spent = 0;
      solved = false;
      grade = null;
      asked += 1;
    },

    score: () => ({ asked, solved: totalSolved, guessesUsed: totalGuesses }),
  };
}

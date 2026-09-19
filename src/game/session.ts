import { buildNameIndex, resolveName, suggestName } from './matching';
import type { NameIndex } from './matching';
import { equivalenceGroup, loadRooms } from '../rooms';
import type { RenderSettings, Room } from '../types';

/** How many wrong answers a room allows before it is lost. */
export const MAX_GUESSES = 6;

/** How many rooms make a round, after which the player is shown how they did. */
export const ROUND_LENGTH = 6;

/** What a room is worth if it is named without buying a thing. */
export const STARTING_POINTS = 100;

export type HintKind = 'area' | 'enemies' | 'neighbour' | 'diagram' | 'name';

/** Least to most generous. The name itself is the last thing worth giving away. */
export const HINT_ORDER: HintKind[] = ['area', 'enemies', 'neighbour', 'diagram', 'name'];

/**
 * What each hint costs out of the room's hundred points.
 *
 * Every hint together comes to 120, which is deliberately more than a room is worth: the
 * player has to decide which ones are worth having rather than working down a list. The
 * name is half a room on its own, because knowing the room and not being able to name it
 * is the case this is all for — it should be buyable, and it should hurt.
 */
export const HINT_COSTS: Record<HintKind, number> = {
  area: 10,
  enemies: 10,
  neighbour: 20,
  diagram: 30,
  name: 50,
};

const HINT_LABELS: Record<HintKind, string> = {
  area: 'Original map area',
  enemies: 'Enemies',
  neighbour: 'Connects to',
  diagram: 'The room itself',
  name: 'The name',
};

/**
 * The name with everything but the first letter of each word struck out, as in hangman.
 *
 * A word is what the spaces separate, so "Pre-Map" gives away only its P. Punctuation stays
 * visible: it is not a letter to guess, and the shape of the name is the hint.
 */
export function nameHint(name: string): string {
  return name
    .split(' ')
    .map((word) => {
      let first = true;
      return [...word]
        .map((ch) => {
          if (!/[A-Za-z0-9]/.test(ch)) return ch;
          if (first) { first = false; return ch; }
          return '_';
        })
        .join('');
    })
    .join(' ');
}

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

/** A hint as the player sees it before buying: what it is, what it costs, whether it can be. */
export interface HintOffer {
  kind: HintKind;
  label: string;
  cost: number;
  bought: boolean;
  /** False once it is bought, or once there are too few points left to pay for it. */
  affordable: boolean;
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

function hintFor(kind: HintKind, room: Room): Hint {
  switch (kind) {
    case 'area':
      return { kind, label: HINT_LABELS[kind], text: room.area };
    case 'enemies': {
      if (room.enemies.length === 0) {
        return { kind, label: HINT_LABELS[kind], text: 'This room has no enemies.' };
      }
      const list = room.enemies
        .map((e) => (e.quantity > 1 ? `${e.quantity} ${e.name}` : e.name))
        .join(', ');
      return { kind, label: HINT_LABELS[kind], text: list };
    }
    case 'neighbour':
      return {
        kind,
        label: HINT_LABELS[kind],
        text: room.neighbours.length === 0 ? 'Nothing' : room.neighbours.join(', '),
      };
    case 'diagram':
      return {
        kind,
        label: HINT_LABELS[kind],
        text: room.diagram ?? 'No diagram for this room.',
        ...(room.diagram ? { imageUrl: `${CDN}@${SM_JSON_COMMIT}/${room.diagram}` } : {}),
      };
    case 'name':
      return { kind, label: HINT_LABELS[kind], text: nameHint(room.name) };
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

export interface PlayedRoom {
  room: Room;
  solved: boolean;
  guessesUsed: number;
  /** What the room was worth when it was finished with: zero if it was never got. */
  points: number;
}

export interface Session {
  current(): Room;
  /** Rooms already finished with, oldest first, for looking back over. */
  played(): PlayedRoom[];
  /** Which round is being played, counting from one. */
  roundNumber(): number;
  /** Rooms finished in this round, the one in play included once it is over. */
  roundResults(): PlayedRoom[];
  roundComplete(): boolean;
  /** Begins the next round. Only valid once this one is over. */
  startRound(): void;
  state(): RoomState;
  guessesLeft(): number;
  /** What the room in play is still worth: a hundred less whatever hints were bought. */
  points(): number;
  /** The points banked this round, the room in play included once it is over. */
  roundPoints(): number;
  /** Only the hints that have been bought — everything, once the room is over. */
  hints(): Hint[];
  /** Every hint there is, priced, whether bought or not. */
  offers(): HintOffer[];
  buyHint(kind: HintKind): void;
  /** Every room indistinguishable from the current one, including it. */
  group(): Room[];
  guess(input: string): Grade;
  /** End the room unsolved, for when there is nothing left worth guessing. */
  giveUp(): void;
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
  let gaveUp = false;
  let bought = new Set<HintKind>();
  let grade: Grade | null = null;
  let asked = 1;
  let totalSolved = 0;
  let totalGuesses = 0;
  const finished: PlayedRoom[] = [];
  let roundStart = 0;
  let round = 1;

  const state = (): RoomState => {
    if (solved) return 'solved';
    return gaveUp || spent >= MAX_GUESSES ? 'lost' : 'guessing';
  };

  /** A room never got is worth nothing, however little was spent working on it. */
  const points = (): number => {
    if (state() === 'lost') return 0;
    return STARTING_POINTS - [...bought].reduce((sum, kind) => sum + HINT_COSTS[kind], 0);
  };

  const record = (): PlayedRoom => ({ room, solved, guessesUsed: spent, points: points() });

  /** The room in play counts towards the round as soon as it is finished with. */
  const roundResults = (): PlayedRoom[] => {
    const done = finished.slice(roundStart);
    return state() === 'guessing' ? done : [...done, record()];
  };
  const roundComplete = () => roundResults().length >= ROUND_LENGTH;

  const draw = (): void => {
    finished.push(record());
    room = bag.take();
    spent = 0;
    solved = false;
    gaveUp = false;
    bought = new Set();
    grade = null;
    asked += 1;
  };

  /** What has been bought, in a settled order however it was bought — or all of it, once
   * the room is over and there is nothing left to give away. */
  const revealed = (): Hint[] => {
    const shown = state() === 'guessing' ? HINT_ORDER.filter((k) => bought.has(k)) : HINT_ORDER;
    return shown.map((kind) => hintFor(kind, room));
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
    points,
    roundPoints: () => roundResults().reduce((sum, r) => sum + r.points, 0),
    hints: revealed,
    group: () => equivalenceGroup(room, settings),
    lastGrade: () => grade,

    offers: () => HINT_ORDER.map((kind) => ({
      kind,
      label: HINT_LABELS[kind],
      cost: HINT_COSTS[kind],
      bought: bought.has(kind),
      affordable: !bought.has(kind) && HINT_COSTS[kind] <= points(),
    })),

    buyHint(kind) {
      requirePlaying();
      if (bought.has(kind)) throw new Error(`The ${kind} hint has already been bought`);
      if (HINT_COSTS[kind] > points()) {
        throw new Error(`Not enough points left for the ${kind} hint`);
      }
      bought.add(kind);
    },

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

    giveUp() {
      requirePlaying();
      grade = null;
      gaveUp = true;
    },

    played: () => [...finished],
    roundNumber: () => round,
    roundResults,
    roundComplete,

    next() {
      if (state() === 'guessing') throw new Error('This room is still in play');
      if (roundComplete()) throw new Error('This round is over; start another');
      draw();
    },

    startRound() {
      if (!roundComplete()) throw new Error('This round is not over yet');
      draw();
      // draw() has just filed the last room of the old round, so the new one starts here.
      roundStart = finished.length;
      round += 1;
    },

    score: () => ({ asked, solved: totalSolved, guessesUsed: totalGuesses }),
  };
}

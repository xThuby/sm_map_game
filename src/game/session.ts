import { buildNameIndex, resolveName, suggestName } from './matching';
import type { NameIndex } from './matching';
import { equivalenceGroup, loadRooms } from '../rooms';
import type { RenderSettings, Room } from '../types';

/** How many rooms make a round, after which the player is shown how they did. */
export const ROUND_LENGTH = 6;

/** What a room is worth if it is named without buying a thing. */
export const STARTING_POINTS = 100;

/**
 * What a wrong answer costs. There is no guess allowance any more — guesses come out of the
 * same purse as hints, so being wrong is priced rather than rationed.
 */
export const WRONG_GUESS_COST = 10;

/** The most guesses a room can take: any more and the points are gone. */
export const MAX_GUESSES = STARTING_POINTS / WRONG_GUESS_COST;

export type HintKind = 'area' | 'enemies' | 'neighbour' | 'diagram' | 'name';

/** Least to most generous. The name itself is the last thing worth giving away. */
export const HINT_ORDER: HintKind[] = ['area', 'enemies', 'neighbour', 'diagram', 'name'];

/** How many letters of each word the name hint will give away, one purchase each. */
export const NAME_LETTERS = 2;

/**
 * What each hint costs out of the room's hundred points — for the name, what each letter of
 * it costs, so the whole name comes to 50.
 *
 * Everything together comes to 95, so a player who buys the lot still takes 5 points for
 * naming the room. Knowing the room and not being able to name it is the case this is all
 * for: the way out of it has to be affordable, and it has to leave something behind.
 */
export const HINT_COSTS: Record<HintKind, number> = {
  area: 5,
  enemies: 10,
  neighbour: 15,
  diagram: 15,
  name: 25,
};

/**
 * What a wrong answer throws in, in order — the first wrong answer gives the first of these
 * that is not already showing, the second the next, and after that the ten buys nothing.
 *
 * Area costs 5 to ask for and 10 to be given, which is the right way round: the hint is a
 * consolation for the guess, not a cheaper route to the hint.
 */
export const AUTO_HINTS: HintKind[] = ['area', 'enemies'];

const HINT_LABELS: Record<HintKind, string> = {
  area: 'Original map area',
  enemies: 'Enemies',
  neighbour: 'Connects to',
  diagram: 'The room itself',
  name: 'The name',
};

/**
 * The name with every letter struck out but the ones at `revealed`, as in hangman.
 *
 * Spaces and punctuation always show: they are not letters to guess, and the shape of the
 * name is itself free — it is what the room's own map tiles cannot tell you and its name
 * length can.
 */
export function nameHint(name: string, revealed: ReadonlySet<number>): string {
  return [...name]
    .map((ch, i) => {
      if (!/[A-Za-z0-9]/.test(ch)) return ch;
      return revealed.has(i) ? ch : '_';
    })
    .join('');
}

/** Where the letters are in a name — the only places a bought letter can land. */
function letterSpots(name: string): number[] {
  return [...name].flatMap((ch, i) => (/[A-Za-z0-9]/.test(ch) ? [i] : []));
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
  /** True only for the room actually on screen: a look-alike is a wrong answer. */
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

function hintFor(kind: HintKind, room: Room, nameShowing: ReadonlySet<number>): Hint {
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
      return { kind, label: HINT_LABELS[kind], text: nameHint(room.name, nameShowing) };
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
  /** How many answers have been given on this room, right or wrong. */
  guessesUsed(): number;
  /** The rooms already named and found wrong on this one, oldest first. */
  wrongGuesses(): Room[];
  /** What the room in play is still worth: a hundred less whatever hints were bought. */
  points(): number;
  /** The points banked this round, the room in play included once it is over. */
  roundPoints(): number;
  /** Only the hints that have been bought — everything, once the room is over. */
  hints(): Hint[];
  /** Every hint there is, priced, whether bought or not. */
  offers(): HintOffer[];
  /** How many letters of the name have been paid for, up to NAME_LETTERS. */
  nameLetters(): number;
  /** The name with only the bought letters showing — the whole name once the room is over. */
  nameMask(): string;
  /** Buys one more of a hint. The name is sold a letter at a time; the rest, once each. */
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
  let used = 0;
  let solved = false;
  let gaveUp = false;
  /** Hints showing, whether paid for or thrown in with a wrong answer. */
  let revealed = new Set<HintKind>();
  /** Which characters of the name are showing. Its size is how many letters were bought. */
  let nameShowing = new Set<number>();
  /** Points gone: hints bought plus ten for every wrong answer. */
  let spentPoints = 0;
  /** The rooms named and found wrong, so they can be shown rather than tried again. */
  let wrong: Room[] = [];
  let grade: Grade | null = null;
  let asked = 1;
  let totalSolved = 0;
  let totalGuesses = 0;
  const finished: PlayedRoom[] = [];
  let roundStart = 0;
  let round = 1;

  /** Out of points is out of the room: the purse is the only thing rationing a guess. */
  const broke = (): boolean => spentPoints >= STARTING_POINTS;

  const state = (): RoomState => {
    if (solved) return 'solved';
    return gaveUp || broke() ? 'lost' : 'guessing';
  };

  const timesBought = (kind: HintKind): number =>
    (kind === 'name' ? nameShowing.size : (revealed.has(kind) ? 1 : 0));

  /** The name can only sell as many letters as it has, which is never fewer than two. */
  const limitFor = (kind: HintKind): number =>
    (kind === 'name' ? Math.min(NAME_LETTERS, letterSpots(room.name).length) : 1);

  /** A room never got is worth nothing, however little was spent working on it. */
  const points = (): number => (state() === 'lost' ? 0 : STARTING_POINTS - spentPoints);

  /** Everything showing once the room is over, so nothing is held back on the reveal. */
  const allNameSpots = (): Set<number> => new Set(letterSpots(room.name));

  /** Uncovers one more letter of the name, wherever it falls. */
  const showNameLetter = (): void => {
    const left = letterSpots(room.name).filter((i) => !nameShowing.has(i));
    if (left.length === 0) return;
    nameShowing.add(left[Math.floor(random() * left.length)] as number);
  };

  const show = (kind: HintKind): void => {
    if (kind === 'name') showNameLetter();
    else revealed.add(kind);
  };

  const record = (): PlayedRoom => ({ room, solved, guessesUsed: used, points: points() });

  /** The room in play counts towards the round as soon as it is finished with. */
  const roundResults = (): PlayedRoom[] => {
    const done = finished.slice(roundStart);
    return state() === 'guessing' ? done : [...done, record()];
  };
  const roundComplete = () => roundResults().length >= ROUND_LENGTH;

  const draw = (): void => {
    finished.push(record());
    room = bag.take();
    used = 0;
    solved = false;
    gaveUp = false;
    revealed = new Set();
    nameShowing = new Set();
    spentPoints = 0;
    wrong = [];
    grade = null;
    asked += 1;
  };

  /** What has been bought, in a settled order however it was bought — or all of it, once
   * the room is over and there is nothing left to give away. */
  const onShow = (): Hint[] => {
    const playing = state() === 'guessing';
    const shown = playing ? HINT_ORDER.filter((k) => timesBought(k) > 0) : HINT_ORDER;
    // A room that is over has nothing left to hold back, name included.
    const letters = playing ? nameShowing : allNameSpots();
    return shown.map((kind) => hintFor(kind, room, letters));
  };

  const mask = (): string =>
    nameHint(room.name, state() === 'guessing' ? nameShowing : allNameSpots());

  const requirePlaying = () => {
    if (state() !== 'guessing') throw new Error('This room is already over');
  };

  const spend = () => {
    used += 1;
    totalGuesses += 1;
  };

  return {
    current: () => room,
    state,
    guessesUsed: () => used,
    wrongGuesses: () => [...wrong],
    points,
    roundPoints: () => roundResults().reduce((sum, r) => sum + r.points, 0),
    hints: onShow,
    group: () => equivalenceGroup(room, settings),
    lastGrade: () => grade,

    nameLetters: () => nameShowing.size,
    nameMask: mask,

    offers: () => HINT_ORDER.map((kind) => {
      const spent = timesBought(kind) >= limitFor(kind);
      return {
        kind,
        label: HINT_LABELS[kind],
        cost: HINT_COSTS[kind],
        bought: spent,
        affordable: !spent && HINT_COSTS[kind] <= points(),
      };
    }),

    buyHint(kind) {
      requirePlaying();
      if (timesBought(kind) >= limitFor(kind)) {
        throw new Error(`The ${kind} hint has already been bought`);
      }
      if (HINT_COSTS[kind] > points()) {
        throw new Error(`Not enough points left for the ${kind} hint`);
      }
      spentPoints += HINT_COSTS[kind];
      show(kind);
    },

    /**
     * Only the room on screen is the right answer. Look-alikes used to count, on the grounds
     * that nothing on screen separated them — but the hints do separate them now, and any of
     * them can be bought, so naming the wrong twin is a wrong answer like any other. The
     * group still comes back, to name the twins on the reveal.
     */
    guess(input) {
      requirePlaying();
      const named = resolveName(input, index);
      const result: Grade = {
        correct: named !== null && named.id === room.id,
        recognised: named !== null,
        answer: named,
        group: equivalenceGroup(room, settings),
        suggestion: named === null ? (suggestName(input, index)?.room ?? null) : null,
      };
      grade = result;

      // Typing something that names no room at all is a slip, not a guess.
      if (!result.recognised) return result;

      spend();
      if (result.correct) {
        solved = true;
        totalSolved += 1;
        return result;
      }

      // Being wrong costs ten, and throws in the next hint there is to give.
      wrong.push(named as Room);
      spentPoints += WRONG_GUESS_COST;
      const consolation = AUTO_HINTS.find((kind) => timesBought(kind) === 0);
      if (consolation) show(consolation);
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

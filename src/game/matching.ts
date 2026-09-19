import type { Room } from '../types';

export interface NameEntry {
  /** The name as written, canonical or alias. */
  name: string;
  normalized: string;
  room: Room;
  isAlias: boolean;
}

export interface NameIndex {
  entries: NameEntry[];
  byKey: Map<string, Room>;
}

export interface Suggestion {
  room: Room;
  name: string;
  distance: number;
}

/** How far a typed name may be from a real one before it stops being a plausible typo. */
const MAX_SUGGESTION_DISTANCE = 2;

/**
 * Reduces a name to a comparison key, so that "Wrecked Ship Main Shaft",
 * "wreckedshipmainshaft" and "WRECKED-SHIP-MAIN-SHAFT" all answer the same question.
 */
export function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Every key a name should be findable under, most literal first.
 *
 * A name starting with "the" also gets a key without it, because players drop the article:
 * the map says "The Moat" and conversation says "Moat". Handling that here rather than
 * inside normalizeName is what makes "TheMoat" work — an earlier version matched /^the\s+/
 * before punctuation was stripped, so the run-together form silently failed while
 * "WreckedShipMainShaft" succeeded.
 */
export function nameKeys(input: string): string[] {
  const plain = normalizeName(input);
  if (plain === '') return [];
  return plain.startsWith('the') && plain.length > 3 ? [plain, plain.slice(3)] : [plain];
}

/** Standard edit distance, iterative with a single row of state. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] as number;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(current + 1, (row[j - 1] as number) + 1, prev + cost);
      prev = current;
    }
  }
  return row[b.length] as number;
}

export function buildNameIndex(rooms: readonly Room[]): NameIndex {
  const entries: NameEntry[] = [];
  const byKey = new Map<string, Room>();

  for (const room of rooms) {
    for (const [i, name] of [room.name, ...room.aliases].entries()) {
      entries.push({ name, normalized: normalizeName(name), room, isAlias: i > 0 });
    }
  }

  // Two passes so a room's own full name always wins the key, and an article-stripped
  // variant can only claim a key nothing else already owns.
  for (const entry of entries) byKey.set(entry.normalized, entry.room);
  for (const entry of entries) {
    for (const key of nameKeys(entry.name)) {
      if (!byKey.has(key)) byKey.set(key, entry.room);
    }
  }
  return { entries, byKey };
}

/** The room a typed answer names exactly, or null. Never guesses. */
export function resolveName(input: string, index: NameIndex): Room | null {
  for (const key of nameKeys(input)) {
    const room = index.byKey.get(key);
    if (room) return room;
  }
  return null;
}

/**
 * The room a typed answer most likely meant, when it does not name one exactly. Offered to
 * the player rather than accepted for them — silently upgrading a near miss to a hit would
 * teach the wrong name.
 */
export function suggestName(input: string, index: NameIndex): Suggestion | null {
  const key = normalizeName(input);
  if (key === '' || resolveName(input, index) !== null) return null;

  let best: Suggestion | null = null;
  for (const entry of index.entries) {
    const distance = levenshtein(key, entry.normalized);
    if (distance <= MAX_SUGGESTION_DISTANCE && (best === null || distance < best.distance)) {
      best = { room: entry.room, name: entry.name, distance };
    }
  }
  return best;
}

/**
 * Names containing the typed text, those starting with it first. Matching on the normalized
 * key means "crocomires" finds "Crocomire's Room".
 */
export function autocomplete(input: string, index: NameIndex, limit = 10): NameEntry[] {
  const key = normalizeName(input);
  if (key === '') return [];

  const prefix: NameEntry[] = [];
  const substring: NameEntry[] = [];
  for (const entry of index.entries) {
    if (entry.normalized.startsWith(key)) prefix.push(entry);
    else if (entry.normalized.includes(key)) substring.push(entry);
  }

  const byName = (a: NameEntry, b: NameEntry) => a.name.localeCompare(b.name);
  return [...prefix.sort(byName), ...substring.sort(byName)].slice(0, limit);
}

import { visualSignature } from '../signature';
import { MAX_GUESSES } from './session';
import type { RenderSettings, Room } from '../types';

/** A room nothing distinguishes is worth the full set of guesses. */
export const MAX_PAR = MAX_GUESSES;

/** What a player has to go on, in the order the hints arrive. */
export type ParStep = 'shape' | 'area' | 'enemies' | 'neighbour';

export const PAR_STEPS: ParStep[] = ['shape', 'area', 'enemies', 'neighbour'];

export interface ParBreakdown {
  room: Room;
  par: number;
  /** The step that finally made the room unique, or null if nothing did. */
  resolvedBy: ParStep | null;
  steps: { hint: ParStep; confusable: Room[] }[];
}

/**
 * Everything known about a room once this many hints are out. Two rooms with the same
 * description are still confusable at that point.
 *
 * The neighbour hint names only one of a room's neighbours, so using the whole set here is
 * slightly optimistic: it can call a room resolved when the hint might not have resolved it.
 */
function describe(room: Room, settings: RenderSettings, upTo: number): string {
  const parts = [visualSignature(room, settings)];
  if (upTo >= 1) parts.push(`area:${room.area}`);
  if (upTo >= 2) {
    parts.push(`enemies:${room.enemies.map((e) => `${e.quantity}x${e.name}`).sort().join(',')}`);
  }
  if (upTo >= 3) parts.push(`neighbours:${[...room.neighbours].sort().join(',')}`);
  return parts.join('#');
}

/**
 * How many guesses a room ought to take: one, plus a guess for each hint needed before it
 * stops matching any other room.
 *
 * A room nothing looks like is par 1. Rooms that stay confusable however much you are told —
 * the identical save rooms, say — sit at the maximum, because no amount of guessing beats
 * picking one of them.
 */
export function parBreakdown(
  room: Room,
  pool: readonly Room[],
  settings: RenderSettings,
): ParBreakdown {
  const steps: { hint: ParStep; confusable: Room[] }[] = [];
  let resolvedBy: ParStep | null = null;
  let par = MAX_PAR;

  for (const [level, hint] of PAR_STEPS.entries()) {
    const mine = describe(room, settings, level);
    const confusable = pool.filter(
      (other) => other.id !== room.id && describe(other, settings, level) === mine,
    );
    steps.push({ hint, confusable });

    if (confusable.length === 0) {
      resolvedBy = hint;
      par = level + 1;
      break;
    }
  }
  return { room, par, resolvedBy, steps };
}

export function parFor(room: Room, pool: readonly Room[], settings: RenderSettings): number {
  return parBreakdown(room, pool, settings).par;
}

export function allPars(pool: readonly Room[], settings: RenderSettings): ParBreakdown[] {
  return pool.map((room) => parBreakdown(room, pool, settings));
}

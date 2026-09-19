import type { Side } from '../types';

/**
 * The doors Map Rando always marks gray, from get_gray_doors() in map_tiles.rs: the vanilla
 * boss, miniboss and pirate rooms. Unlike the ammo and beam locks a seed assigns, this list
 * is fixed, so a trainer showing a room in isolation can show them.
 *
 * Entries are [roomId, tileX, tileY, side].
 */
const GRAY_DOORS: [number, number, number, Side][] = [
  // Pirate rooms
  [12, 0, 0, 'left'], [12, 2, 0, 'right'],        // Pit Room
  [82, 0, 0, 'left'], [82, 5, 0, 'right'],        // Baby Kraid Room
  [219, 0, 0, 'left'],                            // Plasma Room
  [139, 0, 0, 'left'], [139, 2, 0, 'right'],      // Metal Pirates Room
  // Boss rooms
  [84, 0, 1, 'left'], [84, 1, 1, 'right'],        // Kraid Room
  [158, 0, 0, 'left'],                            // Phantoon's Room
  [193, 0, 1, 'left'], [193, 1, 0, 'right'],      // Draygon's Room
  [142, 0, 0, 'right'], [142, 0, 1, 'left'],      // Ridley's Room
  // Miniboss rooms
  [19, 0, 0, 'left'],                             // Bomb Torizo Room
  [57, 0, 2, 'bottom'],                           // Spore Spawn Room
  [122, 3, 0, 'top'],                             // Crocomire's Room
  [185, 0, 0, 'left'],                            // Botwoon's Room
  [150, 1, 1, 'right'],                           // Golden Torizo's Room
];

const INDEX = new Set(GRAY_DOORS.map(([id, x, y, side]) => `${id}:${x}:${y}:${side}`));

export const GRAY_DOOR_COUNT = GRAY_DOORS.length;

export function grayDoorSide(roomId: number, x: number, y: number, side: Side): boolean {
  return INDEX.has(`${roomId}:${x}:${y}:${side}`);
}

import mapData from '../../data/raw/maps.json';
import { roomById } from '../rooms';
import { AREAS } from '../types';
import type { Area, Door, Room } from '../types';

/**
 * A zone of a real Map Rando map: the rooms it put in one area, where it put them, and how
 * they join up.
 *
 * The layouts are not generated here. Map Rando's generator is a trained model rather than
 * anything callable, so tools/fetch-maps.ts vendors 25 of its published maps instead, and
 * this slices one area out of one of them. That is what the game's own map screen shows —
 * one area at a time — so a zone is the natural unit rather than a contrivance.
 */

/** One map as data/raw/maps.json stores it: [roomId, x, y, area] and the connections. */
export interface RawLayout {
  rooms: [number, number, number, number][];
  connections: [number, number, number, number, boolean][];
}

export interface Placement {
  room: Room;
  /** Top-left tile of the room, relative to the zone's own origin. */
  x: number;
  y: number;
}

export interface DoorRef {
  room: Room;
  door: Door;
  /** Which of the room's doors this is — how the map data names it. */
  index: number;
}

export interface Connection {
  from: DoorRef;
  to: DoorRef;
  bidirectional: boolean;
}

export interface Layout {
  area: Area;
  placements: Placement[];
  /** Only connections with both ends in the zone; the rest are its edges. */
  connections: Connection[];
  width: number;
  height: number;
}

const maps = (mapData as unknown as { maps: RawLayout[] }).maps;

/** Every vendored map layout. */
export function loadMaps(): RawLayout[] {
  return maps;
}

function doorRef(roomId: number, index: number): DoorRef | null {
  const room = roomById(roomId);
  const door = room?.doors[index];
  if (!room || !door) return null;
  return { room, door, index };
}

/**
 * One area of one map, moved to its own origin so it can be drawn on its own.
 *
 * A room reassigned to another area takes its connections with it, so a door leading out of
 * the zone is simply dropped — which is right: on the map screen it is an opening at the
 * edge, and where it goes is the next screen's business.
 */
export function layoutFor(map: RawLayout, area: Area): Layout {
  const inZone = new Map<number, { x: number; y: number }>();
  for (const [id, x, y, index] of map.rooms) {
    if (AREAS[index] === area) inZone.set(id, { x, y });
  }

  const placed = [...inZone].flatMap(([id, at]) => {
    const room = roomById(id);
    return room ? [{ room, ...at }] : [];
  });

  // Anchor the zone at 0,0 rather than wherever it sat on the whole-game grid.
  const originX = Math.min(...placed.map((p) => p.x));
  const originY = Math.min(...placed.map((p) => p.y));
  const placements: Placement[] = placed.map((p) => ({
    room: p.room, x: p.x - originX, y: p.y - originY,
  }));

  const connections: Connection[] = [];
  for (const [fromRoom, fromDoor, toRoom, toDoor, bidirectional] of map.connections) {
    if (!inZone.has(fromRoom) || !inZone.has(toRoom)) continue;
    const from = doorRef(fromRoom, fromDoor);
    const to = doorRef(toRoom, toDoor);
    if (!from || !to) continue;
    connections.push({ from, to, bidirectional });
  }

  return {
    area,
    placements,
    connections,
    width: Math.max(...placements.map((p) => p.x + p.room.width)),
    height: Math.max(...placements.map((p) => p.y + p.room.height)),
  };
}

/** A zone at random: one of the vendored maps, one of its six areas. */
export function pickLayout(random: () => number = Math.random): Layout {
  const map = maps[Math.floor(random() * maps.length)] as RawLayout;
  const area = AREAS[Math.floor(random() * AREAS.length)] as Area;
  return layoutFor(map, area);
}

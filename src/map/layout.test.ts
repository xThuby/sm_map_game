import { describe, it, expect } from 'vitest';
import { loadMaps, layoutFor, pickLayout } from './layout';
import type { Layout } from './layout';
import { loadRooms } from '../rooms';
import { AREAS } from '../types';
import type { Direction } from '../types';

const maps = loadMaps();
const rooms = loadRooms();

const seeded = (seed: number) => {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
};

/** Every zone of every vendored map — 150 of them, which is the whole corpus. */
const everyZone = (): Layout[] => maps.flatMap((m) => AREAS.map((a) => layoutFor(m, a)));

const OPPOSITE: Record<Direction, Direction> = {
  left: 'right', right: 'left', up: 'down', down: 'up',
};
const STEP: Record<Direction, [number, number]> = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
};

describe('the vendored maps', () => {
  it('loads all 25', () => {
    expect(maps).toHaveLength(25);
  });

  it('places every room in the game', () => {
    for (const [i, m] of maps.entries()) expect(m.rooms, `map ${i}`).toHaveLength(rooms.length);
  });
});

describe('slicing one zone out of a map', () => {
  it('keeps only the rooms the map assigned to that area', () => {
    const zone = layoutFor(maps[0]!, 'Norfair');
    expect(zone.area).toBe('Norfair');
    expect(zone.placements.length).toBeGreaterThan(0);
    const ids = new Set(zone.placements.map((p) => p.room.id));
    const assigned = maps[0]!.rooms.filter(([, , , a]) => AREAS[a] === 'Norfair');
    expect(ids).toEqual(new Set(assigned.map(([id]) => id)));
  });

  /** Six zones, no room left out and none in two of them. */
  it('partitions the whole game across the six zones', () => {
    for (const [i, m] of maps.entries()) {
      const seen = AREAS.flatMap((a) => layoutFor(m, a).placements.map((p) => p.room.id));
      expect(seen, `map ${i}`).toHaveLength(rooms.length);
      expect(new Set(seen).size, `map ${i}`).toBe(rooms.length);
    }
  });

  /**
   * A zone is drawn on its own, so its own top-left corner is the origin. Without this every
   * zone would carry the offset of wherever it happened to sit on the whole-game grid.
   */
  it('moves the zone to its own origin', () => {
    for (const zone of everyZone()) {
      if (zone.placements.length === 0) continue;
      expect(Math.min(...zone.placements.map((p) => p.x))).toBe(0);
      expect(Math.min(...zone.placements.map((p) => p.y))).toBe(0);
    }
  });

  it('measures itself by the rooms it holds', () => {
    for (const zone of everyZone()) {
      expect(zone.width).toBe(Math.max(...zone.placements.map((p) => p.x + p.room.width)));
      expect(zone.height).toBe(Math.max(...zone.placements.map((p) => p.y + p.room.height)));
    }
  });

  /**
    * Rooms do not overlap, with one exception that is in the vanilla map too: the Toilet is a
    * tube Samus falls through, and Map Rando draws it over whatever it passes. It is also the
    * one room the two upstream files disagree about — ten tiles in map_tiles.json against
    * four in room_geometry.json — so it is a known oddity rather than a new one.
    *
    * Worth pinning because it decides draw order: the Toilet has to go on top.
    */
  it('overlaps no rooms but the Toilet, which is drawn over what it passes through', () => {
    const clashes: [string, string][] = [];
    let zonesAffected = 0;
    for (const zone of everyZone()) {
      const taken = new Map<string, string>();
      let hit = false;
      for (const p of zone.placements) {
        for (const t of p.room.tiles) {
          const key = `${p.x + t.x},${p.y + t.y}`;
          const other = taken.get(key);
          if (other !== undefined) { clashes.push([other, p.room.name]); hit = true; }
          taken.set(key, p.room.name);
        }
      }
      if (hit) zonesAffected += 1;
    }
    const notTheToilet = clashes.filter(([a, b]) => a !== 'Toilet Bowl' && b !== 'Toilet Bowl');
    expect(notTheToilet).toEqual([]);
    expect(clashes.length).toBeGreaterThan(0);
    // One Toilet to a map, so it lands in one zone of each: a quarter of the 150.
    expect(zonesAffected).toBe(maps.length);
  });
});

describe('the connections a zone keeps', () => {
  it('keeps the ones with both ends inside it, and drops the rest', () => {
    const m = maps[0]!;
    const areaOf = new Map(m.rooms.map(([id, , , a]) => [id, AREAS[a]]));
    for (const area of AREAS) {
      const zone = layoutFor(m, area);
      const kept = new Set(zone.connections.map((c) => `${c.from.room.id}:${c.from.index}`));
      for (const [fromRoom, fromDoor, toRoom] of m.connections) {
        const inside = areaOf.get(fromRoom) === area && areaOf.get(toRoom) === area;
        expect(kept.has(`${fromRoom}:${fromDoor}`), `${area} ${fromRoom}:${fromDoor}`)
          .toBe(inside);
      }
    }
  });

  it('accounts for every connection across the six zones, dropped or kept', () => {
    const m = maps[0]!;
    const kept = AREAS.reduce((n, a) => n + layoutFor(m, a).connections.length, 0);
    expect(kept).toBeLessThan(m.connections.length);
    expect(kept).toBeGreaterThan(0);
  });

  it('only ever joins doors that face each other', () => {
    for (const zone of everyZone()) {
      for (const c of zone.connections) {
        expect(OPPOSITE[c.from.door.direction], `${zone.area} ${c.from.room.name}`)
          .toBe(c.to.door.direction);
      }
    }
  });

  /**
   * Doors meet tile to tile, which is what makes the placement arithmetic checkable — the
   * same property all 291 vanilla connections have. Elevators are the exception both here
   * and there: they join across a gap.
   */
  it('puts joined doors next to each other unless they are elevators', () => {
    let adjacent = 0;
    let elevators = 0;
    for (const zone of everyZone()) {
      for (const c of zone.connections) {
        const from = zone.placements.find((p) => p.room.id === c.from.room.id)!;
        const to = zone.placements.find((p) => p.room.id === c.to.room.id)!;
        const [dx, dy] = STEP[c.from.door.direction];
        const hit = from.x + c.from.door.x + dx === to.x + c.to.door.x
          && from.y + c.from.door.y + dy === to.y + c.to.door.y;
        if (hit) { adjacent += 1; continue; }
        elevators += 1;
        expect(c.from.door.subtype, `${zone.area} ${c.from.room.name} is apart but not an elevator`)
          .toBe('elevator');
      }
    }
    expect(adjacent).toBeGreaterThan(0);
    // Elevators are rare; if this ever dominated, the placement arithmetic would be wrong.
    expect(elevators).toBeLessThan(adjacent / 10);
  });
});

describe('picking a zone', () => {
  it('gives the same one for the same seed', () => {
    const a = pickLayout(seeded(7));
    const b = pickLayout(seeded(7));
    expect(a.area).toBe(b.area);
    expect(a.placements.map((p) => p.room.id)).toEqual(b.placements.map((p) => p.room.id));
  });

  it('gives different ones over many seeds', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 40; s += 1) {
      const zone = pickLayout(seeded(s * 7919));
      seen.add(`${zone.area}:${zone.placements.map((p) => p.room.id).join(',')}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('always hands back a zone with rooms in it', () => {
    for (let s = 1; s <= 40; s += 1) {
      expect(pickLayout(seeded(s * 7919)).placements.length).toBeGreaterThan(0);
    }
  });
});

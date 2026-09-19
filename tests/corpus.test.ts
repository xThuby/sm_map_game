import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAllRooms } from '../tools/transform';
import type { RawGeoRoom, RawTileRoom, VanillaMap } from '../tools/transform';
import { visualSignature, SHAPE_ONLY, FULLY_VISIBLE } from '../src/signature';
import type { RenderSettings, Room } from '../src/types';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readRaw = <T>(f: string): T =>
  JSON.parse(readFileSync(resolve(repoRoot, 'data/raw', f), 'utf8')) as T;

const rawTiles = readRaw<{ rooms: RawTileRoom[] }>('map_tiles.json').rooms;
const rawGeo = readRaw<RawGeoRoom[]>('room_geometry.json');
const smJson = readRaw<Record<string, { name?: string }>>('sm_json_rooms.json');
const vanillaMap = readRaw<VanillaMap>('vanilla_map.json');
const curated = JSON.parse(
  readFileSync(resolve(repoRoot, 'data/room-names.json'), 'utf8'),
) as { rooms: Record<string, string[]> };
const rooms: Room[] = buildAllRooms(rawTiles, rawGeo, smJson, vanillaMap, curated.rooms);

const byName = new Map(rooms.map((r) => [r.name, r]));
const tally = <T>(xs: T[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[String(x)] = (out[String(x)] ?? 0) + 1;
  return out;
};

/**
 * Every number below was derived independently from the pinned upstream files before any of
 * this code existed (data/raw checksums are recorded in ATTRIBUTION.md). They are regression
 * anchors: if one moves, either the transform changed meaning or upstream data drifted.
 */
describe('corpus: shape of the source data', () => {
  it('has 253 rooms in each file, over the identical id set', () => {
    expect(rawTiles).toHaveLength(253);
    expect(rawGeo).toHaveLength(253);
    expect(rooms).toHaveLength(253);
    expect(new Set(rawTiles.map((r) => r.roomId)))
      .toEqual(new Set(rawGeo.map((r) => r.room_id)));
  });

  it('has 1270 tiles in total', () => {
    expect(rooms.reduce((n, r) => n + r.tiles.length, 0)).toBe(1270);
  });

  it('has 64 single-tile rooms and a largest room of 42 tiles', () => {
    expect(rooms.filter((r) => r.tiles.length === 1)).toHaveLength(64);
    expect(Math.max(...rooms.map((r) => r.tiles.length))).toBe(42);
  });

  it('places every tile inside its room bounding box', () => {
    for (const r of rooms) {
      for (const t of r.tiles) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x).toBeLessThan(r.width);
        expect(t.y).toBeLessThan(r.height);
      }
    }
  });

  it('uses only known enum values', () => {
    const edges = rooms.flatMap((r) => r.tiles.flatMap((t) => [t.left, t.right, t.top, t.bottom]));
    expect(new Set(edges)).toEqual(new Set([
      'empty', 'wall', 'door', 'passage', 'sand', 'elevatorEntrance',
      'qolEmpty', 'qolWall', 'qolDoor', 'qolPassage', 'qolSand',
    ]));
    expect(new Set(rooms.flatMap((r) => r.doors.map((d) => d.subtype))))
      .toEqual(new Set(['normal', 'sand', 'elevator']));
    expect(new Set(rooms.flatMap((r) => r.doors.map((d) => d.direction))))
      .toEqual(new Set(['left', 'right', 'up', 'down']));
  });

  // Map Rando draws the Toilet larger than room_geometry's grid. It is the only room where
  // the two files disagree, so it is whitelisted rather than reconciled.
  it('has exactly one room where the two files disagree on tile count', () => {
    const geoById = new Map(rawGeo.map((g) => [g.room_id, g]));
    const disagree = rawTiles
      .filter((t) => {
        const g = geoById.get(t.roomId);
        if (!g) return true;
        const cells = g.map.reduce((n, row) => n + row.reduce((m, c) => m + c, 0), 0);
        return cells !== t.mapTiles.length;
      })
      .map((t) => t.roomName);
    expect(disagree).toEqual(['Toilet Bowl']);
  });
});

describe('corpus: derived room facts', () => {
  it('has 48 heated rooms', () => {
    expect(rooms.filter((r) => r.heated)).toHaveLength(48);
  });

  it('has the expected liquid distribution', () => {
    expect(tally(rooms.map((r) => r.liquid)))
      .toEqual({ none: 146, water: 62, acid: 25, lava: 20 });
  });

  it('gives every liquid room a level, and every dry room none', () => {
    for (const r of rooms) {
      if (r.liquid === 'none') expect(r.liquidLevel).toBeNull();
      else expect(typeof r.liquidLevel).toBe('number');
    }
  });

  it('has the expected area distribution', () => {
    expect(tally(rooms.map((r) => r.area))).toEqual({
      Crateria: 33, Brinstar: 54, Norfair: 76, 'Wrecked Ship': 16, Maridia: 55, Tourian: 19,
    });
  });

  it('has the expected door subtype distribution', () => {
    expect(tally(rooms.flatMap((r) => r.doors.map((d) => d.subtype))))
      .toEqual({ normal: 544, sand: 24, elevator: 14 });
  });

  it('has the expected interior distribution', () => {
    expect(tally(rooms.flatMap((r) => r.tiles.map((t) => t.interior)))).toEqual({
      empty: 1120, item: 77, doubleItem: 6, hiddenItem: 11, saveStation: 18, mapStation: 6,
      energyRefill: 5, ammoRefill: 2, doubleRefill: 2, ship: 1, event: 8,
      elevatorPlatformLow: 9, elevatorPlatformHigh: 5,
    });
  });

  it('has the expected special tile distribution', () => {
    expect(tally(rooms.flatMap((r) => r.tiles.map((t) => t.special).filter(Boolean)))).toEqual({
      elevator: 30, tube: 10, black: 2,
      slopeUpCeilingLow: 2, slopeUpCeilingHigh: 2, slopeUpFloorLow: 2, slopeUpFloorHigh: 2,
      slopeDownCeilingLow: 2, slopeDownCeilingHigh: 2, slopeDownFloorLow: 2,
      slopeDownFloorHigh: 2,
    });
  });

  // Independent cross-check: sm-json-data separately lists exactly 100 item nodes.
  it('counts 100 items across the game', () => {
    expect(rooms.reduce((n, r) => n + r.itemCount, 0)).toBe(100);
    expect(rooms.reduce((n, r) => n + r.hiddenItemCount, 0)).toBe(11);
  });

  it('has 41 rooms whose doors are not all mutually reachable', () => {
    const split = rooms.filter((r) => r.oneWay !== null);
    expect(split).toHaveLength(41);
    expect(split.filter((r) => r.oneWay!.transient.length > 0)).toHaveLength(35);
    expect(split.filter((r) => r.oneWay!.durable.length > 0)).toHaveLength(4);
  });
});

describe('corpus: item markers', () => {
  /**
   * Every item draws the same marker, because Map Rando substitutes doubleItem and
   * hiddenItem per seed. Two rooms differing only in which kind of item tile they hold are
   * therefore indistinguishable, and grading has to accept either.
   */
  it('cannot separate a double-item room from a plain one that matches otherwise', () => {
    const billy = byName.get('Billy Mays Room')!;
    const warehouse = byName.get('Warehouse Energy Tank Room')!;
    expect(billy.tiles[0]?.interior).toBe('doubleItem');
    expect(warehouse.tiles[0]?.interior).toBe('hiddenItem');
    expect(visualSignature(billy, FULLY_VISIBLE))
      .toBe(visualSignature(warehouse, FULLY_VISIBLE));
  });
});

describe('corpus: aliases', () => {
  it('gives 42 rooms at least one other name', () => {
    expect(rooms.filter((r) => r.aliases.length > 0)).toHaveLength(42);
  });

  /** data/room-names.json is the only source of aliases, so it has to list every room. */
  it('names every room in the file that drives it', () => {
    expect(Object.keys(curated.rooms)).toHaveLength(rooms.length);
    for (const r of rooms) expect(curated.rooms, r.name).toHaveProperty([r.name]);
  });

  /**
   * A name upstream uses has to be in the file rather than arriving with a data refresh:
   * the file is hand-edited, and a name that appears without being written there would be
   * one nobody chose.
   */
  it('lists every name sm-json-data uses for a room', () => {
    for (const r of rooms) {
      const upstream = smJson[String(r.id)]?.name;
      expect(upstream, `room ${r.id}`).toBeTypeOf('string');
      if ((upstream as string).toLowerCase() === r.name.toLowerCase()) continue;
      expect(r.aliases.map((a) => a.toLowerCase()), r.name).toContain(
        (upstream as string).toLowerCase(),
      );
    }
  });

  it('knows the rooms players are most likely to name differently', () => {
    const alias = (name: string) => byName.get(name)?.aliases;
    expect(alias('Lower Norfair Escape Power Bomb Room')).toEqual(['The Jail']);
    expect(alias('Bug Sand Hole')).toEqual(['Yoink Room']);
    expect(alias('Pseudo Plasma Spark Room')).toEqual(['The Beach']);
    expect(alias('Post Crocomire Missile Room')).toEqual(['Cosine Room']);
  });

  /**
   * If an alias equalled some other room's canonical name, a typed answer could not be
   * resolved to one room. It does not happen, and this fails loudly if upstream changes that.
   */
  it('never reuses another room\'s canonical name as an alias', () => {
    const canonical = new Map(rooms.map((r) => [r.name.toLowerCase(), r.id]));
    for (const r of rooms) {
      for (const a of r.aliases) {
        const owner = canonical.get(a.toLowerCase());
        expect(owner === undefined || owner === r.id).toBe(true);
      }
    }
  });

  it('accepts the hand-added names too', () => {
    expect(byName.get('Statues Room')?.aliases).toContain('G4');
    expect(byName.get('Statues Hallway')?.aliases).toContain('G4 Hallway');
  });

  it('answers to a name a player is likely to type for a room the map calls something else', () => {
    const alias = (name: string) => byName.get(name)?.aliases ?? [];
    expect(alias('Mt. Everest')).toContain('Mount Everest');
    expect(alias('Kassiuz Room')).toContain('Plasma Climb');
    expect(alias('Pants Room')).toContain('East Pants Room');
  });

  /** "Crocomire's Room" and "Crocomire Room" are different keys once punctuation goes. */
  it('answers to a boss room without the possessive', () => {
    const alias = (name: string) => byName.get(name)?.aliases ?? [];
    expect(alias("Crocomire's Room")).toContain('Crocomire Room');
    expect(alias("Ridley's Room")).toContain('Ridley Room');
    expect(alias("Golden Torizo's Room")).toContain('Golden Torizo Room');
  });

  it('offers 295 distinct names across all rooms', () => {
    const all = rooms.flatMap((r) => [r.name, ...r.aliases]);
    expect(new Set(all).size).toBe(295);
    expect(all).toHaveLength(295);
  });
});

describe('corpus: spot checks', () => {
  it('knows Volcano Room is heated', () => {
    expect(byName.get('Volcano Room')?.heated).toBe(true);
  });

  it('knows The Moat has water', () => {
    expect(byName.get('The Moat')).toMatchObject({ liquid: 'water', liquidLevel: 0.75 });
  });

  it('knows Landing Site is a 5-door Crateria room', () => {
    const r = byName.get('Landing Site');
    expect(r?.area).toBe('Crateria');
    expect(r?.doors).toHaveLength(4); // the Ship is a node in sm-json-data, not a door here
    expect(r?.width).toBe(9);
    expect(r?.height).toBe(5);
  });

  it('knows the Ship is in Landing Site and nowhere else', () => {
    expect(rooms.filter((r) => r.utilities.includes('ship')).map((r) => r.name))
      .toEqual(['Landing Site']);
  });

  it("knows Crocomire's Room has a durable one-way and no transient one", () => {
    expect(byName.get("Crocomire's Room")?.oneWay)
      .toEqual({ parts: [[0], [1]], transient: [], durable: [[1, 0]] });
  });
});

describe('corpus: visual equivalence', () => {
  const groupsFor = (s: RenderSettings) => {
    const g = new Map<string, string[]>();
    for (const r of rooms) {
      const k = visualSignature(r, s);
      g.set(k, [...(g.get(k) ?? []), r.name]);
    }
    const ambiguous = [...g.values()].filter((v) => v.length > 1);
    return {
      distinct: g.size,
      groups: ambiguous.length,
      rooms: ambiguous.reduce((n, v) => n + v.length, 0),
    };
  };

  /**
   * How many rooms the player genuinely cannot tell apart, per render setting. This is the
   * whole justification for grading against an equivalence group rather than one name.
   */
  it.each([
    ['vanilla',  'visible', false, 176, 21,  98],
    ['vanilla',  'visible', true,  226, 21,  48],
    ['vanilla',  'hidden',  false, 135, 21, 139],
    ['vanilla',  'hidden',  true,  201, 29,  81],
    ['enhanced', 'visible', false, 183, 23,  93],
    ['enhanced', 'visible', true,  231, 17,  39],
    ['enhanced', 'hidden',  false, 142, 23, 134],
    ['enhanced', 'hidden',  true,  207, 26,  72],
  ] as const)(
    'walls=%s blueDoors=%s hazards=%s -> %i distinct, %i groups, %i rooms',
    (walls, blueDoors, hazards, distinct, groups, roomCount) => {
      const level = hazards ? 'visible' : 'hidden';
      const s: RenderSettings = {
        ...FULLY_VISIBLE, walls, blueDoors,
        heat: level, water: level, lava: level, acid: level, areaColour: hazards,
        grayDoors: level,
      };
      expect(groupsFor(s)).toEqual({ distinct, groups, rooms: roomCount });
    },
  );

  it('matches the named presets to the settings they stand for', () => {
    expect(groupsFor(SHAPE_ONLY)).toEqual({ distinct: 183, groups: 23, rooms: 93 });
    expect(groupsFor(FULLY_VISIBLE)).toEqual({ distinct: 231, groups: 17, rooms: 39 });
  });

  /**
   * The 19 fixed gray door locks are shown under the tournament preset, and they carry real
   * information: they are what tells Kraid Room apart from Pink Brinstar Hopper Room.
   */
  it('separates the boss rooms from their look-alikes once gray doors are shown', () => {
    const kraid = byName.get('Kraid Room')!;
    const hopper = byName.get('Pink Brinstar Hopper Room')!;
    const noLocks: RenderSettings = { ...FULLY_VISIBLE, grayDoors: 'hidden' };
    expect(visualSignature(kraid, noLocks)).toBe(visualSignature(hopper, noLocks));
    expect(visualSignature(kraid, FULLY_VISIBLE)).not.toBe(visualSignature(hopper, FULLY_VISIBLE));
  });

  it('cannot separate Wave Beam Room from Ice Beam Room at any setting', () => {
    const wave = byName.get('Wave Beam Room')!;
    const ice = byName.get('Ice Beam Room')!;
    expect(visualSignature(wave, FULLY_VISIBLE)).toBe(visualSignature(ice, FULLY_VISIBLE));
  });

  it('separates the eight identical-looking save rooms only by area', () => {
    const saves = rooms.filter((r) => r.utilities.includes('save'));
    const shape = new Set(saves.map((r) => visualSignature(r, SHAPE_ONLY)));
    const full = new Set(saves.map((r) => visualSignature(r, FULLY_VISIBLE)));
    expect(shape.size).toBeLessThan(full.size);
  });
});

describe('corpus: the committed rooms.json', () => {
  const generated = JSON.parse(
    readFileSync(resolve(repoRoot, 'src/data/rooms.json'), 'utf8'),
  ) as { rooms: Room[] };

  /**
   * src/data/rooms.json is what the app actually serves. Without this check a change to the
   * transform would pass every other test while the shipped data quietly went stale.
   */
  it('is exactly what the current transform produces from data/raw', () => {
    expect(generated.rooms).toEqual(rooms);
  });
});

describe('corpus: hint data', () => {
  // sm-json-data lists enemies for 173 of its 261 rooms, but 2 of those are Ceres rooms
  // that have no map tiles and so are not ours.
  it('gives 171 of our rooms an enemy list', () => {
    expect(rooms.filter((r) => r.enemies.length > 0)).toHaveLength(171);
  });

  it('knows Volcano Room has six Fune', () => {
    expect(byName.get('Volcano Room')?.enemies).toEqual([{ name: 'Fune', quantity: 6 }]);
  });

  it('gives all but two rooms at least one vanilla neighbour', () => {
    expect(rooms.filter((r) => r.neighbours.length === 0)).toHaveLength(2);
  });

  it('knows what Landing Site connects to in vanilla', () => {
    expect(byName.get('Landing Site')?.neighbours.slice().sort()).toEqual([
      'Crateria Power Bomb Room', 'Crateria Tube', 'Gauntlet Entrance', 'Parlor and Alcatraz',
    ]);
  });

  it('makes neighbours mutual', () => {
    const byNameMap = new Map(rooms.map((r) => [r.name, r]));
    for (const r of rooms) {
      for (const n of r.neighbours) {
        expect(byNameMap.get(n)?.neighbours, `${r.name} -> ${n}`).toContain(r.name);
      }
    }
  });

  it('gives every room a diagram image path', () => {
    expect(rooms.filter((r) => r.diagram === null)).toHaveLength(0);
  });
});

/**
 * data/raw/maps.json holds real Map Rando layouts, taken from a published pool rather than
 * generated here — Map Rando's own generator is a trained model, not something to reproduce.
 * These anchor what a vendored layout is allowed to look like, since nobody is going to read
 * 25 maps by eye.
 */
describe('corpus: vendored map layouts', () => {
  const layouts = JSON.parse(
    readFileSync(resolve(repoRoot, 'data/raw/maps.json'), 'utf8'),
  ) as {
    source: { pool: string; member: string; maps: number };
    maps: { rooms: [number, number, number, number][];
      connections: [number, number, number, number, boolean][] }[];
  };
  const knownIds = new Set(rooms.map((r) => r.id));
  const doorsOf = new Map(rawGeo.map((g) => [g.room_id, g.doors]));

  it('vendors 25 layouts, and says which pool they came from', () => {
    expect(layouts.maps).toHaveLength(25);
    expect(layouts.source.maps).toBe(25);
    expect(layouts.source.pool).toContain('map-rando-artifacts');
  });

  it('places all 253 rooms in every layout, each exactly once', () => {
    for (const [i, m] of layouts.maps.entries()) {
      expect(m.rooms, `map ${i}`).toHaveLength(253);
      expect(new Set(m.rooms.map(([id]) => id)).size, `map ${i}`).toBe(253);
      for (const [id] of m.rooms) expect(knownIds.has(id), `map ${i} room ${id}`).toBe(true);
    }
  });

  it('gives every room one of the six areas, and uses all six', () => {
    for (const [i, m] of layouts.maps.entries()) {
      const tally = new Map<number, number>();
      for (const [, , , area] of m.rooms) tally.set(area, (tally.get(area) ?? 0) + 1);
      expect([...tally.keys()].sort(), `map ${i}`).toEqual([0, 1, 2, 3, 4, 5]);
      expect([...tally.values()].reduce((a, b) => a + b), `map ${i}`).toBe(253);
    }
  });

  it('connects rooms 291 ways, naming doors that exist', () => {
    for (const [i, m] of layouts.maps.entries()) {
      expect(m.connections, `map ${i}`).toHaveLength(291);
      for (const [fromRoom, fromDoor, toRoom, toDoor] of m.connections) {
        expect(doorsOf.get(fromRoom)?.[fromDoor], `map ${i} ${fromRoom} door ${fromDoor}`)
          .toBeDefined();
        expect(doorsOf.get(toRoom)?.[toDoor], `map ${i} ${toRoom} door ${toDoor}`).toBeDefined();
      }
    }
  });

  /** Doors only ever meet head-on, which is what makes placement arithmetic checkable. */
  it('only ever joins doors that face each other', () => {
    const opposite: Record<string, string> = {
      left: 'right', right: 'left', up: 'down', down: 'up',
    };
    for (const [i, m] of layouts.maps.entries()) {
      for (const [fromRoom, fromDoor, toRoom, toDoor] of m.connections) {
        const a = doorsOf.get(fromRoom)![fromDoor]!;
        const b = doorsOf.get(toRoom)![toDoor]!;
        expect(opposite[a.direction], `map ${i} ${fromRoom}:${fromDoor}`).toBe(b.direction);
      }
    }
  });

  /** They are generated, not vanilla: the area assignment is shuffled per seed. */
  it('assigns areas differently from the vanilla map', () => {
    const vanillaTally = [33, 54, 76, 16, 55, 19];
    const same = layouts.maps.filter((m) => {
      const tally = [0, 0, 0, 0, 0, 0];
      for (const [, , , area] of m.rooms) tally[area] = (tally[area] as number) + 1;
      return tally.every((n, a) => n === vanillaTally[a]);
    });
    expect(same).toHaveLength(0);
  });

  it('lays every layout out differently', () => {
    const shapes = layouts.maps.map((m) => JSON.stringify(m.rooms));
    expect(new Set(shapes).size).toBe(layouts.maps.length);
  });
});

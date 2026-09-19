import { describe, it, expect } from 'vitest';
import {
  areaFromIndex, boundingBox, normalizeTile, deriveItemCount, deriveHasHiddenItem,
  deriveUtilities, deriveHasElevator, deriveOneWay, buildRoom,
} from './transform';
import type { RawGeoRoom, RawMapTile, RawTileRoom } from './transform';
import type { Tile } from '../src/types';

const tile = (over: Partial<Tile> = {}): Tile => ({
  x: 0, y: 0, left: 'empty', right: 'empty', top: 'empty', bottom: 'empty',
  interior: 'empty', ...over,
});

const rawGeo = (over: Partial<RawGeoRoom> = {}): RawGeoRoom => ({
  room_id: 7, name: 'The Moat', area: 0, map: [[1, 1], [1, 1]],
  doors: [{ direction: 'left', x: 0, y: 0, subtype: 'normal' }],
  items: [], parts: [[0]], durable_part_connections: [],
  transient_part_connections: [], heated: false, ...over,
});

const rawTiles = (over: Partial<RawTileRoom> = {}): RawTileRoom => ({
  roomId: 7, roomName: 'The Moat',
  mapTiles: [{ coords: [0, 0], left: 'wall', right: 'door' }], ...over,
});

describe('areaFromIndex', () => {
  it('maps the six area indices in ROM order', () => {
    expect([0, 1, 2, 3, 4, 5].map(areaFromIndex)).toEqual([
      'Crateria', 'Brinstar', 'Norfair', 'Wrecked Ship', 'Maridia', 'Tourian',
    ]);
  });

  it('throws on an index outside that range', () => {
    expect(() => areaFromIndex(6)).toThrow();
    expect(() => areaFromIndex(-1)).toThrow();
  });
});

describe('normalizeTile', () => {
  it('flattens coords into x and y', () => {
    expect(normalizeTile({ coords: [3, 5] })).toMatchObject({ x: 3, y: 5 });
  });

  it('defaults every absent edge to empty and the interior to empty', () => {
    expect(normalizeTile({ coords: [0, 0] })).toEqual({
      x: 0, y: 0, left: 'empty', right: 'empty', top: 'empty', bottom: 'empty',
      interior: 'empty',
    });
  });

  it('preserves raw qol edge values rather than collapsing them', () => {
    const raw: RawMapTile = { coords: [0, 0], left: 'qolPassage', top: 'qolEmpty' };
    expect(normalizeTile(raw)).toMatchObject({ left: 'qolPassage', top: 'qolEmpty' });
  });

  it('carries specialType through only when present', () => {
    expect(normalizeTile({ coords: [0, 0], specialType: 'elevator' }).special).toBe('elevator');
    expect(normalizeTile({ coords: [0, 0] }).special).toBeUndefined();
  });

  it('rejects an unknown edge value', () => {
    expect(() => normalizeTile({ coords: [0, 0], left: 'trapdoor' } as unknown as RawMapTile))
      .toThrow(/trapdoor/);
  });
});

describe('boundingBox', () => {
  it('measures a non-rectangular tile set by its extent', () => {
    // An L: (0,0) (0,1) (1,1) (2,1) -> 3 wide, 2 tall
    expect(boundingBox([tile(), tile({ y: 1 }), tile({ x: 1, y: 1 }), tile({ x: 2, y: 1 })]))
      .toEqual({ width: 3, height: 2 });
  });

  it('measures a single tile as 1x1', () => {
    expect(boundingBox([tile()])).toEqual({ width: 1, height: 1 });
  });

  it('throws on an empty tile set', () => {
    expect(() => boundingBox([])).toThrow();
  });
});

describe('deriveItemCount', () => {
  it('counts a plain item and a hidden item as one each, a double item as two', () => {
    expect(deriveItemCount([tile({ interior: 'item' })])).toBe(1);
    expect(deriveItemCount([tile({ interior: 'hiddenItem' })])).toBe(1);
    expect(deriveItemCount([tile({ interior: 'doubleItem' })])).toBe(2);
  });

  it('ignores non-item interiors', () => {
    expect(deriveItemCount([tile({ interior: 'saveStation' }), tile({ interior: 'empty' })])).toBe(0);
  });

  it('sums across tiles', () => {
    expect(deriveItemCount([
      tile({ interior: 'item' }), tile({ interior: 'doubleItem' }), tile({ interior: 'hiddenItem' }),
    ])).toBe(4);
  });
});

describe('deriveHasHiddenItem', () => {
  it('is true only when a hiddenItem tile is present', () => {
    expect(deriveHasHiddenItem([tile({ interior: 'hiddenItem' })])).toBe(true);
    expect(deriveHasHiddenItem([tile({ interior: 'item' })])).toBe(false);
  });
});

describe('deriveUtilities', () => {
  it('extracts each utility interior', () => {
    expect(deriveUtilities([
      tile({ interior: 'saveStation' }), tile({ interior: 'mapStation' }),
      tile({ interior: 'energyRefill' }), tile({ interior: 'ammoRefill' }),
      tile({ interior: 'doubleRefill' }), tile({ interior: 'ship' }),
    ])).toEqual(['save', 'map', 'energyRefill', 'ammoRefill', 'doubleRefill', 'ship']);
  });

  it('returns an empty array when the room has none', () => {
    expect(deriveUtilities([tile(), tile({ interior: 'item' })])).toEqual([]);
  });

  it('de-duplicates a utility appearing on more than one tile', () => {
    expect(deriveUtilities([tile({ interior: 'saveStation' }), tile({ interior: 'saveStation' })]))
      .toEqual(['save']);
  });
});

describe('deriveHasElevator', () => {
  it('is true when any tile carries the elevator special type', () => {
    expect(deriveHasElevator([tile({ special: 'elevator' })])).toBe(true);
    expect(deriveHasElevator([tile({ special: 'tube' })])).toBe(false);
    expect(deriveHasElevator([tile()])).toBe(false);
  });
});

describe('deriveOneWay', () => {
  it('is null for a room whose doors are all mutually reachable', () => {
    expect(deriveOneWay(rawGeo({ parts: [[0, 1]] }))).toBeNull();
  });

  it('reports parts and both kinds of connection for a split room', () => {
    expect(deriveOneWay(rawGeo({
      parts: [[1], [0, 2, 3]],
      transient_part_connections: [[0, 1]],
      durable_part_connections: [],
    }))).toEqual({ parts: [[1], [0, 2, 3]], transient: [[0, 1]], durable: [] });
  });
});

describe('buildRoom', () => {
  it('joins the tile record and the geometry record into one room', () => {
    const r = buildRoom(rawTiles(), rawGeo());
    expect(r).toMatchObject({
      id: 7, name: 'The Moat', area: 'Crateria', width: 1, height: 1,
      heated: false, liquid: 'none', liquidLevel: null, itemCount: 0, oneWay: null,
    });
    expect(r.doors).toEqual([{ direction: 'left', x: 0, y: 0, subtype: 'normal' }]);
  });

  it('defaults absent heat and liquid to false and none', () => {
    const r = buildRoom(rawTiles(), rawGeo());
    expect(r.heated).toBe(false);
    expect(r.liquid).toBe('none');
  });

  it('carries heat, liquid type and liquid level through when present', () => {
    const r = buildRoom(
      rawTiles({ heated: true, liquidType: 'lava', liquidLevel: 0.625 }), rawGeo(),
    );
    expect(r).toMatchObject({ heated: true, liquid: 'lava', liquidLevel: 0.625 });
  });

  it('throws when the two records are for different rooms', () => {
    expect(() => buildRoom(rawTiles({ roomId: 7 }), rawGeo({ room_id: 8 }))).toThrow(/7.*8|8.*7/);
  });

  it('throws when the two records disagree on the room name', () => {
    expect(() => buildRoom(rawTiles({ roomName: 'The Moat' }), rawGeo({ name: 'Landing Site' })))
      .toThrow();
  });

  // room_geometry.json writes "Parlor And Alcatraz"; every other source writes "and".
  it('tolerates a difference of casing alone', () => {
    expect(() => buildRoom(
      rawTiles({ roomName: 'Parlor and Alcatraz' }), rawGeo({ name: 'Parlor And Alcatraz' }),
    )).not.toThrow();
  });

  it('takes the canonical name from map_tiles, which agrees with sm-json-data', () => {
    const r = buildRoom(
      rawTiles({ roomName: 'Parlor and Alcatraz' }), rawGeo({ name: 'Parlor And Alcatraz' }),
    );
    expect(r.name).toBe('Parlor and Alcatraz');
  });

  it('allows the one room the upstream files genuinely name differently', () => {
    const r = buildRoom(
      rawTiles({ roomId: 321, roomName: 'Toilet Bowl' }),
      rawGeo({ room_id: 321, name: 'Toilet' }),
    );
    expect(r.name).toBe('Toilet Bowl');
  });
});

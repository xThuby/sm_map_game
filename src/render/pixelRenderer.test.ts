import { describe, it, expect } from 'vitest';
import { renderTileBitmap, renderRoomBitmap, PALETTE_INDICES } from './pixelRenderer';
import { grayDoorSide } from './grayDoors';
import { TOURNAMENT_SETTINGS } from './renderer';
import {
  PALETTE, NEUTRAL_PALETTE, AREAS_WITH_HEATED_PALETTE, paletteFor, luminance,
  GRID_COLOUR, GRID_DOTS, gridBackgroundUrl,
} from './palette';
import type { Rgb } from './palette';
import { FULLY_VISIBLE, SHAPE_ONLY } from '../signature';
import { loadRooms } from '../rooms';
import type { Interior, RenderSettings, Room, Tile } from '../types';

const tile = (over: Partial<Tile> = {}): Tile => ({
  x: 0, y: 0, left: 'empty', right: 'empty', top: 'empty', bottom: 'empty',
  interior: 'empty', ...over,
});

const room = (over: Partial<Room> = {}): Room => ({
  id: 1, name: 'Test Room', aliases: [], area: 'Crateria', width: 1, height: 1,
  tiles: [tile()], heated: false, liquid: 'none', liquidLevel: null,
  doors: [], itemCount: 0, hasHiddenItem: false, utilities: [], hasElevator: false,
  oneWay: null, enemies: [], neighbours: [], diagram: null, ...over,
});

const settings = (over: Partial<RenderSettings> = {}): RenderSettings =>
  ({ ...FULLY_VISIBLE, ...over });

const bitmapOf = (t: Partial<Tile>, r: Partial<Room> = {}, s: Partial<RenderSettings> = {}) => {
  const theTile = tile(t);
  return renderTileBitmap(room({ ...r, tiles: [theTile] }), theTile, settings(s));
};

/** The column of a left edge is 0; the row of a top edge is 0. */
const col = (b: number[][], c: number) => b.map((row) => row[c]);

describe('renderTileBitmap: shape', () => {
  it('is 8 rows of 8 pixels', () => {
    const b = bitmapOf({});
    expect(b).toHaveLength(8);
    for (const row of b) expect(row).toHaveLength(8);
  });

  it('fills an ordinary tile with the room interior colour', () => {
    expect(bitmapOf({})).toEqual(Array.from({ length: 8 }, () => Array(8).fill(1)));
  });

  it('fills a heated tile with the heated interior colour, but only when heat is shown', () => {
    expect(bitmapOf({}, { heated: true })[0]?.[0]).toBe(2);
    expect(bitmapOf({}, { heated: true }, { heat: 'hidden' })[0]?.[0]).toBe(1);
  });
});

describe('renderTileBitmap: edges', () => {
  // draw_edge fills pixel i of an 8-pixel ring; a wall fills all eight.
  it('draws a wall along the whole side', () => {
    expect(col(bitmapOf({ left: 'wall' }), 0)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('leaves an empty edge as interior', () => {
    expect(col(bitmapOf({ left: 'empty' }), 0)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('draws a door as the side minus its middle two pixels', () => {
    expect(col(bitmapOf({ left: 'door' }), 0)).toEqual([3, 3, 3, 1, 1, 3, 3, 3]);
  });

  it('draws a passage as two pixels at each end', () => {
    expect(col(bitmapOf({ left: 'passage' }), 0)).toEqual([3, 3, 1, 1, 1, 1, 3, 3]);
  });

  it('fills a door solid when blue doors are hidden', () => {
    expect(col(bitmapOf({ left: 'door' }, {}, { blueDoors: 'hidden' }), 0))
      .toEqual(col(bitmapOf({ left: 'wall' }), 0));
  });

  it('follows the walls setting for qol variants', () => {
    expect(col(bitmapOf({ left: 'qolEmpty' }, {}, { walls: 'vanilla' }), 0))
      .toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(col(bitmapOf({ left: 'qolEmpty' }, {}, { walls: 'enhanced' }), 0))
      .toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('draws a plain passage as a solid wall in vanilla mode', () => {
    expect(col(bitmapOf({ left: 'passage' }, {}, { walls: 'vanilla' }), 0))
      .toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('draws an elevator entrance with stubs on the wall row and the air row', () => {
    const b = bitmapOf({ top: 'elevatorEntrance' });
    expect(b[0]).toEqual([3, 3, 1, 1, 1, 1, 3, 3]);
    expect(b[1]?.[0]).toBe(3);
    expect(b[1]?.[7]).toBe(3);
  });

  it('puts each side on its own ring of the tile', () => {
    const b = bitmapOf({ left: 'wall', right: 'wall', top: 'wall', bottom: 'wall' });
    expect(b[0]).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(b[7]).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(col(b, 0)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(col(b, 7)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(b[3]?.[3]).toBe(1);
  });
});

describe('renderTileBitmap: interiors', () => {
  it('draws an item as a two-by-two white dot in the centre', () => {
    const b = bitmapOf({ interior: 'item' });
    expect([b[3]?.[3], b[3]?.[4], b[4]?.[3], b[4]?.[4]]).toEqual([13, 13, 13, 13]);
    expect(b[2]?.[2]).toBe(1);
  });

  /**
   * render_tile panics on doubleItem and hiddenItem: Map Rando substitutes a marker per seed
   * from the item that landed there and the item_markers setting. Which tier that is cannot
   * be known without a seed, so every item gets the plain marker. Drawing the vanilla
   * diagonals instead would show players something no seed ever shows them.
   */
  it('draws a double item exactly as a plain one', () => {
    expect(bitmapOf({ interior: 'doubleItem' })).toEqual(bitmapOf({ interior: 'item' }));
  });

  it('draws a hidden item exactly as a plain one', () => {
    expect(bitmapOf({ interior: 'hiddenItem' })).toEqual(bitmapOf({ interior: 'item' }));
  });

  it('draws no diagonal anywhere in the game', () => {
    for (const room of loadRooms()) {
      for (const tile of room.tiles) {
        const b = renderTileBitmap(room, tile, FULLY_VISIBLE);
        // the vanilla double-item artwork put a marker pixel at 2,2; nothing else does
        expect(b[2]?.[2], `${room.name}`).not.toBe(13);
      }
    }
  });

  it('draws nothing for an empty interior or an event', () => {
    const plain = bitmapOf({});
    expect(bitmapOf({ interior: 'empty' })).toEqual(plain);
    expect(bitmapOf({ interior: 'event' })).toEqual(plain);
  });

  it('hides item markers when items are hidden, leaving a bare tile', () => {
    const itemsOff = { items: 'hidden' as const };
    for (const interior of ['item', 'doubleItem', 'hiddenItem'] as Interior[]) {
      expect(bitmapOf({ interior }, {}, itemsOff)).toEqual(bitmapOf({}, {}, itemsOff));
    }
  });

  /**
   * A station icon occupies the whole 8x8 including its own border, so render_tile skips
   * drawing the tile's edges entirely for these. Missing that would double-draw the border.
   */
  it('lets a station icon replace the tile edges rather than adding to them', () => {
    const withWalls = bitmapOf({ interior: 'saveStation', left: 'wall', right: 'door' });
    const withNone = bitmapOf({ interior: 'saveStation' });
    expect(withWalls).toEqual(withNone);
  });

  it('gives each station its own icon', () => {
    const stations: Interior[] = [
      'saveStation', 'mapStation', 'energyRefill', 'ammoRefill', 'doubleRefill',
    ];
    const seen = stations.map((interior) => JSON.stringify(bitmapOf({ interior })));
    expect(new Set(seen).size).toBe(stations.length);
  });

  it('draws an elevator platform as two wall-coloured pixels', () => {
    expect(bitmapOf({ interior: 'elevatorPlatformLow' })[5]?.slice(3, 5)).toEqual([3, 3]);
    expect(bitmapOf({ interior: 'elevatorPlatformHigh' })[2]?.slice(3, 5)).toEqual([3, 3]);
  });
});

describe('renderTileBitmap: liquid', () => {
  it('checkerboards water below the surface', () => {
    const r = { liquid: 'water' as const, liquidLevel: 0, height: 1 };
    const b = renderTileBitmap(room({ ...r, tiles: [tile()] }), tile(), settings());
    expect(b[4]?.[4]).toBe(5);
    expect(b[4]?.[5]).toBe(1);
  });

  it('fills lava solid below the surface', () => {
    const t = tile();
    const r = room({ liquid: 'lava', liquidLevel: 0, heated: true, tiles: [t] });
    expect(renderTileBitmap(r, t, settings())[7]).toEqual(Array(8).fill(1));
  });

  it('starts the fill at the surface row within the tile', () => {
    const t = tile();
    const r = room({ liquid: 'water', liquidLevel: 0.5, tiles: [t] });
    const b = renderTileBitmap(r, t, settings());
    expect(b[3]?.[3]).toBe(1);   // above the surface: dry
    expect(b[4]?.[4]).toBe(5);   // below it: water
  });

  it('leaves the tile dry when that liquid is hidden', () => {
    const t = tile();
    const r = room({ liquid: 'water', liquidLevel: 0, tiles: [t] });
    expect(renderTileBitmap(r, t, settings({ water: 'hidden' })))
      .toEqual(renderTileBitmap(room({ tiles: [t] }), t, settings()));
  });
});

describe('renderRoomBitmap', () => {
  it('is the room extent in tiles, eight pixels each', () => {
    const r = loadRooms().find((x) => x.name === 'Landing Site')!;
    const b = renderRoomBitmap(r, settings());
    expect(b).toHaveLength(r.height * 8);
    expect(b[0]).toHaveLength(r.width * 8);
  });

  it('leaves the gaps of a non-rectangular room as backdrop', () => {
    const r = room({ width: 2, height: 1, tiles: [tile({ x: 1 })] });
    const b = renderRoomBitmap(r, settings());
    expect(b[0]?.slice(0, 8)).toEqual(Array(8).fill(0));
    expect(b[0]?.[8]).toBe(1);
  });

  it('renders all 253 rooms using only known palette indices', () => {
    for (const r of loadRooms()) {
      for (const preset of [SHAPE_ONLY, FULLY_VISIBLE]) {
        for (const row of renderRoomBitmap(r, preset)) {
          for (const px of row) {
            expect(PALETTE_INDICES.has(px), `${r.name}: unexpected index ${px}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('palette', () => {
  /**
   * The palette was measured from Map Rando's own render of the vanilla map, and index 2
   * only appeared for Crateria, Norfair and Tourian. If a room ever produced it elsewhere,
   * that colour would be a guess rather than a measurement.
   */
  it('never needs the heated colour outside the three areas it was measured for', () => {
    for (const room of loadRooms()) {
      if (AREAS_WITH_HEATED_PALETTE.includes(room.area)) continue;
      for (const row of renderRoomBitmap(room, FULLY_VISIBLE)) {
        expect(row, `${room.name} (${room.area}) produced palette index 2`).not.toContain(2);
      }
    }
  });

  it('gives every area a colour for every index the renderer can emit', () => {
    for (const area of Object.keys(PALETTE) as (keyof typeof PALETTE)[]) {
      for (const index of PALETTE_INDICES) {
        expect(PALETTE[area][index], `${area} index ${index}`).toBeDefined();
      }
    }
  });

  it('paints room interiors in the area colour and walls white', () => {
    expect(PALETTE.Norfair[1]).toEqual([189, 0, 0]);
    expect(PALETTE.Norfair[3]).toEqual([255, 255, 255]);
  });

  it('falls back to a neutral palette when the area is not being shown', () => {
    expect(paletteFor('Norfair', true)).toBe(PALETTE.Norfair);
    expect(paletteFor('Norfair', false)).toBe(NEUTRAL_PALETTE);
  });
});

describe('gray doors', () => {
  const rooms = loadRooms();
  const find = (n: string) => rooms.find((r) => r.name === n)!;

  /**
   * Map Rando marks the 19 vanilla boss, miniboss and pirate doors gray from a hardcoded
   * list, and the Community Race Season 5 preset has gray_doors: Visible. They are static,
   * unlike the ammo and beam locks a seed assigns, so the trainer can show them.
   */
  it('marks the left door of Kraid Room gray', () => {
    const kraid = find('Kraid Room');
    const tile = kraid.tiles.find((t) => t.x === 0 && t.y === 1)!;
    const shown = renderTileBitmap(kraid, tile, settings({ grayDoors: 'visible' }));
    const hidden = renderTileBitmap(kraid, tile, settings({ grayDoors: 'hidden' }));
    expect(shown).not.toEqual(hidden);
    expect(shown.map((r) => r[0])).toContain(15);
  });

  it('leaves a room with no gray door untouched by the setting', () => {
    const moat = find('The Moat');
    const tile = moat.tiles[0]!;
    expect(renderTileBitmap(moat, tile, settings({ grayDoors: 'visible' })))
      .toEqual(renderTileBitmap(moat, tile, settings({ grayDoors: 'hidden' })));
  });

  it('marks exactly the 19 documented doors across the whole game', () => {
    let marked = 0;
    for (const room of rooms) {
      for (const tile of room.tiles) {
        for (const side of ['left', 'right', 'top', 'bottom'] as const) {
          if (grayDoorSide(room.id, tile.x, tile.y, side)) marked += 1;
        }
      }
    }
    expect(marked).toBe(19);
  });

  it('draws a gray door over the edge that was there', () => {
    const croc = find("Crocomire's Room");
    const tile = croc.tiles.find((t) => t.x === 3 && t.y === 0)!;
    const b = renderTileBitmap(croc, tile, settings({ grayDoors: 'visible' }));
    expect(b[0]).toContain(15);   // the top edge carries the lock
  });
});

describe('tournament settings', () => {
  it('matches the Community Race Season 5 preset', () => {
    expect(TOURNAMENT_SETTINGS).toMatchObject({
      blueDoors: 'visible', grayDoors: 'visible',
      heat: 'visible', water: 'visible', lava: 'visible', acid: 'visible',
      walls: 'enhanced', items: 'visible',
    });
  });
});

describe('the neutral palette', () => {
  /**
   * The room's body has to read against the backdrop. A dark fill also destroys the liquid
   * dithers, which alternate the fill colour with black.
   */
  it('fills rooms brightly enough to separate from the backdrop', () => {
    const fill = luminance(NEUTRAL_PALETTE[1] as Rgb);
    expect(fill).toBeGreaterThan(luminance(NEUTRAL_PALETTE[0] as Rgb) + 80);
    expect(fill).toBeGreaterThan(luminance(NEUTRAL_PALETTE[5] as Rgb) + 80);
  });

  it('keeps walls brighter than the fill, as the real palettes do', () => {
    expect(luminance(NEUTRAL_PALETTE[3] as Rgb))
      .toBeGreaterThan(luminance(NEUTRAL_PALETTE[1] as Rgb));
    expect(luminance(PALETTE.Norfair[3] as Rgb))
      .toBeGreaterThan(luminance(PALETTE.Norfair[1] as Rgb));
  });

  it('sits in the same brightness range as the real area colours', () => {
    const areas = Object.values(PALETTE).map((p) => luminance(p[1] as Rgb));
    const fill = luminance(NEUTRAL_PALETTE[1] as Rgb);
    expect(fill).toBeGreaterThan(Math.min(...areas) - 20);
    expect(fill).toBeLessThan(Math.max(...areas) + 40);
  });

  /** Heat reads as brightness here, as it does in every measured area palette. */
  it('makes a heated room clearly brighter than a cold one', () => {
    expect(luminance(NEUTRAL_PALETTE[2] as Rgb))
      .toBeGreaterThan(luminance(NEUTRAL_PALETTE[1] as Rgb) + 30);
    expect(luminance(NEUTRAL_PALETTE[2] as Rgb))
      .toBeLessThan(luminance(NEUTRAL_PALETTE[3] as Rgb) - 30);
  });

  it('keeps the lattice dim enough to stay behind the map', () => {
    expect(luminance(GRID_COLOUR)).toBeLessThan(luminance(NEUTRAL_PALETTE[1] as Rgb) - 25);
  });

  it('draws the lattice along the top and left of each tile', () => {
    expect(GRID_DOTS).toHaveLength(7);
    expect(gridBackgroundUrl()).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(decodeURIComponent(gridBackgroundUrl())).toContain('rgb(49,49,49)');
  });
});

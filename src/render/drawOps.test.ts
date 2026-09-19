import { describe, it, expect } from 'vitest';
import { computeDrawOps } from './drawOps';
import type { DrawOp, LineOp, FillOp, GlyphOp } from './drawOps';
import { SHAPE_ONLY, FULLY_VISIBLE } from '../signature';
import type { Interior, RawEdge, RenderSettings, Room, Tile } from '../types';

const TS = 8;
const settings = (over: Partial<RenderSettings> = {}): RenderSettings =>
  ({ ...FULLY_VISIBLE, tileSize: TS, ...over });

const tile = (over: Partial<Tile> = {}): Tile => ({
  x: 0, y: 0, left: 'empty', right: 'empty', top: 'empty', bottom: 'empty',
  interior: 'empty', ...over,
});

const room = (over: Partial<Room> = {}): Room => ({
  id: 1, name: 'Test Room', aliases: [], area: 'Crateria', width: 1, height: 1,
  tiles: [tile()], heated: false, liquid: 'none', liquidLevel: null,
  doors: [], itemCount: 0, hasHiddenItem: false, utilities: [], hasElevator: false,
  oneWay: null, ...over,
});

const lines = (ops: DrawOp[]): LineOp[] => ops.filter((o): o is LineOp => o.kind === 'line');
const fills = (ops: DrawOp[]): FillOp[] => ops.filter((o): o is FillOp => o.kind === 'fill');
const glyphs = (ops: DrawOp[]): GlyphOp[] => ops.filter((o): o is GlyphOp => o.kind === 'glyph');

/** The vertical extents of the segments drawn along a left or right edge. */
const vSpans = (ops: DrawOp[]) => lines(ops).map((l) => [l.y1, l.y2] as const);
/** The horizontal extents of the segments drawn along a top or bottom edge. */
const hSpans = (ops: DrawOp[]) => lines(ops).map((l) => [l.x1, l.x2] as const);

const withEdge = (edge: RawEdge, side: 'left' | 'top' | 'bottom' = 'left') =>
  computeDrawOps(room({ tiles: [tile({ [side]: edge })] }), settings());

describe('computeDrawOps: edges', () => {
  it('draws a wall as one segment spanning the whole tile side', () => {
    expect(vSpans(withEdge('wall'))).toEqual([[0, TS]]);
  });

  it('draws nothing at all for an empty edge', () => {
    expect(lines(withEdge('empty'))).toEqual([]);
  });

  // Transcribed from map_tiles.rs::draw_edge, which fills pixels 0-2 and 5-7 of eight.
  it('draws a door as two segments with a centred gap of a quarter', () => {
    expect(vSpans(withEdge('door'))).toEqual([[0, TS * 0.375], [TS * 0.625, TS]]);
  });

  it('draws a passage as two shorter stubs with a centred gap of a half', () => {
    expect(vSpans(withEdge('passage'))).toEqual([[0, TS * 0.25], [TS * 0.75, TS]]);
  });

  it('draws an elevator entrance as corner stubs', () => {
    expect(vSpans(withEdge('elevatorEntrance'))).toEqual([[0, TS * 0.25], [TS * 0.75, TS]]);
  });

  /**
   * Map Rando paints sand exactly as a door on a top edge and as a passage on a bottom one,
   * so the trainer does too: showing a distinction the real map screen does not make would
   * hand the player information they will not have in a seed.
   */
  it('paints sand as a door on top and as a passage on the bottom', () => {
    expect(hSpans(withEdge('sand', 'top'))).toEqual(hSpans(withEdge('door', 'top')));
    expect(hSpans(withEdge('sand', 'bottom'))).toEqual(hSpans(withEdge('passage', 'bottom')));
  });

  it('places each side along its own boundary of the tile', () => {
    const all = computeDrawOps(
      room({ tiles: [tile({ left: 'wall', right: 'wall', top: 'wall', bottom: 'wall' })] }),
      settings(),
    );
    expect(lines(all)).toHaveLength(4);
    expect(lines(all).map((l) => [l.x1, l.y1, l.x2, l.y2])).toEqual([
      [0, 0, 0, TS],          // left
      [TS, 0, TS, TS],        // right
      [0, 0, TS, 0],          // top
      [0, TS, TS, TS],        // bottom
    ]);
  });

  it('offsets edges by the tile position', () => {
    const r = room({ width: 2, height: 2, tiles: [tile({ x: 1, y: 1, left: 'wall' })] });
    expect(lines(computeDrawOps(r, settings())).map((l) => [l.x1, l.y1, l.x2, l.y2]))
      .toEqual([[TS, TS, TS, 2 * TS]]);
  });

  it('fills a door solid when blue doors are hidden, matching a wall exactly', () => {
    const hidden = settings({ blueDoors: 'hidden' });
    const asDoor = computeDrawOps(room({ tiles: [tile({ left: 'door' })] }), hidden);
    const asWall = computeDrawOps(room({ tiles: [tile({ left: 'wall' })] }), hidden);
    expect(lines(asDoor)).toEqual(lines(asWall));
  });

  it('follows the walls setting for the qol variants', () => {
    const vanilla = settings({ walls: 'vanilla' });
    const enhanced = settings({ walls: 'enhanced' });
    const qolEmpty = (s: RenderSettings) =>
      lines(computeDrawOps(room({ tiles: [tile({ left: 'qolEmpty' })] }), s));
    expect(qolEmpty(vanilla)).toHaveLength(1);
    expect(qolEmpty(enhanced)).toHaveLength(0);
  });
});

describe('computeDrawOps: hazards', () => {
  it('paints a heated tile with the heat background only when heat is shown', () => {
    const hot = room({ heated: true });
    expect(fills(computeDrawOps(hot, settings())).map((f) => f.paint)).toContain('heat');
    expect(fills(computeDrawOps(hot, settings({ heat: 'hidden' }))).map((f) => f.paint))
      .not.toContain('heat');
  });

  it('paints a cold room with a plain background whatever the heat setting', () => {
    expect(fills(computeDrawOps(room(), settings())).map((f) => f.paint)).toEqual(['background']);
  });

  /**
   * liquidLevel is the row the surface sits on, measured from the top of the room: rows above
   * it are dry, rows below are full, and exactly one row is partly filled. Taken from
   * maprando-game's per-tile liquid assignment.
   */
  it('fills the row the surface sits on from the surface downwards', () => {
    const r = room({
      width: 1, height: 3, liquid: 'water', liquidLevel: 1.25,
      tiles: [tile({ y: 0 }), tile({ y: 1 }), tile({ y: 2 })],
    });
    const water = fills(computeDrawOps(r, settings())).filter((f) => f.paint === 'water');
    expect(water.map((f) => [f.y, f.h])).toEqual([
      [TS + TS * 0.25, TS * 0.75], // row 1: surface a quarter of the way down
      [2 * TS, TS],                // row 2: submerged
    ]);
  });

  it('leaves a room dry when that liquid is hidden, and only that liquid', () => {
    const wet = room({ liquid: 'water', liquidLevel: 0 });
    expect(fills(computeDrawOps(wet, settings({ water: 'hidden' }))).map((f) => f.paint))
      .not.toContain('water');
    expect(fills(computeDrawOps(wet, settings({ lava: 'hidden' }))).map((f) => f.paint))
      .toContain('water');
  });

  /**
   * On the real map screen it is the room outline that is tinted by area, not the dark
   * interior, so the area has to reach the line ops or the setting would barely show.
   */
  it('carries the area on the background and the walls only when area colour is on', () => {
    const walled = room({ tiles: [tile({ left: 'wall' })] });
    const on = computeDrawOps(walled, settings());
    expect(fills(on)[0]?.area).toBe('Crateria');
    expect(lines(on)[0]?.area).toBe('Crateria');

    const off = computeDrawOps(walled, settings({ areaColour: false }));
    expect(fills(off)[0]?.area).toBeUndefined();
    expect(lines(off)[0]?.area).toBeUndefined();
  });
});

describe('computeDrawOps: interiors', () => {
  const glyphFor = (interior: Interior, s = settings()) =>
    glyphs(computeDrawOps(room({ tiles: [tile({ interior })] }), s)).map((g) => g.glyph);

  it('gives every drawn interior its own glyph', () => {
    const drawn: Interior[] = [
      'item', 'doubleItem', 'hiddenItem', 'saveStation', 'mapStation',
      'energyRefill', 'ammoRefill', 'doubleRefill', 'ship',
    ];
    const seen = drawn.map((i) => glyphFor(i)[0]);
    expect(seen.every((g) => g !== undefined)).toBe(true);
    expect(new Set(seen).size).toBe(drawn.length);
  });

  it('draws nothing for an empty interior, nor for an event', () => {
    expect(glyphFor('empty')).toEqual([]);
    expect(glyphFor('event')).toEqual([]);
  });

  it('hides item markers when items are hidden, and leaves utilities alone', () => {
    const itemsOff = settings({ items: 'hidden' });
    expect(glyphFor('item', itemsOff)).toEqual([]);
    expect(glyphFor('hiddenItem', itemsOff)).toEqual([]);
    expect(glyphFor('doubleItem', itemsOff)).toEqual([]);
    expect(glyphFor('saveStation', itemsOff)).toHaveLength(1);
  });

  it('centres a glyph in its tile', () => {
    const r = room({ width: 2, height: 2, tiles: [tile({ x: 1, y: 1, interior: 'item' })] });
    const g = glyphs(computeDrawOps(r, settings()))[0];
    expect([g?.x, g?.y]).toEqual([TS * 1.5, TS * 1.5]);
  });

  it('marks elevator and tube tiles', () => {
    const marks = (special: 'elevator' | 'tube') =>
      glyphs(computeDrawOps(room({ tiles: [tile({ special })] }), settings())).map((g) => g.glyph);
    expect(marks('elevator')).toContain('elevator');
    expect(marks('tube')).toContain('tube');
  });
});

describe('computeDrawOps: scaling', () => {
  it('scales every coordinate linearly with tile size', () => {
    const r = room({
      width: 2, height: 2, liquid: 'lava', liquidLevel: 0.5,
      tiles: [tile({ left: 'door', top: 'wall', interior: 'item' }), tile({ x: 1, y: 1 })],
    });
    const small = computeDrawOps(r, settings({ tileSize: 8 }));
    const large = computeDrawOps(r, settings({ tileSize: 16 }));

    expect(large).toHaveLength(small.length);
    const coords = (ops: DrawOp[]) =>
      ops.flatMap((o) =>
        o.kind === 'line' ? [o.x1, o.y1, o.x2, o.y2]
          : o.kind === 'fill' ? [o.x, o.y, o.w, o.h]
            : [o.x, o.y, o.size]);
    expect(coords(large)).toEqual(coords(small).map((n) => n * 2));
  });

  it('draws every tile of a multi-tile room', () => {
    const r = room({
      width: 3, height: 1,
      tiles: [tile({ x: 0 }), tile({ x: 1 }), tile({ x: 2 })],
    });
    expect(fills(computeDrawOps(r, SHAPE_ONLY))).toHaveLength(3);
  });
});

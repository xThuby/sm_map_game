import { describe, it, expect } from 'vitest';
import { resolveEdge, visualSignature, SHAPE_ONLY, FULLY_VISIBLE } from './signature';
import type { RenderSettings, Room, Tile } from './types';

const tile = (over: Partial<Tile> = {}): Tile => ({
  x: 0, y: 0, left: 'wall', right: 'wall', top: 'wall', bottom: 'wall',
  interior: 'empty', ...over,
});

const room = (over: Partial<Room> = {}): Room => ({
  id: 1, name: 'Test Room', aliases: [], area: 'Crateria', width: 1, height: 1,
  tiles: [tile()], heated: false, liquid: 'none', liquidLevel: null,
  doors: [], itemCount: 0, hasHiddenItem: false, utilities: [], hasElevator: false,
  oneWay: null, ...over,
});

const walls = (w: 'vanilla' | 'enhanced') => ({ walls: w, blueDoors: 'visible' } as const);

describe('resolveEdge', () => {
  it('paints wall and door identically to their qol aliases in both wall modes', () => {
    for (const w of ['vanilla', 'enhanced'] as const) {
      expect(resolveEdge('qolWall', walls(w))).toBe(resolveEdge('wall', walls(w)));
      expect(resolveEdge('qolDoor', walls(w))).toBe(resolveEdge('door', walls(w)));
      expect(resolveEdge('qolSand', walls(w))).toBe(resolveEdge('sand', walls(w)));
    }
  });

  // The whole point of the qol variants: Map Rando corrects vanilla map errors, and the
  // player can choose which version they see.
  it('paints qolEmpty as a wall only in vanilla mode', () => {
    expect(resolveEdge('qolEmpty', walls('vanilla'))).toBe('wall');
    expect(resolveEdge('qolEmpty', walls('enhanced'))).toBe('empty');
  });

  it('paints qolPassage as a passage only in enhanced mode', () => {
    expect(resolveEdge('qolPassage', walls('vanilla'))).toBe('empty');
    expect(resolveEdge('qolPassage', walls('enhanced'))).toBe('passage');
  });

  it('paints a plain passage as a solid wall in vanilla mode', () => {
    expect(resolveEdge('passage', walls('vanilla'))).toBe('wall');
    expect(resolveEdge('passage', walls('enhanced'))).toBe('passage');
  });

  it('fills doors and sand solid when blue doors are hidden', () => {
    const hidden = { walls: 'enhanced', blueDoors: 'hidden' } as const;
    expect(resolveEdge('door', hidden)).toBe('wall');
    expect(resolveEdge('sand', hidden)).toBe('wall');
    expect(resolveEdge('passage', hidden)).toBe('passage');
  });

  it('leaves empty and elevatorEntrance alone', () => {
    for (const w of ['vanilla', 'enhanced'] as const) {
      expect(resolveEdge('empty', walls(w))).toBe('empty');
      expect(resolveEdge('elevatorEntrance', walls(w))).toBe('elevatorEntrance');
    }
  });
});

describe('visualSignature', () => {
  it('is independent of the order tiles are stored in', () => {
    const a = room({ tiles: [tile({ x: 0 }), tile({ x: 1 })], width: 2 });
    const b = room({ tiles: [tile({ x: 1 }), tile({ x: 0 })], width: 2 });
    expect(visualSignature(a, SHAPE_ONLY)).toBe(visualSignature(b, SHAPE_ONLY));
  });

  it('separates rooms differing in a single edge', () => {
    const a = room();
    const b = room({ tiles: [tile({ right: 'door' })] });
    expect(visualSignature(a, SHAPE_ONLY)).not.toBe(visualSignature(b, SHAPE_ONLY));
  });

  it('ignores the room name and id', () => {
    expect(visualSignature(room({ id: 1, name: 'A' }), SHAPE_ONLY))
      .toBe(visualSignature(room({ id: 2, name: 'B' }), SHAPE_ONLY));
  });

  it('ignores hazards when they are not painted, and honours them when they are', () => {
    const cold = room();
    const hot = room({ heated: true });
    expect(visualSignature(cold, SHAPE_ONLY)).toBe(visualSignature(hot, SHAPE_ONLY));
    expect(visualSignature(cold, FULLY_VISIBLE)).not.toBe(visualSignature(hot, FULLY_VISIBLE));
  });

  it('honours each liquid type independently of the others', () => {
    const dry = room();
    const wet = room({ liquid: 'water', liquidLevel: 0.625 });
    const waterOff: RenderSettings = { ...FULLY_VISIBLE, water: 'hidden' };
    const lavaOff: RenderSettings = { ...FULLY_VISIBLE, lava: 'hidden' };
    expect(visualSignature(dry, waterOff)).toBe(visualSignature(wet, waterOff));
    expect(visualSignature(dry, lavaOff)).not.toBe(visualSignature(wet, lavaOff));
  });

  it('separates rooms by area only when area colour is shown', () => {
    const a = room({ area: 'Crateria' });
    const b = room({ area: 'Maridia' });
    expect(visualSignature(a, SHAPE_ONLY)).toBe(visualSignature(b, SHAPE_ONLY));
    expect(visualSignature(a, FULLY_VISIBLE)).not.toBe(visualSignature(b, FULLY_VISIBLE));
  });

  it('hides item interiors when items are not painted', () => {
    const bare = room();
    const withItem = room({ tiles: [tile({ interior: 'item' })], itemCount: 1 });
    const itemsOff: RenderSettings = { ...FULLY_VISIBLE, items: 'hidden' };
    expect(visualSignature(bare, itemsOff)).toBe(visualSignature(withItem, itemsOff));
    expect(visualSignature(bare, FULLY_VISIBLE)).not.toBe(visualSignature(withItem, FULLY_VISIBLE));
  });

  it('keeps non-item interiors visible when items are hidden', () => {
    const bare = room();
    const save = room({ tiles: [tile({ interior: 'saveStation' })] });
    const itemsOff: RenderSettings = { ...FULLY_VISIBLE, items: 'hidden' };
    expect(visualSignature(bare, itemsOff)).not.toBe(visualSignature(save, itemsOff));
  });

  it('does not vary with tile size', () => {
    const r = room();
    expect(visualSignature(r, { ...FULLY_VISIBLE, tileSize: 8 }))
      .toBe(visualSignature(r, { ...FULLY_VISIBLE, tileSize: 32 }));
  });
});

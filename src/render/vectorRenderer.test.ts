import { describe, it, expect } from 'vitest';
import { paint, canvasSize } from './vectorRenderer';
import type { DrawTarget } from './vectorRenderer';
import { computeDrawOps } from './drawOps';
import type { DrawOp } from './drawOps';
import { loadRooms } from '../rooms';
import { SHAPE_ONLY, FULLY_VISIBLE } from '../signature';
import type { RenderSettings, Room } from '../types';

type Call = [string, ...unknown[]];

/** Records every drawing call made against it, in order. */
function recorder(): DrawTarget & { calls: Call[] } {
  const calls: Call[] = [];
  const log = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  return {
    calls,
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    font: '', textAlign: 'center' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    clearRect: log('clearRect'), fillRect: log('fillRect'), strokeRect: log('strokeRect'),
    beginPath: log('beginPath'), moveTo: log('moveTo'), lineTo: log('lineTo'),
    stroke: log('stroke'), fillText: log('fillText'),
  };
}

const settings = (over: Partial<RenderSettings> = {}): RenderSettings =>
  ({ ...FULLY_VISIBLE, tileSize: 8, ...over });

const rooms = loadRooms();
const byName = (n: string): Room => rooms.find((r) => r.name === n)!;

describe('canvasSize', () => {
  it('is the room extent in tiles times the tile size', () => {
    expect(canvasSize(byName('Landing Site'), settings({ tileSize: 10 })))
      .toEqual({ width: 90, height: 50 });
  });
});

describe('paint', () => {
  it('issues one fillRect per fill op', () => {
    const ops: DrawOp[] = [
      { kind: 'fill', x: 0, y: 0, w: 8, h: 8, paint: 'background' },
      { kind: 'fill', x: 0, y: 4, w: 8, h: 4, paint: 'water' },
    ];
    const target = recorder();
    paint(target, ops);
    expect(target.calls.filter((c) => c[0] === 'fillRect')).toEqual([
      ['fillRect', 0, 0, 8, 8],
      ['fillRect', 0, 4, 8, 4],
    ]);
  });

  it('strokes each line op between its own endpoints', () => {
    const ops: DrawOp[] = [
      { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 8, paint: 'wall' },
      { kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0, paint: 'wall' },
    ];
    const target = recorder();
    paint(target, ops);
    expect(target.calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')).toEqual([
      ['moveTo', 0, 0], ['lineTo', 0, 8],
      ['moveTo', 0, 0], ['lineTo', 8, 0],
    ]);
    expect(target.calls.filter((c) => c[0] === 'stroke')).toHaveLength(2);
  });

  it('draws ops in the order given, so later ops paint over earlier ones', () => {
    const ops: DrawOp[] = [
      { kind: 'fill', x: 0, y: 0, w: 8, h: 8, paint: 'background' },
      { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 8, paint: 'wall' },
    ];
    const target = recorder();
    paint(target, ops);
    const kinds = target.calls.map((c) => c[0]);
    expect(kinds.indexOf('fillRect')).toBeLessThan(kinds.indexOf('stroke'));
  });

  it('draws something for every glyph it knows', () => {
    const glyphs = [
      'item', 'doubleItem', 'hiddenItem', 'save', 'map', 'energyRefill', 'ammoRefill',
      'doubleRefill', 'ship', 'elevatorPlatform', 'elevator', 'tube',
    ] as const;
    for (const glyph of glyphs) {
      const target = recorder();
      paint(target, [{ kind: 'glyph', glyph, x: 4, y: 4, size: 8, paint: 'item' }]);
      expect(target.calls.length, `glyph ${glyph} drew nothing`).toBeGreaterThan(0);
    }
  });

  it('draws nothing at all for an empty op list', () => {
    const target = recorder();
    paint(target, []);
    expect(target.calls).toEqual([]);
  });
});

describe('paint: the whole game', () => {
  /**
   * The rendering rules are checked by inspection in drawOps.test.ts; this checks that no
   * real room trips the canvas layer over an op combination the fixtures never produce.
   */
  it('draws all 253 rooms without throwing, at either preset', () => {
    for (const preset of [SHAPE_ONLY, FULLY_VISIBLE]) {
      for (const room of rooms) {
        const target = recorder();
        expect(() => paint(target, computeDrawOps(room, { ...preset, tileSize: 8 })))
          .not.toThrow();
        expect(target.calls.length, `${room.name} drew nothing`).toBeGreaterThan(0);
      }
    }
  });

  it('emits a finite coordinate for every call it makes', () => {
    for (const room of rooms) {
      const target = recorder();
      paint(target, computeDrawOps(room, settings()));
      for (const [name, ...args] of target.calls) {
        for (const arg of args) {
          if (typeof arg === 'number') {
            expect(Number.isFinite(arg), `${room.name}: ${name} got ${arg}`).toBe(true);
          }
        }
      }
    }
  });
});

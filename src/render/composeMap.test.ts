import { describe, it, expect } from 'vitest';
import { composeMapBitmap, mapBitmapSize, renderMap, fitMapTileSize } from './composeMap';
import { renderRoomBitmap, PALETTE_INDICES, BACKDROP } from './pixelRenderer';
import { VIEWPORT, TOURNAMENT_SETTINGS } from './renderer';
import { loadMaps, layoutFor } from '../map/layout';
import { roomByName } from '../rooms';
import { AREAS } from '../types';
import type { Layout } from '../map/layout';
import type { RenderSettings } from '../types';

const settings: RenderSettings = { ...TOURNAMENT_SETTINGS };
const maps = loadMaps();
const everyZone = (): Layout[] => maps.flatMap((m) => AREAS.map((a) => layoutFor(m, a)));

const alone = (name: string): Layout => {
  const room = roomByName(name)!;
  return {
    area: room.area,
    placements: [{ room, x: 0, y: 0 }],
    connections: [],
    width: room.width,
    height: room.height,
  };
};

describe('composing a zone into one bitmap', () => {
  it('measures the zone, eight pixels to the tile', () => {
    for (const zone of everyZone()) {
      const bitmap = composeMapBitmap(zone, settings);
      expect(bitmap, `${zone.area}`).toHaveLength(zone.height * 8);
      expect(bitmap[0], `${zone.area}`).toHaveLength(zone.width * 8);
    }
  });

  /** One room on its own has to come out exactly as the single-room renderer draws it. */
  it('draws a lone room the way the room renderer does', () => {
    for (const name of ['Volcano Room', 'The Moat', 'Landing Site', 'Green Brinstar Main Shaft']) {
      const zone = alone(name);
      expect(composeMapBitmap(zone, settings), name)
        .toEqual(renderRoomBitmap(roomByName(name)!, settings));
    }
  });

  it('puts each room down at its own offset', () => {
    const zone = layoutFor(maps[0]!, 'Wrecked Ship');
    const bitmap = composeMapBitmap(zone, settings);
    for (const p of zone.placements) {
      if (p.room.name === 'Toilet Bowl') continue; // drawn over other rooms on purpose
      const own = renderRoomBitmap(p.room, settings);
      for (const t of p.room.tiles) {
        for (let r = 0; r < 8; r += 1) {
          const into = bitmap[(p.y + t.y) * 8 + r] as number[];
          const from = own[t.y * 8 + r] as number[];
          expect(into.slice((p.x + t.x) * 8, (p.x + t.x) * 8 + 8), `${p.room.name}`)
            .toEqual(from.slice(t.x * 8, t.x * 8 + 8));
        }
      }
    }
  });

  it('leaves the space between rooms as backdrop', () => {
    const zone = layoutFor(maps[0]!, 'Tourian');
    const bitmap = composeMapBitmap(zone, settings);
    const filled = new Set<string>();
    for (const p of zone.placements) {
      for (const t of p.room.tiles) filled.add(`${p.x + t.x},${p.y + t.y}`);
    }
    for (let ty = 0; ty < zone.height; ty += 1) {
      for (let tx = 0; tx < zone.width; tx += 1) {
        if (filled.has(`${tx},${ty}`)) continue;
        for (let r = 0; r < 8; r += 1) {
          expect((bitmap[ty * 8 + r] as number[]).slice(tx * 8, tx * 8 + 8), `${tx},${ty}`)
            .toEqual(Array(8).fill(BACKDROP));
        }
      }
    }
  });

  it('uses only colours the palette knows', () => {
    // Collected rather than asserted per pixel: 150 zones is some seven million of them.
    const seen = new Set<number>();
    for (const zone of everyZone()) {
      for (const row of composeMapBitmap(zone, settings)) for (const index of row) seen.add(index);
    }
    expect([...seen].filter((i) => !PALETTE_INDICES.has(i))).toEqual([]);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('composes every zone of every map without complaint', () => {
    for (const zone of everyZone()) expect(() => composeMapBitmap(zone, settings)).not.toThrow();
  });
});

/**
 * The Toilet is a tube Samus falls through, and it is the only room Map Rando draws over
 * another — in the vanilla map as much as a generated one. Drawn underneath it would vanish.
 */
describe('the Toilet', () => {
  const zoneWithToilet = (): Layout => {
    for (const zone of everyZone()) {
      if (zone.placements.some((p) => p.room.name === 'Toilet Bowl')) return zone;
    }
    throw new Error('no vendored zone holds the Toilet');
  };

  it('is drawn over the room it passes through, not under it', () => {
    const zone = zoneWithToilet();
    const toilet = zone.placements.find((p) => p.room.name === 'Toilet Bowl')!;
    const own = renderRoomBitmap(toilet.room, settings);
    const bitmap = composeMapBitmap(zone, settings);

    const taken = new Set<string>();
    for (const p of zone.placements) {
      if (p.room.name === 'Toilet Bowl') continue;
      for (const t of p.room.tiles) taken.add(`${p.x + t.x},${p.y + t.y}`);
    }
    const crossed = toilet.room.tiles
      .filter((t) => taken.has(`${toilet.x + t.x},${toilet.y + t.y}`));
    expect(crossed.length, 'this zone has the Toilet crossing nothing').toBeGreaterThan(0);

    for (const t of crossed) {
      for (let r = 0; r < 8; r += 1) {
        const into = bitmap[(toilet.y + t.y) * 8 + r] as number[];
        const from = own[t.y * 8 + r] as number[];
        expect(into.slice((toilet.x + t.x) * 8, (toilet.x + t.x) * 8 + 8))
          .toEqual(from.slice(t.x * 8, t.x * 8 + 8));
      }
    }
  });
});

describe('fitting a zone on the page', () => {
  it('keeps every zone inside the viewport', () => {
    for (const zone of everyZone()) {
      const tileSize = fitMapTileSize(zone, VIEWPORT);
      expect(zone.width * tileSize, `${zone.area} width`).toBeLessThanOrEqual(VIEWPORT.width);
      expect(zone.height * tileSize, `${zone.area} height`).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  /** Whole multiples of 8, so every source pixel stays a whole number of screen pixels. */
  it('scales in whole pixels', () => {
    for (const zone of everyZone()) expect(fitMapTileSize(zone, VIEWPORT) % 8).toBe(0);
  });

  /**
   * A zone is far wider than one room, so the single-room floor of 32 would push the biggest
   * of them five times past the page. Native size is the floor here instead.
   */
  it('draws the biggest zone at native size rather than overflowing', () => {
    const biggest = everyZone().reduce((a, b) => (a.width > b.width ? a : b));
    expect(biggest.width).toBeGreaterThan(50);
    expect(fitMapTileSize(biggest, VIEWPORT)).toBe(8);
  });

  it('draws a small zone larger than a big one', () => {
    const zones = everyZone();
    const small = zones.reduce((a, b) => (a.width < b.width ? a : b));
    const big = zones.reduce((a, b) => (a.width > b.width ? a : b));
    expect(fitMapTileSize(small, VIEWPORT)).toBeGreaterThan(fitMapTileSize(big, VIEWPORT));
  });

  it('sizes the canvas to the zone and the scale', () => {
    const zone = layoutFor(maps[0]!, 'Maridia');
    const at = { ...settings, tileSize: 16 };
    expect(mapBitmapSize(zone, at)).toEqual({
      width: zone.width * 8 * 2, height: zone.height * 8 * 2,
    });
  });
});

describe('painting a zone', () => {
  /** jsdom has no canvas, so this records what would have been painted. */
  const fakeCanvas = () => {
    const rects: [number, number, number, number][] = [];
    const ctx = {
      imageSmoothingEnabled: true,
      fillStyle: '',
      clearRect() { /* nothing to record */ },
      fillRect(x: number, y: number, w: number, h: number) { rects.push([x, y, w, h]); },
    };
    return {
      rects,
      canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement,
    };
  };

  it('paints one block per pixel that is not backdrop, and sizes the canvas', () => {
    const zone = layoutFor(maps[0]!, 'Tourian');
    const at = { ...settings, tileSize: 8 };
    const { rects, canvas } = fakeCanvas();
    renderMap(canvas, zone, at);

    const painted = composeMapBitmap(zone, at)
      .flat().filter((index) => index !== BACKDROP).length;
    expect(rects).toHaveLength(painted);
    expect(canvas.width).toBe(zone.width * 8);
    expect(canvas.height).toBe(zone.height * 8);
    expect(rects.every(([, , w, h]) => w === 1 && h === 1)).toBe(true);
  });

  it('scales every block up together', () => {
    const zone = layoutFor(maps[0]!, 'Tourian');
    const { rects, canvas } = fakeCanvas();
    renderMap(canvas, zone, { ...settings, tileSize: 24 });
    expect(canvas.width).toBe(zone.width * 8 * 3);
    expect(rects.every(([, , w, h]) => w === 3 && h === 3)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { fitTileSize, MAX_TILE_SIZE, MIN_TILE_SIZE, VIEWPORT } from './renderer';
import { loadRooms } from '../rooms';

const box = (w: number, h: number) => ({ width: w, height: h });
const room = (width: number, height: number) => ({ width, height });

describe('fitTileSize', () => {
  it('draws a small room at full size', () => {
    expect(fitTileSize(room(1, 1), VIEWPORT)).toBe(MAX_TILE_SIZE);
    expect(fitTileSize(room(4, 3), VIEWPORT)).toBe(MAX_TILE_SIZE);
  });

  it('shrinks a room that would not otherwise fit', () => {
    const big = fitTileSize(room(13, 12), VIEWPORT);
    expect(big).toBeLessThan(MAX_TILE_SIZE);
    expect(13 * big).toBeLessThanOrEqual(VIEWPORT.width);
    expect(12 * big).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('is driven by whichever side is tighter', () => {
    // a wide, short room is limited by width; a narrow, tall one by height
    expect(fitTileSize(room(20, 1), box(400, 4000))).toBe(fitTileSize(room(20, 1), box(400, 400)));
    expect(fitTileSize(room(1, 20), box(4000, 400))).toBe(fitTileSize(room(1, 20), box(400, 400)));
  });

  it('never shrinks past the point of being readable', () => {
    expect(fitTileSize(room(200, 200), VIEWPORT)).toBe(MIN_TILE_SIZE);
  });

  /** A fractional scale would blur the art; every source pixel must stay a whole number. */
  it('keeps the scale a whole number of pixels per source pixel', () => {
    for (const w of [1, 3, 7, 13]) {
      for (const h of [1, 5, 12]) {
        expect(fitTileSize(room(w, h), VIEWPORT) % 8).toBe(0);
      }
    }
  });

  it('fits every room in the game inside the viewport', () => {
    for (const r of loadRooms()) {
      const size = fitTileSize(r, VIEWPORT);
      const tooWide = r.width * size > VIEWPORT.width;
      const tooTall = r.height * size > VIEWPORT.height;
      // only a room that has already hit the minimum may overflow
      if (tooWide || tooTall) expect(size, r.name).toBe(MIN_TILE_SIZE);
    }
  });
});

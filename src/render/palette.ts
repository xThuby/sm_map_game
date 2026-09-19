import type { Area } from '../types';

export type Rgb = readonly [number, number, number];

/**
 * The map screen palette, per area.
 *
 * SNES map tiles store palette indices and the hardware swaps the palette per region, so the
 * real colours live in the ROM rather than in Map Rando's source. These were recovered
 * instead by rendering the whole vanilla map with this renderer and reading back the colours
 * Map Rando's own published render (maprando.com/logic/vanilla_map.png) has at each pixel.
 * Every entry below came out 98-100% pure over ~80,000 pixels, so they are measurements
 * rather than guesses.
 *
 * Note the arrangement, which is the opposite of what it looks like at a glance: a room's
 * interior carries the area colour and its walls are white.
 *
 * Indices: 0 backdrop, 1 room interior, 2 heated interior, 3 wall, 4 unused in the light
 * theme, 5 the dark half of a liquid dither, 13 item marker.
 */
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
/**
 * Door-lock colours are the exception to the measurement above: Map Rando defines these in
 * source (add_cross_area_arrows), as SNES 5-bit values. Gray is rgb(18, 12, 14).
 */
const GRAY_DOOR: Rgb = [148, 98, 115];

/**
 * Index 2 only ever appears in a heated room or an acid room. In the shipped data that is
 * Crateria, Norfair and Tourian only — the three measured below. The other three areas carry
 * their interior colour here because the index is unreachable for them, which
 * pixelRenderer.test.ts asserts.
 */
export const PALETTE: Record<Area, Record<number, Rgb>> = {
  Crateria: { 0: BLACK, 1: [148, 0, 222], 2: [222, 123, 255], 3: WHITE, 4: BLACK, 5: BLACK, 12: BLACK, 13: WHITE, 15: GRAY_DOOR },
  Brinstar: { 0: BLACK, 1: [0, 148, 0], 2: [0, 148, 0], 3: WHITE, 4: BLACK, 5: BLACK, 12: BLACK, 13: WHITE, 15: GRAY_DOOR },
  Norfair: { 0: BLACK, 1: [189, 0, 0], 2: [255, 98, 98], 3: WHITE, 4: BLACK, 5: BLACK, 12: BLACK, 13: WHITE, 15: GRAY_DOOR },
  'Wrecked Ship': { 0: BLACK, 1: [131, 139, 0], 2: [131, 139, 0], 3: WHITE, 4: BLACK, 5: BLACK, 12: BLACK, 13: WHITE, 15: GRAY_DOOR },
  Maridia: { 0: BLACK, 1: [24, 98, 238], 2: [24, 98, 238], 3: WHITE, 4: BLACK, 5: BLACK, 12: BLACK, 13: WHITE, 15: GRAY_DOOR },
  Tourian: { 0: BLACK, 1: [172, 98, 0], 2: [238, 139, 98], 3: WHITE, 4: BLACK, 5: BLACK, 12: BLACK, 13: WHITE, 15: GRAY_DOOR },
};

/** Areas whose rooms can actually produce palette index 2. */
export const AREAS_WITH_HEATED_PALETTE: Area[] = ['Crateria', 'Norfair', 'Tourian'];

/**
 * A neutral palette for when the area should not be given away. Keeps the wall/interior
 * contrast of the real thing without naming the region.
 */
export const NEUTRAL_PALETTE: Record<number, Rgb> = {
  0: BLACK, 1: [38, 42, 56], 2: [92, 74, 60], 3: WHITE, 4: BLACK, 5: BLACK,
  12: BLACK, 13: WHITE, 15: GRAY_DOOR,
};

export function paletteFor(area: Area, areaColour: boolean): Record<number, Rgb> {
  return areaColour ? (PALETTE[area] as Record<number, Rgb>) : NEUTRAL_PALETTE;
}

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
 * The grey a Map Rando map screen uses for rooms outside the area being viewed: a mid grey
 * body with white walls, and a brighter grey for heated rooms.
 *
 * This is what the game itself shows when the area is not the point, which is exactly our
 * case — Map Rando reassigns rooms to areas per seed, so vanilla area colour would teach a
 * signal that is not there. Heat reads as brightness rather than hue, as it does in every
 * measured area palette.
 *
 * Sampled from a screenshot of a real seed, so these are the game's own values rather than
 * an approximation of them. The two greys carry the liquids as well: lava fills a heated
 * room with index 1, and acid dithers the two against each other, which is why the pair has
 * to be exactly this far apart.
 */
export const NEUTRAL_PALETTE: Record<number, Rgb> = {
  0: BLACK,
  1: [0x53, 0x56, 0x55],
  2: [0x8b, 0x8b, 0x8b],
  3: WHITE,
  4: BLACK,
  5: BLACK,
  12: BLACK,
  13: WHITE,
  15: GRAY_DOOR,
};

/**
 * The dotted lattice behind the map, one dot every other pixel along each tile's top and
 * left edge. Measured off Map Rando's own vanilla map render, where it is SNES rgb(6, 6, 6).
 */
export const GRID_COLOUR: Rgb = [49, 49, 49];
export const GRID_DOTS: [number, number][] = [
  [0, 0], [2, 0], [4, 0], [6, 0],
  [0, 2], [0, 4], [0, 6],
];

/** The lattice as a tile-sized SVG, for use as a CSS background behind the map. */
export function gridBackgroundUrl(): string {
  const rgb = `rgb(${GRID_COLOUR[0]},${GRID_COLOUR[1]},${GRID_COLOUR[2]})`;
  const dots = GRID_DOTS
    .map(([x, y]) => `<rect x='${x}' y='${y}' width='1' height='1' fill='${rgb}'/>`)
    .join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8' `
    + `shape-rendering='crispEdges'>${dots}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Rough perceived brightness, 0-255. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function paletteFor(area: Area, areaColour: boolean): Record<number, Rgb> {
  return areaColour ? (PALETTE[area] as Record<number, Rgb>) : NEUTRAL_PALETTE;
}

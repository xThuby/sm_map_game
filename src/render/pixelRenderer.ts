import { resolveEdge } from '../signature';
import { tileArt, variantName } from './tileArt';
import { paletteFor } from './palette';
import { grayDoorSide } from './grayDoors';
import type { Renderer } from './renderer';
import type { Edge, RenderSettings, Room, Side, Tile } from '../types';

/**
 * A faithful port of MapRandomizer's render_tile and draw_edge: each map tile is an 8x8 grid
 * of SNES palette indices, exactly as the game draws it on the pause map.
 *
 * Rendering the real artwork rather than an approximation matters for a trainer — the player
 * should be practising against the pixels a seed will actually show them.
 *
 * Indices: 0 backdrop, 1 room interior, 2 heated interior, 3 wall, 4 dark-theme wall,
 * 5 water highlight, 13 item white.
 */
export const BACKDROP = 0;
export const PALETTE_INDICES = new Set([0, 1, 2, 3, 4, 5, 12, 13, 15]);

const WALL = 3;
const ITEM = 13;
const LOCK_SHADOW = 12;
const LOCK_AIR_SHADOW = 5;
const GRAY_LOCK = 15;

/**
 * The three concentric rings draw_edge writes to, as (row, col) per side. Index 0 runs
 * left-to-right along the top, and clockwise from there.
 */
function ring(side: Side, depth: 0 | 1 | 2): [number, number][] {
  const d = depth;
  const idx = [0, 1, 2, 3, 4, 5, 6, 7];
  switch (side) {
    case 'top': return idx.map((i) => [d, i]);
    case 'bottom': return idx.map((i) => [7 - d, 7 - i]);
    case 'left': return idx.map((i) => [i, d]);
    case 'right': return idx.map((i) => [7 - i, 7 - d]);
  }
}

/** Which of the eight pixels along an edge are painted. From map_tiles.rs::draw_edge. */
function edgePixels(edge: Edge, side: Side): { wall: number[]; air: number[] } {
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  const ends = [0, 1, 6, 7];
  switch (edge) {
    case 'empty': return { wall: [], air: [] };
    case 'wall': return { wall: all, air: [] };
    case 'door': return { wall: [0, 1, 2, 5, 6, 7], air: [] };
    case 'passage': return { wall: ends, air: [] };
    case 'elevatorEntrance': return { wall: ends, air: [0, 7] };
    case 'sand':
      return { wall: side === 'bottom' ? ends : [0, 1, 2, 5, 6, 7], air: [] };
  }
}

/**
 * A gray door lock at the large size: a coloured bubble with a black border, sitting on the
 * wall ring and bulging two pixels into the tile. From draw_edge's LockedDoor arm with
 * DoorLocksSize::Large, which is what the tournament preset uses.
 */
function drawGrayLock(data: number[][], side: Side): void {
  const wall = ring(side, 0);
  const air = ring(side, 1);
  const deep = ring(side, 2);
  const put = (r: [number, number][], i: number, colour: number) => {
    const [row, col] = r[i] as [number, number];
    (data[row] as number[])[col] = colour;
  };

  for (const i of [0, 1, 6, 7]) put(wall, i, WALL);
  for (const i of [2, 5]) put(wall, i, LOCK_SHADOW);
  for (const i of [3, 4]) put(wall, i, GRAY_LOCK);
  for (const i of [1, 6]) put(air, i, LOCK_AIR_SHADOW);
  for (const i of [2, 3, 4, 5]) put(air, i, GRAY_LOCK);
  for (const i of [2, 3, 4, 5]) put(deep, i, LOCK_AIR_SHADOW);
}

function drawEdge(data: number[][], side: Side, edge: Edge): void {
  const { wall, air } = edgePixels(edge, side);
  const wallRing = ring(side, 0);
  const airRing = ring(side, 1);
  for (const i of wall) {
    const [r, c] = wallRing[i] as [number, number];
    (data[r] as number[])[c] = WALL;
  }
  for (const i of air) {
    const [r, c] = airRing[i] as [number, number];
    (data[r] as number[])[c] = WALL;
  }
}

/** The pair of colours a liquid alternates between, from render_tile. */
function liquidColours(room: Room): [number, number] | null {
  switch (room.liquid) {
    case 'none': return null;
    case 'water': return [5, 1];
    case 'lava': return [2, 1];
    case 'acid': return room.heated ? [2, 1] : [1, 2];
  }
}

function liquidVisible(room: Room, settings: RenderSettings): boolean {
  switch (room.liquid) {
    case 'water': return settings.water === 'visible';
    case 'lava': return settings.lava === 'visible';
    case 'acid': return settings.acid === 'visible';
    case 'none': return false;
  }
}

/**
 * How far down this tile the liquid surface sits, 0 to 1, or null if the tile is dry.
 * liquidLevel counts tiles from the top of the room.
 */
function tileLiquidLevel(room: Room, tile: Tile): number | null {
  if (room.liquidLevel === null) return null;
  const start = room.liquidLevel - tile.y;
  if (start >= 1) return null;
  return Math.max(start, 0);
}

const ITEM_INTERIORS = new Set(['item', 'doubleItem', 'hiddenItem']);

/**
 * Interiors Map Rando never actually draws. render_tile panics on both, because the
 * randomizer replaces them per seed with a marker chosen from the item that landed there and
 * the item_markers setting — 4-Tiered, on the current season's preset.
 *
 * Which tier a seed shows cannot be known without that seed. An item's position identifies a
 * room where its marker shape does not, so every item gets the plain marker rather than the
 * vanilla artwork, which no player would ever see.
 */
const SUBSTITUTED: Record<string, string> = {
  doubleItem: 'Item',
  hiddenItem: 'Item',
};

/**
 * Special tiles that are not part of the room. Map Rando paints the background lattice
 * through a black tile, so its artwork is dots in the room's fill colour; with no lattice
 * behind it those read as a stray mark floating beside the room.
 */
const NOT_ROOM = new Set(['black']);

/**
 * Tiles whose interior icon fills the whole 8x8 including its own border. render_tile skips
 * the tile's edges for these, so the icon is not drawn over.
 */
const ICON_INTERIORS = new Set([
  'saveStation', 'mapStation', 'energyRefill', 'ammoRefill', 'doubleRefill', 'ship',
]);

function stamp(data: number[][], name: string, heated: boolean): void {
  const art = tileArt(name);
  if (!art) return;

  if (art.grid) {
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const value = (art.grid[r] as number[])[c] as number;
        // apply_heat recolours interior pixels of a heated tile.
        (data[r] as number[])[c] = art.applyHeat && heated && value === 1 ? 2 : value;
      }
    }
  }
  for (const set of art.sets) {
    const colour = set.colour === 'item_color' ? ITEM : set.colour;
    for (const px of set.px) {
      const [r, c] = px as [number, number];
      (data[r] as number[])[c] = colour as number;
    }
  }
}

/** One map tile as an 8x8 grid of palette indices. */
export function renderTileBitmap(room: Room, tile: Tile, settings: RenderSettings): number[][] {
  const heated = room.heated && settings.heat === 'visible';
  const background = heated ? 2 : 1;
  const data: number[][] = Array.from({ length: 8 }, () => Array(8).fill(background));

  const level = liquidVisible(room, settings) ? tileLiquidLevel(room, tile) : null;
  const colours = liquidColours(room);
  if (level !== null && colours) {
    const [light, dark] = colours;
    for (let y = Math.floor(level * 8); y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const row = data[y] as number[];
        if (room.liquid === 'water') row[x] = (x + y) % 2 === 0 ? light : dark;
        else if (room.liquid === 'lava') row[x] = dark;
        else if (room.liquid === 'acid' && (x + y) % 2 === 0) row[x] = dark;
      }
    }
  }

  if (tile.special && NOT_ROOM.has(tile.special)) {
    return data.map((row) => row.map(() => BACKDROP));
  }

  const showInterior = !(settings.items === 'hidden' && ITEM_INTERIORS.has(tile.interior));
  if (showInterior) {
    stamp(data, SUBSTITUTED[tile.interior] ?? variantName(tile.interior), heated);
  }
  if (tile.special) stamp(data, variantName(tile.special), heated);

  if (!(showInterior && ICON_INTERIORS.has(tile.interior))) {
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      if (settings.grayDoors === 'visible' && grayDoorSide(room.id, tile.x, tile.y, side)) {
        drawGrayLock(data, side);
      } else {
        drawEdge(data, side, resolveEdge(tile[side], settings));
      }
    }
  }
  return data;
}

/** A whole room as a grid of palette indices, gaps left as backdrop. */
export function renderRoomBitmap(room: Room, settings: RenderSettings): number[][] {
  const out: number[][] = Array.from(
    { length: room.height * 8 },
    () => Array(room.width * 8).fill(BACKDROP),
  );
  for (const tile of room.tiles) {
    const bitmap = renderTileBitmap(room, tile, settings);
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        (out[tile.y * 8 + r] as number[])[tile.x * 8 + c] = (bitmap[r] as number[])[c] as number;
      }
    }
  }
  return out;
}

export function bitmapSize(room: Room, settings: RenderSettings): {
  width: number;
  height: number;
} {
  const scale = Math.max(1, Math.round(settings.tileSize / 8));
  return { width: room.width * 8 * scale, height: room.height * 8 * scale };
}

/**
 * Draws the room's palette-index bitmap onto a canvas, one source pixel per scale x scale
 * block. Nearest-neighbour by construction, so the art stays crisp at any size rather than
 * being smoothed into mush the way an upscaled image would be.
 */
export const pixelRenderer: Renderer = {
  render(canvas, room, settings) {
    const scale = Math.max(1, Math.round(settings.tileSize / 8));
    const { width, height } = bitmapSize(room, settings);
    canvas.width = width;
    canvas.height = height;

    // Backdrop pixels are left unpainted so the page's own dark ground shows through them,
    // including the gaps inside an L-shaped room.
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);

    const palette = paletteFor(room.area, settings.areaColour);
    const bitmap = renderRoomBitmap(room, settings);
    for (let y = 0; y < bitmap.length; y += 1) {
      const row = bitmap[y] as number[];
      for (let x = 0; x < row.length; x += 1) {
        const index = row[x] as number;
        if (index === BACKDROP) continue;
        const rgb = palette[index] ?? [255, 0, 255];
        ctx.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  },
};

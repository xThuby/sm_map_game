import { resolveEdge } from '../signature';
import type { Area, Edge, Interior, RenderSettings, Room, Side, Special, Tile } from '../types';

/** Semantic colour roles. The renderer decides what they actually look like. */
export type Paint =
  | 'background' | 'heat' | 'water' | 'lava' | 'acid'
  | 'wall' | 'item' | 'utility' | 'special';

export type Glyph =
  | 'item' | 'doubleItem' | 'hiddenItem'
  | 'save' | 'map' | 'energyRefill' | 'ammoRefill' | 'doubleRefill' | 'ship'
  | 'elevatorPlatform' | 'elevator' | 'tube';

export interface FillOp {
  kind: 'fill';
  x: number; y: number; w: number; h: number;
  paint: Paint;
  /** Set on the tile background when area colour is on, so the renderer can tint by area. */
  area?: Area;
}

export interface LineOp {
  kind: 'line';
  x1: number; y1: number; x2: number; y2: number;
  paint: Paint;
  /** Set when area colour is on: the map screen tints room outlines by area. */
  area?: Area;
}

export interface GlyphOp {
  kind: 'glyph';
  glyph: Glyph;
  /** Centre of the tile the glyph sits in. */
  x: number; y: number;
  /** The tile size, so the renderer can scale the symbol. */
  size: number;
  paint: Paint;
}

export type DrawOp = FillOp | LineOp | GlyphOp;

/**
 * Which eighths of an edge are painted, transcribed from map_tiles.rs::draw_edge where an
 * edge is eight pixels wide.
 *
 * Sand is side-dependent: Map Rando paints it exactly as a door along a top edge and as a
 * passage along a bottom one. Reproducing that rather than inventing a distinct sand style
 * keeps the trainer honest, since a seed will not distinguish them either.
 */
function edgeSegments(edge: Edge, side: Side): [number, number][] {
  switch (edge) {
    case 'empty': return [];
    case 'wall': return [[0, 8]];
    case 'door': return [[0, 3], [5, 8]];
    case 'passage': return [[0, 2], [6, 8]];
    case 'elevatorEntrance': return [[0, 2], [6, 8]];
    case 'sand': return side === 'bottom' ? [[0, 2], [6, 8]] : [[0, 3], [5, 8]];
  }
}

const GLYPH_OF: Partial<Record<Interior, Glyph>> = {
  item: 'item',
  doubleItem: 'doubleItem',
  hiddenItem: 'hiddenItem',
  saveStation: 'save',
  mapStation: 'map',
  energyRefill: 'energyRefill',
  ammoRefill: 'ammoRefill',
  doubleRefill: 'doubleRefill',
  ship: 'ship',
  elevatorPlatformHigh: 'elevatorPlatform',
  elevatorPlatformLow: 'elevatorPlatform',
  // `event` and `empty` deliberately absent: Map Rando draws nothing for either.
};

const ITEM_GLYPHS = new Set<Glyph>(['item', 'doubleItem', 'hiddenItem']);
const SPECIAL_GLYPH_OF: Partial<Record<Special, Glyph>> = { elevator: 'elevator', tube: 'tube' };

function liquidPaint(room: Room): Paint | null {
  return room.liquid === 'none' ? null : room.liquid;
}

function liquidShown(room: Room, settings: RenderSettings): boolean {
  switch (room.liquid) {
    case 'water': return settings.water === 'visible';
    case 'lava': return settings.lava === 'visible';
    case 'acid': return settings.acid === 'visible';
    case 'none': return false;
  }
}

/**
 * How far down a tile its liquid surface sits, as a fraction of the tile, or null when the
 * tile holds no liquid. 0 means submerged.
 *
 * liquidLevel is measured in tiles from the top of the room, so rows above the surface are
 * dry, rows below are full, and exactly one row is partly filled.
 */
function liquidStart(room: Room, tile: Tile): number | null {
  if (room.liquidLevel === null) return null;
  const start = room.liquidLevel - tile.y;
  if (start >= 1) return null;
  return Math.max(start, 0);
}

/**
 * Everything to paint for this room at these settings, as data.
 *
 * Kept separate from the canvas so the rendering rules can be tested by inspection rather
 * than by screenshot, and so a more faithful renderer can be swapped in without touching
 * them. Edge resolution is shared with visualSignature, so what is drawn and what counts as
 * indistinguishable cannot drift apart.
 */
export function computeDrawOps(room: Room, settings: RenderSettings): DrawOp[] {
  const ts = settings.tileSize;
  const ops: DrawOp[] = [];
  const paintLiquid = liquidShown(room, settings) ? liquidPaint(room) : null;

  for (const tile of room.tiles) {
    const px = tile.x * ts;
    const py = tile.y * ts;

    const background: FillOp = {
      kind: 'fill', x: px, y: py, w: ts, h: ts,
      paint: room.heated && settings.heat === 'visible' ? 'heat' : 'background',
    };
    if (settings.areaColour) background.area = room.area;
    ops.push(background);

    if (paintLiquid !== null) {
      const start = liquidStart(room, tile);
      if (start !== null) {
        ops.push({
          kind: 'fill', x: px, y: py + start * ts, w: ts, h: ts - start * ts, paint: paintLiquid,
        });
      }
    }

    const glyph = GLYPH_OF[tile.interior];
    if (glyph && !(settings.items === 'hidden' && ITEM_GLYPHS.has(glyph))) {
      ops.push({
        kind: 'glyph', glyph, x: px + ts / 2, y: py + ts / 2, size: ts,
        paint: ITEM_GLYPHS.has(glyph) ? 'item' : 'utility',
      });
    }

    const specialGlyph = tile.special ? SPECIAL_GLYPH_OF[tile.special] : undefined;
    if (specialGlyph) {
      ops.push({
        kind: 'glyph', glyph: specialGlyph, x: px + ts / 2, y: py + ts / 2, size: ts,
        paint: 'special',
      });
    }

    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const vertical = side === 'left' || side === 'right';
      const along = vertical ? py : px;
      const across = side === 'right' ? px + ts : side === 'bottom' ? py + ts : vertical ? px : py;

      for (const [from, to] of edgeSegments(resolveEdge(tile[side], settings), side)) {
        const a = along + (from / 8) * ts;
        const b = along + (to / 8) * ts;
        const line: LineOp = vertical
          ? { kind: 'line', x1: across, y1: a, x2: across, y2: b, paint: 'wall' }
          : { kind: 'line', x1: a, y1: across, x2: b, y2: across, paint: 'wall' };
        if (settings.areaColour) line.area = room.area;
        ops.push(line);
      }
    }
  }
  return ops;
}

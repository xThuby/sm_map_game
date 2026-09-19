import { renderTileBitmap, paintBitmap, scaleFor, BACKDROP } from './pixelRenderer';
import { paletteFor } from './palette';
import { fitTileSize } from './renderer';
import type { Layout, Placement } from '../map/layout';
import type { RenderSettings } from '../types';

/**
 * A whole zone drawn as one bitmap, the way the game's map screen draws an area.
 *
 * Composition happens in palette indices rather than colours, so the colour is chosen once
 * for the zone at paint time. That matters: a room's own `area` is where it sat in the
 * vanilla game, and a generated map has reassigned it. The zone's area is the true one.
 */

/** The smallest a map tile is drawn: native size, one screen pixel per source pixel. */
export const MIN_MAP_TILE_SIZE = 8;

/**
 * The box a zone is drawn to fit, which is wider than the box one room gets.
 *
 * A source pixel has to cover a whole number of screen pixels or the art blurs, so the tile
 * size climbs in steps of 8 and a zone realistically has two of them: 8 or 16. At the game's
 * 760 the widest zones only clear the first, and half the page goes unused. This is wide
 * enough that every zone reaches 16.
 */
export const MAP_VIEWPORT = { width: 1100, height: 760 };

/**
 * The Toilet is a tube Samus falls through, and the only room Map Rando draws over another
 * — in the vanilla map as much as a generated one. It has to go down last or it vanishes
 * under whatever it crosses. It is also the only room built entirely of tube tiles, so
 * nothing has to name it.
 */
function tube(placement: Placement): boolean {
  return placement.room.tiles.every((t) => t.special === 'tube');
}

function drawOrder(placements: Placement[]): Placement[] {
  return [...placements.filter((p) => !tube(p)), ...placements.filter(tube)];
}

/** The zone as a grid of palette indices, the gaps between rooms left as backdrop. */
export function composeMapBitmap(layout: Layout, settings: RenderSettings): number[][] {
  const out: number[][] = Array.from(
    { length: layout.height * 8 },
    () => Array(layout.width * 8).fill(BACKDROP) as number[],
  );

  // Tile by tile rather than room by room: a room's bitmap covers its whole bounding box,
  // and copying the empty parts of that would rub out a neighbour sitting in the notch.
  for (const p of drawOrder(layout.placements)) {
    for (const tile of p.room.tiles) {
      const bitmap = renderTileBitmap(p.room, tile, settings);
      const top = (p.y + tile.y) * 8;
      const left = (p.x + tile.x) * 8;
      for (let r = 0; r < 8; r += 1) {
        const row = out[top + r] as number[];
        const from = bitmap[r] as number[];
        for (let c = 0; c < 8; c += 1) row[left + c] = from[c] as number;
      }
    }
  }
  return out;
}

export function mapBitmapSize(layout: Layout, settings: RenderSettings): {
  width: number;
  height: number;
} {
  const scale = scaleFor(settings);
  return { width: layout.width * 8 * scale, height: layout.height * 8 * scale };
}

/**
 * A zone is far wider than one room, so the single-room floor of 32 pixels a tile would push
 * the biggest of them several times past the page. Native size is the floor here.
 */
export function fitMapTileSize(
  layout: Pick<Layout, 'width' | 'height'>,
  viewport: { width: number; height: number },
): number {
  return fitTileSize(layout, viewport, MIN_MAP_TILE_SIZE);
}

/** The map's answer to `Renderer`, so a page can take a recorder in its place. */
export interface MapRenderer {
  render(canvas: HTMLCanvasElement, layout: Layout, settings: RenderSettings): void;
}

export function renderMap(
  canvas: HTMLCanvasElement,
  layout: Layout,
  settings: RenderSettings,
): void {
  paintBitmap(
    canvas,
    composeMapBitmap(layout, settings),
    paletteFor(layout.area, settings.areaColour),
    scaleFor(settings),
  );
}

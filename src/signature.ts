import { grayDoorSide } from './render/grayDoors';
import type { Edge, RawEdge, RenderSettings, Room, Side, Tile } from './types';

/**
 * What each stored edge is actually painted as, per wall mode. Transcribed from
 * MapRandomizer's rust/maprando/src/patch/map_tiles.rs::draw_edge, where an edge is eight
 * pixels and each variant fills a different subset of them:
 *
 *   - wall / qolWall      all eight, in both modes
 *   - door / qolDoor      all but the middle two, in both modes
 *   - sand / qolSand      a wider middle gap, in both modes
 *   - passage             all eight in vanilla, ends only in enhanced
 *   - qolPassage          nothing in vanilla, ends only in enhanced
 *   - qolEmpty            all eight in vanilla, nothing in enhanced
 *
 * So the qol variants are not aliases: qolEmpty and qolPassage, and plain passage, each paint
 * differently depending on the mode the player chose.
 */
const PAINTED: Record<'vanilla' | 'enhanced', Record<RawEdge, Edge>> = {
  vanilla: {
    empty: 'empty', qolEmpty: 'wall',
    passage: 'wall', qolPassage: 'empty',
    wall: 'wall', qolWall: 'wall',
    door: 'door', qolDoor: 'door',
    sand: 'sand', qolSand: 'sand',
    elevatorEntrance: 'elevatorEntrance',
  },
  enhanced: {
    empty: 'empty', qolEmpty: 'empty',
    passage: 'passage', qolPassage: 'passage',
    wall: 'wall', qolWall: 'wall',
    door: 'door', qolDoor: 'door',
    sand: 'sand', qolSand: 'sand',
    elevatorEntrance: 'elevatorEntrance',
  },
};

export type EdgeSettings = Pick<RenderSettings, 'walls' | 'blueDoors'>;

/** The edge a player actually sees, given their settings. */
export function resolveEdge(raw: RawEdge, settings: EdgeSettings): Edge {
  const painted = PAINTED[settings.walls][raw];
  // Hiding blue doors fills the door and sand gaps solid, making them indistinguishable
  // from ordinary wall.
  if (settings.blueDoors === 'hidden' && (painted === 'door' || painted === 'sand')) {
    return 'wall';
  }
  return painted;
}

const ITEM_INTERIORS = new Set(['item', 'doubleItem', 'hiddenItem']);

/** The interior a player actually sees. Item markers vanish when items are hidden. */
function resolveInterior(tile: Tile, settings: RenderSettings): string {
  if (settings.items === 'hidden' && ITEM_INTERIORS.has(tile.interior)) return 'empty';
  return tile.interior;
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
 * A key identifying everything the player can see of this room at these settings. Two rooms
 * sharing a key are genuinely indistinguishable, which is why grading accepts either.
 *
 * Only painted properties contribute: hide the heat overlay and a heated room becomes
 * identical to a cold one, which is precisely what makes "is this room heated?" a real
 * question rather than a colour-matching exercise.
 */
export function visualSignature(room: Room, settings: RenderSettings): string {
  // A gray lock is painted over whatever edge was there, so it replaces it in the signature.
  const edge = (room: Room, t: Tile, side: Side): string =>
    settings.grayDoors === 'visible' && grayDoorSide(room.id, t.x, t.y, side)
      ? 'grayLock'
      : resolveEdge(t[side], settings);

  const tiles = room.tiles
    .map((t) => [
      t.x, t.y,
      edge(room, t, 'left'), edge(room, t, 'right'),
      edge(room, t, 'top'), edge(room, t, 'bottom'),
      resolveInterior(t, settings), t.special ?? null,
    ])
    .sort((a, b) => (a[1] as number) - (b[1] as number) || (a[0] as number) - (b[0] as number));

  const parts = [JSON.stringify(tiles)];
  if (settings.heat === 'visible') parts.push(`heat:${room.heated}`);
  if (liquidVisible(room, settings)) parts.push(`liquid:${room.liquid}@${room.liquidLevel}`);
  if (settings.areaColour) parts.push(`area:${room.area}`);
  return parts.join('#');
}

const BASE: Omit<RenderSettings, 'heat' | 'water' | 'lava' | 'acid' | 'areaColour' | 'grayDoors'> = {
  blueDoors: 'visible',
  walls: 'enhanced',
  items: 'visible',
  tileSize: 8,
};

/** Geometry alone: no hazard overlays, no area colour. The hardest setting to identify from. */
export const SHAPE_ONLY: RenderSettings = {
  ...BASE,
  heat: 'hidden', water: 'hidden', lava: 'hidden', acid: 'hidden', areaColour: false,
  grayDoors: 'hidden',
};

/** Everything the map screen can show. The most forgiving setting. */
export const FULLY_VISIBLE: RenderSettings = {
  ...BASE,
  heat: 'visible', water: 'visible', lava: 'visible', acid: 'visible', areaColour: true,
  grayDoors: 'visible',
};

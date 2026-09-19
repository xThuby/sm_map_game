import type { RenderSettings, Room } from '../types';

/**
 * Tile sizes are whole multiples of 8, so every source pixel stays a whole number of screen
 * pixels and the art never blurs.
 */
export const MIN_TILE_SIZE = 32;
/** Four times the smallest a room is ever drawn — a whole multiple, so nothing blurs. */
export const MAX_TILE_SIZE = MIN_TILE_SIZE * 4;

/** The box a room is drawn to fit inside. */
export const VIEWPORT = { width: 760, height: 620 };

/**
 * The tile size that fits a room in the box, as large as it will go.
 *
 * Green Brinstar Main Shaft is twelve tiles tall, which at full size runs well past the fold
 * and pushes everything else down the page. Scaling to fit keeps the whole room visible,
 * which identifying it requires, and the click-to-zoom is there for detail.
 */
export function fitTileSize(
  room: Pick<Room, 'width' | 'height'>,
  viewport: { width: number; height: number },
): number {
  const limit = Math.min(viewport.width / room.width, viewport.height / room.height);
  const steps = Math.floor(limit / 8) * 8;
  return Math.min(Math.max(steps, MIN_TILE_SIZE), MAX_TILE_SIZE);
}

export interface Renderer {
  render(canvas: HTMLCanvasElement, room: Room, settings: RenderSettings): void;
}

/**
 * The map exactly as a Community Race Season 5 seed draws it — Map Rando's current
 * tournament preset, taken from rust/data/presets/full-settings. Everything is shown.
 *
 * Two of that preset's settings are not modelled, because both depend on a seed rather than
 * on the room: ammo and beam door locks, which the randomizer assigns, and 4-Tiered item
 * markers, whose shape depends on which item landed there. All item locations are drawn with
 * the plain marker; since every tier occupies the same tile, an item's position carries the
 * room-identity signal and its shape does not.
 */
export const TOURNAMENT_SETTINGS: RenderSettings = {
  heat: 'visible',
  water: 'visible',
  lava: 'visible',
  acid: 'visible',
  blueDoors: 'visible',
  grayDoors: 'visible',
  walls: 'enhanced',
  items: 'visible',
  areaColour: true,
  tileSize: 24,
};

/**
 * What the quiz shows: the tournament preset, but with the area colour dropped.
 *
 * Map Rando reassigns rooms to areas per seed, so the vanilla area colour carries no
 * information about which room this is — showing it would teach a signal that is not there.
 * The cost is more rooms that look alike (60 rather than 37), which the equivalence grouping
 * already handles. It also makes heated rooms stand out against a neutral ground.
 */
export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  ...TOURNAMENT_SETTINGS,
  areaColour: false,
  tileSize: 96,
};

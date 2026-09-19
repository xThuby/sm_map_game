import type { RenderSettings, Room } from '../types';

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

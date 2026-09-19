import artData from '../../data/raw/tile_art.json';

/**
 * One tile's artwork: either a complete 8x8 grid that replaces the tile, or a list of pixels
 * to stamp onto whatever is already there.
 *
 * Mechanically extracted from MapRandomizer's render_tile — see data/raw/tile_art.json for
 * provenance and the settings the branches were resolved at.
 */
export interface TileArt {
  grid: number[][] | null;
  /** Grids wrapped in apply_heat recolour interior pixels when the room is heated. */
  applyHeat: boolean;
  /** Pixels as [row, col]; typed loosely because it is loaded from JSON. */
  sets: { colour: number | string; px: number[][] }[];
}

const art = (artData as { art: Record<string, TileArt> }).art;

export function tileArt(name: string): TileArt | undefined {
  return art[name];
}

/** Maps our lower-camel enum values onto the Rust variant names the artwork is keyed by. */
export function variantName(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The six map areas, in ROM index order (0-5). */
export type Area = 'Crateria' | 'Brinstar' | 'Norfair' | 'Wrecked Ship' | 'Maridia' | 'Tourian';

/**
 * An edge as stored upstream. The `qol*` variants are Map Rando's corrections to vanilla map
 * errors; which of the two a player sees depends on their `walls` setting, so the raw value
 * is kept and resolved at render time. See resolveEdge in ./signature.
 */
export type RawEdge =
  | 'empty' | 'wall' | 'door' | 'passage' | 'sand' | 'elevatorEntrance'
  | 'qolEmpty' | 'qolWall' | 'qolDoor' | 'qolPassage' | 'qolSand';

/** An edge as actually painted, once settings are applied. */
export type Edge = 'empty' | 'wall' | 'door' | 'passage' | 'sand' | 'elevatorEntrance';

export type Interior =
  | 'empty' | 'item' | 'doubleItem' | 'hiddenItem'
  | 'saveStation' | 'mapStation' | 'energyRefill' | 'ammoRefill' | 'doubleRefill'
  | 'ship' | 'event' | 'elevatorPlatformHigh' | 'elevatorPlatformLow';

export type Special =
  | 'elevator' | 'tube' | 'black'
  | 'slopeUpFloorLow' | 'slopeUpFloorHigh' | 'slopeUpCeilingLow' | 'slopeUpCeilingHigh'
  | 'slopeDownFloorLow' | 'slopeDownFloorHigh' | 'slopeDownCeilingLow'
  | 'slopeDownCeilingHigh';

export type Liquid = 'none' | 'water' | 'lava' | 'acid';
export type Side = 'left' | 'right' | 'top' | 'bottom';
export type Direction = 'left' | 'right' | 'up' | 'down';
export type DoorSubtype = 'normal' | 'sand' | 'elevator';
export type Utility = 'save' | 'map' | 'energyRefill' | 'ammoRefill' | 'doubleRefill' | 'ship';

export interface Tile {
  x: number;
  y: number;
  left: RawEdge;
  right: RawEdge;
  top: RawEdge;
  bottom: RawEdge;
  interior: Interior;
  special?: Special;
}

export interface Door {
  direction: Direction;
  x: number;
  y: number;
  subtype: DoorSubtype;
}

/**
 * Map Rando's model of traversal inside a room: `parts` groups door indices that are mutually
 * reachable, and the connections say how you can cross between groups. A room with a single
 * part has no internal one-way, and carries `null`.
 */
export interface OneWay {
  parts: number[][];
  transient: [number, number][];
  durable: [number, number][];
}

export interface Room {
  id: number;
  /** The name Map Rando's own map data uses. */
  name: string;
  /**
   * Other names the same room goes by, from sm-json-data. maprando.com/logic renders from
   * that dataset, so 31 rooms are known there by a name the map data never shows.
   */
  aliases: string[];
  area: Area;
  width: number;
  height: number;
  tiles: Tile[];

  heated: boolean;
  liquid: Liquid;
  liquidLevel: number | null;
  doors: Door[];
  itemCount: number;
  hasHiddenItem: boolean;
  utilities: Utility[];
  hasElevator: boolean;
  oneWay: OneWay | null;

  /** Enemy types and counts, for the enemies hint. Empty for 80 of the 253 rooms. */
  enemies: { name: string; quantity: number }[];
  /** Rooms this one connects to on the vanilla map, for the neighbour hint. */
  neighbours: string[];
  /** Path to this room's in-game diagram within sm-json-data, served over a CDN. */
  diagram: string | null;
}

export type Visibility = 'visible' | 'hidden';

/**
 * Mirrors Map Rando's own EnhancedMapSettings, so hiding a hazard is what a real seed can do
 * rather than something invented for the quiz.
 */
export interface RenderSettings {
  heat: Visibility;
  water: Visibility;
  lava: Visibility;
  acid: Visibility;
  blueDoors: Visibility;
  /** The fixed boss/miniboss/pirate door locks. Seed-assigned locks are not modelled. */
  grayDoors: Visibility;
  walls: 'vanilla' | 'enhanced';
  items: Visibility;
  areaColour: boolean;
  tileSize: number;
}

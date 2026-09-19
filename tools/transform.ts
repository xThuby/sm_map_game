import type {
  Area, Direction, Door, DoorSubtype, Interior, Liquid, OneWay, RawEdge, Room, Special, Tile,
  Utility,
} from '../src/types';

/** A tile as stored in MapRandomizer's rust/data/map_tiles.json. */
export interface RawMapTile {
  coords: [number, number];
  left?: RawEdge;
  right?: RawEdge;
  top?: RawEdge;
  bottom?: RawEdge;
  interior?: Interior;
  specialType?: Special;
}

export interface RawTileRoom {
  roomId: number;
  roomName: string;
  heated?: boolean;
  liquidType?: Exclude<Liquid, 'none'>;
  liquidLevel?: number;
  mapTiles: RawMapTile[];
}

/** A room as stored in MapRandomizer's room_geometry.json. */
export interface RawGeoRoom {
  room_id: number;
  name: string;
  area: number;
  map: number[][];
  doors: { direction: Direction; x: number; y: number; subtype: DoorSubtype }[];
  items: { x: number; y: number; addr: number }[];
  parts: number[][];
  durable_part_connections: [number, number][];
  transient_part_connections: [number, number][];
  heated: boolean;
}

/**
 * The one room the two upstream files genuinely name differently. map_tiles.json agrees with
 * sm-json-data here ("Toilet Bowl"), and is authoritative for this project, so the difference
 * is recorded rather than treated as corruption. Every other room matches, ignoring the case
 * of "Parlor and Alcatraz".
 */
const KNOWN_NAME_DIFFERENCES = new Map<number, string>([[321, 'Toilet']]);

const AREAS: Area[] = ['Crateria', 'Brinstar', 'Norfair', 'Wrecked Ship', 'Maridia', 'Tourian'];

const EDGES = new Set<string>([
  'empty', 'wall', 'door', 'passage', 'sand', 'elevatorEntrance',
  'qolEmpty', 'qolWall', 'qolDoor', 'qolPassage', 'qolSand',
]);

const INTERIORS = new Set<string>([
  'empty', 'item', 'doubleItem', 'hiddenItem', 'saveStation', 'mapStation',
  'energyRefill', 'ammoRefill', 'doubleRefill', 'ship', 'event',
  'elevatorPlatformHigh', 'elevatorPlatformLow',
]);

const SPECIALS = new Set<string>([
  'elevator', 'tube', 'black',
  'slopeUpFloorLow', 'slopeUpFloorHigh', 'slopeUpCeilingLow', 'slopeUpCeilingHigh',
  'slopeDownFloorLow', 'slopeDownFloorHigh', 'slopeDownCeilingLow', 'slopeDownCeilingHigh',
]);

/** Interior markers that stand for a collectable, and how many each represents. */
const ITEM_WEIGHT: Partial<Record<Interior, number>> = {
  item: 1,
  hiddenItem: 1,
  doubleItem: 2,
};

const UTILITY_OF: Partial<Record<Interior, Utility>> = {
  saveStation: 'save',
  mapStation: 'map',
  energyRefill: 'energyRefill',
  ammoRefill: 'ammoRefill',
  doubleRefill: 'doubleRefill',
  ship: 'ship',
};

export function areaFromIndex(index: number): Area {
  const area = AREAS[index];
  if (!area) throw new Error(`Unknown area index ${index}; expected 0-${AREAS.length - 1}`);
  return area;
}

function checkEdge(value: string | undefined, side: string): RawEdge {
  const edge = value ?? 'empty';
  if (!EDGES.has(edge)) throw new Error(`Unknown ${side} edge value ${JSON.stringify(edge)}`);
  return edge as RawEdge;
}

export function normalizeTile(raw: RawMapTile): Tile {
  const [x, y] = raw.coords;
  const interior = raw.interior ?? 'empty';
  if (!INTERIORS.has(interior)) {
    throw new Error(`Unknown interior value ${JSON.stringify(interior)}`);
  }
  if (raw.specialType !== undefined && !SPECIALS.has(raw.specialType)) {
    throw new Error(`Unknown specialType value ${JSON.stringify(raw.specialType)}`);
  }

  const tile: Tile = {
    x, y,
    left: checkEdge(raw.left, 'left'),
    right: checkEdge(raw.right, 'right'),
    top: checkEdge(raw.top, 'top'),
    bottom: checkEdge(raw.bottom, 'bottom'),
    interior,
  };
  // Left off entirely rather than set to undefined, so the emitted JSON stays compact.
  if (raw.specialType !== undefined) tile.special = raw.specialType;
  return tile;
}

export function boundingBox(tiles: { x: number; y: number }[]): {
  width: number;
  height: number;
} {
  if (tiles.length === 0) throw new Error('Cannot measure a room with no tiles');
  return {
    width: Math.max(...tiles.map((t) => t.x)) + 1,
    height: Math.max(...tiles.map((t) => t.y)) + 1,
  };
}

export function deriveItemCount(tiles: Tile[]): number {
  return tiles.reduce((n, t) => n + (ITEM_WEIGHT[t.interior] ?? 0), 0);
}

export function deriveHasHiddenItem(tiles: Tile[]): boolean {
  return tiles.some((t) => t.interior === 'hiddenItem');
}

export function deriveUtilities(tiles: Tile[]): Utility[] {
  const found: Utility[] = [];
  for (const t of tiles) {
    const utility = UTILITY_OF[t.interior];
    if (utility && !found.includes(utility)) found.push(utility);
  }
  return found;
}

export function deriveHasElevator(tiles: Tile[]): boolean {
  return tiles.some((t) => t.special === 'elevator');
}

export function deriveOneWay(geo: RawGeoRoom): OneWay | null {
  if (geo.parts.length <= 1) return null;
  return {
    parts: geo.parts,
    transient: geo.transient_part_connections,
    durable: geo.durable_part_connections,
  };
}

export function buildRoom(rawTile: RawTileRoom, geo: RawGeoRoom): Room {
  if (rawTile.roomId !== geo.room_id) {
    throw new Error(
      `Room id mismatch: map_tiles has ${rawTile.roomId}, room_geometry has ${geo.room_id}`,
    );
  }
  const sameName = rawTile.roomName.toLowerCase() === geo.name.toLowerCase();
  if (!sameName && KNOWN_NAME_DIFFERENCES.get(geo.room_id) !== geo.name) {
    throw new Error(
      `Room ${geo.room_id} name mismatch: map_tiles has ${JSON.stringify(rawTile.roomName)}, ` +
        `room_geometry has ${JSON.stringify(geo.name)}`,
    );
  }

  const tiles = rawTile.mapTiles.map(normalizeTile);
  const { width, height } = boundingBox(tiles);
  const liquid: Liquid = rawTile.liquidType ?? 'none';

  return {
    id: geo.room_id,
    name: rawTile.roomName,
    area: areaFromIndex(geo.area),
    width,
    height,
    tiles,
    heated: rawTile.heated ?? false,
    liquid,
    liquidLevel: liquid === 'none' ? null : (rawTile.liquidLevel ?? null),
    doors: geo.doors.map(
      (d): Door => ({ direction: d.direction, x: d.x, y: d.y, subtype: d.subtype }),
    ),
    itemCount: deriveItemCount(tiles),
    hasHiddenItem: deriveHasHiddenItem(tiles),
    utilities: deriveUtilities(tiles),
    hasElevator: deriveHasElevator(tiles),
    oneWay: deriveOneWay(geo),
  };
}

export function buildAllRooms(rawTiles: RawTileRoom[], rawGeo: RawGeoRoom[]): Room[] {
  const geoById = new Map(rawGeo.map((g) => [g.room_id, g]));
  if (geoById.size !== rawGeo.length) throw new Error('room_geometry contains duplicate room ids');

  const rooms = rawTiles.map((t) => {
    const geo = geoById.get(t.roomId);
    if (!geo) throw new Error(`Room ${t.roomId} (${t.roomName}) is missing from room_geometry`);
    return buildRoom(t, geo);
  });

  if (rooms.length !== rawGeo.length) {
    throw new Error(`Room count mismatch: ${rooms.length} tile records, ${rawGeo.length} geometry`);
  }
  return rooms.sort((a, b) => a.id - b.id);
}

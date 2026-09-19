import type {
  Area, Direction, Door, DoorSubtype, Interior, Liquid, OneWay, RawEdge, Room, Special, Tile,
  Utility,
} from '../src/types';
import { AREAS } from '../src/types';

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
/** A vanilla map door: [[exitA, entranceA], [exitB, entranceB], bidirectional]. */
export type VanillaDoor = [[number, number], [number, number], boolean];

export interface VanillaMap {
  rooms: [number, number][];
  doors: VanillaDoor[];
  /** Which area each room belongs to, in the same order as `rooms`. */
  area: number[];
}

/** The per-room facts pulled out of sm-json-data. */
export interface SmJsonRoom {
  name?: string;
  enemies?: { name: string; quantity: number }[];
  neighbours?: string[];
  diagram?: string | null;
}

export interface RawGeoRoom {
  room_id: number;
  name: string;
  area: number;
  map: number[][];
  doors: {
    direction: Direction; x: number; y: number; subtype: DoorSubtype;
    exit_ptr?: number | null; entrance_ptr?: number | null;
  }[];
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

export function deriveHiddenItemCount(tiles: Tile[]): number {
  return tiles.filter((t) => t.interior === 'hiddenItem').length;
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

/**
 * The sm-json-data name for a room, when it is genuinely a different name rather than the
 * same one cased differently.
 */
export function deriveAliases(canonical: string, smJsonName: string | undefined): string[] {
  if (smJsonName === undefined) return [];
  if (smJsonName.toLowerCase() === canonical.toLowerCase()) return [];
  return [smJsonName];
}

/** Names the room also answers to, without repeats and never its own name. */
function mergeAliases(name: string, fromSmJson: string[], curated: string[]): string[] {
  const seen = new Set([name.toLowerCase()]);
  const out: string[] = [];
  for (const alias of [...fromSmJson, ...curated]) {
    if (seen.has(alias.toLowerCase())) continue;
    seen.add(alias.toLowerCase());
    out.push(alias);
  }
  return out;
}

/**
 * sm-json-data names each phase of a boss fight and each palette variant separately, which
 * turns an enemies hint into "Botwoon 1, Botwoon 2, Reverse Botwoon 1, Reverse Botwoon 2".
 * A player thinks of that as one Botwoon.
 *
 * "Ripper 2" keeps its number: it is a genuinely different enemy from a Ripper, and only the
 * colour in brackets is a variant.
 */
const PHASE = /^(?:Reverse\s+)?(Botwoon|Mother Brain)\s+\d+$/;

export function tidyEnemyName(name: string): string {
  const withoutVariant = name.replace(/\s*\([^)]*\)\s*$/, '');
  return PHASE.exec(withoutVariant)?.[1] ?? withoutVariant;
}

/** Whether this entry is one phase of a single boss rather than a creature in its own right. */
function isPhase(name: string): boolean {
  return PHASE.test(name.replace(/\s*\([^)]*\)\s*$/, ''));
}

/**
 * Enemies as a player would list them, phases and variants folded together.
 *
 * Phases count once however many there are — a room holds one Botwoon, not four. Palette
 * variants of an ordinary enemy do add up, because those really are separate creatures.
 */
export function mergeEnemies(
  enemies: { name: string; quantity: number }[],
): { name: string; quantity: number }[] {
  const counts = new Map<string, number>();
  for (const e of enemies) {
    const name = tidyEnemyName(e.name);
    const seen = counts.get(name) ?? 0;
    counts.set(name, isPhase(e.name) ? Math.max(seen, 1) : seen + e.quantity);
  }
  return [...counts].map(([name, quantity]) => ({ name, quantity }));
}

export function deriveOneWay(geo: RawGeoRoom): OneWay | null {
  if (geo.parts.length <= 1) return null;
  return {
    parts: geo.parts,
    transient: geo.transient_part_connections,
    durable: geo.durable_part_connections,
  };
}

/**
 * Which rooms touch which on the vanilla map, as room ids keyed by room id.
 *
 * The vanilla map lists door connections by ROM pointer, so each side is matched back to the
 * room owning that exit pointer. Doors that loop within one room are dropped.
 *
 * Ids rather than names: room_geometry spells two rooms differently from map_tiles, which is
 * canonical here, so resolving names once at the end avoids a neighbour that matches no room.
 */
export function deriveNeighbours(
  geo: RawGeoRoom[],
  map: VanillaMap,
): Record<number, number[]> {
  const roomOfExit = new Map<number, RawGeoRoom>();
  for (const room of geo) {
    for (const door of room.doors) {
      if (typeof door.exit_ptr === 'number') roomOfExit.set(door.exit_ptr, room);
    }
  }

  const found = new Map<number, Set<number>>(geo.map((r) => [r.room_id, new Set()]));
  for (const [[exitA], [exitB]] of map.doors) {
    const a = roomOfExit.get(exitA);
    const b = roomOfExit.get(exitB);
    if (!a || !b || a.room_id === b.room_id) continue;
    found.get(a.room_id)?.add(b.room_id);
    found.get(b.room_id)?.add(a.room_id);
  }
  return Object.fromEntries([...found].map(([id, ids]) => [id, [...ids]]));
}

export function buildRoom(
  rawTile: RawTileRoom,
  geo: RawGeoRoom,
  aliases: string[] = [],
  extra: SmJsonRoom = {},
  curated: string[] = [],
): Room {
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
    aliases: mergeAliases(rawTile.roomName, aliases, curated),
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
    hiddenItemCount: deriveHiddenItemCount(tiles),
    utilities: deriveUtilities(tiles),
    hasElevator: deriveHasElevator(tiles),
    oneWay: deriveOneWay(geo),
    enemies: mergeEnemies(extra.enemies ?? []),
    neighbours: extra.neighbours ?? [],
    diagram: extra.diagram ?? null,
  };
}

export function buildAllRooms(
  rawTiles: RawTileRoom[],
  rawGeo: RawGeoRoom[],
  smJson: Record<string, SmJsonRoom> = {},
  vanillaMap?: VanillaMap,
  curatedAliases: Record<string, string[]> = {},
): Room[] {
  const geoById = new Map(rawGeo.map((g) => [g.room_id, g]));
  if (geoById.size !== rawGeo.length) throw new Error('room_geometry contains duplicate room ids');

  const neighbours = vanillaMap ? deriveNeighbours(rawGeo, vanillaMap) : {};
  const canonicalName = new Map(rawTiles.map((t) => [t.roomId, t.roomName]));

  const rooms = rawTiles.map((t) => {
    const geo = geoById.get(t.roomId);
    if (!geo) throw new Error(`Room ${t.roomId} (${t.roomName}) is missing from room_geometry`);
    const extra = smJson[String(t.roomId)] ?? {};
    return buildRoom(t, geo, [], {
      ...extra,
      neighbours: (neighbours[geo.room_id] ?? [])
        .map((id) => canonicalName.get(id))
        .filter((name): name is string => name !== undefined)
        .sort(),
    }, curatedAliases[t.roomName] ?? []);
  });

  // A curated alias keyed by a name no room has would otherwise vanish without a word.
  const names = new Set(rawTiles.map((t) => t.roomName));
  for (const key of Object.keys(curatedAliases)) {
    if (!names.has(key)) throw new Error(`Curated alias for unknown room ${JSON.stringify(key)}`);
  }

  if (rooms.length !== rawGeo.length) {
    throw new Error(`Room count mismatch: ${rooms.length} tile records, ${rawGeo.length} geometry`);
  }
  return rooms.sort((a, b) => a.id - b.id);
}

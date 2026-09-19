/**
 * Turns the vendored upstream files in data/raw into src/data/rooms.json.
 *
 *   npm run build:data
 *
 * All the work lives in ./transform as pure functions; this is just IO plus the assertions
 * that guard against upstream drift. The generated file is committed, so the app needs no
 * build step to run and CI needs no network access.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAllRooms } from './transform.ts';
import type { RawGeoRoom, RawTileRoom } from './transform.ts';
import type { Room } from '../src/types.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = resolve(repoRoot, 'data/raw');
const outFile = resolve(repoRoot, 'src/data/rooms.json');

const EXPECTED_ROOMS = 253;
const EXPECTED_TILES = 1270;
const EXPECTED_ITEMS = 100;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`rooms.json build failed: ${message}`);
}

function main(): void {
  const tiles = JSON.parse(
    readFileSync(resolve(rawDir, 'map_tiles.json'), 'utf8'),
  ) as { rooms: RawTileRoom[] };
  const geo = JSON.parse(
    readFileSync(resolve(rawDir, 'room_geometry.json'), 'utf8'),
  ) as RawGeoRoom[];

  const rooms: Room[] = buildAllRooms(tiles.rooms, geo);

  assert(rooms.length === EXPECTED_ROOMS, `expected ${EXPECTED_ROOMS} rooms, got ${rooms.length}`);
  const tileCount = rooms.reduce((n, r) => n + r.tiles.length, 0);
  assert(tileCount === EXPECTED_TILES, `expected ${EXPECTED_TILES} tiles, got ${tileCount}`);
  const itemCount = rooms.reduce((n, r) => n + r.itemCount, 0);
  assert(itemCount === EXPECTED_ITEMS, `expected ${EXPECTED_ITEMS} items, got ${itemCount}`);
  assert(
    new Set(rooms.map((r) => r.name)).size === rooms.length,
    'room names are not unique, so they cannot be used as answers',
  );
  for (const r of rooms) {
    assert(r.tiles.length > 0, `room ${r.id} (${r.name}) has no tiles`);
    for (const t of r.tiles) {
      assert(
        t.x >= 0 && t.x < r.width && t.y >= 0 && t.y < r.height,
        `room ${r.id} (${r.name}) has a tile at ${t.x},${t.y} outside ${r.width}x${r.height}`,
      );
    }
  }

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify({ rooms }, null, 0)}\n`);

  const kb = (readFileSync(outFile).length / 1024).toFixed(1);
  console.log(`Wrote ${rooms.length} rooms (${tileCount} tiles, ${itemCount} items) -> ${kb} KB`);
}

main();

/**
 * Vendors a handful of real Map Rando map layouts into data/raw/maps.json.
 *
 *   npm run fetch:maps
 *
 * Map Rando does not generate maps in Rust — its generator is a trained PyTorch model in
 * python/maze_builder, so there is nothing to run and nothing worth approximating. What it
 * does do is publish the generated pools, and a pool is the real thing: layouts the
 * randomizer actually serves, each with its own shuffled assignment of rooms to areas.
 *
 * A whole pool is 364 MB. We take two byte ranges out of it instead — the tar headers, then
 * one member — which is about 2 MB for a file holding a thousand maps. The result is
 * committed, so the build never touches the network.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMaps } from './avro.ts';

const POOL = 'https://map-rando-artifacts.s3.us-west-004.backblazeb2.com/maps'
  + '/v119-standard-avro.tar';

/** How many layouts to keep. Each is six zones, so this is 150 of them. */
const MAP_COUNT = 25;

const EXPECTED_ROOMS = 253;

const rawDir = resolve(dirname(fileURLToPath(import.meta.url)), '../data/raw');

/** One tar member: 512-byte header, name at 0, size as octal at 124. */
interface TarEntry { name: string; offset: number; size: number }

function* tarEntries(header: Buffer, from = 0): Generator<TarEntry> {
  let at = from;
  while (at + 512 <= header.length) {
    const name = header.toString('utf8', at, at + 100).replace(/\0.*/s, '');
    if (name === '') return;
    const size = parseInt(header.toString('ascii', at + 124, at + 136).trim(), 8) || 0;
    yield { name, offset: at + 512, size };
    at += 512 + Math.ceil(size / 512) * 512;
  }
}

async function range(url: string, from: number, to: number): Promise<Buffer> {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
  if (!res.ok) throw new Error(`GET ${url} bytes ${from}-${to} -> ${res.status}`);
  if (res.status !== 206) {
    throw new Error(`${url} ignored the range request and sent ${res.status}; refusing to `
      + 'download the whole pool');
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  mkdirSync(rawDir, { recursive: true });

  // The tar is a flat directory of avro files; the first one is as good as any.
  const headers = await range(POOL, 0, 4095);
  const member = [...tarEntries(headers)].find((e) => e.name.endsWith('.avro'));
  if (!member) throw new Error('no .avro member in the first 4 KB of the pool tar');
  console.log(`${member.name}  ${(member.size / 1048576).toFixed(1)} MB`);

  const body = await range(POOL, member.offset, member.offset + member.size - 1);
  const decoded = readMaps(body, MAP_COUNT);
  if (decoded.length < MAP_COUNT) {
    throw new Error(`wanted ${MAP_COUNT} maps, the member only yielded ${decoded.length}`);
  }

  const maps = decoded.map((m) => {
    if (m.room_id.length !== EXPECTED_ROOMS) {
      throw new Error(`a map places ${m.room_id.length} rooms, expected ${EXPECTED_ROOMS}`);
    }
    return {
      rooms: m.room_id.map((id, i) => [id, m.room_x[i], m.room_y[i], m.room_area[i]]),
      connections: m.conn_from_room_id.map((from, i) => [
        from, m.conn_from_door_id[i], m.conn_to_room_id[i], m.conn_to_door_id[i],
        m.conn_bidirectional[i],
      ]),
    };
  });

  const out = {
    _note: 'Real Map Rando map layouts, taken from the published pool named in `source`. '
      + 'Each room is [roomId, x, y, area] and each connection is [fromRoom, fromDoor, '
      + 'toRoom, toDoor, bidirectional], where a door is an index into that room\'s doors in '
      + 'room_geometry.json. Regenerate with `npm run fetch:maps`.',
    source: { pool: POOL, member: member.name, maps: maps.length },
    maps,
  };
  const json = JSON.stringify(out);
  writeFileSync(resolve(rawDir, 'maps.json'), `${json}\n`);
  console.log(`maps.json  ${maps.length} maps, ${(json.length / 1024).toFixed(1)} KB`);
}

await main();

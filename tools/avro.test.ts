import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMaps, MAP_SCHEMA_FIELDS } from './avro';
import type { RawGeoRoom, VanillaMap } from './transform';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (f: string) => resolve(repoRoot, 'data/raw', f);

const geo = JSON.parse(readFileSync(raw('room_geometry.json'), 'utf8')) as RawGeoRoom[];
const vanilla = JSON.parse(readFileSync(raw('vanilla_map.json'), 'utf8')) as VanillaMap;
const decoded = readMaps(readFileSync(raw('vanilla_maps.avro')));

/**
 * The generated map pools are avro, and 1,000 maps to a file: there is no eyeballing them.
 * What makes the reader trustworthy is that Map Rando ships the vanilla map in both formats,
 * and this one file has to come out equal to the vanilla_map.json we already vendor — which
 * the rest of the project has been asserting numbers against since the beginning.
 */
describe('reading a map out of avro', () => {
  it('finds one map in the vanilla pool file', () => {
    expect(decoded).toHaveLength(1);
  });

  it('reads every field the schema declares', () => {
    expect(Object.keys(decoded[0] as object).sort()).toEqual([...MAP_SCHEMA_FIELDS].sort());
  });

  it('places all 253 rooms, and connects them 291 ways', () => {
    const m = decoded[0]!;
    expect(m.room_id).toHaveLength(253);
    expect(m.room_x).toHaveLength(253);
    expect(m.room_y).toHaveLength(253);
    expect(m.room_area).toHaveLength(253);
    expect(m.conn_from_room_id).toHaveLength(291);
    expect(m.conn_bidirectional.filter(Boolean)).toHaveLength(279);
  });

  it('puts every room exactly where vanilla_map.json puts it', () => {
    const m = decoded[0]!;
    const at = new Map(geo.map((g, i) => [g.room_id, vanilla.rooms[i] as [number, number]]));
    for (const [i, id] of m.room_id.entries()) {
      expect([m.room_x[i], m.room_y[i]], `room ${id}`).toEqual(at.get(id));
    }
  });

  it('gives every room the area vanilla_map.json gives it', () => {
    const m = decoded[0]!;
    const area = new Map(geo.map((g, i) => [g.room_id, vanilla.area[i]]));
    for (const [i, id] of m.room_id.entries()) {
      expect(m.room_area[i], `room ${id}`).toBe(area.get(id));
    }
    // The distribution tests/corpus.test.ts has anchored since the first round.
    const tally: Record<number, number> = {};
    for (const a of m.room_area) tally[a] = (tally[a] ?? 0) + 1;
    expect(tally).toEqual({ 0: 33, 1: 54, 2: 76, 3: 16, 4: 55, 5: 19 });
  });

  /**
   * A connection names a room and a door by id. The door id has to be an index into that
   * room's `doors` in room_geometry.json, or nothing downstream can find the door — so check
   * it resolves to the same door pointers vanilla_map.json pairs up.
   */
  it('names doors by their index in room_geometry', () => {
    const m = decoded[0]!;
    const doorsOf = new Map(geo.map((g) => [g.room_id, g.doors]));
    const pair = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    const pairs = new Set(vanilla.doors.map(([a, b]) => pair(a[0], b[0])));

    let checked = 0;
    let pointerless = 0;
    for (let i = 0; i < m.conn_from_room_id.length; i += 1) {
      const from = doorsOf.get(m.conn_from_room_id[i] as number)?.[m.conn_from_door_id[i] as number];
      const to = doorsOf.get(m.conn_to_room_id[i] as number)?.[m.conn_to_door_id[i] as number];
      expect(from, `connection ${i} from`).toBeDefined();
      expect(to, `connection ${i} to`).toBeDefined();

      // Six doors carry no exit pointer — the upward halves of Maridia's sand falls, which
      // you only ever go down through. There is nothing to match those against.
      if (typeof from!.exit_ptr !== 'number' || typeof to!.exit_ptr !== 'number') {
        pointerless += 1;
        expect(from!.subtype === 'sand' || to!.subtype === 'sand', `connection ${i}`).toBe(true);
        continue;
      }
      checked += 1;
      const key = pair(from!.exit_ptr, to!.exit_ptr);
      expect(pairs.has(key), `connection ${i} is not one vanilla_map.json makes`).toBe(true);
    }
    expect(pointerless).toBe(6);
    expect(checked).toBe(285);
  });

  it('refuses a buffer that is not avro', () => {
    expect(() => readMaps(Buffer.from('not an avro file at all'))).toThrow(/avro/i);
  });
});

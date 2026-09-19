/**
 * Just enough of the avro container format to read Map Rando's generated map pools.
 *
 * Not a general reader, on purpose. The pools use one schema — a record of flat arrays of
 * int and boolean — so this refuses anything else rather than growing to meet it. What makes
 * it trustworthy is tools/avro.test.ts: Map Rando ships the vanilla map in this format as
 * well as as JSON, and decoding it has to reproduce the JSON we already vendor.
 *
 * The format, for anyone reading this without the spec to hand: the file opens with a
 * four-byte magic, then a metadata map holding the schema and the compression codec, then a
 * 16-byte sync marker. After that come blocks, each a record count, a byte length, the data,
 * and the sync marker again. Integers are zigzag varints; an array is runs of (count, items)
 * ending at a zero count, and a negative count is followed by a byte length that can be
 * skipped.
 */
import { inflateRawSync } from 'node:zlib';

const MAGIC = Buffer.from([0x4f, 0x62, 0x6a, 0x01]);

/** The fields Map Rando's map schema declares, in order. */
export const MAP_SCHEMA_FIELDS = [
  'room_id', 'room_x', 'room_y', 'room_area', 'room_subarea', 'room_subsubarea',
  'conn_from_room_id', 'conn_from_door_id', 'conn_to_room_id', 'conn_to_door_id',
  'conn_bidirectional',
] as const;

export type MapField = (typeof MAP_SCHEMA_FIELDS)[number];

/** One generated map, exactly as the pool stores it: parallel arrays. */
export type RawMap = Record<Exclude<MapField, 'conn_bidirectional'>, number[]>
  & { conn_bidirectional: boolean[] };

interface Cursor { at: number }

/** Zigzag varint, avro's only integer encoding. */
function long(buf: Buffer, c: Cursor): number {
  let shift = 0;
  let n = 0n;
  for (;;) {
    const byte = buf[c.at];
    if (byte === undefined) throw new Error('avro: ran off the end reading an integer');
    c.at += 1;
    n |= BigInt(byte & 0x7f) << BigInt(shift);
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return Number((n >> 1n) ^ -(n & 1n));
}

function bytes(buf: Buffer, c: Cursor): Buffer {
  const length = long(buf, c);
  const out = buf.subarray(c.at, c.at + length);
  c.at += length;
  return out;
}

/** An avro array: runs of items, ending at a run of length zero. */
function array(buf: Buffer, c: Cursor, boolean: boolean): (number | boolean)[] {
  const out: (number | boolean)[] = [];
  for (;;) {
    let count = long(buf, c);
    if (count === 0) return out;
    // A negative count means the run is followed by its size in bytes, which is only useful
    // for skipping a run you do not want. We want all of them.
    if (count < 0) { count = -count; long(buf, c); }
    for (let i = 0; i < count; i += 1) {
      if (boolean) { out.push(buf[c.at] !== 0); c.at += 1; } else out.push(long(buf, c));
    }
  }
}

interface SchemaField { name: string; type: { type: string; items: string } }

function readHeader(buf: Buffer, c: Cursor): { fields: SchemaField[]; codec: string } {
  if (!buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('avro: the file does not start with the avro magic');
  }
  c.at = 4;
  const meta = new Map<string, Buffer>();
  for (;;) {
    const count = long(buf, c);
    if (count === 0) break;
    for (let i = 0; i < count; i += 1) {
      const key = bytes(buf, c).toString('utf8');
      meta.set(key, bytes(buf, c));
    }
  }
  const raw = meta.get('avro.schema');
  if (!raw) throw new Error('avro: the file carries no schema');
  const schema = JSON.parse(raw.toString('utf8')) as { fields?: SchemaField[] };
  const fields = schema.fields ?? [];
  const names = fields.map((f) => f.name);
  if (names.join(',') !== MAP_SCHEMA_FIELDS.join(',')) {
    throw new Error(`avro: expected Map Rando's map schema, got fields ${names.join(', ')}`);
  }
  for (const f of fields) {
    if (f.type.type !== 'array' || (f.type.items !== 'int' && f.type.items !== 'boolean')) {
      throw new Error(`avro: field ${f.name} is not an array of int or boolean`);
    }
  }
  const codec = meta.get('avro.codec')?.toString('utf8') ?? 'null';
  if (codec !== 'null' && codec !== 'deflate') {
    throw new Error(`avro: unsupported codec ${codec}`);
  }
  c.at += 16; // the sync marker closing the header
  return { fields, codec };
}

/**
 * Every map in an avro file. Pass `limit` to stop early — a pool file holds a thousand, and
 * a buffer cut short is fine as long as it is cut between blocks, which lets a caller
 * range-request the front of a file rather than all of it.
 */
export function readMaps(buf: Buffer, limit = Infinity): RawMap[] {
  const c: Cursor = { at: 0 };
  const { fields, codec } = readHeader(buf, c);
  const maps: RawMap[] = [];

  while (c.at < buf.length && maps.length < limit) {
    const count = long(buf, c);
    const size = long(buf, c);
    if (c.at + size > buf.length) break; // a block cut short by a partial download
    const raw = buf.subarray(c.at, c.at + size);
    c.at += size + 16; // the block's data, then its sync marker
    const data = codec === 'deflate' ? inflateRawSync(raw) : raw;

    const inner: Cursor = { at: 0 };
    for (let r = 0; r < count && maps.length < limit; r += 1) {
      const map: Record<string, (number | boolean)[]> = {};
      for (const f of fields) map[f.name] = array(data, inner, f.type.items === 'boolean');
      maps.push(map as unknown as RawMap);
    }
  }
  return maps;
}

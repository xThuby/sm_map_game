/**
 * Re-downloads the vendored upstream files at the pinned commit.
 *
 *   npm run fetch:data
 *
 * The files are committed, so this is only needed when deliberately moving to a newer
 * upstream revision. Doing so will break the regression anchors in tests/corpus.test.ts on
 * purpose: those numbers describe one exact revision of the data and must be re-derived,
 * not edited until green.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED_COMMIT = 'ea03c0aa21f3792e6ca354ec7c4257351befad4b';
const REPO = 'blkerby/MapRandomizer';

const FILES: { from: string; to: string; binary?: true }[] = [
  { from: 'rust/data/map_tiles.json', to: 'map_tiles.json' },
  { from: 'room_geometry.json', to: 'room_geometry.json' },
  { from: 'maps/vanilla/vanilla_map.json', to: 'vanilla_map.json' },
  // The same vanilla map again, in the avro container the generated map pools use. Small,
  // and decoding it has to reproduce vanilla_map.json exactly — which is what proves the
  // avro reader in tools/avro.ts before it is pointed at a pool nobody can eyeball.
  { from: 'maps/vanilla/maps-0.avro', to: 'vanilla_maps.avro', binary: true },
];

const rawDir = resolve(dirname(fileURLToPath(import.meta.url)), '../data/raw');

async function main(): Promise<void> {
  mkdirSync(rawDir, { recursive: true });
  for (const { from, to, binary } of FILES) {
    const url = `https://raw.githubusercontent.com/${REPO}/${PINNED_COMMIT}/${from}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
    const body = binary
      ? Buffer.from(await res.arrayBuffer())
      : await res.text();
    writeFileSync(resolve(rawDir, to), body);
    console.log(`${to}  ${(body.length / 1024).toFixed(1)} KB`);
  }
  console.log(`Fetched from ${REPO} @ ${PINNED_COMMIT.slice(0, 7)}`);
}

await main();

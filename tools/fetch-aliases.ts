/**
 * Extracts per-room facts from sm-json-data at a pinned commit, into
 * data/raw/sm_json_rooms.json: the room's name there, its enemies, and the path to its room
 * diagram image.
 *
 *   npm run fetch:aliases
 *
 * maprando.com/logic renders its room pages from sm-json-data, so 32 rooms are known there
 * by a different name than the map data uses ("The Jail", "Yoink Room", "Cosine Room").
 * Players read those pages, so both names have to be accepted as answers.
 *
 * Only the names are kept. The full dataset is ~10 MB of logic that Phase 1 has no use for.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED_COMMIT = 'f0a990339a2d234ed8d3ae6234c855a016aae021';
const REPO = 'vg-json-data/sm-json-data';

const rawDir = resolve(dirname(fileURLToPath(import.meta.url)), '../data/raw');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.json') ? [full] : [];
  });
}

function walkPng(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walkPng(full);
    return full.endsWith('.png') && full.includes('roomDiagrams') ? [full] : [];
  });
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'sm-json-'));
  try {
    const url = `https://codeload.github.com/${REPO}/tar.gz/${PINNED_COMMIT}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
    const tarball = join(work, 'sm-json-data.tar.gz');
    writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
    execFileSync('tar', ['-xzf', tarball, '-C', work]);

    const root = join(work, `sm-json-data-${PINNED_COMMIT}`, 'region');
    const files = walk(root);

    // Room diagrams are named <subarea>_<RoomName>_<roomId>.png.
    const diagrams: Record<string, string> = {};
    for (const file of files.length ? walkPng(root) : []) {
      const id = /_(\d+)\.png$/.exec(file)?.[1];
      if (id) diagrams[id] = file.slice(file.indexOf('region/'));
    }

    const rooms: Record<string, unknown> = {};
    for (const file of files) {
      if (file.includes('roomDiagrams')) continue;
      const doc = JSON.parse(readFileSync(file, 'utf8')) as {
        id?: number; name?: string; nodes?: unknown;
        enemies?: { enemyName?: string; quantity?: number }[];
      };
      if (typeof doc.id !== 'number' || typeof doc.name !== 'string' || !doc.nodes) continue;

      // Collapse the groups sm-json-data splits enemies into; a hint wants "5 Fune", not
      // which node they patrol.
      const counts = new Map<string, number>();
      for (const e of doc.enemies ?? []) {
        if (!e.enemyName) continue;
        counts.set(e.enemyName, (counts.get(e.enemyName) ?? 0) + (e.quantity ?? 1));
      }
      rooms[String(doc.id)] = {
        name: doc.name,
        enemies: [...counts].map(([name, quantity]) => ({ name, quantity })),
        diagram: diagrams[String(doc.id)] ?? null,
      };
    }

    const sorted = Object.fromEntries(
      Object.entries(rooms).sort(([a], [b]) => Number(a) - Number(b)),
    );
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(resolve(rawDir, 'sm_json_rooms.json'), `${JSON.stringify(sorted, null, 1)}\n`);
    console.log(`Wrote ${Object.keys(sorted).length} rooms from ${REPO} @ ${PINNED_COMMIT.slice(0, 7)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();

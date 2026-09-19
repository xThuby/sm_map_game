import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import viteConfig from '../vite.config';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(repoRoot, 'dist');

/**
 * The GitHub Pages base path. `gh repo create --source=.` names the repo after the
 * directory, so the directory name is the repo name is the base path. A mismatch here is
 * the classic Vite-on-Pages failure: the site deploys, then serves a blank page because
 * every asset 404s at the domain root.
 */
const EXPECTED_BASE = '/sm_map_game/';

describe('vite config', () => {
  it('sets a base path for GitHub Pages project hosting', () => {
    expect(viteConfig.base).toBe(EXPECTED_BASE);
  });

  it('keeps the base path in step with the repo directory name', () => {
    expect(viteConfig.base).toBe(`/${basename(repoRoot)}/`);
  });
});

describe('production build', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: repoRoot, stdio: 'pipe' });
  }, 120_000);

  it('emits dist/index.html', () => {
    expect(existsSync(resolve(dist, 'index.html'))).toBe(true);
  });

  it('prefixes every asset reference with the base path', () => {
    const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((r): r is string => r !== undefined);

    // A build that emits no asset references would pass the check below vacuously.
    expect(refs.length).toBeGreaterThan(0);

    const rootRelative = refs.filter((r) => r.startsWith('/'));
    expect(rootRelative.length).toBeGreaterThan(0);
    for (const ref of rootRelative) {
      expect(ref.startsWith(EXPECTED_BASE)).toBe(true);
    }
  });

  it('emits no bare /assets/ reference', () => {
    const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
    expect(html).not.toMatch(/(?:src|href)="\/assets\//);
  });
});

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});

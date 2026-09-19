import { defineConfig } from 'vitest/config';

/**
 * Deployed to GitHub Pages as a project site at https://xthuby.github.io/sm_map_game/,
 * so every asset must be served from that subpath rather than the domain root.
 * Guarded by tests/build.test.ts.
 */
export default defineConfig({
  base: '/sm_map_game/',
  build: {
    // Two review pages beside the game: par.html for judging the par numbers, map.html for
    // looking at the generated map layouts hard mode will be built on.
    rollupOptions: { input: { main: 'index.html', par: 'par.html', map: 'map.html' } },
  },
  test: {
    // Deliberately broad: a narrower list once silently skipped tools/, and a test file that
    // is never collected is worse than one that fails.
    include: ['**/*.test.ts'],
    environment: 'node',
  },
});

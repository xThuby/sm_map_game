# SM Map Rando Trainer

A browser trainer for [Super Metroid Map Rando](https://maprando.com/). It shows a room as it
appears on the Map Rando map screen; you identify it. Hard mode also asks what the room
contains — heat, liquid, items, doors, one-way exits.

Live: https://xthuby.github.io/sm_map_game/

## Development

```
npm install
npm run dev          # dev server
npm test             # full suite
npm run test:watch   # watch mode
npm run build        # typecheck + production build
```

Deployment is automatic: a push to `main` runs the tests, and only a green suite gets built
and published to GitHub Pages.

Room data is vendored in `data/raw/` at a pinned upstream commit — see
[ATTRIBUTION.md](ATTRIBUTION.md). The numbers asserted in `tests/corpus.test.ts` are only
stable against that commit; refreshing the data means re-deriving them.

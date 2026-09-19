# SM Map Rando Trainer

A browser trainer for [Super Metroid Map Rando](https://maprando.com/). It shows a room as it
appears on the Map Rando map screen; you identify it. Hard mode also asks what the room
contains — heat, liquid, items, doors, one-way exits.

Live: https://xthuby.github.io/sm_map_game/

A round is six rooms; after each one you get a summary of how it went against your running
stats, which are kept in the browser.

There is a par review page at `/par.html` — how many guesses each room ought to take, with the
reasoning, for checking those numbers look sensible. It is not linked from the game.

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

The map is drawn exactly as a **Community Race Season 5** seed draws it — Map Rando's current
tournament preset. Two of that preset's settings depend on a seed rather than a room and so
are not modelled: the ammo and beam door locks the randomizer assigns, and 4-Tiered item
markers, whose shape depends on which item landed there. The 19 fixed gray locks on boss,
miniboss and pirate doors *are* drawn.

The renderer is a port of Map Rando's own `render_tile`, verified by composing the whole
vanilla map and diffing it against Map Rando's published render of that map: 99.01% of
non-backdrop pixels are byte-identical.

Room data is vendored in `data/raw/` at a pinned upstream commit — see
[ATTRIBUTION.md](ATTRIBUTION.md). The numbers asserted in `tests/corpus.test.ts` are only
stable against that commit; refreshing the data means re-deriving them.

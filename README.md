# SM Map Rando Trainer

A browser trainer for [Super Metroid Map Rando](https://maprando.com/). It shows a room as it
appears on the Map Rando map screen; you identify it. Hard mode also asks what the room
contains — heat, liquid, items, doors, one-way exits.

Live: https://xthuby.github.io/sm_map_game/

Each room starts at 100 points, and everything comes out of that one purse. Hints are on
sale from the start rather than handed out on a schedule — the original map area costs 5, the
enemy list 5, the connecting rooms 15, the room graphics 20, and the name 25 for one random
letter, twice. The room's name is masked from the start, so its shape is free. The lot comes
to 95: every hint is always within reach, and naming a room after taking them all still pays
5.

A room is lost by giving up or by guessing wrong, never by buying. A hint priced at exactly
what is left would empty the room, so it is not for sale — its button is shown, disabled, so
you can see what you can no longer reach.

A wrong answer costs 10, and throws in the area hint the first time and the enemy list the
second — 10 for a hint that costs 5 to ask for either way, because it is a consolation for
the guess rather than a cheaper way to the hint. After that a wrong answer just costs the 10. There is
no guess allowance: you keep going until you name the room or a wrong answer takes the last
of the points, which is ten of them if you buy nothing. A room you never get is worth
nothing, whatever you spent on it. A room already guessed is refused rather than charged for.

Only the room actually shown counts as right. Rooms that draw identically are named on the
reveal, but a hint will always separate them, so naming the wrong twin is a wrong answer.

Once a round is over you can walk back through its six rooms with the left and right arrows,
which show each room as it was and what the round stood at then.

A round is six rooms; after each one you get a summary of how it went — points won, guesses
taken, rooms going worst — against your running stats, which are kept in the browser.

Every price lives in [src/game/costs.ts](src/game/costs.ts) — what a room is worth, what
each hint costs, what a wrong answer costs, and which hints a wrong answer throws in. Tweak
them there; `src/game/costs.test.ts` guards the two things the balance depends on, so a
change that breaks one says so.

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

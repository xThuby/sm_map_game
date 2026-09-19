# Attribution

This project is an unofficial fan-made training tool. It is not affiliated with Nintendo, and
contains no Super Metroid ROM data, graphics, or audio.

## Super Metroid Map Randomizer

The room data in `data/raw/` — `map_tiles.json`, `room_geometry.json`, `vanilla_map.json` and
`vanilla_maps.avro` — is taken verbatim from
[blkerby/MapRandomizer](https://github.com/blkerby/MapRandomizer), pinned at commit
`ea03c0aa21f3792e6ca354ec7c4257351befad4b`.

`data/raw/maps.json` holds 25 generated map layouts, taken from that project's published map
pool at
`https://map-rando-artifacts.s3.us-west-004.backblazeb2.com/maps/v119-standard-avro.tar`.
They are output of the generator in its `python/maze_builder`, and are redistributed here
under the same MIT licence as the code that produced them. `tools/fetch-maps.ts` refetches
them; `tools/avro.ts` reads the container format, and is checked against `vanilla_maps.avro`,
which is the same vanilla map that `vanilla_map.json` already gives us in another form.

`data/raw/tile_art.json` is the map tile artwork, mechanically extracted from that commit's
`rust/maprando/src/patch/map_tiles.rs` (`render_tile`). `src/render/pixelRenderer.ts` is a
port of `render_tile` and `draw_edge` from the same file.

The palette in `src/render/palette.ts` was measured rather than copied: the SNES stores map
tiles as palette indices and swaps the palette per region, so the colours live in the ROM. No
ROM data is redistributed here. The values were recovered by rendering the vanilla map with
this project's own renderer and reading back the colours at each pixel from Map Rando's
published render of that map, and are reproduced here as measurements of a public image.

```
MIT License

Copyright (c) 2023 maddo, kyleb

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## sm-json-data

`data/raw/sm_json_rooms.json` is derived from
[sm-json-data](https://github.com/vg-json-data/sm-json-data), pinned at commit
`f0a990339a2d234ed8d3ae6234c855a016aae021`. It contains, per room id, only the name that
dataset uses, the enemies it lists, and the path to its room diagram; the logic data itself
is not redistributed here.

sm-json-data is developed by the A Link to the Past Randomizer & Super Metroid Randomizer
communities and is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This project uses it unmodified in
substance, as an attributed derivative.

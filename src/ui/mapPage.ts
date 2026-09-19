import { loadMaps, layoutFor } from '../map/layout';
import { renderMap, fitMapTileSize, MAP_VIEWPORT } from '../render/composeMap';
import { AREAS } from '../types';
import type { Layout } from '../map/layout';
import type { MapRenderer } from '../render/composeMap';
import type { Area, RenderSettings } from '../types';

/**
 * A page that draws one zone of one map and nothing else.
 *
 * Hard mode will ask questions about these layouts, and there is no judging whether a layout
 * is worth asking about from a test that counts tiles. This is for looking at them: step
 * through the maps and the six areas of each, and see whether they read as map screens.
 */

export interface MapPageOptions {
  settings: RenderSettings;
  renderer?: MapRenderer;
  random?: () => number;
}

const defaultRenderer: MapRenderer = { render: renderMap };

export function mountMapPage(root: HTMLElement, options: MapPageOptions): void {
  const { settings, renderer = defaultRenderer, random = Math.random } = options;
  const maps = loadMaps();

  root.innerHTML = `
    <h1>Map layouts</h1>
    <p>One zone of one generated Map Rando map, drawn the way its map screen would.</p>
    <p>
      <label>Map
        <select data-role="map">${maps
    .map((_, i) => `<option value="${i}">${i + 1}</option>`).join('')}</select>
      </label>
      <label style="margin-left:16px">Zone
        <select data-role="area">${AREAS
    .map((a) => `<option value="${a}">${a}</option>`).join('')}</select>
      </label>
      <button data-action="another" style="margin-left:16px">Another zone</button>
    </p>
    <p data-role="caption"></p>
    <div data-role="stage" style="line-height:0;max-width:100%;overflow-x:auto">
      <canvas data-role="map-canvas"></canvas>
    </div>
  `;

  const el = <T extends Element>(sel: string): T => {
    const found = root.querySelector<T>(sel);
    if (!found) throw new Error(`missing ${sel}`);
    return found;
  };

  const canvas = el<HTMLCanvasElement>('canvas[data-role=map-canvas]');
  const mapSelect = el<HTMLSelectElement>('select[data-role=map]');
  const areaSelect = el<HTMLSelectElement>('select[data-role=area]');
  const caption = el<HTMLParagraphElement>('[data-role=caption]');

  let at = 0;
  let area: Area = AREAS[0] as Area;

  function draw(): void {
    const layout: Layout = layoutFor(maps[at]!, area);
    const tileSize = fitMapTileSize(layout, MAP_VIEWPORT);
    renderer.render(canvas, layout, { ...settings, tileSize });
    caption.textContent = `Map ${at + 1} of ${maps.length}, ${layout.area}`
      + ` — ${layout.placements.length} rooms, ${layout.width} x ${layout.height} tiles,`
      + ` drawn at ${tileSize} pixels a tile`;
  }

  /** The controls follow the dice, or the page stops saying what it is showing. */
  function show(nextMap: number, nextArea: Area): void {
    at = nextMap;
    area = nextArea;
    mapSelect.value = String(at);
    areaSelect.value = area;
    draw();
  }

  mapSelect.addEventListener('change', () => show(Number(mapSelect.value), area));
  areaSelect.addEventListener('change', () => show(at, areaSelect.value as Area));
  el<HTMLButtonElement>('button[data-action=another]').addEventListener('click', () => {
    show(
      Math.floor(random() * maps.length),
      AREAS[Math.floor(random() * AREAS.length)] as Area,
    );
  });

  show(at, area);
}

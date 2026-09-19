/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountMapPage } from './mapPage';
import { loadMaps } from '../map/layout';
import { TOURNAMENT_SETTINGS } from '../render/renderer';
import { AREAS } from '../types';
import type { Layout } from '../map/layout';
import { MAP_VIEWPORT } from '../render/composeMap';
import type { MapRenderer } from '../render/composeMap';

const maps = loadMaps();
const seeded = (seed: number) => {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
};

let root: HTMLElement;
let drawn: { layout: Layout; tileSize: number }[];
const q = <T extends Element>(sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const click = (sel: string) => q<HTMLButtonElement>(sel).click();
const choose = (sel: string, value: string) => {
  const select = q<HTMLSelectElement>(sel);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

/** jsdom has no canvas, so this records what the page asked to be drawn. */
const recorder: MapRenderer = {
  render(_canvas, layout, settings) { drawn.push({ layout, tileSize: settings.tileSize }); },
};

const mount = (random = seeded(3)) => {
  root = document.createElement('div');
  document.body.append(root);
  return mountMapPage(root, {
    settings: { ...TOURNAMENT_SETTINGS }, renderer: recorder, random,
  });
};

beforeEach(() => {
  document.body.innerHTML = '';
  drawn = [];
});

describe('the map page', () => {
  it('draws a zone as soon as it is mounted', () => {
    mount();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.layout.placements.length).toBeGreaterThan(0);
    expect(q('canvas')).toBeTruthy();
  });

  it('says which map and which zone is on screen', () => {
    mount();
    const caption = q('[data-role=caption]').textContent ?? '';
    expect(caption).toContain(drawn[0]!.layout.area);
    expect(caption).toMatch(/\d+ rooms/);
    expect(caption).toMatch(/\d+ x \d+ tiles/);
  });

  it('offers every vendored map and every area', () => {
    mount();
    expect(q('select[data-role=map]').querySelectorAll('option')).toHaveLength(maps.length);
    const areas = [...q('select[data-role=area]').querySelectorAll('option')]
      .map((o) => o.textContent);
    expect(areas).toEqual([...AREAS]);
  });

  it('draws the area that was chosen', () => {
    mount();
    choose('select[data-role=area]', 'Tourian');
    expect(drawn[drawn.length - 1]?.layout.area).toBe('Tourian');
    choose('select[data-role=area]', 'Maridia');
    expect(drawn[drawn.length - 1]?.layout.area).toBe('Maridia');
  });

  it('draws the map that was chosen, keeping the area', () => {
    mount();
    choose('select[data-role=area]', 'Brinstar');
    choose('select[data-role=map]', '4');
    const last = drawn[drawn.length - 1]!;
    expect(last.layout.area).toBe('Brinstar');
    const expected = maps[4]!.rooms.filter(([, , , a]) => AREAS[a] === 'Brinstar').length;
    expect(last.layout.placements).toHaveLength(expected);
  });

  /** The controls have to follow the dice, or the page stops saying what it is showing. */
  it('moves the controls to whatever a reseed lands on', () => {
    mount();
    click('button[data-action=another]');
    const last = drawn[drawn.length - 1]!;
    expect(q<HTMLSelectElement>('select[data-role=area]').value).toBe(last.layout.area);
    const chosen = Number(q<HTMLSelectElement>('select[data-role=map]').value);
    expect(maps[chosen]).toBeDefined();
  });

  it('lands somewhere different over a few reseeds', () => {
    mount(seeded(11));
    for (let i = 0; i < 12; i += 1) click('button[data-action=another]');
    const seen = new Set(drawn.map((d) => `${d.layout.area}:${d.layout.placements.length}`));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('fits every zone it draws to the page', () => {
    mount();
    for (const area of AREAS) {
      choose('select[data-role=area]', area);
      const { layout, tileSize } = drawn[drawn.length - 1]!;
      expect(tileSize % 8, area).toBe(0);
      expect(layout.width * tileSize, area).toBeLessThanOrEqual(MAP_VIEWPORT.width);
      expect(layout.height * tileSize, area).toBeLessThanOrEqual(MAP_VIEWPORT.height);
      // Never at native size on this page: every zone clears the second step.
      expect(tileSize, area).toBeGreaterThanOrEqual(16);
    }
  });

  it('draws once per change, not once per redraw', () => {
    mount();
    const before = drawn.length;
    choose('select[data-role=area]', 'Norfair');
    expect(drawn).toHaveLength(before + 1);
  });
});

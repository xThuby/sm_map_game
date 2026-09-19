/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountParPage, lookAlikeGroups } from './parPage';
import { guessableRooms } from '../rooms';
import { DEFAULT_RENDER_SETTINGS } from '../render/renderer';
import { allPars } from '../game/par';
import type { Renderer } from '../render/renderer';

const noopRenderer: Renderer = { render() { /* jsdom has no canvas */ } };
const pool = guessableRooms();
const pars = allPars(pool, DEFAULT_RENDER_SETTINGS);

let root: HTMLElement;
const q = <T extends Element>(sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const mount = () => {
  root = document.createElement('div');
  document.body.append(root);
  return mountParPage(root, {
    rooms: pool, settings: DEFAULT_RENDER_SETTINGS, renderer: noopRenderer,
  });
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('lookAlikeGroups', () => {
  /** Every room worth reviewing has at least one twin; that is why its par is above one. */
  it('covers every room above par one', () => {
    const grouped = new Set(lookAlikeGroups(pool, DEFAULT_RENDER_SETTINGS)
      .flatMap((g) => g.rooms.map((r) => r.id)));
    for (const p of pars) {
      if (p.par > 1) expect(grouped.has(p.room.id), p.room.name).toBe(true);
    }
  });

  it('holds no group of one', () => {
    for (const g of lookAlikeGroups(pool, DEFAULT_RENDER_SETTINGS)) {
      expect(g.rooms.length).toBeGreaterThan(1);
    }
  });

  it('puts each room in at most one group', () => {
    const seen = new Set<number>();
    for (const g of lookAlikeGroups(pool, DEFAULT_RENDER_SETTINGS)) {
      for (const r of g.rooms) {
        expect(seen.has(r.id), r.name).toBe(false);
        seen.add(r.id);
      }
    }
  });

  it('names a group after the rooms in it', () => {
    const g = lookAlikeGroups(pool, DEFAULT_RENDER_SETTINGS)
      .find((x) => x.rooms.some((r) => r.name === 'Wave Beam Room'));
    expect(g?.label).toContain('Wave Beam Room');
  });
});

describe('the par page', () => {
  it('leaves out every par one room', () => {
    mount();
    const listed = [...root.querySelectorAll('[data-role=room]')]
      .map((el) => el.getAttribute('data-par'));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed).not.toContain('1');
  });

  it('shows every room above par one', () => {
    mount();
    expect(root.querySelectorAll('[data-role=room]')).toHaveLength(
      pars.filter((p) => p.par > 1).length,
    );
  });

  it('offers a group to filter by', () => {
    mount();
    const select = q<HTMLSelectElement>('select[data-role=group]');
    expect(select.options.length).toBeGreaterThan(1);
  });

  it('narrows to one group when you pick it', () => {
    mount();
    const select = q<HTMLSelectElement>('select[data-role=group]');
    select.value = select.options[1]!.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const shown = [...root.querySelectorAll('[data-role=room]')];
    expect(shown.length).toBeGreaterThan(1);
    expect(shown.length).toBeLessThan(pars.filter((p) => p.par > 1).length);
  });

  /** The point of the page is judging whether a par is fair, which needs the reasoning. */
  it('shows what each room is confusable with, and what settles it', () => {
    mount();
    const first = q('[data-role=room]');
    expect(first.querySelector('[data-role=par]')).toBeTruthy();
    expect(first.querySelector('[data-role=resolved-by]')).toBeTruthy();
    expect(first.querySelector('[data-role=steps]')?.textContent).toMatch(/shape/);
    expect(first.querySelector('canvas')).toBeTruthy();
  });

  it('shows the facts a hint would give away', () => {
    mount();
    const text = q('[data-role=room]').textContent ?? '';
    expect(text).toMatch(/area/i);
    expect(text).toMatch(/enem/i);
    expect(text).toMatch(/connect/i);
  });

  it('counts the rooms at each par', () => {
    mount();
    expect(q('[data-role=summary]').textContent).toMatch(/par 2/i);
  });
});

describe('ordering', () => {
  const shownNames = () => [...root.querySelectorAll('[data-role=room]')]
    .map((el) => el.querySelector('strong')?.textContent ?? '');

  /** Judging whether a par is fair means comparing a room against the ones it looks like. */
  it('keeps every look-alike group together in one run', () => {
    mount();
    const names = shownNames();
    for (const group of lookAlikeGroups(pool, DEFAULT_RENDER_SETTINGS)) {
      const positions = group.rooms
        .map((r) => names.indexOf(r.name))
        .sort((a, b) => a - b);
      expect(positions[0], group.label).toBeGreaterThanOrEqual(0);
      expect(
        (positions[positions.length - 1] as number) - (positions[0] as number),
        group.label,
      ).toBe(positions.length - 1);
    }
  });

  it('puts the two Aqueduct Quicksand Rooms next to each other', () => {
    mount();
    const names = shownNames();
    const east = names.indexOf('East Aqueduct Quicksand Room');
    const west = names.indexOf('West Aqueduct Quicksand Room');
    expect(east).toBeGreaterThanOrEqual(0);
    expect(Math.abs(east - west)).toBe(1);
  });

  it('heads each run with the group it belongs to', () => {
    mount();
    const headings = root.querySelectorAll('[data-role=group-heading]');
    expect(headings).toHaveLength(lookAlikeGroups(pool, DEFAULT_RENDER_SETTINGS).length);
  });

  it('orders rooms within a group by par, hardest first', () => {
    mount();
    for (const section of root.querySelectorAll('[data-role=group-section]')) {
      const pars = [...section.querySelectorAll('[data-role=room]')]
        .map((el) => Number(el.getAttribute('data-par')));
      expect(pars).toEqual([...pars].sort((a, b) => b - a));
    }
  });
});

describe('group headings', () => {
  it('names a single par plainly and a spread as a range', () => {
    mount();
    const headings = [...root.querySelectorAll('[data-role=group-heading]')]
      .map((h) => h.textContent ?? '');
    expect(headings.some((h) => /par \d$/.test(h))).toBe(true);
    expect(headings.some((h) => /par \d–\d$/.test(h))).toBe(true);
    expect(headings.every((h) => !h.includes('and'))).toBe(true);
  });
});

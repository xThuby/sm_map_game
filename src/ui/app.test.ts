/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp, ALIAS_ISSUE_BASE, ZOOM_FACTOR, plural } from './app';
import { loadRooms } from '../rooms';
import { TOURNAMENT_SETTINGS } from '../render/renderer';
import { MAX_GUESSES } from '../game/session';
import type { Renderer } from '../render/renderer';

const noopRenderer: Renderer = { render() { /* jsdom has no canvas */ } };
const rooms = loadRooms();
const seeded = () => {
  let s = 42;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
};

let root: HTMLElement;
const q = <T extends Element>(sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const click = (sel: string) => q<HTMLButtonElement>(sel).click();
const type = (value: string) => {
  const input = q<HTMLInputElement>('input[name=answer]');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const mount = (pool = rooms) => {
  root = document.createElement('div');
  document.body.append(root);
  return mountApp(root, {
    rooms: pool, settings: { ...TOURNAMENT_SETTINGS }, renderer: noopRenderer, random: seeded(),
  });
};
const only = (name: string) => mount(rooms.filter((r) => r.name === name));

beforeEach(() => { document.body.innerHTML = ''; });

describe('plural', () => {
  it('uses -es after a sibilant', () => {
    expect(plural(4, 'guess')).toBe('4 guesses');
    expect(plural(0, 'guess')).toBe('0 guesses');
  });

  it('uses -s otherwise', () => {
    expect(plural(2, 'item')).toBe('2 items');
    expect(plural(3, 'door')).toBe('3 doors');
  });

  it('leaves a single one alone', () => {
    expect(plural(1, 'guess')).toBe('1 guess');
    expect(plural(1, 'item')).toBe('1 item');
  });
});

describe('layout', () => {
  it('shows a canvas, an answer box, Answer and Skip', () => {
    mount();
    expect(q('canvas')).toBeTruthy();
    expect(q('input[name=answer]')).toBeTruthy();
    expect(q('button[data-action=guess]')).toBeTruthy();
    expect(q('button[data-action=skip]')).toBeTruthy();
  });

  it('says how many guesses are left', () => {
    mount();
    expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES));
  });

  /** Next must not look like a way out of the room; Skip is what buys a hint. */
  it('hides Next until the room is over', () => {
    const app = only('Volcano Room');
    expect(q<HTMLButtonElement>('button[data-action=next]').hidden).toBe(true);
    type('Volcano Room');
    click('button[data-action=guess]');
    expect(q<HTMLButtonElement>('button[data-action=next]').hidden).toBe(false);
    void app;
  });

  it('hides Answer and Skip once the room is over', () => {
    only('Volcano Room');
    type('Volcano Room');
    click('button[data-action=guess]');
    expect(q<HTMLButtonElement>('button[data-action=guess]').hidden).toBe(true);
    expect(q<HTMLButtonElement>('button[data-action=skip]').hidden).toBe(true);
  });

  it('does not name the room before it is over', () => {
    const app = only('Volcano Room');
    expect(root.textContent).not.toContain('Volcano Room');
    void app;
  });
});

describe('guessing', () => {
  it('says Incorrect for a wrong room', () => {
    only('Volcano Room');
    type('Landing Site');
    click('button[data-action=guess]');
    expect(q('[data-role=verdict]').textContent).toMatch(/incorrect/i);
  });

  it('counts down the guesses as they are spent', () => {
    only('Volcano Room');
    click('button[data-action=skip]');
    expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES - 1));
  });

  it('reveals a hint per spent guess', () => {
    only('Volcano Room');
    click('button[data-action=skip]');
    expect(q('[data-role=hints]').textContent).toContain('Norfair');
    click('button[data-action=skip]');
    expect(q('[data-role=hints]').textContent).toContain('Fune');
  });

  it('shows the room diagram while the final guess is still available', () => {
    only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES - 1; i += 1) click('button[data-action=skip]');
    expect(q('[data-role=guesses]').textContent).toContain('1 guess left');
    expect(q<HTMLImageElement>('[data-role=hints] img').src).toContain('VolcanoRoom_116.png');
  });

  it('reveals the answer once every guess is spent', () => {
    only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES; i += 1) click('button[data-action=skip]');
    expect(q('[data-role=reveal]').textContent).toContain('Volcano Room');
  });

  it('does nothing at all when the box is empty', () => {
    only('Volcano Room');
    click('button[data-action=guess]');
    expect(q('[data-role=verdict]').textContent).toBe('');
    expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES));
  });

  it('suggests a near miss without spending a guess', () => {
    only('Volcano Room');
    type('Volcanoe Room');
    click('button[data-action=guess]');
    expect(q('[data-role=verdict]').textContent).toContain('Volcano Room');
    expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES));
  });
});

describe('the reveal', () => {
  const revealOf = (name: string) => {
    only(name);
    for (let i = 0; i < MAX_GUESSES; i += 1) click('button[data-action=skip]');
    return q('[data-role=reveal]').textContent ?? '';
  };
  /** Facts render as separate list items; textContent would run them together. */
  const factsOf = (name: string) => {
    only(name);
    for (let i = 0; i < MAX_GUESSES; i += 1) click('button[data-action=skip]');
    return [...root.querySelectorAll('[data-role=reveal] li')].map((li) => li.textContent ?? '');
  };

  it('says nothing about heat when the room is not heated', () => {
    expect(revealOf('The Moat')).not.toMatch(/not heated/i);
  });

  it('says a room is heated when it is', () => {
    expect(revealOf('Volcano Room')).toMatch(/heated/i);
  });

  it('omits the items line when there are none', () => {
    expect(factsOf('Volcano Room').some((f) => /item/i.test(f))).toBe(false);
  });

  it('writes item singular and items plural', () => {
    expect(factsOf('Crateria Power Bomb Room')).toContain('1 item');
    expect(factsOf('East Sand Hole')).toContain('2 items');
  });

  it('names the look-alikes when there are any', () => {
    expect(revealOf('Wave Beam Room')).toContain('Ice Beam Room');
  });

  it('offers a prefilled issue link for suggesting another name', () => {
    only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES; i += 1) click('button[data-action=skip]');
    const link = q<HTMLAnchorElement>('[data-role=reveal] a[data-action=suggest-alias]');
    expect(link.href).toContain(ALIAS_ISSUE_BASE);
    const params = new URL(link.href).searchParams;
    expect(params.get('title')).toContain('Volcano Room');
    expect(params.get('body')).toContain('Volcano Room');
    expect(params.get('labels')).toBe('alias-suggestion');
  });
});

describe('typing', () => {
  it('offers completions as you type', () => {
    mount();
    type('wrecked ship main');
    expect(q('[data-role=suggestions]').textContent).toContain('Wrecked Ship Main Shaft');
  });

  it('completes to the top suggestion on Tab', () => {
    mount();
    const input = q<HTMLInputElement>('input[name=answer]');
    type('wrecked ship main');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(input.value).toBe('Wrecked Ship Main Shaft');
  });

  it('leaves Tab alone when there is nothing to complete', () => {
    mount();
    const input = q<HTMLInputElement>('input[name=answer]');
    type('zzzzzz');
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('submits on Enter', () => {
    const app = only('Volcano Room');
    const input = q<HTMLInputElement>('input[name=answer]');
    input.value = 'Volcano Room';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(app.session.state()).toBe('solved');
  });
});

describe('moving on', () => {
  it('clears the board for the next room', () => {
    const app = mount();
    type(app.session.current().name);
    click('button[data-action=guess]');
    click('button[data-action=next]');
    expect(q<HTMLInputElement>('input[name=answer]').value).toBe('');
    expect(q('[data-role=verdict]').textContent).toBe('');
    expect(q('[data-role=hints]').textContent).toBe('');
    expect(q('[data-role=reveal]').textContent).toBe('');
    expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES));
  });

  it('keeps a running score', () => {
    const app = mount();
    for (let i = 0; i < 3; i += 1) {
      type(app.session.current().name);
      click('button[data-action=guess]');
      click('button[data-action=next]');
    }
    expect(q('[data-role=score]').textContent).toContain('3');
  });
});

describe('the stage', () => {
  /**
   * Rooms are drawn with white walls on an unpainted backdrop, so on a white page the
   * outlines disappear entirely. The black behind them is what makes the room readable.
   */
  it('puts black behind the room, with room to breathe around it', () => {
    mount();
    const style = q<HTMLDivElement>('[data-role=stage]').style;
    expect(style.background).toMatch(/#000|black|rgb\(0, 0, 0\)/);
    expect(parseInt(style.padding, 10)).toBeGreaterThan(0);
  });
});

describe('zoom', () => {
  const stage = () => q<HTMLDivElement>('[data-role=stage]');

  it('starts zoomed out', () => {
    mount();
    expect(stage().dataset['zoom']).toBe('out');
  });

  it('zooms in on click and back out on a second click', () => {
    mount();
    stage().click();
    expect(stage().dataset['zoom']).toBe('in');
    stage().click();
    expect(stage().dataset['zoom']).toBe('out');
  });

  it('scales the map by the zoom factor while zoomed in', () => {
    mount();
    stage().click();
    expect(q<HTMLCanvasElement>('canvas').style.transform).toContain(`scale(${ZOOM_FACTOR})`);
  });

  it('pans with the pointer, so the point under it stays put', () => {
    mount();
    // jsdom does no layout, so the stage would otherwise measure zero and never pan.
    stage().getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    stage().click();
    const canvas = q<HTMLCanvasElement>('canvas');

    stage().dispatchEvent(new MouseEvent('mousemove', { clientX: 25, clientY: 25, bubbles: true }));
    expect(canvas.style.transformOrigin).toBe('25% 25%');
    stage().dispatchEvent(new MouseEvent('mousemove', { clientX: 90, clientY: 10, bubbles: true }));
    expect(canvas.style.transformOrigin).toBe('90% 10%');
  });

  it('keeps the origin inside the map when the pointer leaves it', () => {
    mount();
    stage().getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    stage().click();
    stage().dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: -50, bubbles: true }));
    expect(q<HTMLCanvasElement>('canvas').style.transformOrigin).toBe('100% 0%');
  });

  it('ignores pointer movement while zoomed out', () => {
    mount();
    const canvas = q<HTMLCanvasElement>('canvas');
    stage().dispatchEvent(new MouseEvent('mousemove', { clientX: 90, clientY: 90, bubbles: true }));
    expect(canvas.style.transform).toBe('');
  });

  it('zooms out again when the next room is shown', () => {
    const app = mount();
    stage().click();
    type(app.session.current().name);
    click('button[data-action=guess]');
    click('button[data-action=next]');
    expect(stage().dataset['zoom']).toBe('out');
  });
});

/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp, ALIAS_ISSUE_BASE, plural } from './app';
import { loadRooms } from '../rooms';
import { TOURNAMENT_SETTINGS, MAX_TILE_SIZE, VIEWPORT } from '../render/renderer';
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

  it('has every hint out while the final guess is still available', () => {
    only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES - 1; i += 1) click('button[data-action=skip]');
    expect(q('[data-role=guesses]').textContent).toContain('1 guess left');
    expect(q('[data-role=hints]').textContent).toContain('Norfair');
  });

  it('reveals the answer once every guess is spent', () => {
    only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES; i += 1) click('button[data-action=skip]');
    expect(q('[data-role=reveal]').textContent).toContain('Volcano Room');
  });

  /** A button labelled Answer should not spend a guess on a hint; only Enter offers that. */
  it('does nothing when the Answer button is pressed with an empty box', () => {
    only('Volcano Room');
    click('button[data-action=guess]');
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

describe('fitting the room on screen', () => {
  /**
   * The renderer is handed a tile size chosen per room, so a twelve-tile-tall shaft is drawn
   * smaller rather than running off the page. The whole room has to stay visible; you cannot
   * identify what you cannot see.
   */
  it('draws a small room at full size', () => {
    const sizes: number[] = [];
    const recorder: Renderer = { render(_c, _r, s) { sizes.push(s.tileSize); } };
    const root2 = document.createElement('div');
    document.body.append(root2);
    mountApp(root2, {
      rooms: rooms.filter((r) => r.name === 'The Moat'),
      settings: { ...TOURNAMENT_SETTINGS }, renderer: recorder, random: seeded(),
    });
    expect(sizes[0]).toBe(MAX_TILE_SIZE);
  });

  it('shrinks the tallest room in the game so it fits', () => {
    const sizes: number[] = [];
    const recorder: Renderer = { render(_c, _r, s) { sizes.push(s.tileSize); } };
    const root2 = document.createElement('div');
    document.body.append(root2);
    mountApp(root2, {
      rooms: rooms.filter((r) => r.name === 'Green Brinstar Main Shaft'),
      settings: { ...TOURNAMENT_SETTINGS }, renderer: recorder, random: seeded(),
    });
    expect(sizes[0]).toBeLessThan(MAX_TILE_SIZE);
    expect((sizes[0] as number) * 12).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('re-fits when the next room is a different shape', () => {
    const sizes: number[] = [];
    const recorder: Renderer = { render(_c, _r, s) { sizes.push(s.tileSize); } };
    const root2 = document.createElement('div');
    document.body.append(root2);
    mountApp(root2, {
      rooms, settings: { ...TOURNAMENT_SETTINGS }, renderer: recorder, random: seeded(),
    });
    for (let i = 0; i < 12; i += 1) {
      for (let k = 0; k < MAX_GUESSES; k += 1) {
        root2.querySelector<HTMLButtonElement>('button[data-action=skip]')!.click();
      }
      root2.querySelector<HTMLButtonElement>('button[data-action=next]')!.click();
    }
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });
});

describe('the two columns', () => {
  /**
   * A tall shaft at this scale runs far past the fold, which pushed the answer box off
   * screen entirely. The map gets its own column and the guessing sticks beside it.
   */
  it('puts the map and the heading on the left', () => {
    mount();
    const left = q<HTMLDivElement>('[data-role=left]');
    expect(left.querySelector('h1')).toBeTruthy();
    expect(left.querySelector('canvas')).toBeTruthy();
    expect(left.querySelector('[data-role=score]')).toBeTruthy();
  });

  it('puts everything you act on on the right', () => {
    mount();
    const right = q<HTMLDivElement>('[data-role=right]');
    expect(right.querySelector('input[name=answer]')).toBeTruthy();
    expect(right.querySelector('button[data-action=guess]')).toBeTruthy();
    expect(right.querySelector('button[data-action=skip]')).toBeTruthy();
    expect(right.querySelector('[data-role=guesses]')).toBeTruthy();
    expect(right.querySelector('[data-role=hints]')).toBeTruthy();
    expect(right.querySelector('[data-role=reveal]')).toBeTruthy();
  });

  it('keeps the guessing column in view beside a room taller than the page', () => {
    mount();
    const right = q<HTMLDivElement>('[data-role=right]');
    expect(right.style.position).toBe('sticky');
  });

  it('lays the two out side by side', () => {
    mount();
    expect(q<HTMLDivElement>('[data-role=layout]').style.display).toBe('flex');
  });
});

describe('the stage', () => {
  /**
   * The dark ground is the page's, not a rectangle behind the map — a panel around the room
   * reads as a frame it does not have. Guarded in tests/build.test.ts.
   */
  it('paints no ground of its own behind the room', () => {
    mount();
    const style = q<HTMLDivElement>('[data-role=stage]').style;
    expect(style.background).toBe('');
    expect(style.padding).toBe('');
  });
});


describe('the keyboard', () => {
  const press = (key: string) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    q<HTMLInputElement>('input[name=answer]').dispatchEvent(e);
    return e;
  };

  it('clears the box after a guess', () => {
    only('Volcano Room');
    type('Landing Site');
    press('Enter');
    expect(q<HTMLInputElement>('input[name=answer]').value).toBe('');
  });

  it('moves to the next room on Enter once the room is over', () => {
    const app = mount();
    type(app.session.current().name);
    press('Enter');
    expect(app.session.state()).toBe('solved');
    press('Enter');
    expect(app.session.state()).toBe('guessing');
  });

  describe('skip confirmation', () => {
    /** Enter on an empty box is as likely a stray keypress as a decision. */
    it('asks before spending a guess', () => {
      only('Volcano Room');
      press('Enter');
      expect(q('[data-role=verdict]').textContent).toMatch(/again|confirm/i);
      expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES));
    });

    it('skips when Enter is pressed a second time', () => {
      only('Volcano Room');
      press('Enter');
      press('Enter');
      expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES - 1));
      expect(q('[data-role=hints]').textContent).toContain('Norfair');
    });

    it('stands down when you start typing', () => {
      only('Volcano Room');
      press('Enter');
      type('vol');
      expect(q('[data-role=verdict]').textContent).toBe('');
      press('Enter');
      expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES));
    });

    it('stands down on Escape', () => {
      only('Volcano Room');
      press('Enter');
      press('Escape');
      expect(q('[data-role=verdict]').textContent).toBe('');
    });

    it('stands down when the box loses focus', () => {
      only('Volcano Room');
      press('Enter');
      q<HTMLInputElement>('input[name=answer]').dispatchEvent(new Event('blur', { bubbles: true }));
      expect(q('[data-role=verdict]').textContent).toBe('');
    });
  });

  describe('guess history', () => {
    const guessTwice = () => {
      only('Volcano Room');
      type('Landing Site');
      press('Enter');
      type('The Moat');
      press('Enter');
    };

    it('walks back through what you already tried', () => {
      guessTwice();
      press('ArrowLeft');
      expect(q<HTMLInputElement>('input[name=answer]').value).toBe('The Moat');
      press('ArrowLeft');
      expect(q<HTMLInputElement>('input[name=answer]').value).toBe('Landing Site');
    });

    it('walks forward again', () => {
      guessTwice();
      press('ArrowLeft');
      press('ArrowLeft');
      press('ArrowRight');
      expect(q<HTMLInputElement>('input[name=answer]').value).toBe('The Moat');
    });

    it('comes back to an empty box at the end of history', () => {
      guessTwice();
      press('ArrowLeft');
      press('ArrowRight');
      expect(q<HTMLInputElement>('input[name=answer]').value).toBe('');
    });

    it('stops at the oldest guess rather than wrapping', () => {
      guessTwice();
      for (let i = 0; i < 6; i += 1) press('ArrowLeft');
      expect(q<HTMLInputElement>('input[name=answer]').value).toBe('Landing Site');
    });

    /** Arrows have to keep moving the caret once you have edited the text. */
    it('leaves the caret alone when the box holds something you typed', () => {
      guessTwice();
      type('some other room');
      expect(press('ArrowLeft').defaultPrevented).toBe(false);
      expect(q<HTMLInputElement>('input[name=answer]').value).toBe('some other room');
    });

    it('starts empty again on the next room', () => {
      const app = mount();
      const elsewhere = rooms.find((r) => !app.session.group().some((g) => g.id === r.id))!;
      type(elsewhere.name);
      press('Enter');
      for (let i = 0; i < MAX_GUESSES - 1; i += 1) click('button[data-action=skip]');
      click('button[data-action=next]');
      press('ArrowLeft');
      expect(q<HTMLInputElement>('input[name=answer]').value).toBe('');
    });
  });
});

describe('the room diagram hint', () => {
  it('replaces the map rather than sitting beside it', () => {
    only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES - 1; i += 1) click('button[data-action=skip]');
    const img = q<HTMLImageElement>('[data-role=stage] img[data-role=diagram]');
    expect(img.src).toContain('VolcanoRoom_116.png');
    expect(q<HTMLCanvasElement>('canvas').hidden).toBe(true);
  });

  it('is drawn at the size the map was', () => {
    only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES - 1; i += 1) click('button[data-action=skip]');
    const canvas = q<HTMLCanvasElement>('canvas');
    const img = q<HTMLImageElement>('[data-role=stage] img[data-role=diagram]');
    expect(img.width).toBe(canvas.width);
    expect(img.height).toBe(canvas.height);
  });

  it('shows the map again on the next room', () => {
    const app = mount();
    for (let i = 0; i < MAX_GUESSES; i += 1) click('button[data-action=skip]');
    click('button[data-action=next]');
    expect(root.querySelector('[data-role=stage] img[data-role=diagram]')).toBeNull();
    expect(q<HTMLCanvasElement>('canvas').hidden).toBe(false);
    void app;
  });
});

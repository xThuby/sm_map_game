/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp, ALIAS_ISSUE_BASE, plural } from './app';
import { loadRooms } from '../rooms';
import { TOURNAMENT_SETTINGS, MAX_TILE_SIZE, VIEWPORT } from '../render/renderer';
import { MAX_GUESSES, ROUND_LENGTH } from '../game/session';
import type { Renderer } from '../render/renderer';
import type { App } from './app';

const noopRenderer: Renderer = { render() { /* jsdom has no canvas */ } };
const rooms = loadRooms();
const seeded = () => {
  let s = 42;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
};

let root: HTMLElement;
/** Every mount, so each one's document listeners are torn down between tests. */
const mounts: App[] = [];
const track = (app: App): App => { mounts.push(app); return app; };
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
  return track(mountApp(root, {
    rooms: pool, settings: { ...TOURNAMENT_SETTINGS }, renderer: noopRenderer, random: seeded(),
  }));
};
const only = (name: string) => mount(rooms.filter((r) => r.name === name));

beforeEach(() => {
  for (const app of mounts.splice(0)) app.destroy();
  document.body.innerHTML = '';
});

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
    track(mountApp(root2, {
      rooms: rooms.filter((r) => r.name === 'The Moat'),
      settings: { ...TOURNAMENT_SETTINGS }, renderer: recorder, random: seeded(),
    }));
    expect(sizes[0]).toBe(MAX_TILE_SIZE);
  });

  it('shrinks the tallest room in the game so it fits', () => {
    const sizes: number[] = [];
    const recorder: Renderer = { render(_c, _r, s) { sizes.push(s.tileSize); } };
    const root2 = document.createElement('div');
    document.body.append(root2);
    track(mountApp(root2, {
      rooms: rooms.filter((r) => r.name === 'Green Brinstar Main Shaft'),
      settings: { ...TOURNAMENT_SETTINGS }, renderer: recorder, random: seeded(),
    }));
    expect(sizes[0]).toBeLessThan(MAX_TILE_SIZE);
    expect((sizes[0] as number) * 12).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('re-fits when the next room is a different shape', () => {
    const sizes: number[] = [];
    const recorder: Renderer = { render(_c, _r, s) { sizes.push(s.tileSize); } };
    const root2 = document.createElement('div');
    document.body.append(root2);
    track(mountApp(root2, {
      rooms, settings: { ...TOURNAMENT_SETTINGS }, renderer: recorder, random: seeded(),
    }));
    for (let i = 0; i < 12; i += 1) {
      for (let k = 0; k < MAX_GUESSES; k += 1) {
        root2.querySelector<HTMLButtonElement>('button[data-action=skip]')!.click();
      }
      root2.querySelector<HTMLButtonElement>('button[data-action=next]')!.click();
    }
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });
});

describe('par', () => {
  it('sits with the guesses left, above the answer box', () => {
    only('Landing Site');
    const right = q<HTMLDivElement>('[data-role=right]');
    const par = q<HTMLElement>('[data-role=par]');
    const input = q<HTMLInputElement>('input[name=answer]');
    expect(right.contains(par)).toBe(true);
    expect(par.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('[data-role=guesses]').parentElement).toBe(par.parentElement);
  });

  /** A label telling the player how hard this room ought to be. Nothing else uses it. */
  it('shows the par for the room on screen', () => {
    only('Landing Site');
    expect(q('[data-role=par]').textContent).toMatch(/par 1/i);
  });

  /** Par is over the whole game, not this session's pool: a filtered session is no easier. */
  it('shows a harder room as harder, even asked about on its own', () => {
    only('Wave Beam Room');
    expect(q('[data-role=par]').textContent).toMatch(/par 4/i);
  });

  it('shows it straight away, before any guess', () => {
    const app = mount();
    expect(q('[data-role=par]').textContent).toMatch(/par \d/i);
    expect(app.session.guessesLeft()).toBe(MAX_GUESSES);
  });

  it('follows the room being looked back at', () => {
    mount();
    const shownFirst = q('[data-role=par]').textContent;
    for (let i = 0; i < MAX_GUESSES; i += 1) click('button[data-action=skip]');
    click('button[data-action=next]');
    q<HTMLInputElement>('input[name=answer]').blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(q('[data-role=par]').textContent).toBe(shownFirst);
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

describe('looking back at earlier rooms', () => {
  const arrow = (key: 'ArrowLeft' | 'ArrowRight') => {
    // Advancing focuses the answer box for typing, so stepping away from it is what a
    // player does before reaching for the arrows.
    q<HTMLInputElement>('input[name=answer]').blur();
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    return e;
  };
  const finish = () => {
    for (let i = 0; i < MAX_GUESSES; i += 1) click('button[data-action=skip]');
    click('button[data-action=next]');
  };

  it('has nothing to go back to at the start', () => {
    const app = mount();
    const first = app.session.current().name;
    arrow('ArrowLeft');
    expect(q('[data-role=viewing]').textContent).toBe('');
    expect(app.session.current().name).toBe(first);
  });

  it('goes back to the room before this one', () => {
    const app = mount();
    const first = app.session.current().name;
    finish();
    arrow('ArrowLeft');
    expect(q('[data-role=viewing]').textContent).toContain(first);
  });

  it('comes forward again to the room in play', () => {
    mount();
    finish();
    arrow('ArrowLeft');
    arrow('ArrowRight');
    expect(q('[data-role=viewing]').textContent).toBe('');
  });

  it('stops at the oldest room rather than wrapping', () => {
    const app = mount();
    const first = app.session.current().name;
    finish();
    for (let i = 0; i < 5; i += 1) arrow('ArrowLeft');
    expect(q('[data-role=viewing]').textContent).toContain(first);
  });

  it('hides the guessing controls while looking back', () => {
    mount();
    finish();
    arrow('ArrowLeft');
    expect(q<HTMLInputElement>('input[name=answer]').hidden).toBe(true);
    arrow('ArrowRight');
    expect(q<HTMLInputElement>('input[name=answer]').hidden).toBe(false);
  });

  /** Arrows have to keep moving the caret while the answer box has focus. */
  it('leaves the arrows alone while the box is focused', () => {
    mount();
    finish();
    const input = q<HTMLInputElement>('input[name=answer]');
    input.focus();
    const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    input.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(q('[data-role=viewing]').textContent).toBe('');
  });
});

describe('the map / room toggle', () => {
  const revealDiagram = () => {
    for (let i = 0; i < MAX_GUESSES - 1; i += 1) click('button[data-action=skip]');
  };

  it('stays hidden until the room itself has been revealed', () => {
    only('Volcano Room');
    expect(q<HTMLButtonElement>('button[data-action=toggle-view]').hidden).toBe(true);
    revealDiagram();
    expect(q<HTMLButtonElement>('button[data-action=toggle-view]').hidden).toBe(false);
  });

  it('sits above the room, in the left column', () => {
    only('Volcano Room');
    revealDiagram();
    const left = q<HTMLDivElement>('[data-role=left]');
    const toggle = q<HTMLButtonElement>('button[data-action=toggle-view]');
    const stage = q<HTMLDivElement>('[data-role=stage]');
    expect(left.contains(toggle)).toBe(true);
    expect(toggle.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('switches between the room and the map', () => {
    only('Volcano Room');
    revealDiagram();
    expect(q<HTMLCanvasElement>('canvas').hidden).toBe(true);
    click('button[data-action=toggle-view]');
    expect(q<HTMLCanvasElement>('canvas').hidden).toBe(false);
    expect(root.querySelector('[data-role=stage] img[data-role=diagram]')).toBeNull();
    click('button[data-action=toggle-view]');
    expect(q<HTMLCanvasElement>('canvas').hidden).toBe(true);
  });

  it('goes away again on the next room', () => {
    mount();
    for (let i = 0; i < MAX_GUESSES; i += 1) click('button[data-action=skip]');
    click('button[data-action=next]');
    expect(q<HTMLButtonElement>('button[data-action=toggle-view]').hidden).toBe(true);
  });
});

describe('rounds', () => {
  const finishRoom = () => {
    for (let i = 0; i < MAX_GUESSES; i += 1) click('button[data-action=skip]');
  };
  const playRound = () => {
    for (let i = 0; i < ROUND_LENGTH - 1; i += 1) { finishRoom(); click('button[data-action=next]'); }
    finishRoom();
  };

  it('says nothing about rounds until one is over', () => {
    mount();
    expect(q<HTMLElement>('[data-role=summary]').hidden).toBe(true);
  });

  it('shows the summary once the round is done', () => {
    mount();
    playRound();
    expect(q<HTMLElement>('[data-role=summary]').hidden).toBe(false);
  });

  it('hides Next and offers another round instead', () => {
    mount();
    playRound();
    expect(q<HTMLButtonElement>('button[data-action=next]').hidden).toBe(true);
    expect(q<HTMLButtonElement>('button[data-action=new-round]').hidden).toBe(false);
  });

  it('starts a fresh round when asked', () => {
    const app = mount();
    playRound();
    click('button[data-action=new-round]');
    expect(app.session.roundNumber()).toBe(2);
    expect(q<HTMLElement>('[data-role=summary]').hidden).toBe(true);
    expect(app.session.state()).toBe('guessing');
  });

  it('draws a bar for every guess and one for a loss', () => {
    mount();
    playRound();
    const bars = root.querySelectorAll('[data-role=bar]');
    expect(bars).toHaveLength(MAX_GUESSES + 1);
    expect(bars[bars.length - 1]?.getAttribute('data-label')).toBe('X');
  });

  it('shows this round and all time on the same bar', () => {
    mount();
    playRound();
    const bar = q('[data-role=bar]');
    expect(bar.querySelector('[data-role=bar-round]')).toBeTruthy();
    expect(bar.querySelector('[data-role=bar-all]')).toBeTruthy();
  });

  it('reports the win rate for the round against all time', () => {
    mount();
    playRound();
    const text = q('[data-role=win-rate]').textContent ?? '';
    expect(text).toMatch(/%/);
    expect(q('[data-role=win-diff]')).toBeTruthy();
  });

  it('lists the rooms going worst', () => {
    mount();
    playRound();
    const struggles = q('[data-role=struggles]');
    expect(struggles.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(struggles.querySelectorAll('li').length).toBeLessThanOrEqual(5);
  });

  it('counts every room of the round as lost when all were skipped', () => {
    mount();
    playRound();
    expect(q('[data-role=win-rate]').textContent).toContain('0%');
  });
});

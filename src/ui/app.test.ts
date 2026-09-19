/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp, ALIAS_ISSUE_BASE, plural } from './app';
import { loadRooms } from '../rooms';
import { TOURNAMENT_SETTINGS, MAX_TILE_SIZE, VIEWPORT } from '../render/renderer';
import {
  MAX_GUESSES, ROUND_LENGTH, STARTING_POINTS, HINT_COSTS, HINT_ORDER, NAME_LETTERS,
} from '../game/session';
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
const buyButton = (kind: string) =>
  root.querySelector<HTMLButtonElement>(`button[data-action=buy][data-hint=${kind}]`);
const buy = (kind: string) => {
  const button = buyButton(kind);
  if (!button) throw new Error(`no hint for sale: ${kind}`);
  button.click();
};
const giveUp = () => click('button[data-action=give-up]');
/** Any room but the one being asked about, so the guess is wrong but recognised. */
const wrongGuess = (app: App) => {
  const other = rooms.find((r) => r.id !== app.session.current().id) as { name: string };
  type(other.name);
  click('button[data-action=guess]');
};
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
  it('shows a canvas, an answer box, Answer and Give up', () => {
    mount();
    expect(q('canvas')).toBeTruthy();
    expect(q('input[name=answer]')).toBeTruthy();
    expect(q('button[data-action=guess]')).toBeTruthy();
    expect(q('button[data-action=give-up]')).toBeTruthy();
  });

  it('says how many guesses are left', () => {
    mount();
    expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES));
  });

  /** Next must not look like a way out of the room; Give up is the way out. */
  it('hides Next until the room is over', () => {
    const app = only('Volcano Room');
    expect(q<HTMLButtonElement>('button[data-action=next]').hidden).toBe(true);
    type('Volcano Room');
    click('button[data-action=guess]');
    expect(q<HTMLButtonElement>('button[data-action=next]').hidden).toBe(false);
    void app;
  });

  it('hides Answer and Give up once the room is over', () => {
    only('Volcano Room');
    type('Volcano Room');
    click('button[data-action=guess]');
    expect(q<HTMLButtonElement>('button[data-action=guess]').hidden).toBe(true);
    expect(q<HTMLButtonElement>('button[data-action=give-up]').hidden).toBe(true);
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
    const app = only('Volcano Room');
    wrongGuess(app);
    expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES - 1));
  });

  /** A wrong answer costs a guess and nothing else: hints are bought, not earned. */
  it('gives nothing away for a wrong answer', () => {
    const app = only('Volcano Room');
    wrongGuess(app);
    expect(q('[data-role=facts]').textContent).not.toContain('Norfair');
    expect(q('[data-role=points]').textContent).toContain(String(STARTING_POINTS));
  });

  it('reveals the answer once every guess is spent', () => {
    const app = only('Volcano Room');
    for (let i = 0; i < MAX_GUESSES; i += 1) wrongGuess(app);
    expect(q('[data-role=room-name]').textContent).toContain('Volcano Room');
  });

  it('reveals the answer when the room is given up on', () => {
    only('Volcano Room');
    giveUp();
    expect(q('[data-role=room-name]').textContent).toContain('Volcano Room');
  });

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
    expect(q('[data-role=room-name]').textContent).not.toMatch(/[A-Za-z0-9]/);
    expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES));
  });

  it('counts which room of the round you are on', () => {
    const app = mount();
    expect(q('[data-role=score]').textContent).toMatch(/Room 1 of 6/);
    for (let i = 0; i < 2; i += 1) {
      type(app.session.current().name);
      click('button[data-action=guess]');
      click('button[data-action=next]');
    }
    expect(q('[data-role=score]').textContent).toMatch(/Room 3 of 6/);
  });

  /** The room stays the one you are on until you actually move off it. */
  it('does not count you onto the next room before you go there', () => {
    const app = mount();
    expect(q('[data-role=score]').textContent).toMatch(/Room 1 of 6/);
    type(app.session.current().name);
    click('button[data-action=guess]');
    expect(q('[data-role=score]').textContent).toMatch(/Room 1 of 6/);
    click('button[data-action=next]');
    expect(q('[data-role=score]').textContent).toMatch(/Room 2 of 6/);
  });

  it('stays on the last room of the round once the round is over', () => {
    mount();
    for (let i = 0; i < ROUND_LENGTH - 1; i += 1) { giveUp(); click('button[data-action=next]'); }
    giveUp();
    expect(q('[data-role=score]').textContent).toMatch(/Room 6 of 6/);
  });

  it('says nothing about guesses used up there', () => {
    mount();
    expect(q('[data-role=score]').textContent).not.toMatch(/guess/i);
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
      root2.querySelector<HTMLButtonElement>('button[data-action=give-up]')!.click();
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
    giveUp();
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
    expect(right.querySelector('button[data-action=give-up]')).toBeTruthy();
    expect(right.querySelector('[data-role=guesses]')).toBeTruthy();
    expect(right.querySelector('[data-role=facts]')).toBeTruthy();
    expect(right.querySelector('[data-role=room-name]')).toBeTruthy();
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

  /**
   * A typo is not a guess — it costs nothing and is graded against nothing, so wiping the
   * box would throw away work the player still has to redo.
   */
  it('leaves the box alone when what was typed names no room', () => {
    only('Volcano Room');
    type('Volcan Roomm');
    press('Enter');
    expect(q<HTMLInputElement>('input[name=answer]').value).toBe('Volcan Roomm');
  });

  it('leaves the box alone for a near miss it can suggest a fix for', () => {
    only('Volcano Room');
    type('Volcanoe Room');
    press('Enter');
    expect(q('[data-role=verdict]').textContent).toContain('Volcano Room');
    expect(q<HTMLInputElement>('input[name=answer]').value).toBe('Volcanoe Room');
  });

  it('moves to the next room on Enter once the room is over', () => {
    const app = mount();
    type(app.session.current().name);
    press('Enter');
    expect(app.session.state()).toBe('solved');
    press('Enter');
    expect(app.session.state()).toBe('guessing');
  });

  /**
   * Enter on an empty box used to offer a hint for a guess. Hints are bought now, so there
   * is nothing for it to do and it should cost nothing.
   */
  describe('Enter on an empty box', () => {
    it('does nothing at all', () => {
      only('Volcano Room');
      press('Enter');
      expect(q('[data-role=verdict]').textContent).toBe('');
      expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES));
      expect(q('[data-role=points]').textContent).toContain(String(STARTING_POINTS));
    });

    it('does nothing when pressed twice either', () => {
      const app = only('Volcano Room');
      press('Enter');
      press('Enter');
      expect(app.session.state()).toBe('guessing');
      expect(q('[data-role=facts]').textContent).not.toContain('Norfair');
    });
  });

});

describe('the room diagram hint', () => {
  it('replaces the map rather than sitting beside it', () => {
    only('Volcano Room');
    buy('diagram');
    const img = q<HTMLImageElement>('[data-role=stage] img[data-role=diagram]');
    expect(img.src).toContain('VolcanoRoom_116.png');
    expect(q<HTMLCanvasElement>('canvas').hidden).toBe(true);
  });

  it('is drawn at the size the map was', () => {
    only('Volcano Room');
    buy('diagram');
    const canvas = q<HTMLCanvasElement>('canvas');
    const img = q<HTMLImageElement>('[data-role=stage] img[data-role=diagram]');
    expect(img.width).toBe(canvas.width);
    expect(img.height).toBe(canvas.height);
  });

  it('shows the map again on the next room', () => {
    const app = mount();
    buy('diagram');
    giveUp();
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
    giveUp();
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
  const revealDiagram = () => buy('diagram');

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
    revealDiagram();
    giveUp();
    click('button[data-action=next]');
    expect(q<HTMLButtonElement>('button[data-action=toggle-view]').hidden).toBe(true);
  });
});

describe('rounds', () => {
  const playRound = () => {
    for (let i = 0; i < ROUND_LENGTH - 1; i += 1) { giveUp(); click('button[data-action=next]'); }
    giveUp();
  };
  /** A clean round: every room named first go, so the points come out whole. */
  const playPerfectRound = (app: App) => {
    for (let i = 0; i < ROUND_LENGTH - 1; i += 1) {
      type(app.session.current().name);
      click('button[data-action=guess]');
      click('button[data-action=next]');
    }
    type(app.session.current().name);
    click('button[data-action=guess]');
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

  it('counts every room of the round as lost when all were given up on', () => {
    mount();
    playRound();
    expect(q('[data-role=win-rate]').textContent).toContain('0%');
  });

  it('totals the points won over the round', () => {
    const app = mount();
    playPerfectRound(app);
    expect(q('[data-role=round-points]').textContent)
      .toContain(String(STARTING_POINTS * ROUND_LENGTH));
  });

  /** Not out of a possible 600: most rooms cannot be had without spending something. */
  it('gives the round total on its own, not against what was possible', () => {
    const app = mount();
    playPerfectRound(app);
    expect(q('[data-role=round-points]').textContent).not.toContain('600 of');
    expect(q('[data-role=round-points]').textContent).not.toMatch(/out of|\/\s*\d/);
  });

  it('counts a bought hint against the round total', () => {
    const app = mount();
    buy('area');
    type(app.session.current().name);
    click('button[data-action=guess]');
    click('button[data-action=next]');
    for (let i = 0; i < ROUND_LENGTH - 2; i += 1) {
      type(app.session.current().name);
      click('button[data-action=guess]');
      click('button[data-action=next]');
    }
    type(app.session.current().name);
    click('button[data-action=guess]');
    expect(q('[data-role=round-points]').textContent)
      .toContain(String(STARTING_POINTS * ROUND_LENGTH - HINT_COSTS.area));
  });

  it('reports the average points a room and the best round, all time', () => {
    const app = mount();
    playPerfectRound(app);
    const text = q('[data-role=all-points]').textContent ?? '';
    expect(text).toMatch(/average/i);
    expect(text).toMatch(/best/i);
    expect(text).toContain(String(STARTING_POINTS * ROUND_LENGTH));
  });
});

describe('the fact panel', () => {
  const facts = () => [...root.querySelectorAll('[data-role=fact]')]
    .map((li) => li.textContent?.replace(/\s+/g, ' ').trim() ?? '');

  /** The shape of the name, and not one letter of it, is free — it is on the map already. */
  it('starts with the name masked and every hinted fact unknown', () => {
    only('Watering Hole');
    expect(q('[data-role=room-name]').textContent).toBe('________ ____');
    for (const kind of ['area', 'enemies', 'neighbour']) expect(buyButton(kind), kind).toBeTruthy();
    expect(facts().join(' ')).not.toContain('Maridia');
  });

  it('shows the facts that were never a hint from the start', () => {
    only('Watering Hole');
    expect(facts().join(' ')).toContain('2 x 3 tiles');
    expect(facts().join(' ')).toContain('Items: 2');
    expect(facts().join(' ')).toContain('Water');
  });

  it('says nothing about doors', () => {
    only('Watering Hole');
    expect(facts().join(' ')).not.toMatch(/door/i);
  });

  it('fills a fact in when its hint is bought', () => {
    only('Volcano Room');
    buy('area');
    expect(facts()).toContain('Area: Norfair');
    expect(buyButton('enemies')).toBeTruthy();
  });

  it('uncovers a letter of each word when a name letter is bought', () => {
    only('Volcano Room');
    expect(q('[data-role=room-name]').textContent).toBe('_______ ____');
    buy('name');
    expect(q('[data-role=room-name]').textContent).toBe('V______ R___');
    buy('name');
    expect(q('[data-role=room-name]').textContent).toBe('Vo_____ Ro__');
  });

  it('stops selling letters once the name hint is used up', () => {
    only('Volcano Room');
    for (let i = 0; i < NAME_LETTERS; i += 1) buy('name');
    expect(buyButton('name')).toBeNull();
  });

  it('names the room once it is over', () => {
    only('Volcano Room');
    giveUp();
    expect(q('[data-role=room-name]').textContent).toBe('Volcano Room');
  });

  it('names it straight away when solved', () => {
    only('Volcano Room');
    type('Volcano Room');
    click('button[data-action=guess]');
    expect(q('[data-role=room-name]').textContent).toBe('Volcano Room');
  });

  it('offers a prefilled issue link once the room is named', () => {
    only('Volcano Room');
    expect(root.querySelector('a[data-action=suggest-alias]')).toBeNull();
    giveUp();
    const link = q<HTMLAnchorElement>('a[data-action=suggest-alias]');
    expect(link.href).toContain(ALIAS_ISSUE_BASE);
    expect(new URL(link.href).searchParams.get('title')).toContain('Volcano Room');
  });

  /** The picture stands in for the map, so listing it again as text says nothing. */
  it('does not list the room picture as a fact', () => {
    only('Volcano Room');
    giveUp();
    expect(facts().join(' ')).not.toMatch(/room itself|in place of the map/i);
  });
});

describe('finishing a room with the keyboard', () => {
  const press = (key: string) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    q<HTMLInputElement>('input[name=answer]').dispatchEvent(e);
    return e;
  };

  /** The box used to be disabled once the room ended, and a disabled input gets no keydown. */
  it('advances on Enter after the last guess is spent', () => {
    const app = mount();
    for (let i = 0; i < MAX_GUESSES - 1; i += 1) wrongGuess(app);
    type('definitely not a room');
    press('Enter');
    const other = rooms.find((r) => r.id !== app.session.current().id) as { name: string };
    type(other.name);
    press('Enter');
    expect(app.session.state()).not.toBe('guessing');
    press('Enter');
    expect(app.session.state()).toBe('guessing');
  });

  it('leaves the box usable so it can still take the key', () => {
    mount();
    giveUp();
    expect(q<HTMLInputElement>('input[name=answer]').disabled).toBe(false);
  });
});

describe('choosing a suggestion', () => {
  const press = (key: string) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    q<HTMLInputElement>('input[name=answer]').dispatchEvent(e);
    return e;
  };
  const items = () => [...root.querySelectorAll('[data-role=suggestions] li')];
  const selected = () => items().findIndex((li) => li.getAttribute('aria-selected') === 'true');

  it('starts on the first suggestion', () => {
    mount();
    type('brinstar');
    expect(items().length).toBeGreaterThan(1);
    expect(selected()).toBe(0);
  });

  it('moves down and up the list', () => {
    mount();
    type('brinstar');
    press('ArrowDown');
    expect(selected()).toBe(1);
    press('ArrowUp');
    expect(selected()).toBe(0);
  });

  it('stops at the ends rather than wrapping', () => {
    mount();
    type('brinstar');
    press('ArrowUp');
    expect(selected()).toBe(0);
    for (let i = 0; i < 20; i += 1) press('ArrowDown');
    expect(selected()).toBe(items().length - 1);
  });

  it('completes whichever one is selected on Tab', () => {
    mount();
    type('brinstar');
    const second = items()[1]?.textContent ?? '';
    press('ArrowDown');
    press('Tab');
    expect(q<HTMLInputElement>('input[name=answer]').value).toBe(second);
  });

  it('completes on click', () => {
    mount();
    type('brinstar');
    const third = items()[2]?.textContent ?? '';
    (items()[2] as HTMLElement).click();
    expect(q<HTMLInputElement>('input[name=answer]').value).toBe(third);
  });

  it('goes back to the first suggestion when the text changes', () => {
    mount();
    type('brinstar');
    press('ArrowDown');
    type('brinstar m');
    expect(selected()).toBe(0);
  });
});

describe('buying hints', () => {
  it('offers every hint from the start, each with what it costs', () => {
    only('Volcano Room');
    for (const [kind, cost] of Object.entries(HINT_COSTS)) {
      expect(buyButton(kind), kind).toBeTruthy();
      expect(buyButton(kind)?.textContent, kind).toContain(String(cost));
    }
  });

  /** A hint's price sits where its answer will appear, so the trade is plain. */
  it('puts each button where the fact it buys will go', () => {
    only('Volcano Room');
    expect(buyButton('area')?.closest('li[data-role=fact]')?.textContent).toMatch(/^\s*Area:/);
    expect(buyButton('enemies')?.closest('li[data-role=fact]')?.textContent)
      .toMatch(/^\s*Enemies:/);
    expect(buyButton('neighbour')?.closest('li[data-role=fact]')?.textContent)
      .toMatch(/^\s*Connects to:/);
  });

  it("puts the name's price beside the name, above the facts", () => {
    only('Volcano Room');
    expect(buyButton('name')?.closest('li[data-role=fact]')).toBeNull();
    const name = q('[data-role=room-name]');
    expect(buyButton('name')?.parentElement).toBe(name.parentElement);
  });

  /** The picture is not a fact in the list; it stands in for the map, so it is bought there. */
  it("puts the picture's price beside the room, in the left column", () => {
    only('Volcano Room');
    const left = q<HTMLDivElement>('[data-role=left]');
    expect(left.contains(buyButton('diagram'))).toBe(true);
    expect(q('[data-role=buy-diagram]').textContent).toContain('Room graphics');
  });

  it('spends the points and reveals the fact', () => {
    only('Volcano Room');
    buy('neighbour');
    expect(q('[data-role=points]').textContent)
      .toContain(String(STARTING_POINTS - HINT_COSTS.neighbour));
    expect(q('[data-role=facts]').textContent).toContain('Kronic Boost Room');
  });

  it('takes the button away once its hint is bought', () => {
    only('Volcano Room');
    buy('area');
    expect(buyButton('area')).toBeNull();
  });

  it('costs no guesses', () => {
    only('Volcano Room');
    buy('area');
    buy('enemies');
    expect(q('[data-role=guesses]').textContent).toContain(String(MAX_GUESSES));
  });

  /** Buying the lot still leaves something to win, so nothing is ever priced out of reach. */
  it('lets every hint be bought on one room, and still pays for naming it', () => {
    only('Volcano Room');
    for (const kind of HINT_ORDER) {
      expect(buyButton(kind)?.disabled, kind).toBe(false);
      buy(kind);
    }
    for (let i = 1; i < NAME_LETTERS; i += 1) buy('name');
    expect(q('[data-role=points]').textContent).toContain('5 points');
    type('Volcano Room');
    click('button[data-action=guess]');
    expect(q('[data-role=points]').textContent).toContain('5 points');
  });

  it('has nothing left to sell once the room is over', () => {
    only('Volcano Room');
    giveUp();
    for (const kind of Object.keys(HINT_COSTS)) expect(buyButton(kind), kind).toBeNull();
  });

  it('starts the next room on a full hundred with everything for sale again', () => {
    const app = mount();
    buy('area');
    giveUp();
    click('button[data-action=next]');
    expect(q('[data-role=points]').textContent).toContain(String(STARTING_POINTS));
    for (const kind of Object.keys(HINT_COSTS)) expect(buyButton(kind), kind).toBeTruthy();
    void app;
  });
});

describe('points', () => {
  it('sits with the guesses left and the par, above the answer box', () => {
    only('Landing Site');
    const points = q<HTMLElement>('[data-role=points]');
    expect(points.textContent).toContain(String(STARTING_POINTS));
    expect(points.parentElement).toBe(q('[data-role=guesses]').parentElement);
    expect(points.compareDocumentPosition(q('input[name=answer]'))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps what is left when the room is solved', () => {
    only('Volcano Room');
    buy('area');
    type('Volcano Room');
    click('button[data-action=guess]');
    expect(q('[data-role=points]').textContent)
      .toContain(String(STARTING_POINTS - HINT_COSTS.area));
  });

  it('is worth nothing once the room is lost', () => {
    only('Volcano Room');
    buy('area');
    giveUp();
    expect(q('[data-role=points]').textContent).toMatch(/\b0\b/);
  });
});

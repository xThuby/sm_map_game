/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp } from './app';
import { loadRooms } from '../rooms';
import { TOURNAMENT_SETTINGS } from '../render/renderer';
import type { Renderer } from '../render/renderer';

const noopRenderer: Renderer = { render() { /* jsdom has no canvas */ } };
const rooms = loadRooms();
const seeded = () => { let s = 42; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; };

const q = <T extends Element>(root: Element, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

let root: HTMLElement;
const mount = (pool = rooms) => {
  root = document.createElement('div');
  document.body.append(root);
  return mountApp(root, {
    rooms: pool, settings: { ...TOURNAMENT_SETTINGS }, renderer: noopRenderer,
    random: seeded(),
  });
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('mountApp', () => {
  it('renders a canvas, an answer box and a submit control', () => {
    mount();
    expect(q(root, 'canvas')).toBeTruthy();
    expect(q<HTMLInputElement>(root, 'input[name=answer]')).toBeTruthy();
    expect(q<HTMLButtonElement>(root, 'button[data-action=submit]')).toBeTruthy();
  });

  it('shows the score from the start', () => {
    mount();
    expect(q(root, '[data-role=score]').textContent).toMatch(/0/);
  });

  it('does not name the room before it is answered', () => {
    const app = mount();
    expect(root.textContent).not.toContain(app.session.current().name);
  });

  it('accepts a correct answer and says so', () => {
    const app = mount();
    const name = app.session.current().name;
    q<HTMLInputElement>(root, 'input[name=answer]').value = name;
    q<HTMLButtonElement>(root, 'button[data-action=submit]').click();
    expect(q(root, '[data-role=verdict]').textContent).toMatch(/correct/i);
    expect(root.textContent).toContain(name);
  });

  it('rejects a wrong answer but still reveals the room', () => {
    const app = mount();
    const actual = app.session.current().name;
    const wrong = rooms.find((r) => r.name !== actual)!;
    q<HTMLInputElement>(root, 'input[name=answer]').value = wrong.name;
    q<HTMLButtonElement>(root, 'button[data-action=submit]').click();
    expect(q(root, '[data-role=verdict]').textContent).not.toMatch(/correct/i);
    expect(q(root, '[data-role=reveal]').textContent).toContain(actual);
  });

  it('names the look-alikes when the room has any', () => {
    const app = mount(rooms.filter((r) => r.name === 'Wave Beam Room'));
    q<HTMLButtonElement>(root, 'button[data-action=reveal]').click();
    expect(q(root, '[data-role=reveal]').textContent).toContain('Ice Beam Room');
    void app;
  });

  it('suggests what a near miss probably meant', () => {
    mount(rooms.filter((r) => r.name === 'Volcano Room'));
    q<HTMLInputElement>(root, 'input[name=answer]').value = 'Volcanoe Room';
    q<HTMLButtonElement>(root, 'button[data-action=submit]').click();
    expect(q(root, '[data-role=verdict]').textContent).toContain('Volcano Room');
  });

  it('offers name completions as you type', () => {
    mount();
    const input = q<HTMLInputElement>(root, 'input[name=answer]');
    input.value = 'wrecked ship main';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(q(root, '[data-role=suggestions]').textContent).toContain('Wrecked Ship Main Shaft');
  });

  it('moves to the next room and clears the box', () => {
    const app = mount();
    q<HTMLButtonElement>(root, 'button[data-action=reveal]').click();
    q<HTMLButtonElement>(root, 'button[data-action=next]').click();
    expect(app.session.state()).toBe('asking');
    expect(q<HTMLInputElement>(root, 'input[name=answer]').value).toBe('');
    expect(q(root, '[data-role=verdict]').textContent).toBe('');
  });

  it('keeps a running score across rooms', () => {
    const app = mount();
    for (let i = 0; i < 3; i += 1) {
      q<HTMLInputElement>(root, 'input[name=answer]').value = app.session.current().name;
      q<HTMLButtonElement>(root, 'button[data-action=submit]').click();
      q<HTMLButtonElement>(root, 'button[data-action=next]').click();
    }
    expect(app.session.score()).toEqual({ asked: 3, correct: 3 });
    expect(q(root, '[data-role=score]').textContent).toMatch(/3/);
  });

  it('submits on Enter as well as the button', () => {
    const app = mount();
    const input = q<HTMLInputElement>(root, 'input[name=answer]');
    input.value = app.session.current().name;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(app.session.state()).toBe('revealed');
  });
});

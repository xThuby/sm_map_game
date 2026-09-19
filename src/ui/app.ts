import { createSession } from '../game/session';
import type { Session } from '../game/session';
import { buildNameIndex, autocomplete } from '../game/matching';
import { loadRooms } from '../rooms';
import { pixelRenderer } from '../render/pixelRenderer';
import type { Renderer } from '../render/renderer';
import type { RenderSettings, Room } from '../types';

export interface AppOptions {
  rooms: Room[];
  settings: RenderSettings;
  renderer?: Renderer;
  random?: () => number;
}

export interface App {
  session: Session;
}

const SUGGESTION_LIMIT = 6;

/**
 * No styling on purpose: this prototype is about whether the game works, not how it looks.
 * The renderer is injected so the tests can run without a canvas implementation.
 */
export function mountApp(root: HTMLElement, options: AppOptions): App {
  const { rooms, settings, renderer = pixelRenderer, random } = options;
  const session = createSession({ rooms, settings, random });
  const index = buildNameIndex(loadRooms());

  root.innerHTML = `
    <p data-role="score"></p>
    <canvas data-role="map"></canvas>
    <p>
      <label>Which room is this?
        <input name="answer" type="text" autocomplete="off" size="40">
      </label>
      <button data-action="submit">Answer</button>
      <button data-action="reveal">Give up</button>
      <button data-action="next">Next</button>
    </p>
    <ul data-role="suggestions"></ul>
    <p data-role="verdict"></p>
    <div data-role="reveal"></div>
  `;

  const el = <T extends Element>(sel: string): T => {
    const found = root.querySelector<T>(sel);
    if (!found) throw new Error(`missing ${sel}`);
    return found;
  };

  const canvas = el<HTMLCanvasElement>('canvas[data-role=map]');
  const input = el<HTMLInputElement>('input[name=answer]');
  const suggestions = el<HTMLUListElement>('[data-role=suggestions]');
  const verdict = el<HTMLParagraphElement>('[data-role=verdict]');
  const reveal = el<HTMLDivElement>('[data-role=reveal]');
  const score = el<HTMLParagraphElement>('[data-role=score]');
  const nextButton = el<HTMLButtonElement>('button[data-action=next]');

  function drawScore(): void {
    const { asked, correct } = session.score();
    score.textContent = `Score: ${correct} / ${asked}`;
  }

  function drawRoom(): void {
    renderer.render(canvas, session.current(), settings);
  }

  function showSuggestions(): void {
    if (session.state() === 'revealed' || input.value.trim() === '') {
      suggestions.innerHTML = '';
      return;
    }
    suggestions.innerHTML = autocomplete(input.value, index, SUGGESTION_LIMIT)
      .map((e) => `<li>${e.name}${e.isAlias ? ` (also ${e.room.name})` : ''}</li>`)
      .join('');
  }

  function showResult(): void {
    const grade = session.lastGrade();
    if (!grade) return;

    const room = session.current();
    // Every room in the group paints identically, so any of them was a fair answer.
    const twins = grade.group.filter((r) => r.id !== room.id);

    if (grade.correct) {
      verdict.textContent = grade.answer && grade.answer.id !== room.id
        ? `Correct — ${grade.answer.name} is indistinguishable from this room.`
        : 'Correct.';
    } else if (grade.suggestion) {
      verdict.textContent = `Not quite. Did you mean ${grade.suggestion.name}?`;
    } else if (grade.answer) {
      verdict.textContent = `No — that is ${grade.answer.name}.`;
    } else {
      verdict.textContent = 'No answer.';
    }

    reveal.innerHTML = `
      <p><strong>${room.name}</strong> — ${room.area}</p>
      <ul>
        <li>${room.width} x ${room.height} tiles, ${room.tiles.length} on the map</li>
        <li>${room.doors.length} door(s): ${room.doors.map((d) => d.direction).join(', ') || 'none'}</li>
        <li>${room.itemCount} item(s)${room.hasHiddenItem ? ', one hidden' : ''}</li>
        <li>${room.heated ? 'Heated' : 'Not heated'}${room.liquid !== 'none' ? `, ${room.liquid}` : ''}</li>
        ${room.utilities.length ? `<li>${room.utilities.join(', ')}</li>` : ''}
        ${room.aliases.length ? `<li>Also known as: ${room.aliases.join(', ')}</li>` : ''}
        ${twins.length ? `<li>Looks identical to: ${twins.map((r) => r.name).join(', ')}</li>` : ''}
      </ul>`;
    suggestions.innerHTML = '';
    drawScore();
    nextButton.focus();
  }

  function submit(): void {
    if (session.state() === 'revealed') return;
    session.answer(input.value);
    showResult();
  }

  el<HTMLButtonElement>('button[data-action=submit]').addEventListener('click', submit);
  el<HTMLButtonElement>('button[data-action=reveal]').addEventListener('click', () => {
    if (session.state() === 'revealed') return;
    session.reveal();
    showResult();
  });
  nextButton.addEventListener('click', () => {
    session.next();
    input.value = '';
    verdict.textContent = '';
    reveal.innerHTML = '';
    suggestions.innerHTML = '';
    drawRoom();
    drawScore();
    input.focus();
  });
  input.addEventListener('input', showSuggestions);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  drawRoom();
  drawScore();
  return { session };
}

import { createSession } from '../game/session';
import type { Hint, Session } from '../game/session';
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

/** How far a click magnifies the map. */
export const ZOOM_FACTOR = 5;

/** Alias suggestions are collected as GitHub issues; the site itself is static. */
export const ALIAS_ISSUE_BASE = 'https://github.com/xThuby/sm_map_game/issues/new';

function aliasIssueUrl(room: Room): string {
  const params = new URLSearchParams({
    title: `Alias suggestion: ${room.name}`,
    labels: 'alias-suggestion',
    body: [
      `Room: ${room.name} (id ${room.id})`,
      room.aliases.length ? `Already known as: ${room.aliases.join(', ')}` : '',
      '',
      'Suggested name:',
      '',
      'Where this name is used:',
    ].filter(Boolean).join('\n'),
  });
  return `${ALIAS_ISSUE_BASE}?${params.toString()}`;
}

/** "1 guess", "4 guesses", "2 items" — words ending in a sibilant take -es. */
export function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  return `${n} ${word}${/(?:s|x|z|ch|sh)$/.test(word) ? 'es' : 's'}`;
}

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
    <div data-role="stage" data-zoom="out"
         style="display:inline-block;overflow:hidden;cursor:zoom-in;line-height:0;
                background:#000;padding:16px"
      ><canvas data-role="map"></canvas></div>
    <p data-role="guesses"></p>
    <p>
      <label>Which room is this?
        <input name="answer" type="text" autocomplete="off" size="40">
      </label>
      <button data-action="guess">Answer</button>
      <button data-action="skip">Skip (costs a guess, gives a hint)</button>
      <button data-action="next" hidden>Next room</button>
    </p>
    <ul data-role="suggestions"></ul>
    <p data-role="verdict"></p>
    <dl data-role="hints"></dl>
    <div data-role="reveal"></div>
  `;

  const el = <T extends Element>(sel: string): T => {
    const found = root.querySelector<T>(sel);
    if (!found) throw new Error(`missing ${sel}`);
    return found;
  };

  const canvas = el<HTMLCanvasElement>('canvas[data-role=map]');
  const stage = el<HTMLDivElement>('[data-role=stage]');
  const input = el<HTMLInputElement>('input[name=answer]');
  const suggestions = el<HTMLUListElement>('[data-role=suggestions]');
  const verdict = el<HTMLParagraphElement>('[data-role=verdict]');
  const hintList = el<HTMLDListElement>('[data-role=hints]');
  const reveal = el<HTMLDivElement>('[data-role=reveal]');
  const score = el<HTMLParagraphElement>('[data-role=score]');
  const guesses = el<HTMLParagraphElement>('[data-role=guesses]');
  const guessButton = el<HTMLButtonElement>('button[data-action=guess]');
  const skipButton = el<HTMLButtonElement>('button[data-action=skip]');
  const nextButton = el<HTMLButtonElement>('button[data-action=next]');

  const topSuggestion = () => autocomplete(input.value, index, 1)[0] ?? null;

  /**
   * Click to magnify, move the pointer to pan, click again to stop. The stage keeps its size
   * and clips, so the enlarged map slides behind a fixed window rather than pushing the page
   * around. Panning works by moving the transform origin to the point under the pointer,
   * which keeps whatever is under the cursor roughly where it was.
   */
  let zoomed = false;

  function panTo(event: MouseEvent): void {
    if (!zoomed) return;
    const box = stage.getBoundingClientRect();
    const x = box.width > 0 ? ((event.clientX - box.left) / box.width) * 100 : 50;
    const y = box.height > 0 ? ((event.clientY - box.top) / box.height) * 100 : 50;
    const clamp = (n: number) => Math.min(Math.max(n, 0), 100);
    canvas.style.transformOrigin = `${clamp(x)}% ${clamp(y)}%`;
  }

  function setZoom(next: boolean, event?: MouseEvent): void {
    zoomed = next;
    stage.dataset['zoom'] = next ? 'in' : 'out';
    stage.style.cursor = next ? 'zoom-out' : 'zoom-in';
    canvas.style.transform = next ? `scale(${ZOOM_FACTOR})` : '';
    if (next) {
      if (event) panTo(event);
      else canvas.style.transformOrigin = '50% 50%';
    } else {
      canvas.style.transformOrigin = '';
    }
  }

  function drawStatus(): void {
    const { asked, solved, guessesUsed } = session.score();
    score.textContent = `Solved ${solved} of ${asked} — ${plural(guessesUsed, 'guess')} used`;
    const left = session.guessesLeft();
    guesses.textContent = session.state() === 'guessing'
      ? `${plural(left, 'guess')} left`
      : '';

    const over = session.state() !== 'guessing';
    guessButton.hidden = over;
    skipButton.hidden = over;
    input.disabled = over;
    nextButton.hidden = !over;
  }

  function drawHints(): void {
    hintList.innerHTML = session.hints().map((h: Hint) => `
      <dt>${h.label}</dt>
      <dd>${h.imageUrl
        ? `<img data-role="diagram" src="${h.imageUrl}" alt="${h.kind}" loading="lazy" width="480">`
        : h.text}</dd>`).join('');
  }

  function drawSuggestions(): void {
    if (session.state() !== 'guessing' || input.value.trim() === '') {
      suggestions.innerHTML = '';
      return;
    }
    suggestions.innerHTML = autocomplete(input.value, index, SUGGESTION_LIMIT)
      .map((e) => `<li>${e.name}${e.isAlias ? ` (also ${e.room.name})` : ''}</li>`)
      .join('');
  }

  function drawReveal(): void {
    if (session.state() === 'guessing') { reveal.innerHTML = ''; return; }

    const room = session.current();
    // Every room in the group paints identically, so any of them was a fair answer. Taken
    // from the session rather than the last grade, which is empty after a skip.
    const twins = session.group().filter((r) => r.id !== room.id);

    // Only state what is there. A room that is not heated simply says nothing about heat.
    const facts = [
      `${room.width} x ${room.height} tiles, ${plural(room.tiles.length, 'tile')} on the map`,
      `${plural(room.doors.length, 'door')}: ${room.doors.map((d) => d.direction).join(', ')}`,
      room.itemCount > 0
        ? `${plural(room.itemCount, 'item')}${room.hasHiddenItem ? ', one hidden' : ''}`
        : '',
      room.heated ? 'Heated' : '',
      room.liquid !== 'none' ? room.liquid.charAt(0).toUpperCase() + room.liquid.slice(1) : '',
      room.utilities.length ? room.utilities.join(', ') : '',
      room.aliases.length ? `Also known as: ${room.aliases.join(', ')}` : '',
      twins.length ? `Looks identical to: ${twins.map((r) => r.name).join(', ')}` : '',
    ].filter(Boolean);

    reveal.innerHTML = `
      <p><strong>${room.name}</strong></p>
      <ul>${facts.map((f) => `<li>${f}</li>`).join('')}</ul>
      <p><a data-action="suggest-alias" href="${aliasIssueUrl(room)}"
            target="_blank" rel="noopener">Know this room by another name? Suggest it</a></p>`;
  }

  function redraw(): void {
    drawStatus();
    drawHints();
    drawSuggestions();
    drawReveal();
  }

  function submit(): void {
    if (session.state() !== 'guessing') return;
    // An empty box is not an attempt at anything; say nothing rather than scolding.
    if (input.value.trim() === '') return;
    const grade = session.guess(input.value);

    if (!grade.recognised) {
      verdict.textContent = grade.suggestion
        ? `Did you mean ${grade.suggestion.name}?`
        : 'That is not a room name.';
    } else if (grade.correct) {
      verdict.textContent = grade.answer && grade.answer.id !== session.current().id
        ? `Correct — ${grade.answer.name} is indistinguishable from this room.`
        : 'Correct.';
    } else {
      verdict.textContent = 'Incorrect.';
    }
    redraw();
  }

  guessButton.addEventListener('click', submit);
  skipButton.addEventListener('click', () => {
    if (session.state() !== 'guessing') return;
    session.skip();
    verdict.textContent = '';
    redraw();
  });
  nextButton.addEventListener('click', () => {
    session.next();
    input.value = '';
    verdict.textContent = '';
    setZoom(false);
    renderer.render(canvas, session.current(), settings);
    redraw();
    input.focus();
  });
  stage.addEventListener('click', (event) => setZoom(!zoomed, event));
  stage.addEventListener('mousemove', panTo);
  input.addEventListener('input', drawSuggestions);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { submit(); return; }
    if (event.key === 'Tab') {
      const top = topSuggestion();
      if (!top) return;
      event.preventDefault();
      input.value = top.name;
      drawSuggestions();
    }
  });

  renderer.render(canvas, session.current(), settings);
  redraw();
  return { session };
}

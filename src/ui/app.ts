import { createSession } from '../game/session';
import type { Hint, Session } from '../game/session';
import { buildNameIndex, autocomplete } from '../game/matching';
import { loadRooms } from '../rooms';
import { pixelRenderer } from '../render/pixelRenderer';
import { fitTileSize, VIEWPORT } from '../render/renderer';
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

  /**
   * Two columns: the map on the left, everything you act on on the right. A tall shaft runs
   * well past the fold at this scale, and in one column that pushed the answer box off
   * screen. The right column sticks so it stays beside the map however tall the room is.
   */
  root.innerHTML = `
    <div data-role="layout" style="display:flex;gap:32px;align-items:flex-start">
      <div data-role="left" style="flex:0 1 auto;min-width:0">
        <h1>SM Map Rando Trainer</h1>
        <p>Identify the room from its Map Rando map tiles.</p>
        <p data-role="score"></p>
        <div data-role="stage" style="display:inline-block;line-height:0"
          ><canvas data-role="map"></canvas></div>
      </div>
      <div data-role="right" style="flex:1 1 340px;position:sticky;top:16px">
        <p data-role="guesses"></p>
        <p>
          <label>Which room is this?
            <input name="answer" type="text" autocomplete="off" size="32">
          </label>
        </p>
        <p>
          <button data-action="guess">Answer</button>
          <button data-action="skip">Skip (costs a guess, gives a hint)</button>
          <button data-action="next" hidden>Next room</button>
        </p>
        <ul data-role="suggestions"></ul>
        <p data-role="verdict"></p>
        <dl data-role="hints"></dl>
        <div data-role="reveal"></div>
      </div>
    </div>
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
   * What has been typed for this room, newest last, so the arrows can walk back through it.
   * `historyAt` is the entry currently shown; one past the end means the box is the player's
   * own, and the arrows leave the caret alone.
   */
  let history: string[] = [];
  let historyAt = 0;
  /** Enter on an empty box is as likely a stray keypress as a decision, so it asks first. */
  let skipArmed = false;

  /** Each room is drawn as large as it will go without running off the page. */
  function drawRoom(): void {
    const room = session.current();
    renderer.render(canvas, room, { ...settings, tileSize: fitTileSize(room, VIEWPORT) });
  }

  /**
   * The diagram hint stands in for the map at exactly its size, rather than appearing beside
   * it: it is the same room, so showing both invites comparing two pictures of one thing.
   */
  function drawStage(): void {
    const diagram = session.hints().find((h) => h.kind === 'diagram');
    const existing = stage.querySelector('img[data-role=diagram]');
    if (!diagram?.imageUrl) {
      existing?.remove();
      canvas.hidden = false;
      return;
    }
    canvas.hidden = true;
    if (existing) return;
    const img = document.createElement('img');
    img.dataset['role'] = 'diagram';
    img.src = diagram.imageUrl;
    img.alt = 'The room as it looks in game';
    img.width = canvas.width;
    img.height = canvas.height;
    img.style.objectFit = 'contain';
    stage.append(img);
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
      <dd>${h.imageUrl ? 'Shown in place of the map.' : h.text}</dd>`).join('');
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
    drawStage();
    drawStatus();
    drawHints();
    drawSuggestions();
    drawReveal();
  }

  function standDown(): void {
    if (!skipArmed) return;
    skipArmed = false;
    verdict.textContent = '';
  }

  function advance(): void {
    session.next();
    input.value = '';
    history = [];
    historyAt = 0;
    standDown();
    verdict.textContent = '';
    drawRoom();
    redraw();
    input.focus();
  }

  /**
   * Enter on an empty box offers to skip, asking once first: it is as likely a stray
   * keypress as a decision. The Answer button does not, because a button labelled Answer
   * spending a guess on a hint would be a surprise.
   */
  function submitEmpty(): void {
    if (!skipArmed) {
      skipArmed = true;
      verdict.textContent = 'Press Enter again to skip and take a hint.';
      return;
    }
    skipArmed = false;
    verdict.textContent = '';
    session.skip();
    redraw();
  }

  function submit(): void {
    if (session.state() !== 'guessing') return;
    if (input.value.trim() === '') return;
    standDown();

    history.push(input.value);
    historyAt = history.length;
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
    input.value = '';
    redraw();
  }

  guessButton.addEventListener('click', submit);
  skipButton.addEventListener('click', () => {
    if (session.state() !== 'guessing') return;
    session.skip();
    verdict.textContent = '';
    redraw();
  });
  nextButton.addEventListener('click', advance);
  input.addEventListener('input', () => {
    standDown();
    // Typing makes the box the player's own again, so the arrows go back to moving the caret.
    historyAt = history.length;
    drawSuggestions();
  });
  input.addEventListener('blur', standDown);

  /** True while the box still holds exactly what history put there, untouched. */
  const browsingHistory = () =>
    input.value === '' || input.value === history[historyAt];

  function showHistory(at: number): void {
    historyAt = Math.min(Math.max(at, 0), history.length);
    input.value = history[historyAt] ?? '';
    drawSuggestions();
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { standDown(); return; }

    if (event.key === 'Enter') {
      if (session.state() !== 'guessing') advance();
      else if (input.value.trim() === '') submitEmpty();
      else submit();
      return;
    }

    if (event.key === 'Tab') {
      const top = topSuggestion();
      if (!top) return;
      event.preventDefault();
      input.value = top.name;
      drawSuggestions();
      return;
    }

    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && history.length > 0) {
      if (!browsingHistory()) return;
      event.preventDefault();
      showHistory(historyAt + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });

  drawRoom();
  redraw();
  return { session };
}

import { createSession, MAX_GUESSES } from '../game/session';
import type { Hint, Session } from '../game/session';
import { buildNameIndex, autocomplete } from '../game/matching';
import { loadRooms, guessableRooms } from '../rooms';
import { pixelRenderer } from '../render/pixelRenderer';
import { fitTileSize, VIEWPORT } from '../render/renderer';
import { allPars, PAR_OVERRIDES } from '../game/par';
import {
  emptyStats, recordRoom, winRate, guessHistogram, strugglingRooms, loadStats, saveStats,
} from '../game/stats';
import type { Stats } from '../game/stats';
import type { Renderer } from '../render/renderer';
import type { RenderSettings, Room } from '../types';
import type { PlayedRoom } from '../game/session';

/** Room diagrams are served from sm-json-data over a CDN, pinned to a commit. */
const DIAGRAM_CDN = 'https://cdn.jsdelivr.net/gh/vg-json-data/sm-json-data'
  + '@f0a990339a2d234ed8d3ae6234c855a016aae021';

export interface AppOptions {
  rooms: Room[];
  settings: RenderSettings;
  renderer?: Renderer;
  random?: () => number;
}

export interface App {
  session: Session;
  /** Detaches the document-level key handling. Mounting without this leaks listeners. */
  destroy(): void;
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
  // Arrow keys are bound on the document, which outlives this root, so they are torn down
  // together rather than left behind.
  const listeners = new AbortController();
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
        <p>
          <button data-action="toggle-view" hidden>Show the map</button>
          <span data-role="viewing"></span>
        </p>
        <div data-role="stage" style="display:inline-block;line-height:0"
          ><canvas data-role="map"></canvas></div>
      </div>
      <div data-role="right" style="flex:1 1 340px;position:sticky;top:16px">
        <p><span data-role="guesses"></span> <span data-role="par"></span></p>
        <p>
          <label>Which room is this?
            <input name="answer" type="text" autocomplete="off" size="32">
          </label>
        </p>
        <p>
          <button data-action="guess">Answer</button>
          <button data-action="skip">Skip (costs a guess, gives a hint)</button>
          <button data-action="next" hidden>Next room</button>
          <button data-action="new-round" hidden>Start another round</button>
        </p>
        <ul data-role="suggestions"></ul>
        <p data-role="verdict"></p>
        <dl data-role="hints"></dl>
        <div data-role="reveal"></div>
        <section data-role="summary" hidden></section>
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
  const guessButton = el<HTMLButtonElement>('button[data-action=guess]');
  const skipButton = el<HTMLButtonElement>('button[data-action=skip]');
  const nextButton = el<HTMLButtonElement>('button[data-action=next]');
  const toggleButton = el<HTMLButtonElement>('button[data-action=toggle-view]');
  const viewing = el<HTMLSpanElement>('[data-role=viewing]');
  const par = el<HTMLSpanElement>('[data-role=par]');
  const guessesLabel = el<HTMLSpanElement>('[data-role=guesses]');
  const summary = el<HTMLElement>('[data-role=summary]');
  const newRoundButton = el<HTMLButtonElement>('button[data-action=new-round]');

  const storage = (() => {
    try { return window.localStorage; } catch { return null; }
  })();
  /** Everything ever played, kept between visits. A convenience, never load-bearing. */
  let allTime: Stats = loadStats(storage);
  /** Just this round, for showing beside it. */
  let thisRound: Stats = emptyStats();
  /** Guards against filing the same room twice, since redraws are frequent. */
  let recorded = false;

  /**
   * How many guesses each room ought to take, worked out once. It is shown to the player as
   * a difficulty label and nothing else: rooms are drawn at random, not chosen by par.
   *
   * Worked out over every room that can be asked about, not this session's pool. A session
   * narrowed to one area does not make its rooms easier to name, because the player may
   * still answer with any room in the game.
   */
  const parByRoom = new Map(
    allPars(guessableRooms(), settings, PAR_OVERRIDES).map((p) => [p.room.id, p.par]),
  );

  const topSuggestion = () => autocomplete(input.value, index, 1)[0] ?? null;

  /** Enter on an empty box is as likely a stray keypress as a decision, so it asks first. */
  let skipArmed = false;
  /** How far back through finished rooms we are looking. 0 is the room in play. */
  let lookingBack = 0;
  /** Whether the stage shows the map rather than the room's own picture, once both exist. */
  let showMap = false;

  /** The room on screen, which is the one in play unless we are looking back. */
  function viewedRoom(): Room {
    const finished = session.played();
    return lookingBack === 0
      ? session.current()
      : (finished[finished.length - lookingBack] as PlayedRoom).room;
  }

  /** A finished room's picture is always available; the room in play only once revealed. */
  function diagramAvailable(): boolean {
    if (lookingBack > 0) return viewedRoom().diagram !== null;
    return session.hints().some((h) => h.kind === 'diagram' && h.imageUrl);
  }

  /** Each room is drawn as large as it will go without running off the page. */
  function drawRoom(): void {
    const room = viewedRoom();
    renderer.render(canvas, room, { ...settings, tileSize: fitTileSize(room, VIEWPORT) });
  }

  /**
   * The diagram hint stands in for the map at exactly its size, rather than appearing beside
   * it: it is the same room, so showing both invites comparing two pictures of one thing.
   */
  function drawStage(): void {
    const room = viewedRoom();
    const available = diagramAvailable();
    const existing = stage.querySelector('img[data-role=diagram]');

    toggleButton.hidden = !available;
    toggleButton.textContent = showMap ? 'Show the room' : 'Show the map';

    if (!available || showMap) {
      existing?.remove();
      canvas.hidden = false;
      return;
    }
    canvas.hidden = true;
    if (existing) return;

    const img = document.createElement('img');
    img.dataset['role'] = 'diagram';
    img.src = `${DIAGRAM_CDN}/${room.diagram}`;
    img.alt = 'The room as it looks in game';
    img.width = canvas.width;
    img.height = canvas.height;
    img.style.objectFit = 'contain';
    stage.append(img);
  }

  function drawStatus(): void {
    const { asked, solved, guessesUsed } = session.score();
    score.textContent = `Solved ${solved} of ${asked} — ${plural(guessesUsed, 'guess')} used`;
    par.textContent = `Par ${parByRoom.get(viewedRoom().id) ?? 1}`;

    const back = lookingBack > 0;
    const over = session.state() !== 'guessing';

    viewing.textContent = back
      ? `Looking back at ${viewedRoom().name} — right arrow to return`
      : '';
    guessesLabel.textContent = !back && !over ? `${plural(session.guessesLeft(), 'guess')} left` : '';

    // Looking back is read-only: that room is already finished with.
    const roundOver = session.roundComplete();
    input.hidden = back;
    input.disabled = over;
    guessButton.hidden = back || over;
    skipButton.hidden = back || over;
    nextButton.hidden = back || !over || roundOver;
    newRoundButton.hidden = back || !roundOver;
    if (back) suggestions.innerHTML = '';
  }

  /** Files the finished room into the running tallies, once. */
  function recordOutcome(): void {
    if (recorded || session.state() === 'guessing') return;
    recorded = true;
    const outcome = {
      roomId: session.current().id,
      roomName: session.current().name,
      solved: session.state() === 'solved',
      guessesUsed: MAX_GUESSES - session.guessesLeft(),
    };
    allTime = recordRoom(allTime, outcome);
    thisRound = recordRoom(thisRound, outcome);
    saveStats(storage, allTime);
  }

  function bar(label: string, roundShare: number, allShare: number, count: number): string {
    return `<li data-role="bar" data-label="${label}"
      style="display:flex;align-items:center;gap:8px;margin:2px 0">
      <span style="width:1.2em;text-align:right">${label}</span>
      <span style="flex:1;display:block">
        <span data-role="bar-round" title="this round"
          style="display:block;height:10px;background:#7cf;width:${roundShare}%;min-width:${
  count > 0 ? 2 : 0}px"></span>
        <span data-role="bar-all" title="all time"
          style="display:block;height:6px;background:#555;width:${allShare}%"></span>
      </span>
      <span style="width:3em">${count}</span>
    </li>`;
  }

  /**
   * How the round went, next to how things have gone overall. Deliberately plain: the page
   * has not been styled yet, and this only has to be readable.
   */
  function drawSummary(): void {
    summary.hidden = !session.roundComplete();
    if (summary.hidden) return;

    const roundBars = guessHistogram(thisRound);
    const allBars = guessHistogram(allTime);
    const roundRate = winRate(thisRound);
    const allRate = winRate(allTime);
    const diff = roundRate - allRate;
    const struggles = strugglingRooms(allTime, 5);

    summary.innerHTML = `
      <h2>Round ${session.roundNumber()} done</h2>
      <p data-role="win-rate">Solved ${roundRate}% this round
        <span data-role="win-diff">(${diff >= 0 ? '+' : ''}${diff} against ${allRate}% all time)</span>
      </p>
      <p>Solved on guess — <span style="color:#7cf">this round</span> over all time</p>
      <ul style="list-style:none;padding:0;max-width:22em">
        ${roundBars.map((b, i) => bar(b.label, b.share, allBars[i]?.share ?? 0, b.count)).join('')}
      </ul>
      ${struggles.length ? `<p>Rooms going worst</p>
        <ol data-role="struggles">${struggles.map((r) => `<li>${r.name}
          — solved ${r.solved} of ${r.attempts}, ${r.averageGuesses.toFixed(1)} guesses on
          average</li>`).join('')}</ol>` : '<ol data-role="struggles"></ol>'}`;
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
    recordOutcome();
    drawStage();
    drawStatus();
    drawSummary();
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
    if (session.roundComplete()) return;
    session.next();
    recorded = false;
    input.value = '';
    lookingBack = 0;
    showMap = false;
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
  newRoundButton.addEventListener('click', () => {
    session.startRound();
    thisRound = emptyStats();
    recorded = false;
    input.value = '';
    lookingBack = 0;
    showMap = false;
    standDown();
    drawRoom();
    redraw();
    input.focus();
  });
  input.addEventListener('input', () => {
    standDown();
    drawSuggestions();
  });
  input.addEventListener('blur', standDown);

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

  });

  toggleButton.addEventListener('click', () => {
    showMap = !showMap;
    drawRoom();
    redraw();
  });

  /**
   * Left and right step back and forward through the rooms already finished with. They are
   * bound on the document rather than the box, and ignored while the box has focus, so they
   * keep moving the caret while you are typing an answer.
   */
  function look(step: number): void {
    const limit = session.played().length;
    const next = Math.min(Math.max(lookingBack + step, 0), limit);
    if (next === lookingBack) return;
    lookingBack = next;
    showMap = false;
    drawRoom();
    redraw();
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    // While the answer box has focus the arrows belong to the caret.
    if (document.activeElement === input) return;
    event.preventDefault();
    look(event.key === 'ArrowLeft' ? 1 : -1);
  }, { signal: listeners.signal });

  drawRoom();
  redraw();
  return { session, destroy: () => listeners.abort() };
}

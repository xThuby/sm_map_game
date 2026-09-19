import { createSession, ROUND_LENGTH } from '../game/session';
import type { HintKind, Session } from '../game/session';
import { buildNameIndex, autocomplete } from '../game/matching';
import { loadRooms, guessableRooms } from '../rooms';
import { pixelRenderer } from '../render/pixelRenderer';
import { fitTileSize, VIEWPORT } from '../render/renderer';
import { allPars, PAR_OVERRIDES } from '../game/par';
import {
  emptyStats, recordRoom, recordRound, winRate, guessHistogram, strugglingRooms,
  averagePoints, loadStats, saveStats,
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
          <span data-role="buy-diagram"></span>
          <button data-action="toggle-view" hidden>Show the room</button>
        </p>
        <div data-role="stage" style="display:inline-block;line-height:0"
          ><canvas data-role="map"></canvas></div>
      </div>
      <div data-role="right" style="flex:1 1 340px;position:sticky;top:16px">
        <p>
          <span data-role="points" style="margin-right:16px"></span>
          <span data-role="total" style="margin-right:16px"></span>
          <span data-role="par"></span>
        </p>
        <p>
          <label><span data-role="prompt">Which room is this?</span>
            <input name="answer" type="text" autocomplete="off" size="32">
          </label>
        </p>
        <p>
          <button data-action="guess">Answer</button>
          <button data-action="give-up">Give up</button>
          <button data-action="next" hidden>Next room</button>
          <button data-action="new-round" hidden>Start another round</button>
        </p>
        <ul data-role="suggestions" style="list-style:none;padding:0;margin:4px 0"></ul>
        <p data-role="verdict"></p>
        <p data-role="tried"></p>
        <div data-role="facts">
          <p data-role="name-line" style="font-weight:bold;font-size:1.2em"
            ><span data-role="room-name"></span> </p>
          <ul data-role="fact-list"></ul>
          <p data-role="alias-link"></p>
        </div>
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
  const roomName = el<HTMLSpanElement>('[data-role=room-name]');
  const nameLine = el<HTMLParagraphElement>('[data-role=name-line]');
  const factList = el<HTMLUListElement>('[data-role=fact-list]');
  const aliasLink = el<HTMLParagraphElement>('[data-role=alias-link]');
  const score = el<HTMLParagraphElement>('[data-role=score]');
  const guessButton = el<HTMLButtonElement>('button[data-action=guess]');
  const giveUpButton = el<HTMLButtonElement>('button[data-action=give-up]');
  const nextButton = el<HTMLButtonElement>('button[data-action=next]');
  const toggleButton = el<HTMLButtonElement>('button[data-action=toggle-view]');
  const buyDiagram = el<HTMLSpanElement>('[data-role=buy-diagram]');
  const pointsLabel = el<HTMLSpanElement>('[data-role=points]');
  const prompt = el<HTMLSpanElement>('[data-role=prompt]');
  const tried = el<HTMLParagraphElement>('[data-role=tried]');
  const par = el<HTMLSpanElement>('[data-role=par]');
  const totalLabel = el<HTMLSpanElement>('[data-role=total]');
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
  /** Which round's total has been banked, so a redraw does not bank it again. */
  let roundBanked = 0;

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

  /** Which suggestion the arrows have landed on. Reset whenever the text changes. */
  let suggestionAt = 0;
  const currentSuggestions = () => autocomplete(input.value, index, SUGGESTION_LIMIT);

  /** How far back through finished rooms we are looking. 0 is the room in play. */
  let lookingBack = 0;
  /**
   * Whether the stage shows the room's own picture rather than the map. The picture is
   * bought now, so it is off until somebody pays for it or reaches for the toggle.
   */
  let showDiagram = false;

  /** The room on screen, which is the one in play unless we are looking back. */
  function viewedRoom(): Room {
    const finished = session.played();
    return lookingBack === 0
      ? session.current()
      : (finished[finished.length - lookingBack] as PlayedRoom).room;
  }

  /** The picture can be shown once it has been bought, or once the room is over. */
  function diagramShowable(): boolean {
    if (lookingBack > 0 || session.state() !== 'guessing') return viewedRoom().diagram !== null;
    return session.offers().some((o) => o.kind === 'diagram' && o.bought);
  }

  /**
   * The price tag for a hint, put where its answer will appear so the trade is plain. Gone
   * once the hint is bought or the room is over; disabled, rather than hidden, when there
   * are too few points left — what you cannot afford is worth knowing.
   */
  function priceTag(kind: HintKind): string {
    if (lookingBack > 0 || session.state() !== 'guessing') return '';
    if (kind === 'diagram' && viewedRoom().diagram === null) return '';
    const offer = session.offers().find((o) => o.kind === kind);
    if (!offer || offer.bought) return '';
    // The name is sold a letter at a time, so its tag says which letter is being bought.
    const what = kind === 'name'
      ? `${session.nameLetters() === 0 ? 'a letter' : 'another letter'} for`
      : 'for';
    return `<button data-action="buy" data-hint="${kind}"${offer.affordable ? '' : ' disabled'}
      >reveal ${what} ${offer.cost}</button>`;
  }

  /** Where in the played rooms the one on screen sits. Negative is not possible. */
  function viewedIndex(): number {
    return session.played().length - lookingBack;
  }

  /** The points on the room being looked at, which is the one in play unless looking back. */
  function viewedPoints(): number {
    if (lookingBack === 0) return session.points();
    return (session.played()[viewedIndex()] as PlayedRoom).points;
  }

  /**
   * The round's total as it stood when the room on screen was finished with — not as it
   * stands now, which would be a different room's story. Rounds are a fixed length, so where
   * one starts in the played rooms falls straight out of the index.
   */
  function totalSoFar(): number {
    if (lookingBack === 0) return session.roundPoints();
    const at = viewedIndex();
    const start = Math.floor(at / ROUND_LENGTH) * ROUND_LENGTH;
    return session.played().slice(start, at + 1).reduce((sum, r) => sum + r.points, 0);
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
    const available = diagramShowable();
    const existing = stage.querySelector('img[data-role=diagram]');

    const diagramPrice = priceTag('diagram');
    buyDiagram.innerHTML = diagramPrice ? `Room graphics: ${diagramPrice}` : '';
    toggleButton.hidden = !available;
    toggleButton.textContent = showDiagram ? 'Show the map' : 'Show the room';

    if (!available || !showDiagram) {
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
    // Which room on screen is, counting within its own round. Rooms already played sit in
    // one flat list and every round is the same length, so the place falls out of the index:
    // the room in play is the one after the last one filed away, and looking back walks it
    // backwards with you.
    const place = (((viewedIndex()) % ROUND_LENGTH) + ROUND_LENGTH) % ROUND_LENGTH;
    score.textContent = `Room ${place + 1} of ${ROUND_LENGTH}`;
    par.textContent = `Par ${parByRoom.get(viewedRoom().id) ?? 1}`;

    const back = lookingBack > 0;
    const over = session.state() !== 'guessing';

    prompt.textContent = back ? 'This room was' : 'Which room is this?';
    // What has been tried already, so it is not tried twice. The room in play only: a room
    // gone by is filed under what it was worth, not what was guessed at it.
    const guessed = session.wrongGuesses();
    tried.textContent = !back && guessed.length > 0
      ? `Previous guesses: ${guessed.map((r) => r.name).join(', ')}`
      : '';
    pointsLabel.textContent = plural(viewedPoints(), 'point');
    // The total is what the round is worth so far, which only means something once the room
    // on screen has been finished with.
    totalLabel.textContent = back || over ? `Round so far: ${totalSoFar()}` : '';

    // Looking back is read-only: that room is already finished with.
    const roundOver = session.roundComplete();
    input.hidden = back;
    guessButton.hidden = back || over;
    giveUpButton.hidden = back || over;
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
      guessesUsed: session.guessesUsed(),
      points: session.points(),
    };
    allTime = recordRoom(allTime, outcome);
    thisRound = recordRoom(thisRound, outcome);
    saveStats(storage, allTime);
  }

  /** Banks the round's total against the best ever, once the round is done. */
  function recordRoundTotal(): void {
    if (!session.roundComplete() || roundBanked === session.roundNumber()) return;
    roundBanked = session.roundNumber();
    allTime = recordRound(allTime, session.roundPoints());
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
      <p data-role="round-points">${plural(session.roundPoints(), 'point')}</p>
      <p data-role="all-points">All time: average ${plural(averagePoints(allTime), 'point')}
        a room, best round ${allTime.bestRound}</p>
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


  /**
   * One panel for everything known about the room. Facts a hint would give away read "?"
   * until that hint arrives; facts that were never hints are shown from the start, because
   * they are already on the map. The name sits above it, masked, a letter at a time.
   *
   * The room's own picture is not listed: it stands in for the map, and naming it as a fact
   * as well would say nothing.
   */
  /**
   * "Items: 1 (one hidden)" could be read as two items with one of them hidden. A room
   * whose items are all hidden says so outright; one with some of each counts them.
   */
  function itemsFact(room: Room): string {
    if (room.itemCount === 0) return '';
    if (room.hiddenItemCount === 0) return `Items: ${room.itemCount}`;
    if (room.hiddenItemCount === room.itemCount) return `Items: ${room.itemCount} hidden`;
    return `Items: ${room.itemCount} (${room.hiddenItemCount} hidden)`;
  }

  function drawFacts(): void {
    const room = viewedRoom();
    const over = lookingBack > 0 || session.state() !== 'guessing';
    const shown = new Set(session.hints().map((h) => h.kind));
    const known = (kind: HintKind, value: string) =>
      (over || shown.has(kind) ? value : priceTag(kind));

    // Masked from the start rather than hidden: the shape of a name is free, and it is
    // something to work with before any letter of it has been paid for.
    roomName.textContent = over ? room.name : session.nameMask();
    // The name's price sits beside the name rather than in the list below it.
    nameLine.querySelector('button[data-action=buy]')?.remove();
    nameLine.insertAdjacentHTML('beforeend', priceTag('name'));

    const enemies = room.enemies.length === 0
      ? 'none'
      : room.enemies.map((e) => (e.quantity > 1 ? `${e.quantity} ${e.name}` : e.name)).join(', ');

    const twins = over ? session.group().filter((r) => r.id !== room.id) : [];
    const facts = [
      `Area: ${known('area', room.area)}`,
      `Enemies: ${known('enemies', enemies)}`,
      `Connects to: ${known('neighbour', room.neighbours.join(', ') || 'nothing')}`,
      `Size: ${room.width} x ${room.height} tiles`,
      itemsFact(room),
      room.heated ? 'Heated' : '',
      room.liquid !== 'none' ? room.liquid.charAt(0).toUpperCase() + room.liquid.slice(1) : '',
      room.utilities.length ? room.utilities.join(', ') : '',
      over && room.aliases.length ? `Also known as: ${room.aliases.join(', ')}` : '',
      twins.length ? `Looks identical to: ${twins.map((r) => r.name).join(', ')}` : '',
    ].filter(Boolean);

    factList.innerHTML = facts.map((f) => `<li data-role="fact">${f}</li>`).join('');
    aliasLink.innerHTML = over
      ? `<a data-action="suggest-alias" href="${aliasIssueUrl(room)}"
           target="_blank" rel="noopener">Know this room by another name? Suggest it</a>`
      : '';
  }


  function drawSuggestions(): void {
    if (session.state() !== 'guessing' || lookingBack > 0 || input.value.trim() === '') {
      suggestions.innerHTML = '';
      return;
    }
    const matches = currentSuggestions();
    suggestionAt = Math.min(suggestionAt, Math.max(matches.length - 1, 0));
    suggestions.innerHTML = matches
      .map((e, i) => `<li role="option" data-index="${i}"
        aria-selected="${i === suggestionAt}"
        style="cursor:pointer;padding:1px 4px;${
  i === suggestionAt ? 'background:#234;' : ''}">${e.name}</li>`)
      .join('');
  }

  /** Puts a suggestion in the box, ready to be sent. */
  function takeSuggestion(at: number): void {
    const match = currentSuggestions()[at];
    if (!match) return;
    input.value = match.name;
    suggestionAt = 0;
    drawSuggestions();
    input.focus();
  }

  function moveSelection(step: number): void {
    const matches = currentSuggestions();
    if (matches.length === 0) return;
    // Stops at the ends: wrapping past the last one is disorienting in a short list.
    suggestionAt = Math.min(Math.max(suggestionAt + step, 0), matches.length - 1);
    drawSuggestions();
  }




  function redraw(): void {
    recordOutcome();
    recordRoundTotal();
    drawStage();
    drawStatus();
    drawSummary();
    drawFacts();
    drawSuggestions();
  }

  /**
   * Everything on screen that belongs to the room being left rather than the one arriving.
   * Shared by the two ways of moving on, which had drifted apart: starting a new round left
   * the last room's verdict sitting over the new one.
   */
  function clearBoard(): void {
    recorded = false;
    input.value = '';
    suggestionAt = 0;
    lookingBack = 0;
    showDiagram = false;
    verdict.textContent = '';
  }

  function advance(): void {
    if (session.roundComplete()) return;
    session.next();
    clearBoard();
    drawRoom();
    redraw();
    input.focus();
  }

  function submit(): void {
    if (session.state() !== 'guessing') return;
    if (input.value.trim() === '') return;

    const grade = session.guess(input.value);

    // Neither a typo nor a room already ruled out is a guess: both cost nothing and are
    // graded against nothing, so wiping the box would only throw away work to redo.
    if (!grade.recognised) {
      verdict.textContent = grade.suggestion
        ? `Did you mean ${grade.suggestion.name}?`
        : 'That is not a room name.';
      redraw();
      return;
    }

    if (grade.repeat) {
      verdict.textContent = `Already guessed ${grade.answer?.name}.`;
      redraw();
      return;
    }

    verdict.textContent = grade.correct ? 'Correct.' : 'Incorrect.';
    input.value = '';
    redraw();
  }

  guessButton.addEventListener('click', submit);
  giveUpButton.addEventListener('click', () => {
    if (session.state() !== 'guessing') return;
    session.giveUp();
    verdict.textContent = '';
    redraw();
  });

  /**
   * The price tags are redrawn constantly, so the click is caught on the way up rather than
   * bound to buttons that will not survive the next redraw.
   */
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement)
      .closest<HTMLButtonElement>('button[data-action=buy]');
    // A disabled button dispatches no click of its own, but it can still be reached by a
    // stray programmatic one, and buying what is turned off would throw.
    if (!button || button.disabled || lookingBack > 0 || session.state() !== 'guessing') return;
    const kind = button.getAttribute('data-hint') as HintKind;
    session.buyHint(kind);
    // Paying for the picture is asking to see it.
    if (kind === 'diagram') showDiagram = true;
    redraw();
    input.focus();
  });
  nextButton.addEventListener('click', advance);
  newRoundButton.addEventListener('click', () => {
    session.startRound();
    thisRound = emptyStats();
    clearBoard();
    drawRoom();
    redraw();
    input.focus();
  });
  input.addEventListener('input', () => {
    // New text means a new list; start at the top of it again.
    suggestionAt = 0;
    drawSuggestions();
  });
  suggestions.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest('li[data-index]');
    if (item) takeSuggestion(Number(item.getAttribute('data-index')));
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      // An empty box has nothing to send, and nothing to buy: hints are bought by name.
      if (session.state() !== 'guessing') advance();
      else submit();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (currentSuggestions().length === 0) return;
      event.preventDefault();
      moveSelection(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (event.key === 'Tab') {
      if (currentSuggestions().length === 0) return;
      event.preventDefault();
      takeSuggestion(suggestionAt);
      return;
    }

  });

  toggleButton.addEventListener('click', () => {
    showDiagram = !showDiagram;
    drawRoom();
    redraw();
  });

  /**
   * Left and right step back and forward through the rooms already finished with. They are
   * bound on the document rather than the box, and ignored while the box has focus, so they
   * keep moving the caret while you are typing an answer.
   */
  function look(step: number): void {
    // Not until the round is over, and never past its first room. Looking back mid-round is
    // a way of stalling on the room in front of you; once the round is done it is revision.
    const limit = session.roundComplete() ? session.roundResults().length - 1 : 0;
    const next = Math.min(Math.max(lookingBack + step, 0), Math.max(limit, 0));
    if (next === lookingBack) return;
    lookingBack = next;
    showDiagram = false;
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

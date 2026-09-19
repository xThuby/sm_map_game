import { allPars, PAR_OVERRIDES } from '../game/par';
import type { ParBreakdown } from '../game/par';
import { visualSignature } from '../signature';
import { fitTileSize } from '../render/renderer';
import type { Renderer } from '../render/renderer';
import { pixelRenderer } from '../render/pixelRenderer';
import type { RenderSettings, Room } from '../types';

export interface LookAlikeGroup {
  /** A stable id for the group, so picking one survives a redraw. */
  key: string;
  label: string;
  rooms: Room[];
}

/**
 * Rooms that paint the same picture, gathered together. Every room with a par above one has
 * at least one twin — that is precisely why its par is above one — so these groups are the
 * unit worth reviewing.
 */
export function lookAlikeGroups(
  pool: readonly Room[],
  settings: RenderSettings,
): LookAlikeGroup[] {
  const bySignature = new Map<string, Room[]>();
  for (const room of pool) {
    const key = visualSignature(room, settings);
    bySignature.set(key, [...(bySignature.get(key) ?? []), room]);
  }
  return [...bySignature]
    .filter(([, rooms]) => rooms.length > 1)
    .map(([key, rooms]) => ({
      key,
      label: `${rooms.length} rooms — ${rooms.map((r) => r.name).join(', ')}`,
      rooms,
    }))
    .sort((a, b) => b.rooms.length - a.rooms.length || a.label.localeCompare(b.label));
}

export interface ParPageOptions {
  rooms: Room[];
  settings: RenderSettings;
  renderer?: Renderer;
}

const PREVIEW = { width: 260, height: 200 };

const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');

function roomCard(entry: ParBreakdown, settings: RenderSettings, renderer: Renderer): HTMLElement {
  const { room, par, computedPar, override, resolvedBy, steps } = entry;
  const el = document.createElement('article');
  el.dataset['role'] = 'room';
  el.dataset['par'] = String(par);
  el.dataset['room'] = String(room.id);
  el.style.cssText = 'display:flex;gap:16px;align-items:flex-start;'
    + 'border-top:1px solid #333;padding:12px 0';

  const canvas = document.createElement('canvas');
  renderer.render(canvas, room, { ...settings, tileSize: fitTileSize(room, PREVIEW) });

  const facts = document.createElement('div');
  facts.innerHTML = `
    <p><strong>${room.name}</strong>
       — par <span data-role="par">${par}</span>,
       settled by <span data-role="resolved-by">${resolvedBy ?? 'nothing'}</span></p>
    ${override ? `<p data-role="override" style="color:#fc9">Set by hand from ${computedPar}:
       ${override.why}</p>` : ''}
    <ul>
      <li>Area: ${room.area}</li>
      <li>Enemies: ${list(room.enemies.map((e) => (e.quantity > 1 ? `${e.quantity} ${e.name}` : e.name)))}</li>
      <li>Connects to: ${list(room.neighbours)}</li>
      <li>${room.width} x ${room.height} tiles, ${room.doors.length} door(s)${
        room.heated ? ', heated' : ''}${room.liquid !== 'none' ? `, ${room.liquid}` : ''}</li>
    </ul>
    <ol data-role="steps">${steps.map((s) => `
      <li>after <strong>${s.hint}</strong>: ${
        s.confusable.length
          ? `still ${s.confusable.map((r) => r.name).join(', ')}`
          : 'unique'}</li>`).join('')}</ol>`;

  el.append(canvas, facts);
  return el;
}

/**
 * A page for judging whether the par numbers feel right. Par 1 rooms are left out: there is
 * nothing to weigh up about a room nothing else resembles.
 */
export function mountParPage(root: HTMLElement, options: ParPageOptions): void {
  const { rooms, settings, renderer = pixelRenderer } = options;
  const groups = lookAlikeGroups(rooms, settings);
  const entries = allPars(rooms, settings, PAR_OVERRIDES).filter((p) => p.par > 1);

  root.innerHTML = `
    <h1>Par review</h1>
    <p>How many guesses a room ought to take: one, plus a guess for each hint needed before
       it stops matching any other room. Rooms nothing else resembles are par 1 and are not
       listed.</p>
    <p data-role="summary"></p>
    <p>
      <label>Look-alike group
        <select data-role="group">
          <option value="">All ${entries.length} rooms above par 1</option>
          ${groups.map((g) => `<option value="${g.key.replace(/"/g, '&quot;')}">${g.label}</option>`).join('')}
        </select>
      </label>
    </p>
    <div data-role="rooms"></div>
  `;

  const summary = root.querySelector<HTMLParagraphElement>('[data-role=summary]');
  const container = root.querySelector<HTMLDivElement>('[data-role=rooms]');
  const select = root.querySelector<HTMLSelectElement>('select[data-role=group]');
  if (!summary || !container || !select) throw new Error('par page failed to mount');

  const counts = new Map<number, number>();
  for (const e of entries) counts.set(e.par, (counts.get(e.par) ?? 0) + 1);
  summary.textContent = [...counts]
    .sort((a, b) => a[0] - b[0])
    .map(([par, n]) => `par ${par}: ${n} rooms`)
    .join(' · ');

  const byRoom = new Map(entries.map((e) => [e.room.id, e]));

  /**
   * Rooms are laid out group by group, so a room always sits beside the ones it can be
   * confused with. Judging whether a par is fair means weighing it against its neighbours,
   * and sorting by par alone scattered them: the two Aqueduct Quicksand Rooms have different
   * pars and ended up pages apart.
   */
  function draw(): void {
    const key = select?.value ?? '';
    const shown = key === '' ? groups : groups.filter((g) => g.key === key);

    container!.replaceChildren(...shown.map((group) => {
      const section = document.createElement('section');
      section.dataset['role'] = 'group-section';

      const members = group.rooms
        .map((r) => byRoom.get(r.id))
        .filter((e): e is ParBreakdown => e !== undefined)
        .sort((a, b) => b.par - a.par || a.room.name.localeCompare(b.room.name));

      const heading = document.createElement('h2');
      heading.dataset['role'] = 'group-heading';
      heading.style.cssText = 'margin:28px 0 0;font-size:1rem;color:#9cf';
      const pars = [...new Set(members.map((m) => m.par))].sort((a, b) => a - b);
      const span = pars.length === 1
        ? `par ${pars[0]}`
        : `par ${pars[0]}–${pars[pars.length - 1]}`;
      heading.textContent = `${group.rooms.length} rooms that look alike — ${span}`;

      section.append(heading, ...members.map((e) => roomCard(e, settings, renderer)));
      return section;
    }));
  }

  select.addEventListener('change', draw);
  draw();
}

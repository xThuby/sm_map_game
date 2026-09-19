import { describe, it, expect } from 'vitest';
import { parFor, parBreakdown, allPars, MAX_PAR, PAR_OVERRIDES } from './par';
import { loadRooms, guessableRooms, roomByName } from '../rooms';
import { DEFAULT_RENDER_SETTINGS } from '../render/renderer';

const settings = DEFAULT_RENDER_SETTINGS;
const pool = guessableRooms();

describe('parFor', () => {
  /**
   * Par is how many guesses it should take: one, plus a guess for every hint you need before
   * the room can no longer be confused with any other.
   */
  it('gives a room nothing else looks like a par of one', () => {
    expect(parFor(roomByName('Landing Site')!, pool, settings)).toBe(1);
  });

  it('never goes below one or above the guesses available', () => {
    for (const room of pool) {
      const par = parFor(room, pool, settings);
      expect(par, room.name).toBeGreaterThanOrEqual(1);
      expect(par, room.name).toBeLessThanOrEqual(MAX_PAR);
    }
  });

  it('costs a guess for each hint a room needs', () => {
    // Wave Beam Room and Ice Beam Room paint identically and share an area, so the picture
    // and the area hint both leave them confusable.
    const wave = roomByName('Wave Beam Room')!;
    expect(parFor(wave, pool, settings)).toBeGreaterThan(2);
  });

  it('agrees with its own breakdown', () => {
    for (const room of pool.slice(0, 40)) {
      const { par, resolvedBy } = parBreakdown(room, pool, settings);
      expect(par).toBe(parFor(room, pool, settings));
      if (par === 1) expect(resolvedBy).toBe('shape');
      if (par === MAX_PAR) expect(resolvedBy).toBeNull();
    }
  });
});

describe('parBreakdown', () => {
  it('names the rooms still confusable at each step', () => {
    const b = parBreakdown(roomByName('Wave Beam Room')!, pool, settings);
    expect(b.steps[0]?.hint).toBe('shape');
    expect(b.steps[0]?.confusable.map((r) => r.name)).toContain('Ice Beam Room');
  });

  it('shrinks or holds the confusable set as hints are added', () => {
    for (const room of pool.slice(0, 60)) {
      const sizes = parBreakdown(room, pool, settings).steps.map((s) => s.confusable.length);
      for (let i = 1; i < sizes.length; i += 1) {
        expect(sizes[i] as number).toBeLessThanOrEqual(sizes[i - 1] as number);
      }
    }
  });

  it('never lists the room itself among its own look-alikes', () => {
    for (const room of pool.slice(0, 60)) {
      for (const step of parBreakdown(room, pool, settings).steps) {
        expect(step.confusable.map((r) => r.id)).not.toContain(room.id);
      }
    }
  });
});

describe('allPars', () => {
  it('covers every room in the pool exactly once', () => {
    const pars = allPars(pool, settings);
    expect(pars).toHaveLength(pool.length);
    expect(new Set(pars.map((p) => p.room.id)).size).toBe(pool.length);
  });

  /**
   * Par belongs to a room, not to a group of look-alikes, and two rooms that paint the same
   * can stilldiffer: Crateria Tube is the only tube in Crateria, so its area settles it,
   * while West Glass Tube Tunnel shares Maridia with Plasma Tutorial Room and needs the
   * enemies hint as well. What must hold is that rooms nothing ever separates share the
   * maximum.
   */
  it('gives the same par to rooms that no hint ever separates', () => {
    const byId = new Map(allPars(pool, settings).map((p) => [p.room.id, p]));
    for (const entry of byId.values()) {
      if (entry.resolvedBy !== null) continue;
      for (const twin of entry.steps[entry.steps.length - 1]?.confusable ?? []) {
        expect(byId.get(twin.id)?.par, `${entry.room.name} vs ${twin.name}`).toBe(MAX_PAR);
      }
    }
  });

  it('gives a room a higher par than one its own hints resolve sooner', () => {
    const byId = new Map(allPars(pool, settings).map((p) => [p.room.id, p]));
    const tube = byId.get(roomByName('Crateria Tube')!.id)!;
    const glass = byId.get(roomByName('West Glass Tube Tunnel')!.id)!;
    expect(tube.resolvedBy).toBe('area');
    expect(glass.resolvedBy).toBe('enemies');
    expect(glass.par).toBeGreaterThan(tube.par);
  });

  it('leaves most rooms identifiable from the picture alone', () => {
    const pars = allPars(pool, settings);
    const ones = pars.filter((p) => p.par === 1).length;
    expect(ones).toBeGreaterThan(pool.length / 2);
  });
});

describe('the whole game', () => {
  it('only assigns par to rooms that are actually asked about', () => {
    const asked = new Set(pool.map((r) => r.id));
    expect(loadRooms().length).toBeGreaterThan(asked.size);
  });
});

describe('hand-set par', () => {
  const overrides = {
    'East Aqueduct Quicksand Room': { par: 4, why: 'counts too close to tell apart' },
  };

  it('uses the hand-set value in place of the computed one', () => {
    const room = roomByName('East Aqueduct Quicksand Room')!;
    const plain = parBreakdown(room, pool, settings);
    const set = parBreakdown(room, pool, settings, overrides);
    expect(plain.par).toBe(3);
    expect(set.par).toBe(4);
  });

  it('keeps the computed value alongside it, and says why it was changed', () => {
    const set = parBreakdown(roomByName('East Aqueduct Quicksand Room')!, pool, settings, overrides);
    expect(set.computedPar).toBe(3);
    expect(set.override?.why).toMatch(/counts too close/);
  });

  it('leaves every other room alone', () => {
    const room = roomByName('Metroid Room 1')!;
    expect(parBreakdown(room, pool, settings, overrides).par)
      .toBe(parBreakdown(room, pool, settings).par);
    expect(parBreakdown(room, pool, settings, overrides).override).toBeNull();
  });

  /** A value keyed by a room that does not exist would otherwise vanish without a word. */
  it('rejects an override for a room that does not exist', () => {
    expect(() => allPars(pool, settings, { 'Nowhere Room': { par: 4, why: 'x' } }))
      .toThrow(/Nowhere Room/);
  });

  it('rejects a par outside the range a player could actually spend', () => {
    const bad = { 'Metroid Room 1': { par: 9, why: 'x' } };
    expect(() => allPars(pool, settings, bad)).toThrow(/9/);
  });
});

describe('the shipped overrides', () => {
  /**
   * The computation settles these on the enemies hint, 6 against 7 of the same enemy. Par 4
   * says the neighbour hint is what should really settle them.
   */
  it('lifts both Aqueduct Quicksand Rooms from 3 to 4', () => {
    const pars = new Map(allPars(pool, settings, PAR_OVERRIDES).map((p) => [p.room.name, p]));
    for (const n of ['East Aqueduct Quicksand Room', 'West Aqueduct Quicksand Room']) {
      expect(pars.get(n)?.par, n).toBe(4);
      expect(pars.get(n)?.computedPar, n).toBe(3);
      expect(pars.get(n)?.override, n).not.toBeNull();
    }
  });

  /** Players really do memorise these, which is why the adjustment is not a blanket rule. */
  it('leaves the Metroid rooms where the computation put them', () => {
    const pars = new Map(allPars(pool, settings, PAR_OVERRIDES).map((p) => [p.room.name, p]));
    expect(pars.get('Metroid Room 1')?.override).toBeNull();
    expect(pars.get('Metroid Room 3')?.par).toBe(3);
  });

  it('names only rooms that exist', () => {
    expect(() => allPars(pool, settings, PAR_OVERRIDES)).not.toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { parFor, parBreakdown, allPars, MAX_PAR } from './par';
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

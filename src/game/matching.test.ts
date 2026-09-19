import { describe, it, expect } from 'vitest';
import { normalizeName, levenshtein, buildNameIndex, resolveName, suggestName, autocomplete }
  from './matching';
import { loadRooms } from '../rooms';

const index = buildNameIndex(loadRooms());

describe('normalizeName', () => {
  it('collapses case, spacing and run-together words to one key', () => {
    const keys = [
      'Wrecked Ship Main Shaft', 'wrecked ship main shaft',
      'WreckedShipMainShaft', '  wrecked  ship main shaft  ',
      'WRECKED-SHIP-MAIN-SHAFT',
    ].map(normalizeName);
    expect(new Set(keys).size).toBe(1);
  });

  it('drops a leading "the"', () => {
    expect(normalizeName('The Moat')).toBe(normalizeName('Moat'));
  });

  it('drops a leading "the" only at the start', () => {
    expect(normalizeName('The Worst Room In The Game'))
      .toBe(normalizeName('Worst Room In The Game'));
  });

  it('ignores apostrophes', () => {
    expect(normalizeName("Crocomire's Room")).toBe(normalizeName('crocomires room'));
  });

  it('returns an empty key for input with nothing to match on', () => {
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('!!!')).toBe('');
  });
});

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('volcano', 'volcano')).toBe(0);
  });

  it('counts a single insertion, deletion and substitution as one each', () => {
    expect(levenshtein('volcano', 'volcanoe')).toBe(1);
    expect(levenshtein('volcano', 'volcan')).toBe(1);
    expect(levenshtein('volcano', 'volcanp')).toBe(1);
  });

  it('is symmetric', () => {
    expect(levenshtein('moat', 'boats')).toBe(levenshtein('boats', 'moat'));
  });
});

describe('buildNameIndex', () => {
  it('indexes every canonical name and every alias', () => {
    expect(index.entries).toHaveLength(286);
    expect(index.entries.filter((e) => e.isAlias)).toHaveLength(33);
  });

  it('indexes the hand-added names', () => {
    expect(resolveName('G4', index)?.name).toBe('Statues Room');
    expect(resolveName('G4 Hallway', index)?.name).toBe('Statues Hallway');
  });

  it('maps each normalized key to exactly one room', () => {
    expect(index.byKey.size).toBe(index.entries.length);
  });
});

describe('resolveName', () => {
  it('resolves an exact canonical name', () => {
    expect(resolveName('Wrecked Ship Main Shaft', index)?.id).toBe(155);
  });

  it('resolves an alias to the same room as its canonical name', () => {
    expect(resolveName('The Jail', index)).toBe(
      resolveName('Lower Norfair Escape Power Bomb Room', index),
    );
  });

  it('resolves sloppily typed input', () => {
    expect(resolveName('  crocomires ROOM ', index)?.name).toBe("Crocomire's Room");
  });

  // A near miss is offered as a suggestion instead, so the player is never silently told
  // they were right when they were not.
  it('does not resolve a misspelling', () => {
    expect(resolveName('Volcanoe Room', index)).toBeNull();
  });

  it('does not resolve empty input', () => {
    expect(resolveName('   ', index)).toBeNull();
  });
});

describe('suggestName', () => {
  it('suggests the intended room for a one-character typo', () => {
    const s = suggestName('Volcanoe Room', index);
    expect(s?.room.name).toBe('Volcano Room');
    expect(s?.distance).toBe(1);
  });

  it('suggests nothing for input that is far from every name', () => {
    expect(suggestName('Samus Fan Club Headquarters', index)).toBeNull();
  });

  it('suggests nothing when the input already resolves exactly', () => {
    expect(suggestName('Volcano Room', index)).toBeNull();
  });

  it('suggests an alias when that is what was nearly typed', () => {
    expect(suggestName('The Jale', index)?.room.name)
      .toBe('Lower Norfair Escape Power Bomb Room');
  });
});

describe('autocomplete', () => {
  it('returns nothing for empty input', () => {
    expect(autocomplete('', index)).toEqual([]);
  });

  it('finds the room from a partial name', () => {
    expect(autocomplete('wrecked ship main', index).map((e) => e.name))
      .toEqual(['Wrecked Ship Main Shaft']);
  });

  it('matches across spacing and punctuation', () => {
    expect(autocomplete('crocomires', index).map((e) => e.name)).toContain("Crocomire's Room");
  });

  it('finds 21 names across 19 rooms for "save"', () => {
    const hits = autocomplete('save', index, 100);
    expect(hits).toHaveLength(21);
    expect(new Set(hits.map((e) => e.room.id)).size).toBe(19);
  });

  it('ranks prefix matches above substring matches', () => {
    const hits = autocomplete('brinstar', index, 100);
    const isPrefix = hits.map((e) => e.normalized.startsWith(normalizeName('brinstar')));
    expect(isPrefix.filter(Boolean).length).toBeGreaterThan(0);
    expect(isPrefix.filter((p) => !p).length).toBeGreaterThan(0);
    // once the list stops being prefix matches it never goes back
    expect(isPrefix).toEqual([...isPrefix].sort((a, b) => Number(b) - Number(a)));
  });

  it('honours the limit', () => {
    expect(autocomplete('room', index, 5)).toHaveLength(5);
  });

  it('marks alias entries so the UI can show which name was matched', () => {
    const jail = autocomplete('the jail', index).find((e) => e.name === 'The Jail');
    expect(jail?.isAlias).toBe(true);
    expect(jail?.room.name).toBe('Lower Norfair Escape Power Bomb Room');
  });
});

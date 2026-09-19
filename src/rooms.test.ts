import { describe, it, expect } from 'vitest';
import {
  loadRooms, roomById, roomByName, roomsInArea, equivalenceGroup, guessableRooms, isGuessable,
} from './rooms';
import { SHAPE_ONLY, FULLY_VISIBLE } from './signature';

const rooms = loadRooms();

describe('loadRooms', () => {
  it('returns all 253 rooms, in id order', () => {
    expect(rooms).toHaveLength(253);
    expect(rooms.map((r) => r.id)).toEqual([...rooms.map((r) => r.id)].sort((a, b) => a - b));
  });

  it('returns rooms that already carry their derived facts', () => {
    const moat = rooms.find((r) => r.name === 'The Moat');
    expect(moat).toMatchObject({ liquid: 'water', area: 'Crateria' });
    expect(moat?.tiles.length).toBeGreaterThan(0);
  });
});

describe('roomById', () => {
  it('finds a room by its id', () => {
    expect(roomById(8)?.name).toBe('Landing Site');
  });

  it('returns undefined for an id that does not exist', () => {
    expect(roomById(99999)).toBeUndefined();
  });
});

describe('roomByName', () => {
  it('finds a room by its canonical name', () => {
    expect(roomByName('Landing Site')?.id).toBe(8);
  });

  it('finds a room by an alias', () => {
    expect(roomByName('The Jail')?.name).toBe('Lower Norfair Escape Power Bomb Room');
  });

  it('is insensitive to case and punctuation', () => {
    expect(roomByName('crocomires room')?.name).toBe("Crocomire's Room");
  });

  it('returns undefined for a name no room has', () => {
    expect(roomByName('Samus Fan Club')).toBeUndefined();
  });
});

describe('roomsInArea', () => {
  it('returns the 55 Maridia rooms', () => {
    expect(roomsInArea('Maridia')).toHaveLength(55);
  });

  it('partitions the whole game across the six areas', () => {
    const areas = ['Crateria', 'Brinstar', 'Norfair', 'Wrecked Ship', 'Maridia', 'Tourian'] as const;
    expect(areas.reduce((n, a) => n + roomsInArea(a).length, 0)).toBe(253);
  });
});

describe('equivalenceGroup', () => {
  it('includes the room itself', () => {
    const landing = roomByName('Landing Site')!;
    expect(equivalenceGroup(landing, FULLY_VISIBLE)).toContain(landing);
  });

  it('is just the room when nothing else looks like it', () => {
    expect(equivalenceGroup(roomByName('Landing Site')!, FULLY_VISIBLE)).toHaveLength(1);
  });

  it('pairs Wave Beam Room with Ice Beam Room, from either side', () => {
    const names = (n: string) =>
      equivalenceGroup(roomByName(n)!, FULLY_VISIBLE).map((r) => r.name).sort();
    expect(names('Wave Beam Room')).toEqual(['Ice Beam Room', 'Wave Beam Room']);
    expect(names('Ice Beam Room')).toEqual(['Ice Beam Room', 'Wave Beam Room']);
  });

  it('grows when the player can see less', () => {
    const save = roomByName('Kraid Save Room')!;
    expect(equivalenceGroup(save, SHAPE_ONLY).length)
      .toBeGreaterThan(equivalenceGroup(save, FULLY_VISIBLE).length);
  });

  it('is symmetric: every member agrees on the same group', () => {
    const group = equivalenceGroup(roomByName('Kraid Save Room')!, SHAPE_ONLY);
    for (const member of group) {
      expect(equivalenceGroup(member, SHAPE_ONLY).map((r) => r.id).sort())
        .toEqual(group.map((r) => r.id).sort());
    }
  });
});

describe('guessableRooms', () => {
  /**
   * A station icon fills its whole tile including the border, and render_tile skips the
   * tile's edges for it. A room that is nothing but icons therefore draws no wall and no
   * door — there is nothing on screen to identify it by, and every save room looks the same.
   */
  it('drops the 33 rooms that are nothing but a station icon', () => {
    expect(guessableRooms()).toHaveLength(253 - 33);
  });

  it('drops every save room', () => {
    expect(guessableRooms().some((r) => r.utilities.includes('save'))).toBe(false);
  });

  it('drops map and refill rooms for the same reason', () => {
    const names = guessableRooms().map((r) => r.name);
    expect(names).not.toContain('Crateria Map Room');
    expect(names).not.toContain('Golden Torizo Energy Recharge');
  });

  it('keeps a room that merely contains a station alongside real geometry', () => {
    // Landing Site has the Ship on one tile but plenty of drawn wall elsewhere.
    expect(guessableRooms().map((r) => r.name)).toContain('Landing Site');
  });

  it('keeps every room that draws at least one edge', () => {
    for (const room of guessableRooms()) {
      expect(isGuessable(room), room.name).toBe(true);
    }
  });

  it('leaves them answerable even though they are never asked', () => {
    expect(roomByName('Crateria Save Room')).toBeDefined();
  });
});

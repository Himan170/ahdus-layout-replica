import { describe, expect, it } from 'vitest';
import { normaliseLayout } from '../../store/layoutData';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { ROOM_TYPES } from '../../utils/roomStore';
import { LAYOUT_TEMPLATES } from '../index';

describe('layout templates', () => {
  it.each(LAYOUT_TEMPLATES)('$name uses valid, non-overlapping editor layout data', ({ layout }) => {
    const normalized = normaliseLayout(layout);
    const ids = [
      ...normalized.rooms.map((room) => room.id),
      ...normalized.objects.map((object) => object.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(normalized.rooms.length).toBeGreaterThan(0);
    expect(normalized.rooms.every((room) =>
      ROOM_TYPES[room.type] &&
      normalized.floors[room.floor] &&
      Number.isFinite(room.x) &&
      Number.isFinite(room.z) &&
      room.width > 0 &&
      room.depth > 0)).toBe(true);

    for (let i = 0; i < normalized.rooms.length; i++) {
      const room = normalized.rooms[i];
      for (const other of normalized.rooms.slice(i + 1)) {
        if (room.floor !== other.floor) continue;
        const overlapX = Math.min(room.x + room.width / 2, other.x + other.width / 2) -
          Math.max(room.x - room.width / 2, other.x - other.width / 2);
        const overlapZ = Math.min(room.z + room.depth / 2, other.z + other.depth / 2) -
          Math.max(room.z - room.depth / 2, other.z - other.depth / 2);
        expect(overlapX > 0 && overlapZ > 0, `${room.name} overlaps ${other.name}`).toBe(false);
      }
      for (const opening of [...room.doors, ...room.windows]) {
        const wallLength = opening.wall === 'north' || opening.wall === 'south' ? room.width : room.depth;
        expect(Math.abs(opening.offset) + opening.width / 2).toBeLessThanOrEqual(wallLength / 2);
      }
    }

    for (const object of normalized.objects) {
      expect(ASSET_TYPES[object.assetType], object.assetType).toBeTruthy();
      const room = normalized.rooms.find((candidate) => candidate.id === object.roomId);
      expect(room, `${object.id} should reference a room`).toBeTruthy();
      expect(object.floor).toBe(room.floor);
      expect(object.x).toBeGreaterThanOrEqual(room.x - room.width / 2);
      expect(object.x).toBeLessThanOrEqual(room.x + room.width / 2);
      expect(object.z).toBeGreaterThanOrEqual(room.z - room.depth / 2);
      expect(object.z).toBeLessThanOrEqual(room.z + room.depth / 2);
    }
  });
});

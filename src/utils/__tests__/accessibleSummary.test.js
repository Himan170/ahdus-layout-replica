import { describe, it, expect } from 'vitest';
import {
  toDegrees,
  describeRoom,
  describeObject,
  describeAccessibilityRoutes,
} from '../accessibleSummary';

describe('Task S3: Accessibility helpers', () => {
  describe('toDegrees', () => {
    it('converts radians to degrees', () => {
      expect(toDegrees(0)).toBe(0);
      expect(toDegrees(Math.PI / 2)).toBe(90);
      expect(toDegrees(Math.PI)).toBe(180);
      expect(toDegrees(-Math.PI / 2)).toBe(-90);
    });
  });

  describe('describeRoom', () => {
    it('returns empty string for null room', () => {
      expect(describeRoom(null)).toBe('');
    });

    it('generates spoken description with dimensions, items count, and doors', () => {
      const room = {
        id: 'r1',
        name: 'Conference Room',
        type: 'MEETING',
        width: 6,
        depth: 4,
        doors: [{ wall: 'south', width: 1.2 }],
      };
      const objects = [
        { id: 'o1', roomId: 'r1' },
        { id: 'o2', roomId: 'r1' },
        { id: 'o3', roomId: 'r2' },
      ];

      const text = describeRoom(room, objects, 'Ground Floor');
      expect(text).toContain('Conference Room');
      expect(text).toContain('Meeting Room');
      expect(text).toContain('6.0 by 4.0 metres');
      expect(text).toContain('Contains 2 items');
      expect(text).toContain('1 door');
    });
  });

  describe('describeObject', () => {
    it('generates item description with position and rotation', () => {
      const obj = {
        id: 'desk1',
        assetType: 'DESK_STANDARD',
        label: 'Engineering Desk',
        x: 2.5,
        z: -1.0,
        rotationY: Math.PI / 2,
        isLocked: false,
      };

      const text = describeObject(obj, 'Open Office', 'Floor 1');
      expect(text).toContain('Engineering Desk in Open Office on Floor 1');
      expect(text).toContain('Position X 2.5, Z -1.0 metres');
      expect(text).toContain('Rotation 90 degrees');
      expect(text).not.toContain('locked');
    });

    it('indicates when an item is locked', () => {
      const obj = {
        id: 'desk1',
        assetType: 'DESK_STANDARD',
        isLocked: true,
      };
      const text = describeObject(obj);
      expect(text).toContain('Item is locked');
    });
  });

  describe('describeAccessibilityRoutes', () => {
    it('describes single-level building as step-free', () => {
      const text = describeAccessibilityRoutes([{ id: 0 }], []);
      expect(text).toContain('Single level layout');
      expect(text).toContain('step-free accessible');
    });

    it('describes multi-floor building with stairs or elevators', () => {
      const floors = [{ id: 0 }, { id: 1 }];
      const objects = [{ assetType: 'STAIRCASE' }];
      const text = describeAccessibilityRoutes(floors, [], objects);
      expect(text).toContain('2 floors total');
      expect(text).toContain('Stairs connect between floors');
    });

    it('mentions elevator when present in multi-floor building', () => {
      const floors = [{ id: 0 }, { id: 1 }];
      const objects = [{ assetType: 'STAIRCASE' }, { assetType: 'ELEVATOR' }];
      const text = describeAccessibilityRoutes(floors, [], objects);
      expect(text).toContain('Stairs and elevator available for access between floors');
    });
  });
});

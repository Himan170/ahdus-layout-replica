import { describe, it, expect } from 'vitest';
import {
  DESK_SIZES, SEAT_REACH, deskSeat, deskSeats, seatPose, personNear, chooseFullCharacters, MAX_FULL_CHARACTERS,
  normaliseBoneName, canonicalBoneName, BONE_TABLE, SEATED_POSE, STANDING_POSE, breathing, phaseOf,
} from '../people';
import { ASSET_TYPES } from '../../utils/assetCatalog';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 4 } };
const desk = (id, x, z, more = {}) => ({ id, assetType: 'DESK_STANDARD', floor: 0, x, y: 0, z, rotationY: 0, ...more });
const chair = (id, x, z, rotationY, more = {}) => ({ id, assetType: 'CHAIR_OFFICE', floor: 0, x, y: 0, z, rotationY, ...more });

describe('DESK_SIZES', () => {
  it('match the catalogue', () => {
    for (const [type, size] of Object.entries(DESK_SIZES)) {
      expect(ASSET_TYPES[type].defaultWidth).toBe(size.width);
      expect(ASSET_TYPES[type].defaultDepth).toBe(size.depth);
    }
  });
});

describe('deskSeat', () => {
  it('finds the chair in front of a desk, facing it (the sample company)', () => {
    const d = desk('d', 9.5, -1);
    const c = chair('c', 9.5, -0.3, Math.PI);
    expect(deskSeat(d, [d, c])).toBe(c);
  });

  it('ignores a chair that faces away, is too far or is on another floor', () => {
    const d = desk('d', 0, 0);
    expect(deskSeat(d, [d, chair('c', 0, 0.8, 0)])).toBeNull(); // its back to the desk
    expect(deskSeat(d, [d, chair('c', 0, 0.4 + SEAT_REACH + 0.1, Math.PI)])).toBeNull();
    expect(deskSeat(d, [d, chair('c', 0, 0.8, Math.PI, { floor: 1 })])).toBeNull();
    expect(deskSeat(d, [d])).toBeNull();
  });

  it('works for a turned desk, a chair pushed under it and up to 60° off', () => {
    const d = desk('d', 2, 3, { rotationY: Math.PI / 2 }); // faces +X: its long sides look along ±X
    const c = chair('c', 2 - 0.9, 3, Math.PI / 2); // on its -X side, facing +X
    expect(deskSeat(d, [d, c])).toBe(c);
    const under = chair('u', 0, 0.3, Math.PI);
    expect(deskSeat(desk('e', 0, 0), [desk('e', 0, 0), under])).toBe(under);
    const angled = chair('a', 0, 0.9, Math.PI + Math.PI / 4);
    expect(deskSeat(desk('e', 0, 0), [desk('e', 0, 0), angled])).toBe(angled);
  });

  it('gives each chair to one desk only: the one it fits best', () => {
    // two desks side by side 1.4 m apart, one chair each; a third desk with no chair of its own
    const objects = [desk('a', 0, 0), chair('ca', 0, 0.8, Math.PI), desk('b', 1.4, 0), chair('cb', 1.4, 0.8, Math.PI), desk('x', 2.8, 0)];
    const seats = deskSeats(objects);
    expect(seats.get('a')?.id).toBe('ca');
    expect(seats.get('b')?.id).toBe('cb');
    expect(seats.has('x')).toBe(false);
    expect(deskSeat(objects[4], objects)).toBeNull();
  });

  it('takes objects as a record too, and only desks have seats', () => {
    const d = desk('d', 0, 0);
    const c = chair('c', 0, 0.7, Math.PI);
    expect(deskSeat(d, { d, c })).toBe(c);
    expect(deskSeat(c, { d, c })).toBeNull();
  });
});

describe('seatPose', () => {
  it('sits on the chair, facing the way it faces, on its floor', () => {
    const d = desk('d', 0, 0, { floor: 1 });
    const c = chair('c', 0, 0.7, Math.PI, { floor: 1, y: 0.1 });
    const pose = seatPose('d', { d, c }, floors);
    expect(pose).toMatchObject({ deskId: 'd', chairId: 'c', seated: true, floor: 1, x: 0, z: 0.7, yaw: Math.PI });
    expect(pose.y).toBeCloseTo(3.6); // floor 1 starts at 3.5 m, the chair stands 0.1 m up
    expect(pose.seatHeight).toBeCloseTo(0.46);
  });

  it('stands at the -Z side of a desk with no chair, facing it', () => {
    const pose = seatPose('d', [desk('d', 1, 2)], floors);
    expect(pose).toMatchObject({ seated: false, chairId: null, x: 1, yaw: 0 });
    expect(pose.z).toBeCloseTo(2 - 0.4 - 0.35);
    const turned = seatPose('d', [desk('d', 0, 0, { rotationY: Math.PI / 2 })], floors);
    expect(turned.x).toBeCloseTo(-0.75);
    expect(turned.z).toBeCloseTo(0);
  });

  it('is null for an unknown id or something that is not a desk', () => {
    expect(seatPose('nope', [desk('d', 0, 0)], floors)).toBeNull();
    expect(seatPose('c', [chair('c', 0, 0, 0)], floors)).toBeNull();
  });
});

describe('personNear', () => {
  const placed = [{ personId: 'a', floor: 0, x: 0, z: 0 }, { personId: 'b', floor: 0, x: 3, z: 0 }, { personId: 'c', floor: 1, x: 0.1, z: 0 }];
  it('finds the nearest person on that floor within the radius', () => {
    expect(personNear(placed, { x: 0.3, z: 0 }, 0, 1)?.personId).toBe('a');
    expect(personNear(placed, { x: 2.5, z: 0 }, 0, 1)?.personId).toBe('b');
    expect(personNear(placed, { x: 0, z: 0 }, 1, 1)?.personId).toBe('c');
    expect(personNear(placed, { x: 1.5, z: 0 }, 0, 1)).toBeNull();
  });
});

describe('chooseFullCharacters', () => {
  const file = { url: 'a.glb', rig: 'mixamo', height: 1.75 };
  const row = (n, floor = 0, character = file) => Array.from({ length: n }, (_, i) => ({
    personId: `p${floor}_${i}`, floor, x: i, y: floor * 3.5, z: 0, character,
  }));
  const cam = { x: 0, y: 1.6, z: 0 };

  it('takes at most 12, the nearest first, on the current floor only', () => {
    const people = [...row(14), ...row(3, 1)];
    const full = chooseFullCharacters(people, cam, 0);
    expect(full).toHaveLength(MAX_FULL_CHARACTERS);
    expect(full[0]).toBe('p0_0');
    expect(full).not.toContain('p0_13');
    expect(full.every((id) => id.startsWith('p0_'))).toBe(true);
    expect(chooseFullCharacters(people, { x: 0, y: 5, z: 0 }, 1)).toEqual(['p1_0', 'p1_1', 'p1_2']);
  });

  it('leaves out people too far away and people with no character file', () => {
    expect(chooseFullCharacters(row(30), { x: 0, y: 1.6, z: 0 }, 0, { max: 100 })).toHaveLength(15); // x 0…14 (15.1 m from the camera at 15: out)
    expect(chooseFullCharacters(row(3, 0, null), cam, 0)).toEqual([]);
    expect(chooseFullCharacters(row(3, 0, { url: '' }), cam, 0)).toEqual([]);
  });

  it('keeps the ones full already until 18 m', () => {
    const people = [{ personId: 'far', floor: 0, x: 16, y: 0, z: 0, character: file }];
    expect(chooseFullCharacters(people, cam, 0)).toEqual([]);
    expect(chooseFullCharacters(people, cam, 0, { current: ['far'] })).toEqual(['far']);
  });
});

describe('bone names', () => {
  it('take any Mixamo prefix off', () => {
    expect(normaliseBoneName('mixamorig:Hips')).toBe('Hips');
    expect(normaliseBoneName('mixamorig4:LeftArm')).toBe('LeftArm');
    expect(normaliseBoneName('mixamorig10:Spine1')).toBe('Spine1');
    expect(normaliseBoneName('mixamorig_Head')).toBe('Head');
    expect(normaliseBoneName('Hips')).toBe('Hips');
    expect(normaliseBoneName('pelvis')).toBe('pelvis');
  });

  it('map Unreal-style (Victoria) and Mixamo rigs onto the same names', () => {
    expect(canonicalBoneName('pelvis', 'ue')).toBe('Hips');
    expect(canonicalBoneName('spine_01', 'ue')).toBe('Spine');
    expect(canonicalBoneName('thigh_l', 'ue')).toBe('LeftUpLeg');
    expect(canonicalBoneName('calf_r', 'ue')).toBe('RightLeg');
    expect(canonicalBoneName('upperarm_l', 'ue')).toBe('LeftArm');
    expect(canonicalBoneName('Root', 'ue')).toBeNull();
    expect(canonicalBoneName('mixamorig2:RightForeArm', 'mixamo')).toBe('RightForeArm');
    expect(canonicalBoneName('mixamorig:LeftHandIndex1', 'mixamo')).toBeNull(); // fingers: not posed
  });

  it('have one row per bone, Left and Right in pairs', () => {
    const mixamo = BONE_TABLE.map(([m]) => m);
    const ue = BONE_TABLE.map(([, u]) => u);
    expect(new Set(mixamo).size).toBe(mixamo.length);
    expect(new Set(ue).size).toBe(ue.length);
    for (const [m, u] of BONE_TABLE) {
      if (m.startsWith('Left')) {
        expect(mixamo).toContain(m.replace('Left', 'Right'));
        expect(u.endsWith('_l')).toBe(true);
      }
    }
  });
});

describe('poses', () => {
  it('only use bones in the table, with real directions, parents before children', () => {
    const known = new Set(BONE_TABLE.map(([m]) => m));
    for (const pose of [SEATED_POSE, STANDING_POSE]) {
      for (const [bone, toward, dir] of pose) {
        expect(known.has(bone) && known.has(toward)).toBe(true);
        expect(Math.hypot(...dir)).toBeGreaterThan(0.5);
      }
      const order = pose.map(([bone]) => bone);
      expect(order.indexOf('LeftForeArm')).toBeGreaterThan(order.indexOf('LeftArm'));
    }
    // seated: thighs forward, shins down, both sides
    const seated = Object.fromEntries(SEATED_POSE.map(([bone, , dir]) => [bone, dir]));
    expect(seated.LeftUpLeg[2]).toBeGreaterThan(0.9);
    expect(seated.RightLeg[1]).toBeLessThan(-0.9);
  });

  it('breathe slowly, not in step', () => {
    expect(Math.abs(breathing(1.1))).toBeLessThan(0.03);
    expect(phaseOf('a')).not.toBe(phaseOf('b'));
    expect(phaseOf('a')).toBe(phaseOf('a'));
    expect(phaseOf('anyone')).toBeLessThan(2 * Math.PI);
  });
});

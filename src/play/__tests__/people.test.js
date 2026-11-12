import { describe, it, expect } from 'vitest';
import {
  DESK_SIZES, SEAT_REACH, deskSeat, deskSeats, seatPose, personNear, chooseFullCharacters, MAX_FULL_CHARACTERS,
  normaliseBoneName, canonicalBoneName, BONE_TABLE, SEATED_POSE, STANDING_POSE, breathing, phaseOf,
  playerEyeHeight, walkRatio, clipSpeed, MIN_WALK_RATIO, MAX_WALK_RATIO, visitorSpot, COUNTER_GAP, figureWalkCycle, FIGURE_LEG,
  visitorSpots, CORNER_DESK_ARM, OPEN_SIDE_GAP, boneKey, chooseGait, RUN_FROM, stairLift,
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

  it('stands where the chair would be at a desk with no chair, facing it', () => {
    const c = chair('c', 1, 2.7, Math.PI);
    const seated = seatPose('d', [desk('d', 1, 2), c], floors);
    const pose = seatPose('d', [desk('d', 1, 2)], floors);
    expect(pose).toMatchObject({ seated: false, chairId: null, x: 1, seatHeight: 0 });
    expect(pose.z).toBeCloseTo(2 + 0.4 + 0.35); // the chair's side (+Z), not -Z
    expect(Math.sign(pose.z - 2)).toBe(Math.sign(seated.z - 2));
    expect(Math.cos(pose.yaw)).toBeCloseTo(Math.cos(seated.yaw)); // the way a seated person faces
  });

  it.each([0, 90, 180, 270])('turns the standing spot with a desk turned %i°', (deg) => {
    const r = (deg * Math.PI) / 180;
    const pose = seatPose('d', [desk('d', 3, -2, { rotationY: r })], floors);
    // on the desk's local +Z: (sin r, cos r) from its centre, half its depth + the gap away
    expect(pose.x).toBeCloseTo(3 + Math.sin(r) * 0.75);
    expect(pose.z).toBeCloseTo(-2 + Math.cos(r) * 0.75);
    // facing the desk: their forward (sin yaw, cos yaw) points back at its centre
    expect(Math.sin(pose.yaw)).toBeCloseTo(-Math.sin(r));
    expect(Math.cos(pose.yaw)).toBeCloseTo(-Math.cos(r));
    // a chair there, facing the same way, would be the desk's seat
    const c = chair('c', pose.x, pose.z, pose.yaw);
    expect(deskSeat(desk('d', 3, -2, { rotationY: r }), [desk('d', 3, -2, { rotationY: r }), c])).toBe(c);
  });

  it('stands behind a reception desk (its -Z side), the visitors in front', () => {
    const pose = seatPose('r', [{ id: 'r', assetType: 'RECEPTION_DESK', floor: 0, x: 0, y: 0, z: 0, rotationY: Math.PI / 2 }], floors);
    expect(pose.x).toBeCloseTo(-(0.425 + 0.35));
    expect(pose.z).toBeCloseTo(0);
    expect(Math.sin(pose.yaw)).toBeCloseTo(1); // facing +X: over the counter
  });

  it('is null for an unknown id or something that is not a desk', () => {
    expect(seatPose('nope', [desk('d', 0, 0)], floors)).toBeNull();
    expect(seatPose('c', [chair('c', 0, 0, 0)], floors)).toBeNull();
  });
});

describe('visitorSpot', () => {
  it('a reception desk: in front of its counter, opposite its person, turned with it; other desks: none', () => {
    const half = DESK_SIZES.RECEPTION_DESK.depth / 2;
    // turned 0: the person works at local −Z, visitors come to +Z
    expect(visitorSpot({ assetType: 'RECEPTION_DESK', x: 2, z: 3, rotationY: 0 })).toEqual({ x: 2, z: 3 + half + COUNTER_GAP });
    // turned π (the seed's counter facing the entrance at −Z): visitors on −Z
    const turned = visitorSpot({ assetType: 'RECEPTION_DESK', x: -25, z: -7.65, rotationY: Math.PI });
    expect(turned.x).toBeCloseTo(-25);
    expect(turned.z).toBeCloseTo(-7.65 - half - COUNTER_GAP);
    // scaled deeper: still clear of its front
    expect(visitorSpot({ assetType: 'RECEPTION_DESK', x: 0, z: 0, scaleZ: 2 }).z).toBeCloseTo(2 * half + COUNTER_GAP);
    expect(visitorSpot({ assetType: 'DESK_STANDARD', x: 0, z: 0 })).toBeNull();
    expect(visitorSpot(null)).toBeNull();
  });
});

describe('visitorSpots (v0.14.6)', () => {
  const corner = (more = {}) => ({ id: 'c', assetType: 'DESK_CORNER', floor: 0, x: 2, z: 3, rotationY: 0, ...more });
  it('a corner desk: at each open side of its L, level with its person; the side they are nearer first', () => {
    // the chair in the L, nearer its +Z side (0.8 m) than its +X side (1.1 m)
    const pose = { x: 2.1, z: 3.4 };
    const [first, second] = visitorSpots(corner(), pose);
    expect(first.side).toBe('+z');
    expect(first.x).toBeCloseTo(2.1);
    expect(first.z).toBeCloseTo(3 + 1.2 + OPEN_SIDE_GAP);
    expect(second.side).toBe('+x');
    expect(second.x).toBeCloseTo(2 + 1.2 + OPEN_SIDE_GAP);
    expect(second.z).toBeCloseTo(3.4);
  });
  it('turned and mirrored with the desk; never level with an arm (clamped to the open square)', () => {
    // turned 90 degrees: local +X is world -Z, local +Z is world +X
    const spots = visitorSpots(corner({ x: 0, z: 0, rotationY: Math.PI / 2 }), null);
    expect(spots.find((p) => p.side === '+x').z).toBeCloseTo(-(1.2 + OPEN_SIDE_GAP));
    expect(spots.find((p) => p.side === '+z').x).toBeCloseTo(1.2 + OPEN_SIDE_GAP);
    // a negative scaleX mirrors it: its open side is at -X
    const m = visitorSpots(corner({ x: 0, z: 0, scaleX: -1 }), { x: -0.5, z: 0.5 }).find((p) => p.side === '+x');
    expect(m.x).toBeCloseTo(-(1.2 + OPEN_SIDE_GAP));
    // a person level with the -Z arm: the visitor stands where the open square begins
    const low = visitorSpots(corner({ x: 0, z: 0 }), { x: 0.5, z: -1 }).find((p) => p.side === '+x');
    expect(low.z).toBeCloseTo(-1.2 + 2.4 * CORNER_DESK_ARM);
  });
  it('a reception desk: its counter front; other desks: none', () => {
    expect(visitorSpots({ assetType: 'RECEPTION_DESK', x: 2, z: 3, rotationY: 0 })).toHaveLength(1);
    expect(visitorSpots({ assetType: 'DESK_STANDARD', x: 0, z: 0 })).toEqual([]);
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

describe('walking as yourself', () => {
  it('the camera sits at eye height for the person (Preview: 1.62 m for 1.75 m)', () => {
    expect(playerEyeHeight(1.75)).toBeCloseTo(1.62, 3);
    expect(playerEyeHeight(1.88)).toBeGreaterThan(1.62);
    expect(playerEyeHeight(1.5)).toBeLessThan(1.4);
    expect(playerEyeHeight(undefined)).toBeCloseTo(1.62, 3);
  });

  it('the clip plays as fast as you walk, within limits', () => {
    expect(walkRatio(2.4, 1.2)).toBeCloseTo(2);
    expect(walkRatio(0.6, 1.2)).toBeCloseTo(0.5);
    expect(walkRatio(100, 1.2)).toBe(MAX_WALK_RATIO);
    expect(walkRatio(0.01, 1.2)).toBe(MIN_WALK_RATIO);
    expect(walkRatio(2, 0)).toBe(1); // a clip with no known speed plays at its own
  });

  it("a clip's own speed: its root motion, else two step lengths per cycle", () => {
    expect(clipSpeed({ duration: 1, hipsTravel: 1.2, footRange: 0.6 })).toBeCloseTo(1.2);
    expect(clipSpeed({ duration: 2, hipsTravel: -1.4, footRange: 0 })).toBeCloseTo(0.7); // walking towards -Z
    expect(clipSpeed({ duration: 1.1, hipsTravel: 0, footRange: 0.66 })).toBeCloseTo(1.2); // in place
    expect(clipSpeed({ duration: 0, hipsTravel: 1, footRange: 1 })).toBe(0);
  });

  it('the legs of the simple figure keep up with the ground: a step covers what the body moves, at every speed', () => {
    for (const speed of [1, 2.2, 4.5, 6]) {
      const { swing, rate } = figureWalkCycle(speed);
      // a half cycle (one step: π / rate seconds) moves the foot 2 × leg × sin(swing)
      expect((speed * Math.PI) / rate).toBeCloseTo(2 * FIGURE_LEG * Math.sin(swing), 5);
    }
    expect(figureWalkCycle(4.5).rate).toBeGreaterThan(figureWalkCycle(2.2).rate);
    expect(figureWalkCycle(50).swing).toBeLessThanOrEqual(0.75);
  });
});

describe('boneKey (v0.16.0): every bone two files name alike', () => {
  it('Mixamo with or without its prefix, Unreal-style, the Rocketbox biped rig', () => {
    expect(boneKey('mixamorig:LeftHandIndex2')).toBe('LeftHandIndex2');
    expect(boneKey('LeftHandIndex2')).toBe('LeftHandIndex2');
    expect(boneKey('thigh_l', 'ue')).toBe('LeftUpLeg');
    expect(boneKey('Bip01 Pelvis')).toBe('Hips');
    expect(boneKey('Bip01 L Thigh')).toBe('LeftUpLeg');
    expect(boneKey('Bip01 R Forearm')).toBe('RightForeArm');
    expect(boneKey('Bip01 L Finger0')).toBe('LeftHandThumb1');
    expect(boneKey('Bip01 R Finger42')).toBe('RightHandPinky3');
    // a face bone keeps its own name (matched only by a file with the same one)
    expect(boneKey('Bip01 MJaw')).toBe('Bip01 MJaw');
  });
});

describe('gait and stairs (v0.16.0)', () => {
  const both = { walk: true, run: true };
  it('stands still, walks, runs from RUN_FROM (Shift), and stands while flying', () => {
    expect(chooseGait(0, false, both)).toBe('Idle');
    expect(chooseGait(2.2, false, both)).toBe('Walk');
    expect(chooseGait(4.5, false, both)).toBe('Run');
    expect(RUN_FROM).toBeGreaterThan(2.2);
    expect(RUN_FROM).toBeLessThan(4.5);
    expect(chooseGait(4.5, true, both)).toBe('Idle');
    // no Run clip: walks faster; no Walk clip: stands
    expect(chooseGait(4.5, false, { walk: true })).toBe('Walk');
    expect(chooseGait(2.2, false, {})).toBe('Idle');
    expect(chooseGait(NaN, false, both)).toBe('Idle');
  });

  it('lifts the feet when the ground rises (stairs), a little going down, not on the flat', () => {
    expect(stairLift(0)).toBe(0);
    expect(stairLift(0.2)).toBe(0);
    expect(stairLift(1.9)).toBe(1);
    expect(stairLift(0.9)).toBeCloseTo(0.5, 5);
    expect(stairLift(-1.9)).toBeCloseTo(0.4, 5);
    expect(stairLift(Infinity)).toBe(0);
    expect(stairLift(undefined)).toBe(0);
  });
});

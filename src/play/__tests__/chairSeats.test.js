import { describe, it, expect } from 'vitest';
import { seatKind, seatTarget, seatedAt, seatPose, deskSeats, workClip } from '../people';

// a desk with its own chair (in front, facing it), a chair on its own, an armchair, a manager's visitor chair
const objects = {
  desk: { id: 'desk', assetType: 'DESK_STANDARD', floor: 0, x: 0, z: 0, rotationY: 0 },
  deskChair: { id: 'deskChair', assetType: 'CHAIR_OFFICE', floor: 0, x: 0, z: 0.7, rotationY: Math.PI },
  free: { id: 'free', assetType: 'CHAIR_OFFICE', floor: 0, x: 5, y: 0, z: 3, rotationY: Math.PI / 2 },
  lounge: { id: 'lounge', assetType: 'LOUNGE_CHAIR', floor: 1, x: -5, y: 0.1, z: 3, rotationY: 1 },
  plant: { id: 'plant', assetType: 'PLANT_LARGE', floor: 0, x: 3, z: 3 },
};
const floors = { 0: { id: 0, height: 3.5 }, 1: { id: 1, height: 3.5 } };

describe('chairs as seats (v0.18.9)', () => {
  it('a desk, a chair on its own, a desk\'s own chair, not a seat', () => {
    expect(seatKind(objects.desk, objects)).toBe('desk');
    expect(seatKind(objects.free, objects)).toBe('chair');
    expect(seatKind(objects.lounge, objects)).toBe('chair');
    expect(seatKind(objects.deskChair, objects)).toBe('desk-chair');
    expect(seatKind(objects.plant, objects)).toBeNull();
    expect(seatKind(null, objects)).toBeNull();
    // a seat stands for itself; a desk's own chair for its desk
    expect(seatTarget('free', objects)).toBe('free');
    expect(seatTarget('deskChair', objects)).toBe('desk');
    expect(seatTarget('plant', objects)).toBeNull();
    expect(seatTarget('gone', objects)).toBeNull();
    // works with a list too, and with deskSeats given
    expect(seatTarget('deskChair', Object.values(objects), deskSeats(objects))).toBe('desk');
  });

  it('someone on a chair on its own sits on it (on its floor)', () => {
    const pose = seatPose('lounge', objects, floors);
    expect(pose).toMatchObject({ deskId: 'lounge', chairId: 'lounge', seated: true, floor: 1, x: -5, z: 3, yaw: 1 });
    expect(pose.y).toBeCloseTo(3.6);
    expect(workClip(pose, objects)).toBe('Sit');
    // a desk's own chair: the desk's place
    expect(seatPose('deskChair', objects, floors)).toEqual(seatPose('desk', objects, floors));
    expect(seatPose('plant', objects, floors)).toBeNull();
  });

  it('one person per seat: a desk\'s own chair shows the desk\'s person, never two; nothing breaks', () => {
    // the server has Ravi on the desk's own chair (an older seat) and Asha at the desk: Asha, once
    const both = seatedAt([
      { personId: 'ravi', deskId: 'deskChair' },
      { personId: 'asha', deskId: 'desk' },
      { personId: 'mia', deskId: 'free' },
    ], objects);
    expect(both.map((p) => [p.personId, p.deskId])).toEqual([['asha', 'desk'], ['mia', 'free']]);
    expect(both[0]).toEqual({ personId: 'asha', deskId: 'desk' }); // entries are kept as given
    // only Ravi on the desk's chair: that chair shows the desk's person (nobody), so he is not drawn
    // (Studio lists him under "People without a desk")
    expect(seatedAt([{ personId: 'ravi', deskId: 'deskChair' }], objects)).toEqual([]);
    // one seat per person (the first wins), a seat not in the layout, junk
    expect(seatedAt([
      { personId: 'mia', deskId: 'free' }, { personId: 'mia', deskId: 'lounge' },
      { personId: 'x', deskId: 'gone' }, { personId: 'y', deskId: 'plant' }, null, {},
    ], objects).map((p) => p.deskId)).toEqual(['free']);
    expect(seatedAt(undefined, objects)).toEqual([]);
  });
});

describe('Find: someone on a chair (v0.18.9)', () => {
  it('is found there, outlined, and walked to in front of the chair; a desk\'s own chair: the desk\'s person only', async () => {
    const { buildPlaces } = await import('../navigation/places');
    const room = { id: 'r', name: 'Studio', type: 'OFFICE', floor: 0, x: 0, z: 0, width: 14, depth: 10 };
    const layout = { rooms: { r: room }, objects, floors };
    const index = buildPlaces(layout, [
      { personId: 'mia', deskId: 'free', name: 'Mia Shah', department: 'Ops' },
      { personId: 'ravi', deskId: 'deskChair', name: 'Ravi Nair', department: 'Sales' },
      { personId: 'asha', deskId: 'desk', name: 'Asha Rao', department: 'Design' },
    ]);
    const mia = index.byId.get('person:mia');
    expect(mia).toMatchObject({ deskId: 'free', entityId: 'free', highlight: ['free'], x: 5, z: 3 });
    // the chair faces +X: in front of her is +X
    expect(mia.goals[0].x).toBeGreaterThan(5);
    expect(index.byId.get('person:asha')).toMatchObject({ deskId: 'desk' });
    expect(index.byId.has('person:ravi')).toBe(false);
  });
});

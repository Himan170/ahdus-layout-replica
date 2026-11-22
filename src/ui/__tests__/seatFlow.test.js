import { describe, it, expect } from 'vitest';
import {
  isDesk, seatAccess, deskLabel, assignPlan, withSeat, withoutSeat, seatsWithoutDesk, seatsLosingDesk,
  losingDeskText, seatedPeople, seatKindOf, deskOfChair, seatsOf,
} from '../seatFlow';

const label = (t) => ({ DESK: 'Desk', RECEPTION_DESK: 'Reception Desk' }[t] ?? t);
const objects = [
  { id: 'd1', assetType: 'DESK' },
  { id: 'c1', assetType: 'CHAIR' },
  { id: 'd2', assetType: 'DESK' },
  { id: 'd3', assetType: 'DESK', label: 'Corner desk' },
  { id: 'r1', assetType: 'RECEPTION_DESK' },
];
const asha = { deskId: 'd1', userId: 1, name: 'Asha', department: 'Design', assetReference: 'mixamo:aj-v1', hasDesk: true };
const ravi = { deskId: 'd2', userId: 2, name: 'Ravi', department: 'Sales', assetReference: null, hasDesk: true };

describe('isDesk', () => {
  it('takes DESK* and the reception desk, nothing else', () => {
    expect(isDesk('DESK')).toBe(true);
    expect(isDesk('DESK_L_SHAPE')).toBe(true);
    expect(isDesk('RECEPTION_DESK')).toBe(true);
    expect(isDesk('CHAIR')).toBe(false);
    expect(isDesk(undefined)).toBe(false);
  });
});

describe('seatAccess', () => {
  it('Admin and HR manage, appointed editors only see, others nothing', () => {
    expect(seatAccess({ canEdit: true, canAppoint: true })).toBe('manage');
    expect(seatAccess({ canEdit: true, canAppoint: false })).toBe('view');
    expect(seatAccess({ canEdit: false, canAppoint: false })).toBe('none');
    expect(seatAccess(null)).toBe('none'); // not known yet / standalone Studio
  });
});

describe('deskLabel', () => {
  it('own name first, else the type and its number among desks of that type', () => {
    expect(deskLabel('d1', objects, label)).toBe('Desk 1');
    expect(deskLabel('d2', objects, label)).toBe('Desk 2');
    expect(deskLabel('d3', objects, label)).toBe('Corner desk');
    expect(deskLabel('r1', objects, label)).toBe('Reception Desk 1');
    expect(deskLabel('gone', objects, label)).toBe('a desk that was removed');
  });
});

describe('assignPlan', () => {
  const seats = [asha, ravi];
  it('an empty desk and a person with no desk: no question', () => {
    const plan = assignPlan({ seats, deskId: 'd3', person: { id: 3, name: 'Meera' }, objects, typeLabel: label });
    expect(plan).toMatchObject({ kind: 'assign', question: null });
  });
  it('someone who sits elsewhere: asks to move them', () => {
    const plan = assignPlan({ seats, deskId: 'd3', person: { id: 1, name: 'Asha' }, objects, typeLabel: label });
    expect(plan.kind).toBe('move');
    expect(plan.question).toBe('Asha already sits at Desk 1. Move them here?');
    expect(plan.confirmLabel).toBe('Move here');
  });
  it('a taken desk: says who is replaced', () => {
    const plan = assignPlan({ seats, deskId: 'd2', person: { id: 3, name: 'Meera' }, objects, typeLabel: label });
    expect(plan.kind).toBe('replace');
    expect(plan.question).toBe('This replaces Ravi.');
    expect(plan.title).toBe('Replace Ravi?');
  });
  it('both: moves them and replaces the other', () => {
    const plan = assignPlan({ seats, deskId: 'd2', person: { id: 1, name: 'Asha' }, objects, typeLabel: label });
    expect(plan.kind).toBe('move-replace');
    expect(plan.question).toBe('Asha already sits at Desk 1. Move them here? This replaces Ravi.');
  });
  it('someone whose desk is no longer in the layout: no question about moving', () => {
    const gone = { ...asha, deskId: 'removed' };
    expect(assignPlan({ seats: [gone, ravi], deskId: 'd3', person: { id: 1, name: 'Asha' }, objects }).kind).toBe('assign');
  });
  it('already there: nothing to do', () => {
    expect(assignPlan({ seats, deskId: 'd1', person: { id: 1, name: 'Asha' }, objects }).kind).toBe('same');
  });
});

describe('withSeat / withoutSeat', () => {
  it('one person per desk and one desk per person', () => {
    const moved = withSeat([asha, ravi], { ...asha, deskId: 'd2' });
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ userId: 1, deskId: 'd2' });
    expect(withoutSeat([asha, ravi], 'd1')).toEqual([ravi]);
  });
});

describe('people without a desk and the publish warning', () => {
  const gone = { deskId: 'old', userId: 4, name: 'Kiran', department: '', assetReference: null, hasDesk: true };
  const neverHad = { deskId: 'older', userId: 5, name: 'Lata', department: '', assetReference: null, hasDesk: false };
  const seats = [asha, ravi, gone, neverHad];
  it('lists seats whose desk is not in the draft', () => {
    expect(seatsWithoutDesk(seats, objects).map((s) => s.name)).toEqual(['Kiran', 'Lata']);
  });
  it('publishing takes the desk only from those employees see at one now', () => {
    expect(seatsLosingDesk(seats, objects).map((s) => s.name)).toEqual(['Kiran']);
    const fewer = objects.filter((o) => o.id !== 'd2');
    expect(losingDeskText(seatsLosingDesk(seats, fewer))).toBe('2 people lose their desk: Ravi, Kiran.');
    expect(losingDeskText(seatsLosingDesk([gone], objects))).toBe('1 person loses their desk: Kiran.');
    expect(losingDeskText([])).toBeNull();
  });
});

describe('seatedPeople', () => {
  it('only seats on desks of the layout, characters from the manifest, no other fields', () => {
    const characters = new Map([['mixamo:aj-v1', { url: 'https://x/aj.glb', rig: 'mixamo', height: 1.8 }]]);
    const people = seatedPeople([asha, ravi, { ...ravi, userId: 9, deskId: 'gone' }], objects, characters);
    expect(people).toEqual([
      { personId: '1', deskId: 'd1', name: 'Asha', department: 'Design', character: characters.get('mixamo:aj-v1'), characterChosen: true },
      { personId: '2', deskId: 'd2', name: 'Ravi', department: 'Sales', character: null, characterChosen: false },
    ]);
  });
});

describe('seatedPeople (v0.16.0)', () => {
  it('Studio shows the same neutral character and Wardrobe clothing as the viewer', async () => {
    const { parseManifest, neutralFor } = await import('../../embed/characterManifest');
    const m = parseManifest({
      version: 2,
      neutral: ['rocketbox:aisha-v1', 'rocketbox:andre-v1'],
      characters: { 'rocketbox:aisha-v1': { url: 'aisha.glb' }, 'rocketbox:andre-v1': { url: 'andre.glb' } },
    }, 'https://ahdus.example/frontend/workplace/characters.json');
    const [a, b] = seatedPeople([
      { ...asha, assetReference: null, clothing: { upperBody: 'shirt', upperColor: '#ffcc00' } },
      { ...ravi, assetReference: null },
    ], objects, m);
    expect(a.character).toEqual(m.characters.get(neutralFor('1', m)));
    expect(b.character).toEqual(m.characters.get(neutralFor('2', m)));
    expect(a.clothing).toEqual({ schemaVersion: 1, pantsColor: 'black', upperBody: 'shirt', upperColor: '#ffcc00' });
    expect('clothing' in b).toBe(false);
  });

  it('people at their desks are drawn from the lighter "seated" copy when the manifest has one', async () => {
    const { parseManifest } = await import('../../embed/characterManifest');
    const m = parseManifest({ version: 2, characters: { 'rocketbox:aisha-v1': { url: 'aisha.glb', seated: 'aisha-seated.glb' } } },
      'https://ahdus.example/frontend/workplace/characters.json');
    const [a] = seatedPeople([{ ...asha, assetReference: 'rocketbox:aisha-v1' }], objects, m);
    expect(a.character.url).toBe('https://ahdus.example/frontend/workplace/aisha-seated.glb');
  });
});

describe('chairs (v0.18.9)', () => {
  // a desk with its own chair in front of it, a chair on its own, an armchair, a plant
  const room = [
    { id: 'desk', assetType: 'DESK_STANDARD', floor: 0, x: 0, z: 0, rotationY: 0 },
    { id: 'own', assetType: 'CHAIR_OFFICE', floor: 0, x: 0, z: 0.7, rotationY: Math.PI },
    { id: 'free', assetType: 'CHAIR_OFFICE', floor: 0, x: 5, z: 3, rotationY: 0 },
    { id: 'arm', assetType: 'LOUNGE_CHAIR', floor: 0, x: -5, z: 3, rotationY: 0, label: 'Window seat' },
    { id: 'plant', assetType: 'PLANT_LARGE', floor: 0, x: 3, z: 3 },
  ];
  const typeLabel = (t) => ({ DESK_STANDARD: 'Desk', CHAIR_OFFICE: 'Office Chair', LOUNGE_CHAIR: 'Lounge Chair' }[t] ?? t);
  const mia = { deskId: 'free', userId: 7, name: 'Mia', department: 'Ops', assetReference: null, hasDesk: true };
  const asha2 = { ...asha, deskId: 'desk' };

  it('a chair on its own is a seat; a desk\'s own chair is the desk\'s', () => {
    expect(seatKindOf(room[0], room)).toBe('desk');
    expect(seatKindOf(room[1], room)).toBe('desk-chair');
    expect(seatKindOf(room[2], room)).toBe('chair');
    expect(seatKindOf(room[3], room)).toBe('chair');
    expect(seatKindOf(room[4], room)).toBeNull();
    expect(deskOfChair('own', room)).toBe('desk');
    expect(deskOfChair('free', room)).toBeNull();
    expect(seatsOf(room).map((o) => o.id)).toEqual(['desk', 'free', 'arm']);
  });

  it('names: "Office Chair 1", its own name', () => {
    expect(deskLabel('free', room, typeLabel)).toBe('Office Chair 1');
    expect(deskLabel('arm', room, typeLabel)).toBe('Window seat');
    expect(deskLabel('own', room, typeLabel)).toBe('a desk that was removed'); // never a seat of its own
  });

  it('the same questions as desks', () => {
    const plan = assignPlan({ seats: [asha2, mia], deskId: 'free', person: { id: 1, name: 'Asha' }, objects: room, typeLabel });
    expect(plan.kind).toBe('move-replace');
    expect(plan.question).toBe('Asha already sits at Desk 1. Move them here? This replaces Mia.');
    const back = assignPlan({ seats: [asha2, mia], deskId: 'desk', person: { id: 7, name: 'Mia' }, objects: room, typeLabel });
    expect(back.question).toBe('Mia already sits at Office Chair 1. Move them here? This replaces Asha.');
  });

  it('someone the server has on a desk\'s own chair: the desk\'s person shows, never two; they are listed', () => {
    const ravi2 = { ...ravi, deskId: 'own' };
    const shown = seatedPeople([ravi2, asha2, mia], room);
    expect(shown.map((p) => [p.name, p.deskId])).toEqual([['Asha', 'desk'], ['Mia', 'free']]);
    expect(seatsWithoutDesk([ravi2, asha2, mia], room).map((s) => s.name)).toEqual(['Ravi']);
    expect(seatedPeople([ravi2], room)).toEqual([]);
  });
});

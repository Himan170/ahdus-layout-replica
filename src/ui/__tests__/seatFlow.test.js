import { describe, it, expect } from 'vitest';
import {
  isDesk, seatAccess, deskLabel, assignPlan, withSeat, withoutSeat, seatsWithoutDesk, seatsLosingDesk,
  losingDeskText, seatedPeople,
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
    expect(a.character).toBe(m.characters.get(neutralFor('1', m)));
    expect(b.character).toBe(m.characters.get(neutralFor('2', m)));
    expect(a.clothing).toEqual({ schemaVersion: 1, pantsColor: 'black', upperBody: 'shirt', upperColor: '#ffcc00' });
    expect('clothing' in b).toBe(false);
  });
});

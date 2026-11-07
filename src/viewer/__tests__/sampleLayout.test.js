// viewer.html's sample company (v0.14.2): every desk and every room can be walked to from the
// entrance, so the viewer's own tests (e2e:touch, e2e:viewer) can take any of them.
import { describe, it, expect } from 'vitest';

import { SAMPLE_LAYOUT, SAMPLE_PEOPLE } from '../sampleLayout';
import { buildPlaces } from '../../play/navigation/places';
import { findNearestRoute } from '../../play/navigation/route';
import { createWalkMapCache } from '../../play/navigation/walkMap';
import { entranceSpawn } from '../../play/navigation/entrance';
import { ASSET_TYPES } from '../../utils/assetCatalog';

describe('viewer.html sample layout', () => {
  const maps = createWalkMapCache({ catalog: ASSET_TYPES });
  const spawn = entranceSpawn(SAMPLE_LAYOUT, { maps });
  const from = { x: spawn.x, z: spawn.z, floor: spawn.floor };
  const index = buildPlaces(SAMPLE_LAYOUT, SAMPLE_PEOPLE);
  const routeTo = (place) => findNearestRoute(SAMPLE_LAYOUT, from, place.goals, { maps, name: place.name });

  it('every room has a walking route from the entrance', () => {
    const rooms = index.places.filter((p) => p.id.startsWith('room:'));
    expect(rooms.length).toBe(SAMPLE_LAYOUT.rooms.length);
    for (const room of rooms) expect(routeTo(room), room.name).not.toHaveProperty('problem');
  });

  it('every desk (and the people at them) has a walking route from the entrance', () => {
    const desks = SAMPLE_LAYOUT.objects.filter((o) => /^DESK|RECEPTION_DESK/.test(o.assetType));
    expect(desks.length).toBeGreaterThan(1);
    for (const desk of desks) {
      const person = index.places.find((p) => p.kind === 'person' && p.deskId === desk.id);
      expect(person, desk.id).toBeTruthy();
      expect(routeTo(person), person.name).not.toHaveProperty('problem');
    }
  });

  it('a staircase leads up to the meeting room', () => {
    const meeting = index.places.find((p) => p.id === 'room:room_meeting');
    const r = routeTo(meeting);
    expect(r.legs.map((l) => l.floor)).toEqual([0, 1]);
  });
});

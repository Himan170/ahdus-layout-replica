// Random layouts for the navigation tests (entrance.test.js, route.test.js), made from a seed so a
// failure can be repeated. Store shape (v1 names).

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const room = (id, x, z, width, depth, more = {}) => ({
  id, type: 'OFFICE', name: id, floor: 0, x, z, width, depth, wallHeight: 3.2, doors: [], windows: [], ...more,
});
const item = (id, assetType, x, z, more = {}) => ({ id, assetType, floor: 0, x, y: 0, z, rotationY: 0, ...more });

/** A small seeded random generator (mulberry32), so a failure can be repeated. */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ITEMS = ['DESK_STANDARD', 'CHAIR_OFFICE', 'PLANT_LARGE', 'TABLE_MEETING', 'BOOKSHELF', 'FILING_CABINET', 'SOFA_3SEAT', 'RUG'];
const TYPES = ['OFFICE', 'MEETING', 'RECEPTION', 'RESTROOM', 'KITCHEN'];
const WALLS = ['north', 'south', 'east', 'west'];

/** Rows of rooms, back to back or with gaps, random walls, doors, windows, items inside and outside, sometimes an upper floor. */
export function randomLayout(seed) {
  const rnd = random(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rooms = [];
  const objects = [];
  let n = 0;
  const rowCount = 1 + Math.floor(rnd() * 3);
  let z = rnd() * 10 - 5;
  for (let row = 0; row < rowCount; row++) {
    const depth = 3 + rnd() * 9;
    const T = pick([0.15, 0.15, 0.1, 0.3, 0.6]);
    let x = rnd() * 10 - 5;
    const count = 1 + Math.floor(rnd() * 4);
    for (let c = 0; c < count; c++) {
      const width = 3 + rnd() * 11;
      const id = `room_${seed}_${n++}`;
      const doors = [];
      for (const wall of WALLS) {
        if (rnd() < 0.35) continue;
        const len = wall === 'north' || wall === 'south' ? width : depth;
        const w = Math.min(0.8 + rnd() * 1.6, len - 0.6);
        doors.push({ wall, offset: (rnd() - 0.5) * (len - w - 0.4), width: w, height: 2.1 });
      }
      const windows = rnd() < 0.5 ? [{ wall: pick(WALLS), offset: 0, width: 1.2, height: 1.2, sill: rnd() < 0.2 ? 0 : 0.9 }] : [];
      const r = { id, type: pick(TYPES), name: id, floor: 0, x: x + width / 2, z: z + depth / 2, width, depth, wallThickness: T, wallHeight: 3.2, doors, windows };
      rooms.push(r);
      for (let k = Math.floor(rnd() * 7); k > 0; k--) {
        objects.push(item(`obj_${id}_${k}`, pick(ITEMS), r.x + (rnd() - 0.5) * (width - 1), r.z + (rnd() - 0.5) * (depth - 1), { rotationY: rnd() * Math.PI * 2 }));
      }
      if (rnd() < 0.15 && width > 8 && depth > 6) { // a room inside it
        rooms.push(room(`room_${seed}_${n++}`, r.x - width / 4, r.z, 3, 3, { doors: [{ wall: 'east', offset: 0, width: 1 }], wallThickness: T }));
      }
      x += width + (rnd() < 0.6 ? T : 0.5 + rnd() * 3); // back to back, or a gap
    }
    z += depth + (rnd() < 0.6 ? T : 0.5 + rnd() * 3);
  }
  // things outside: benches, plants, cars… (often right where you'd start)
  const minX = Math.min(...rooms.map((r) => r.x - r.width / 2));
  const maxX = Math.max(...rooms.map((r) => r.x + r.width / 2));
  const minZ = Math.min(...rooms.map((r) => r.z - r.depth / 2));
  for (let k = Math.floor(rnd() * 12); k > 0; k--) {
    objects.push(item(`out_${seed}_${k}`, pick(['PLANT_LARGE', 'VENDING_MACHINE', 'SOFA_3SEAT', 'COLUMN']),
      minX + rnd() * (maxX - minX), minZ - 1 - rnd() * 5, { rotationY: rnd() * Math.PI }));
  }
  if (rnd() < 0.3) { // an upper floor with its own rooms (and, sometimes, its own spawn point)
    for (const r of rooms.slice(0, 3)) rooms.push({ ...r, id: `${r.id}_up`, floor: 1 });
    if (rnd() < 0.5) objects.push(item(`spawn_up_${seed}`, 'SPAWN_POINT', rooms[0].x, rooms[0].z, { floor: 1 }));
  }
  return { rooms, objects, floors };
}

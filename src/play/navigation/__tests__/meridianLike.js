// A layout shaped like the Meridian test company (2 floors, a 66 m corridor, 24 rooms, desks in rows,
// one outside door: the lobby's), made here so the tests need no private file. Store shape (v1 names).

const ROOMS = [
  // floor, id, name, type, x, z, width, depth
  [0, 'room_f0_01', 'Corridor', 'CORRIDOR', 0, 0, 66, 3],
  [0, 'room_f0_02', 'Lobby & Reception', 'RECEPTION', -25, -8.65, 16, 14],
  [0, 'room_f0_03', 'Operations', 'OFFICE', -10.85, -8.65, 12, 14],
  [0, 'room_f0_04', 'Customer Success', 'OFFICE', 3.3, -8.65, 16, 14],
  [0, 'room_f0_05', 'Sales', 'OFFICE', 19.45, -8.65, 16, 14],
  [0, 'room_f0_06', 'Stairs', 'STAIRCASE', -31, 8.65, 4, 14],
  [0, 'room_f0_07', 'Restrooms', 'RESTROOM', -26.35, 8.65, 5, 14],
  [0, 'room_f0_08', 'Meeting Room 0.1', 'MEETING', -20.2, 8.65, 7, 14],
  [0, 'room_f0_09', 'HR', 'OFFICE', -12.55, 8.65, 8, 14],
  [0, 'room_f0_10', 'Finance', 'OFFICE', -3.4, 8.65, 10, 14],
  [0, 'room_f0_11', 'Legal', 'OFFICE', 5.75, 8.65, 8, 14],
  [0, 'room_f0_12', 'Marketing', 'OFFICE', 15.9, 8.65, 12, 14],
  [0, 'room_f0_13', 'Meeting Room 0.2', 'MEETING', 27.05, 8.65, 10, 14],
  [1, 'room_f1_01', 'Corridor 1', 'CORRIDOR', 0, 0, 66, 3],
  [1, 'room_f1_02', 'Product', 'OFFICE', -27, -8.65, 12, 14],
  [1, 'room_f1_03', 'Design', 'OFFICE', -15.85, -8.65, 10, 14],
  [1, 'room_f1_04', 'Data & AI', 'OFFICE', -1.7, -8.65, 18, 14],
  [1, 'room_f1_05', 'Engineering 1', 'OFFICE', 19.45, -8.65, 24, 14],
  [1, 'room_f1_06', 'Stairs', 'STAIRCASE', -31, 8.65, 4, 14],
  [1, 'room_f1_07', 'Restrooms', 'RESTROOM', -26.35, 8.65, 5, 14],
  [1, 'room_f1_08', 'Meeting Room 1.3', 'MEETING', -20.2, 8.65, 7, 14],
  [1, 'room_f1_09', 'Engineering 2', 'OFFICE', -4.55, 8.65, 24, 14],
  [1, 'room_f1_10', 'IT & Security', 'OFFICE', 12.6, 8.65, 10, 14],
  [1, 'room_f1_11', 'Executive', 'OFFICE', 23.85, 8.65, 12.2, 14],
];

/** The rooms south of the corridor have their door on the north wall, those north of it on the south wall. */
function doorsOf(id, z) {
  if (id.endsWith('_01')) return [];
  if (id === 'room_f0_02') return [{ wall: 'north', offset: 0, width: 1.6, height: 2.1 }, { wall: 'south', offset: 0, width: 2.4, height: 2.4 }];
  const width = id.endsWith('_06') || id.endsWith('_07') ? 1 : 1.2;
  return [{ wall: z < 0 ? 'north' : 'south', offset: 0, width, height: 2.1 }];
}

function windowsOf(id, z, width) {
  if (id.endsWith('_01') || id.endsWith('_06') || id.endsWith('_07')) return [];
  const n = Math.max(1, Math.floor(width / 4));
  return Array.from({ length: n }, (_, i) => ({
    wall: z < 0 ? 'south' : 'north', offset: (i - (n - 1) / 2) * 4, width: 1.6, height: 1.4, sill: 0.9,
  }));
}

/**
 * @param {{ spawnPoint?: boolean }} [options]  spawnPoint: the seed's SPAWN_POINT 3.5 m outside the lobby (default true)
 */
export function meridianLike({ spawnPoint = true } = {}) {
  const rooms = ROOMS.map(([floor, id, name, type, x, z, width, depth]) => ({
    id, floor, name, type, x, z, width, depth, wallHeight: 3, wallThickness: 0.15,
    doors: doorsOf(id, z), windows: windowsOf(id, z, width),
  }));
  const objects = [];
  // desks in rows, a chair behind each, as the seed lays them out (2 m apart, aisles of 1.4 m)
  for (const r of rooms) {
    if (r.type !== 'OFFICE') continue;
    const rows = r.z < 0 ? [-5.4, -3.2, -1, 1.2, 3.4] : [-3.4, -1.2, 1, 3.2, 5.4];
    for (const [ri, dz] of rows.entries()) {
      for (let dx = -r.width / 2 + 2; dx <= r.width / 2 - 2 + 1e-9; dx += 2) {
        const id = `obj_${r.id}_${ri}_${Math.round(dx * 10)}`;
        objects.push({ id, assetType: 'DESK_STANDARD', floor: r.floor, roomId: r.id, x: r.x + dx, y: 0, z: r.z + dz, rotationY: 0 });
        objects.push({ id: `${id}_chair`, assetType: 'CHAIR_OFFICE', floor: r.floor, roomId: r.id, x: r.x + dx, y: 0, z: r.z + dz + 0.7, rotationY: Math.PI });
      }
    }
  }
  // as the seed (7 Nov): the counter faces the main entrance (−Z), the receptionist sits behind it (corridor side)
  objects.push({ id: 'obj_f0_reception', assetType: 'RECEPTION_DESK', floor: 0, roomId: 'room_f0_02', x: -25, y: 0, z: -7.65, rotationY: Math.PI });
  objects.push({ id: 'obj_f0_reception_chair', assetType: 'CHAIR_OFFICE', floor: 0, roomId: 'room_f0_02', x: -25, y: 0, z: -6.8, rotationY: Math.PI });
  objects.push({ id: 'obj_f0_stairs', assetType: 'STAIRCASE', floor: 0, roomId: 'room_f0_06', x: -31, y: 0, z: 5.15, rotationY: 0 });
  if (spawnPoint) {
    objects.push({ id: 'obj_f0_spawn', assetType: 'SPAWN_POINT', floor: 0, roomId: null, x: -25, y: 0, z: -19.15, rotationY: 0, label: 'Main entrance' });
  }
  const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
  return { rooms, objects, floors };
}

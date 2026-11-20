// v0.18.3: a small layout with a lift (shared by liftRoutes.test.js, avoidStairs.test.js and the engine tests).
/** Three floors: a hall each, a lift shaft inside each hall (same rectangle), stairs from the ground floor to Floor 1 only. */
export function liftLayout({ stairs = true, liftFloors = [0, 1, 2] } = {}) {
  const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 }, 2: { id: 2, name: 'Floor 2', height: 3.5 } };
  const rooms = {};
  for (const f of [0, 1, 2]) {
    rooms[`hall_${f}`] = {
      id: `hall_${f}`, name: f ? `Hall ${f}` : 'Hall', type: 'OFFICE', floor: f, x: 0, z: 0, width: 16, depth: 10, wallHeight: 3.2,
      doors: f === 0 ? [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }] : [], windows: [],
    };
    if (liftFloors.includes(f)) {
      rooms[`lift_${f}`] = {
        id: `lift_${f}`, name: 'Lift', type: 'LIFT', floor: f, x: 5, z: 2, width: 2.2, depth: 2.2, wallHeight: 3.2,
        doors: [{ wall: 'south', offset: 0, width: 1.1, height: 2.1 }], windows: [],
      };
    }
  }
  const objects = stairs ? {
    s1: { id: 's1', assetType: 'STAIRCASE', floor: 0, x: -5, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
  } : {};
  return { rooms, objects, floors };
}

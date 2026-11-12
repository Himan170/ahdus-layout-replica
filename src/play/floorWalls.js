/**
 * play/floorWalls.js (v0.15.6)
 *
 * PURE: the wall pieces of one floor (wallMount.wallPieces), kept until the store's rooms or items change,
 * so placing, dragging and Check ask for them every pointer move at no cost.
 *   const walls = createFloorWalls();
 *   walls(state, floorId)  → pieces (the same array while nothing changed: wallFaces caches by it)
 */
import { wallPieces } from './wallMount';

export function createFloorWalls() {
  let rooms = null;
  let objects = null;
  const byFloor = new Map();
  return function piecesOf(state, floorId) {
    if (state.rooms !== rooms || state.objects !== objects) {
      rooms = state.rooms;
      objects = state.objects;
      byFloor.clear();
    }
    const key = floorId ?? 0;
    let pieces = byFloor.get(key);
    if (!pieces) {
      const onFloor = (r) => (r.floor ?? 0) === key;
      pieces = wallPieces(Object.values(rooms ?? {}).filter(onFloor), Object.values(objects ?? {}).filter(onFloor));
      byFloor.set(key, pieces);
    }
    return pieces;
  };
}

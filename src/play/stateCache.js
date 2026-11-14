// v0.17.0: the walker asks for the layout dozens of times a frame (every 0.1 m collision step, the camera, the aim).
// Object.values(rooms / objects) each time made new arrays per call: on a weak laptop that was garbage the browser
// had to clear while walking. These keep one copy until the store's records change (the store never edits them in
// place: a change is a new object), so a frame without an edit makes no arrays at all.

/**
 * The controller's getState from a store: { rooms, objects, currentFloor, floors }, the arrays made again only when
 * the store's `rooms` / `objects` records are new objects.
 * @param {() => { rooms: object, objects: object, currentFloor: number, floors: object }} read
 */
export function cachedLayoutState(read) {
  let rooms = null;
  let objects = null;
  let roomList = [];
  let objectList = [];
  return () => {
    const s = read();
    if (s.rooms !== rooms) { rooms = s.rooms; roomList = Object.values(rooms ?? {}); }
    if (s.objects !== objects) { objects = s.objects; objectList = Object.values(objects ?? {}); }
    return { rooms: roomList, objects: objectList, currentFloor: s.currentFloor, floors: s.floors };
  };
}

/**
 * f(list, key) kept until the list (by identity) or the key changes. One entry: the walker asks about the floor it
 * is on, again and again.
 * @template T, K, R
 * @param {(list: T[], key: K) => R} f
 * @returns {(list: T[], key: K) => R}
 */
export function lastResult(f) {
  let lastList = null;
  let lastKey;
  let value;
  return (list, key) => {
    if (list !== lastList || key !== lastKey) {
      lastList = list;
      lastKey = key;
      value = f(list, key);
    }
    return value;
  };
}

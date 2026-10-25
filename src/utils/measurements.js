import { WALL_ASSET_LENGTH } from '../play/geometry';

const EPSILON = 1e-5;

export function distanceBetweenPoints(a, b) {
  if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) return null;
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  return Number.isFinite(distance) ? distance : null;
}

export function roomArea(room) {
  if (!Number.isFinite(room?.width) || !Number.isFinite(room?.depth) ||
      room.width <= 0 || room.depth <= 0) return null;
  const area = room.width * room.depth;
  return Number.isFinite(area) && area > 0 ? area : null;
}

function roomWallSegments(room) {
  if (![room?.x, room?.z, room?.width, room?.depth].every(Number.isFinite) ||
      room.width <= 0 || room.depth <= 0) return [];

  const x0 = room.x - room.width / 2;
  const x1 = room.x + room.width / 2;
  const z0 = room.z - room.depth / 2;
  const z1 = room.z + room.depth / 2;
  return [
    { a: { x: x0, z: z0 }, b: { x: x1, z: z0 } },
    { a: { x: x0, z: z1 }, b: { x: x1, z: z1 } },
    { a: { x: x0, z: z0 }, b: { x: x0, z: z1 } },
    { a: { x: x1, z: z0 }, b: { x: x1, z: z1 } },
  ];
}

function standaloneWallSegment(object) {
  if (object?.assetType !== 'WALL_SEGMENT' ||
      ![object.x, object.z, object.rotationY, object.scaleX].every(Number.isFinite) ||
      object.scaleX <= 0) return null;

  const length = WALL_ASSET_LENGTH * object.scaleX;
  if (!Number.isFinite(length) || length <= 0) return null;
  const dx = Math.cos(object.rotationY) * length / 2;
  const dz = -Math.sin(object.rotationY) * length / 2;
  return {
    a: { x: object.x - dx, z: object.z - dz },
    b: { x: object.x + dx, z: object.z + dz },
  };
}

function canonicalDirection(segment) {
  let dx = segment.b.x - segment.a.x;
  let dz = segment.b.z - segment.a.z;
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length <= EPSILON) return null;
  dx /= length;
  dz /= length;
  if (dx < -EPSILON || (Math.abs(dx) <= EPSILON && dz < 0)) {
    dx = -dx;
    dz = -dz;
  }
  return { dx, dz, length };
}

/**
 * Returns non-overlapping wall runs from room boundaries and standalone
 * WALL_SEGMENT assets. Coincident/overlapping collinear geometry is merged.
 */
export function wallMeasurementSegments(rooms, objects = []) {
  const segments = [
    ...rooms.flatMap(roomWallSegments),
    ...objects.map(standaloneWallSegment).filter(Boolean),
  ].map((segment) => {
    const direction = canonicalDirection(segment);
    if (!direction) return null;
    const { dx, dz } = direction;
    const nx = -dz;
    const nz = dx;
    const start = segment.a.x * dx + segment.a.z * dz;
    const end = segment.b.x * dx + segment.b.z * dz;
    return {
      dx, dz, nx, nz,
      offset: segment.a.x * nx + segment.a.z * nz,
      start: Math.min(start, end),
      end: Math.max(start, end),
    };
  }).filter(Boolean);

  const groups = [];
  for (const segment of segments) {
    let group = groups.find((candidate) =>
      Math.abs(candidate.dx * segment.dz - candidate.dz * segment.dx) <= EPSILON &&
      Math.abs(candidate.offset - segment.offset) <= EPSILON);
    if (!group) {
      group = { ...segment, intervals: [] };
      groups.push(group);
    }
    group.intervals.push([segment.start, segment.end]);
  }

  return groups.flatMap((group) => {
    const intervals = group.intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      const previous = merged[merged.length - 1];
      if (previous && interval[0] <= previous[1] + EPSILON) {
        previous[1] = Math.max(previous[1], interval[1]);
      } else {
        merged.push([...interval]);
      }
    }
    return merged.map(([start, end]) => ({
      a: {
        x: group.dx * start + group.nx * group.offset,
        z: group.dz * start + group.nz * group.offset,
      },
      b: {
        x: group.dx * end + group.nx * group.offset,
        z: group.dz * end + group.nz * group.offset,
      },
      length: end - start,
      midpoint: {
        x: group.dx * (start + end) / 2 + group.nx * group.offset,
        z: group.dz * (start + end) / 2 + group.nz * group.offset,
      },
    })).filter((segment) => segment.length > EPSILON);
  });
}

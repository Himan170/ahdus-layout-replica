/**
 * viewer/sampleLayout.js
 *
 * A small company (a save, as the app writes it) for the viewer test page when
 * no companyId + layoutId is given: a reception and an engineering office on
 * the ground floor, each with a door on the south side, stairs up to a
 * meeting room on Floor 1. You start outside, south of the reception.
 */

export const SAMPLE_LAYOUT = {
  layoutName: 'Sample company',
  layoutVersion: 1,
  floors: {
    0: { id: 0, name: 'Ground Floor', height: 3.5 },
    1: { id: 1, name: 'Floor 1', height: 3.5 },
  },
  rooms: [
    { id: 'room_reception', type: 'RECEPTION', name: 'Reception', floor: 0, x: 0, z: 0, width: 8, depth: 6,
      wallHeight: 3.2, color: '#f0b429',
      doors: [{ wall: 'south', offset: 0, width: 1.4, height: 2.1 }],
      windows: [{ wall: 'west', offset: 0, width: 1.4, height: 1.2, sill: 0.9 }] },
    { id: 'room_engineering', type: 'OFFICE', name: 'Engineering', floor: 0, x: 12, z: 0, width: 8, depth: 6,
      wallHeight: 3.2, color: '#4a7dff',
      doors: [{ wall: 'south', offset: 0, width: 1.4, height: 2.1 }],
      windows: [{ wall: 'east', offset: 0, width: 1.4, height: 1.2, sill: 0.9 }] },
    { id: 'room_meeting', type: 'MEETING', name: 'Meeting room', floor: 1, x: 0, z: 0, width: 8, depth: 6,
      wallHeight: 3.2, color: '#38b764', doors: [], windows: [{ wall: 'north', offset: 0, width: 2, height: 1.2, sill: 0.9 }] },
  ],
  objects: [
    { id: 'obj_reception_desk', assetType: 'RECEPTION_DESK', name: 'RECEPTION_DESK 1', floor: 0, roomId: 'room_reception', x: 0, y: 0, z: -1, rotationY: 0 },
    { id: 'obj_stairs', assetType: 'STAIRCASE', name: 'STAIRCASE 1', floor: 0, roomId: 'room_reception', x: 3, y: 0, z: 0.5, rotationY: 0 },
    { id: 'obj_cnc', assetType: 'CNC_MACHINE', name: 'CNC_MACHINE 1', floor: 0, roomId: 'room_engineering', x: 13, y: 0, z: -1.5, rotationY: 0 },
    { id: 'obj_desk', assetType: 'DESK_STANDARD', name: 'DESK_STANDARD 1', floor: 0, roomId: 'room_engineering', x: 9.5, y: 0, z: -1, rotationY: 0 },
    { id: 'obj_chair', assetType: 'CHAIR_OFFICE', name: 'CHAIR_OFFICE 1', floor: 0, roomId: 'room_engineering', x: 9.5, y: 0, z: -0.3, rotationY: Math.PI },
    { id: 'obj_table', assetType: 'TABLE_MEETING', name: 'TABLE_MEETING 1', floor: 1, roomId: 'room_meeting', x: -1, y: 0, z: 0, rotationY: 0 },
  ],
  anchorData: {},
};

export * from './schema';
export { migrateV1toV2, loadLayout, detectVersion } from './migrate';
export { toV1, storeFloorIds, mergeV2Extras } from './toV1';
export type { V1Layout, V1Floor, V1Room, V1Object, V1Opening } from './toV1';
export { anchorId, generateAnchorsForObject, syncAnchors, MACHINE_ASSET_TYPES } from './anchors';

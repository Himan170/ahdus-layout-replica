/** Studio's walk maps shared by click-to-walk and Check my layout. */
import { createWalkMapCache } from '../play/navigation/walkMap';
import { ASSET_TYPES } from '../utils/assetCatalog';
export const studioWalkMaps = createWalkMapCache({ catalog: ASSET_TYPES });

/**
 * ui/ItemPicture.jsx
 *
 * The picture of a catalogue item: its library thumbnail
 * (public/assets/thumbs/*.webp, drawn by scripts/make-thumbs.mjs), or its icon
 * when it has none or the file fails. One component for Studio's library and
 * Walk through's catalog (v0.15.2), so both show the same pictures.
 */

import { useState } from 'react';
import { assetIcon } from './tools';
import { thumbnailFor } from '../utils/modelRegistry';

const ASSETS = `${import.meta.env?.BASE_URL ?? '/'}assets/`;

/**
 * @param {{ assetType: string, thumb?: string | null, iconSize?: number }} props
 *   thumb: the picture's path under the assets folder (default: the type's own, thumbnailFor)
 */
export default function ItemPicture({ assetType, thumb = thumbnailFor(assetType), iconSize = 28 }) {
  const [failed, setFailed] = useState(false);
  const Icon = assetIcon(assetType);
  if (thumb && !failed) {
    return <img src={`${ASSETS}${thumb}`} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
  }
  return <Icon size={iconSize} strokeWidth={1.5} />;
}

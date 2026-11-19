/**
 * ui/PrefabPicture.jsx (v0.18.0)
 *
 * A prefab's picture in the library: its plan from above (desks, partitions, chairs, a cabin's walls),
 * drawn from the same layout that places it (play/prefab.js layoutPrefab), so it never goes stale and
 * needs no picture file.
 */

import { useMemo } from 'react';
import { prefabById } from '../catalog/manifest';
import { layoutPrefab } from '../play/prefab';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { wsParams } from '../play/workstation';

const PAD = 0.25;

export default function PrefabPicture({ prefabId, size = 56 }) {
  const shape = useMemo(() => {
    const prefab = prefabById(prefabId);
    if (!prefab) return null;
    const { members, width, depth, room } = layoutPrefab(prefab, {}, ASSET_TYPES);
    const parts = members.map((m, i) => {
      const def = ASSET_TYPES[m.assetType] ?? {};
      const desk = m.role === 'desk';
      const p = desk ? wsParams({ ...m, scaleY: 1, metadata: { ws: m.ws } }, def) : null;
      const w = desk ? p.width : (def.defaultWidth ?? 0.6) * Math.abs(m.scaleX ?? 1);
      const d = desk ? p.depth : (def.defaultDepth ?? 0.6) * Math.abs(m.scaleZ ?? 1);
      // SVG y grows down: the plan's −Z (the front) at the bottom, as in Plan view (north up)
      const deg = ((m.rotationY ?? 0) * 180) / Math.PI; // with y = −z, SVG's rotate(θ) is the world turn
      return { key: i, desk, x: m.x, y: -m.z, w, d, deg, screen: desk && p.partition !== 'none' };
    });
    return { parts, width, depth, room };
  }, [prefabId]);
  if (!shape) return null;
  const vw = shape.width + PAD * 2;
  const vh = shape.depth + PAD * 2;
  const s = Math.max(vw, vh);
  return (
    <svg width={size} height={size} viewBox={`${-s / 2} ${-s / 2} ${s} ${s}`} aria-hidden data-prefab-picture={prefabId}>
      {shape.room && (
        <rect x={-shape.width / 2} y={-shape.depth / 2} width={shape.width} height={shape.depth}
          fill="none" stroke="currentColor" strokeWidth={0.12} opacity={0.55} />
      )}
      {shape.parts.map((p) => (
        <g key={p.key} transform={`translate(${p.x} ${p.y}) rotate(${p.deg})`}>
          {p.desk ? (
            <>
              <rect x={-p.w / 2} y={-p.d / 2} width={p.w} height={p.d} rx={0.03} fill="var(--accent, #28664f)" opacity={0.85} />
              {p.screen && <rect x={-p.w / 2} y={p.d / 2 - 0.05} width={p.w} height={0.06} fill="currentColor" opacity={0.7} />}
            </>
          ) : (
            <circle r={Math.min(p.w, p.d) / 2.2} fill="currentColor" opacity={0.45} />
          )}
        </g>
      ))}
    </svg>
  );
}

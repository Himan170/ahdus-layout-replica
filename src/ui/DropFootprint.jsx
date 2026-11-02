/**
 * ui/DropFootprint.jsx
 *
 * While a library tile is dragged over the canvas (hooks/useLibraryDrop.js): where it would
 * land, as a dashed outline on the floor, with its name and size (red when it can't go there).
 */

export default function DropFootprint({ drag }) {
  const f = drag?.footprint;
  if (!f) return null;
  return (
    <div className={`drop-footprint${f.valid ? '' : ' is-bad'}`} aria-hidden data-drop-footprint>
      <svg className="drop-footprint__svg">
        <polygon points={f.points} />
      </svg>
      <div className="drop-footprint__label" style={{ transform: `translate(${Math.round(f.centre.x)}px, ${Math.round(f.centre.y)}px) translate(-50%, -50%)` }}>
        <span className="drop-footprint__name">{drag.tile.label}</span>
        <span className="drop-footprint__size">{f.size}</span>
      </div>
    </div>
  );
}

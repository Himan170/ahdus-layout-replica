/**
 * ui/OpeningPicture.jsx (v0.18.1)
 *
 * The Doors & windows library's tile picture: a door / window type seen from the front, in a piece of wall.
 * Plain SVG, the tile's own colours (no theme tokens needed: it reads on the light tile in both themes).
 */

const WALL = '#d9dcd3';
const FRAME = '#5b6470';
const GLASS = '#bfe0f2';
const WOOD = '#a0703f';

function Door({ style }) {
  if (style === 'glass') {
    return (<>
      <rect x="22" y="12" width="20" height="38" fill={GLASS} stroke={FRAME} strokeWidth="2.5" />
      <rect x="37" y="30" width="2" height="7" fill={FRAME} />
    </>);
  }
  if (style === 'double-glass') {
    return (<>
      <rect x="13" y="12" width="19" height="38" fill={GLASS} stroke={FRAME} strokeWidth="2.5" />
      <rect x="32" y="12" width="19" height="38" fill={GLASS} stroke={FRAME} strokeWidth="2.5" />
      <rect x="28" y="26" width="2" height="10" fill={FRAME} /><rect x="34" y="26" width="2" height="10" fill={FRAME} />
    </>);
  }
  if (style === 'sliding-glass') {
    return (<>
      <rect x="13" y="12" width="22" height="38" fill={GLASS} stroke={FRAME} strokeWidth="2.5" />
      <rect x="29" y="12" width="22" height="38" fill={GLASS} stroke={FRAME} strokeWidth="2.5" opacity="0.9" />
      <path d="M18 31 h10 m-3 -3 l3 3 l-3 3" stroke={FRAME} strokeWidth="1.6" fill="none" />
    </>);
  }
  if (style === 'exit') {
    return (<>
      <rect x="22" y="15" width="20" height="35" fill="#8a96a3" stroke={FRAME} strokeWidth="2" />
      <rect x="24" y="31" width="16" height="2.5" fill={FRAME} />
      <rect x="21" y="4" width="22" height="8" rx="1" fill="#1f9d55" />
      <text x="32" y="10.3" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">EXIT</text>
    </>);
  }
  return (<>
    <rect x="22" y="12" width="20" height="38" fill={WOOD} stroke="#6f4a26" strokeWidth="2" />
    <circle cx="38" cy="32" r="1.6" fill="#e8d2a0" />
  </>);
}

function Window({ style }) {
  if (style === 'tall') {
    return (<>
      <rect x="24" y="10" width="16" height="34" fill={GLASS} stroke={FRAME} strokeWidth="2.5" />
      <rect x="22" y="44" width="20" height="2.5" fill={FRAME} />
    </>);
  }
  if (style === 'panel') {
    return (<>
      <rect x="12" y="6" width="40" height="44" fill={GLASS} stroke={FRAME} strokeWidth="1.8" />
      <path d="M18 14 l8 -6 M18 22 l14 -12" stroke="#fff" strokeWidth="1.4" opacity="0.7" />
    </>);
  }
  return (<>
    <rect x="14" y="16" width="36" height="20" fill={GLASS} stroke={FRAME} strokeWidth="2.5" />
    <rect x="31" y="16" width="2" height="20" fill={FRAME} />
    <rect x="12" y="36" width="40" height="2.5" fill={FRAME} />
  </>);
}

export default function OpeningPicture({ kind, style }) {
  return (
    <svg viewBox="0 0 64 52" width="56" height="46" aria-hidden data-opening-picture={`${kind}:${style}`}>
      <rect x="0" y="0" width="64" height="50" fill={WALL} />
      <rect x="0" y="50" width="64" height="2" fill="#9aa093" />
      {kind === 'door' ? <Door style={style} /> : <Window style={style} />}
    </svg>
  );
}

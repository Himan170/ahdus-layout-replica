/**
 * ui/RoomPicture.jsx
 *
 * A small top-down plan of a room type for the library tiles (AHDUS look): its walls and
 * what usually stands in it. Pictures only (aria-hidden); colours in ui/ahdus.css (.room-pic).
 */

const FURNITURE = {
  OFFICE: (
    <>
      <rect className="room-pic__item" x="16" y="13" width="12" height="6" rx="1" />
      <rect className="room-pic__item" x="36" y="13" width="12" height="6" rx="1" />
      <rect className="room-pic__item" x="16" y="25" width="12" height="6" rx="1" />
      <rect className="room-pic__item" x="36" y="25" width="12" height="6" rx="1" />
    </>
  ),
  MEETING: (
    <>
      <rect className="room-pic__wood" x="20" y="16" width="24" height="12" rx="2" />
      {[24, 32, 40].map((x) => <circle key={`t${x}`} className="room-pic__dot" cx={x} cy="11" r="2" />)}
      {[24, 32, 40].map((x) => <circle key={`b${x}`} className="room-pic__dot" cx={x} cy="33" r="2" />)}
    </>
  ),
  RECEPTION: (
    <>
      <path className="room-pic__item" d="M16 12h26a5 5 0 0 1 5 5v1H16z" />
      <circle className="room-pic__dot" cx="32" cy="30" r="2.2" />
    </>
  ),
  CORRIDOR: <line className="room-pic__dash" x1="14" y1="22" x2="50" y2="22" />,
  PRODUCTION: (
    <>
      <rect className="room-pic__item" x="14" y="12" width="14" height="10" rx="1" />
      <rect className="room-pic__item" x="36" y="12" width="14" height="10" rx="1" />
      <rect className="room-pic__wood" x="22" y="27" width="20" height="6" rx="1" />
    </>
  ),
  STAIRCASE: (
    <>
      {[14, 20, 26, 32, 38, 44].map((x) => <line key={x} className="room-pic__line" x1={x} y1="12" x2={x} y2="32" />)}
    </>
  ),
  SERVER_ROOM: (
    <>
      {[16, 26, 36, 46].map((x) => <rect key={x} className="room-pic__item" x={x - 3} y="12" width="6" height="20" rx="1" />)}
    </>
  ),
  RESTROOM: (
    <>
      <line className="room-pic__wall-inner" x1="32" y1="9" x2="32" y2="35" />
      <ellipse className="room-pic__item" cx="21" cy="16" rx="3.5" ry="4.5" />
      <ellipse className="room-pic__item" cx="43" cy="16" rx="3.5" ry="4.5" />
    </>
  ),
  // v0.18.1
  CAFETERIA: (
    <>
      {[20, 44].map((x) => [16, 29].map((y) => (
        <g key={`${x}-${y}`}>
          <circle className="room-pic__wood" cx={x} cy={y} r="4" />
          <circle className="room-pic__dot" cx={x - 6} cy={y} r="1.6" />
          <circle className="room-pic__dot" cx={x + 6} cy={y} r="1.6" />
        </g>
      )))}
    </>
  ),
  LOUNGE: (
    <>
      <path className="room-pic__item" d="M14 13h22v6H20v12h-6z" />
      <rect className="room-pic__wood" x="26" y="23" width="12" height="7" rx="2" />
      <circle className="room-pic__dot" cx="46" cy="28" r="3" />
    </>
  ),
  CABIN: (
    <>
      <rect className="room-pic__wood" x="22" y="14" width="20" height="8" rx="1" />
      <circle className="room-pic__dot" cx="32" cy="11" r="2" />
      <circle className="room-pic__dot" cx="27" cy="28" r="2" />
      <circle className="room-pic__dot" cx="37" cy="28" r="2" />
    </>
  ),
  TRAINING: (
    <>
      <line className="room-pic__line" x1="22" y1="10" x2="42" y2="10" />
      {[17, 25, 33].map((y) => [16, 28, 40].map((x) => (
        <rect key={`${x}-${y}`} className="room-pic__item" x={x} y={y} width="9" height="3.5" rx="0.8" />
      )))}
    </>
  ),
  LOBBY: (
    <>
      <path className="room-pic__item" d="M20 12h24a4 4 0 0 1 4 4v1H20z" />
      <rect className="room-pic__wood" x="14" y="26" width="10" height="5" rx="1.5" />
      <rect className="room-pic__wood" x="40" y="26" width="10" height="5" rx="1.5" />
      <circle className="room-pic__dot" cx="32" cy="29" r="2.5" />
    </>
  ),
  // v0.18.3: the car's doors and its up / down arrows
  LIFT: (
    <>
      <rect className="room-pic__item" x="22" y="12" width="9" height="22" rx="1" />
      <rect className="room-pic__item" x="33" y="12" width="9" height="22" rx="1" />
      <path className="room-pic__wood" d="M48 18l3-4 3 4zM48 26l3 4 3-4z" />
    </>
  ),
};

export default function RoomPicture({ roomType }) {
  const corridor = roomType === 'CORRIDOR';
  return (
    <svg className="room-pic" viewBox="0 0 64 44" aria-hidden="true" focusable="false">
      {corridor
        ? <rect className="room-pic__wall" x="8" y="15" width="48" height="14" rx="2" />
        : <rect className="room-pic__wall" x="9" y="7" width="46" height="30" rx="2" />}
      {FURNITURE[roomType] ?? FURNITURE.OFFICE}
    </svg>
  );
}

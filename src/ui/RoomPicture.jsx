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

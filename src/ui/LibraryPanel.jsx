/**
 * ui/LibraryPanel.jsx
 *
 * The AHDUS look's library, docked next to the tool rail (on a phone: a pull-up sheet over
 * the tool bar). One page per tool:
 *   Rooms      room tiles (a small plan, name, default size), search, "Draw your own size",
 *              Start from a template
 *   Furniture  category chips, search, tiles with a picture of the real model
 *   Stairs     the staircase tile (Lift: coming soon)
 *   Walls, Doors & windows   tool tiles: a click arms the tool
 * Room, furniture and stair tiles: drag one onto the floor (WorkplaceEditor shows its dashed
 * footprint and size), or click it to place it in the middle of the view. On a touch screen a
 * tap picks it and the next tap on the floor places it. What they list: ui/library.js.
 */

import { useState } from 'react';
import { Search, X, PencilRuler, LayoutTemplate, ChevronDown } from 'lucide-react';
import { STUDIO_TOOLS, assetIcon } from './tools';
import {
  ROOM_TILES, filterRooms, FURNITURE_CHIPS, filterFurniture, MODEL_COUNT, templateDetail,
} from './library';
import { LAYOUT_TEMPLATES } from '../templates';
import RoomPicture from './RoomPicture';
import ItemPicture from './ItemPicture';


const PAGES = {
  rooms: { title: 'Rooms', text: 'Drag a room onto the floor, or click it to place it in the middle.', touch: 'Tap one, then tap the floor' },
  furniture: { title: 'Furniture', text: 'Drag into a room. It lands on the floor or a table top.', touch: 'Tap one, then tap the floor' },
  stairs: { title: 'Stairs', text: 'Drag the staircase onto the floor, or click it to place it in the middle. R turns it 90°.', touch: 'Tap it, then tap the floor' },
  walls: { title: 'Walls', text: 'Pick the wall, then drag on the floor from where it starts to where it ends.', touch: 'Tap it, then drag on the floor' },
  doors: { title: 'Doors & windows', text: 'Pick one, then click a room wall to add it. Click one to remove it.', touch: 'Tap one, then tap a wall' },
};

function SearchBox({ value, onChange, placeholder, label }) {
  return (
    <div className="catalog__search lib__search">
      <Search size={16} strokeWidth={1.75} aria-hidden />
      <input type="text" placeholder={placeholder} aria-label={label} value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); } }} />
      {value && (
        <button className="ui-icon-btn catalog__clear" aria-label="Clear search" title="Clear search" onClick={() => onChange('')}>
          <X size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

/** A picture tile: pointer down may start a drag (WorkplaceEditor), a click places it. */
function Tile({ tile, picture, pressed, dragging, onPointerDown, onPlace }) {
  return (
    <button
      className="lib-tile"
      aria-pressed={pressed}
      data-dragging={dragging || undefined}
      title={`${tile.label}: drag onto the floor, or click to place it in the middle`}
      onPointerDown={(e) => onPointerDown(tile, e)}
      onClick={(e) => onPlace(tile, e)}
      onDragStart={(e) => e.preventDefault()}
    >
      <span className="lib-tile__pic" aria-hidden>{picture}</span>
      <span className="lib-tile__name">{tile.label}</span>
      <span className="lib-tile__size">{dragging ? 'Dragging…' : tile.sizeText}</span>
    </button>
  );
}


/** Walls, doors and windows: a tile arms the tool. */
function ToolTiles({ tool, activeOption, onPickOption }) {
  return (
    <div className="lib-grid">
      {tool.options.map((o) => {
        const Icon = o.icon;
        return (
          <button key={o.id} className="lib-tile" disabled={o.disabled} aria-pressed={!o.disabled && activeOption === o.id}
            title={o.disabled ? 'Coming soon' : o.label} onClick={() => onPickOption(o)}>
            <span className="lib-tile__pic" aria-hidden>{Icon && <Icon size={28} strokeWidth={1.5} />}</span>
            <span className="lib-tile__name">{o.label}</span>
            <span className="lib-tile__size">{o.detail}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function LibraryPanel({
  toolId,
  activeOption,      // tools.activeTile().option: the armed room type / tool / asset
  draggingId,        // the tile being dragged, or null
  onTilePointerDown, // (tile, event) => void: may start a drag
  onPlaceTile,       // (tile, event) => void: a click (middle) or a tap (pick, then tap the floor)
  onPickOption,      // walls / doors: arm the tool
  onDrawRoom,        // Rooms: draw one by dragging corner to corner
  drawing = false,   // the room drawing tool is armed
  onTemplate,        // (template) => void: asks, then replaces the layout
  sheet = false,     // phone: a pull-up sheet
  onClose,           // phone: pull the sheet down
}) {
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState(FURNITURE_CHIPS[0]);
  const tool = STUDIO_TOOLS.find((t) => t.id === toolId);
  const page = PAGES[toolId];
  if (!tool || !page) return null;

  const tileProps = (tile) => ({
    tile,
    pressed: activeOption === tile.id,
    dragging: draggingId === tile.id,
    onPointerDown: onTilePointerDown,
    onPlace: onPlaceTile,
  });

  return (
    <aside className={`library${sheet ? ' is-sheet' : ''}`} aria-label={`${page.title} library`} data-library={toolId}>
      {sheet && (
        <button className="library__grab" aria-label="Close the library" title="Close" onClick={onClose}>
          <ChevronDown size={18} strokeWidth={1.75} aria-hidden />
        </button>
      )}
      <header className="library__head">
        <h2 className="library__title">{page.title}</h2>
        <p className="library__text">{sheet ? page.touch : page.text}</p>
      </header>

      <div className="library__body">
        {toolId === 'rooms' && (
          <>
            {!sheet && <SearchBox value={query} onChange={setQuery} placeholder="Search rooms" label="Search rooms" />}
            <h3 className="ui-section-title lib__heading">Room types</h3>
            <div className="lib-grid">
              {filterRooms(query, ROOM_TILES).map((t) => (
                <Tile key={t.id} {...tileProps(t)} picture={<RoomPicture roomType={t.roomType} />} />
              ))}
            </div>
            {filterRooms(query, ROOM_TILES).length === 0 && <p className="lib__empty">No room type matches “{query}”.</p>}
            {!sheet && (
              <button className="ui-btn is-ghost lib__draw" aria-pressed={!!drawing}
                onClick={onDrawRoom} title="Drag on the floor from one corner to the opposite corner">
                <PencilRuler size={16} strokeWidth={1.75} aria-hidden /> Draw your own size
              </button>
            )}
            {!sheet && onTemplate && (
              <>
                <h3 className="ui-section-title lib__heading">Start from a template</h3>
                <ul className="lib-templates" role="list">
                  {LAYOUT_TEMPLATES.map((t) => (
                    <li key={t.id}>
                      <button className="lib-template" onClick={() => onTemplate(t)}
                        title={`${t.description} Replaces this layout (Ctrl+Z undoes it).`}>
                        <span className="lib-template__pic" aria-hidden><LayoutTemplate size={22} strokeWidth={1.5} /></span>
                        <span className="lib-template__name">{t.name}</span>
                        <span className="lib-template__detail">{templateDetail(t.layout)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {toolId === 'furniture' && (
          <>
            {!sheet && <SearchBox value={query} onChange={setQuery} placeholder={`Search ${MODEL_COUNT} models`} label="Search furniture" />}
            <div className="catalog__chips lib__chips" role="group" aria-label="Categories">
              {FURNITURE_CHIPS.map((c) => (
                <button key={c} className="catalog__chip" aria-pressed={!query && chip === c} onClick={() => { setChip(c); setQuery(''); }}>{c}</button>
              ))}
            </div>
            <div className="lib-grid">
              {filterFurniture(query, chip).map((t) => (
                <Tile key={t.id} {...tileProps(t)} picture={<ItemPicture assetType={t.assetType} thumb={t.thumb} />} />
              ))}
            </div>
            {filterFurniture(query, chip).length === 0 && <p className="lib__empty">Nothing matches “{query}”.</p>}
            {!sheet && <p className="lib__note">Pictures show the real 3D models, the same as in the walk-through.</p>}
          </>
        )}

        {toolId === 'stairs' && (
          <div className="lib-grid">
            <Tile {...tileProps({ kind: 'object', id: 'STAIRCASE', assetType: 'STAIRCASE', label: 'Staircase', width: 1.2, depth: 4, sizeText: '1.2 × 4 m · up one floor' })}
              picture={<ItemPicture assetType="STAIRCASE" thumb={null} />} />
            {tool.options.filter((o) => o.disabled).map((o) => {
              const Icon = o.icon;
              return (
                <button key={o.id} className="lib-tile" disabled title="Coming soon">
                  <span className="lib-tile__pic" aria-hidden><Icon size={28} strokeWidth={1.5} /></span>
                  <span className="lib-tile__name">{o.label}</span>
                  <span className="lib-tile__size">{o.detail}</span>
                </button>
              );
            })}
          </div>
        )}

        {(toolId === 'walls' || toolId === 'doors') && (
          <ToolTiles tool={tool} activeOption={activeOption} onPickOption={onPickOption} />
        )}
      </div>
    </aside>
  );
}

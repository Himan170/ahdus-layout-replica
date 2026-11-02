/**
 * ui/BuildPanel.jsx
 *
 * The tool rail on the left of Workplace Studio (dark green): one tile per tool, icon above a
 * short word. Clicking a tile (except Select) opens its library (ui/LibraryPanel) docked next
 * to the rail; on a phone the rail is a bottom bar and the library a pull-up sheet.
 * Layers (bottom) opens the outline of this floor in the Inspector; Shortcuts lists the keys.
 */

import { useMemo, useRef, useState } from 'react';
import { Layers, Keyboard } from 'lucide-react';
import { STUDIO_TOOLS } from './tools';
import ShortcutsPopover from './ShortcutsPopover';
import LibraryPanel from './LibraryPanel';

function Tile({ tool, active, open, onClick, phone = false }) {
  const Icon = tool.icon;
  const label = phone ? tool.phoneLabel ?? tool.railLabel ?? tool.label : tool.railLabel ?? tool.label;
  return (
    <button
      className="build-tile"
      aria-label={tool.label}
      title={`${tool.label} (${tool.shortcut})`}
      aria-pressed={active}
      aria-expanded={tool.options || tool.id === 'furniture' ? open : undefined}
      onClick={onClick}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden />
      <span className="build-tile__label">{label}</span>
    </button>
  );
}

export default function BuildPanel({
  active,              // { id, choice } from tools.activeTile()
  openTray,            // tool id whose library is open, or null
  onOpenTray,          // (id | null) => void
  onSelectTool,        // () => void   Select tile
  layersOpen,
  onToggleLayers,
  library,             // LibraryPanel props
}) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsRef = useRef(null);
  const closeShortcuts = useMemo(() => () => setShortcutsOpen(false), []);

  return (
    <>
    <aside className="build-panel tool-rail" aria-label="Build">
      <div className="build-panel__tiles" role="toolbar" aria-orientation={library?.sheet ? "horizontal" : "vertical"} aria-label="Build tools">
        {STUDIO_TOOLS.map((t) => (
          <Tile
            key={t.id}
            tool={t}
            active={active.id === t.id}
            open={openTray === t.id}
            phone={!!library?.sheet}
            onClick={() => {
              if (t.id === 'select') { onOpenTray(null); onSelectTool(); }
              else onOpenTray(openTray === t.id ? null : t.id);
            }}
          />
        ))}
      </div>
      <button
        className="build-tile build-tile--row"
        aria-label="Layers"
        title="Layers: everything on this floor"
        aria-pressed={layersOpen}
        onClick={onToggleLayers}
      >
        <Layers size={20} strokeWidth={1.75} aria-hidden />
        <span className="build-tile__label">Layers</span>
      </button>
      <button
        ref={shortcutsRef}
        className="build-tile build-tile--row"
        aria-label="Shortcuts"
        title="Keyboard shortcuts"
        aria-expanded={shortcutsOpen}
        onClick={() => setShortcutsOpen((v) => !v)}
      >
        <Keyboard size={20} strokeWidth={1.75} aria-hidden />
        <span className="build-tile__label">Shortcuts</span>
      </button>
      {shortcutsOpen && <ShortcutsPopover onClose={closeShortcuts} anchorRef={shortcutsRef} />}
    </aside>
    {openTray && library && <LibraryPanel key={openTray} toolId={openTray} {...library} />}
    </>
  );
}

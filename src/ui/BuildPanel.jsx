/**
 * ui/BuildPanel.jsx
 *
 * The Build card on the left of Workplace Studio: one tile per tool (icon
 * above a short label). Clicking a tile (except Select) opens its options
 * tray, a card over the canvas; picking an option arms the tool and closes
 * the tray. Layers (bottom) opens the outline of this floor in the Inspector.
 */

import { useMemo, useRef, useState } from 'react';
import { Layers, Keyboard } from 'lucide-react';
import { STUDIO_TOOLS, FURNITURE_ITEMS, assetIcon } from './tools';
import { usePopover } from './usePopover';
import CatalogPicker from './CatalogPicker';
import ShortcutsPopover from './ShortcutsPopover';
import LibraryPanel from './LibraryPanel';
import { isAhdusLook } from './look';

function Tile({ tool, active, choice, open, onClick, rail = false, phone = false }) {
  const Icon = tool.icon;
  const label = phone ? tool.phoneLabel ?? tool.railLabel ?? tool.label : rail ? tool.railLabel ?? tool.label : tool.label;
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
      {!rail && active && choice && <span className="build-tile__choice">{choice}</span>}
    </button>
  );
}

function OptionList({ tool, activeOption, onPick }) {
  return (
    <ul className="tray__options" role="list">
      {tool.options.map((o) => {
        const Icon = o.icon;
        return (
          <li key={o.id}>
            <button
              className="tray__option"
              disabled={o.disabled}
              aria-pressed={!o.disabled && activeOption === o.id}
              title={o.disabled ? 'Coming soon' : o.label}
              onClick={() => onPick(o)}
            >
              {o.color
                ? <span className="ui-dot" style={{ background: o.color }} aria-hidden />
                : Icon && <Icon size={18} strokeWidth={1.75} aria-hidden />}
              <span className="tray__option-label">{o.label}</span>
              <span className="tray__option-detail">{o.detail}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function BuildPanel({
  active,              // { id, choice } from tools.activeTile()
  openTray,            // tool id whose tray is open, or null
  onOpenTray,          // (id | null) => void
  onSelectTool,        // () => void   Select tile
  onPickOption,        // (option) => void   { tool } or { place }
  onPickFurniture,     // (assetType) => void
  onDragFurniture,     // (assetType, event) => void
  placementAsset,      // asset being placed, or null
  layersOpen,
  onToggleLayers,
  library,             // the AHDUS look: LibraryPanel props (a docked library instead of trays)
}) {
  const panelRef = useRef(null);
  const rail = isAhdusLook(); // the AHDUS look: a dark green rail, icon + word, Shortcuts at the bottom
  const closeTray = useMemo(() => () => onOpenTray(null), [onOpenTray]);
  usePopover(!!openTray && !rail, closeTray, [panelRef]); // the docked library stays open

  const furnitureSections = useMemo(() => {
    const byCat = new Map();
    for (const item of FURNITURE_ITEMS) {
      const c = item.category ?? 'Other';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(item);
    }
    return [...byCat].map(([title, items]) => ({ title, items }));
  }, []);

  const trayTool = rail ? null : STUDIO_TOOLS.find((t) => t.id === openTray);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsRef = useRef(null);
  const closeShortcuts = useMemo(() => () => setShortcutsOpen(false), []);

  return (
    <>
    <aside className={`build-panel${rail ? ' tool-rail' : ''}`} ref={panelRef} aria-label="Build">
      {!rail && <h2 className="build-panel__title">Build</h2>}
      <div className="build-panel__tiles" role="toolbar" aria-orientation={library?.sheet ? "horizontal" : "vertical"} aria-label="Build tools">
        {STUDIO_TOOLS.map((t) => (
          <Tile
            key={t.id}
            tool={t}
            active={active.id === t.id}
            choice={active.id === t.id ? active.choice : null}
            open={openTray === t.id}
            rail={rail}
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
      {rail && (
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
      )}
      {shortcutsOpen && <ShortcutsPopover onClose={closeShortcuts} anchorRef={shortcutsRef} />}

      {trayTool && (
        <div className="ui-pop tray" role="dialog" aria-label={`${trayTool.label} options`}>
          <h3 className="tray__title">{trayTool.label}</h3>
          {trayTool.id === 'furniture' ? (
            <CatalogPicker
              compact
              autoFocus
              sections={furnitureSections}
              itemKey={(i) => i.assetType}
              iconFor={(i) => assetIcon(i.assetType)}
              isActive={(i) => i.assetType === placementAsset}
              onPick={(i) => onPickFurniture(i.assetType)}
              onDragStart={(i, e) => onDragFurniture(i.assetType, e)}
            />
          ) : (
            <OptionList
              tool={trayTool}
              activeOption={active.id === trayTool.id ? active.option : null}
              onPick={onPickOption}
            />
          )}
        </div>
      )}
    </aside>
    {rail && openTray && library && <LibraryPanel key={openTray} toolId={openTray} {...library} />}
    </>
  );
}

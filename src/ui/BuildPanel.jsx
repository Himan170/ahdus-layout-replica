/**
 * ui/BuildPanel.jsx
 *
 * The Build card on the left of Workplace Studio: one tile per tool (icon
 * above a short label). Clicking a tile (except Select) opens its options
 * tray, a card over the canvas; picking an option arms the tool and closes
 * the tray. Layers (bottom) opens the outline of this floor in the Inspector.
 */

import { useMemo, useRef } from 'react';
import { Layers } from 'lucide-react';
import { STUDIO_TOOLS, FURNITURE_ITEMS, assetIcon } from './tools';
import { usePopover } from './usePopover';
import CatalogPicker from './CatalogPicker';

function Tile({ tool, active, choice, open, onClick }) {
  const Icon = tool.icon;
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
      <span className="build-tile__label">{tool.label}</span>
      {active && choice && <span className="build-tile__choice">{choice}</span>}
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
}) {
  const panelRef = useRef(null);
  const closeTray = useMemo(() => () => onOpenTray(null), [onOpenTray]);
  usePopover(!!openTray, closeTray, [panelRef]);

  const furnitureSections = useMemo(() => {
    const byCat = new Map();
    for (const item of FURNITURE_ITEMS) {
      const c = item.category ?? 'Other';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(item);
    }
    return [...byCat].map(([title, items]) => ({ title, items }));
  }, []);

  const trayTool = STUDIO_TOOLS.find((t) => t.id === openTray);

  return (
    <aside className="build-panel" ref={panelRef} aria-label="Build">
      <h2 className="build-panel__title">Build</h2>
      <div className="build-panel__tiles" role="toolbar" aria-orientation="vertical" aria-label="Build tools">
        {STUDIO_TOOLS.map((t) => (
          <Tile
            key={t.id}
            tool={t}
            active={active.id === t.id}
            choice={active.id === t.id ? active.choice : null}
            open={openTray === t.id}
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
  );
}

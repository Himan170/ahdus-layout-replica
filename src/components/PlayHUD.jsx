/**
 * PlayHUD.jsx
 *
 * On-screen layer for Preview (walk through the workplace and build): Back to
 * Studio, where you are, crosshair, what's in your hand and what clicking will
 * do, the hotbar, the "click to start" screen, and the catalog (B) for putting
 * any item into a hotbar slot. Same tokens and icons as Workplace Studio
 * (src/ui/theme.css, src/ui/tools.js).
 *
 * Colour meaning matches the 3D preview: blue = can build here, red = can't.
 */

import { useEffect, useState } from 'react';
import { ArrowLeft, LayoutGrid as CatalogIcon, ChevronUp, ChevronDown, Copy, Square, DoorOpen, HelpCircle, Crosshair } from 'lucide-react';
import { catalogSections, itemKey, shortLabel } from '../play/hotbarItems';
import RoomPicture from '../ui/RoomPicture';
import ItemPicture from '../ui/ItemPicture';
import { itemIcon } from '../ui/tools';
import CatalogPicker from '../ui/CatalogPicker';
import '../ui/studio.css';
import '../ui/preview.css';

const CONTROLS = [
  ['W A S D', 'Move'],
  ['Drag', 'Look around (the mouse stays)'],
  ['Click', 'Empty hand: walk there. Holding an item: build where the mouse points'],
  ['Right-click', 'Remove what the mouse points at; drag instead to look around'],
  ['Shift', 'Run'],
  ['Space', 'Jump'],
  ['F', 'Fly (Space up, C down)'],
  ['V', 'First / third person'],
  ['R', 'Turn furniture 90° (Shift+R: 15°)'],
  ['G or middle-click', 'Pick up what the mouse points at, then click to put it down'],
  ['9', 'Edit item: move, turn (R), resize (+ / −), lock (L), slide a door along its wall'],
  ['E', 'Use what the mouse points at'],
  ['1–9 or wheel', 'Choose hotbar slot (the same number again: empty hand)'],
  ['Esc', 'Cancel, then put the item away'],
  ['M', 'Mouse look: the mouse turns the view, a crosshair aims (Esc ends it)'],
  ['B', 'Catalog of all items'],
  ['N', 'New floor above (copy the rooms below, or empty)'],
  ['Page Up / Down', 'Go to the floor above / below'],
  ['Home', 'Back to the entrance'],
  ['3 + / −', 'Stretch: raise or lower the walls'],
  ['Ctrl+Z', 'Undo'],
  ['Tab', 'Back to Studio'],
];

function Key({ children, tone }) {
  return <kbd className={`ui-kbd${tone === 'ok' ? ' is-ok' : ''}`}>{children}</kbd>;
}

/**
 * What the tool in your hand will do: title, detail (red when you can't) and
 * the keys/clicks to use. hint: { title, detail?, bad?, keys?: [key, action][] }
 */
export function ToolHint({ hint, style }) {
  if (!hint) return null;
  const primary = (k) => (k === 'Left-click' || k === 'Click' || k === 'Drag') && !hint.bad;
  return (
    <div className="hud-card hud-hint" style={style} data-hud="hint" aria-live="polite">
      <div>
        <span className="hud-hint__title">{hint.title}</span>
        {hint.detail && <span className={`hud-hint__detail${hint.bad ? ' is-bad' : ''}`}>{hint.detail}</span>}
      </div>
      {hint.keys?.length > 0 && (
        <div className="hud-hint__keys">
          {hint.keys.map(([k, action]) => (
            <span key={k} className="hud-hint__key">
              <Key tone={primary(k) ? 'ok' : undefined}>{k}</Key>
              {action}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The catalog's pictures, the same as Studio's library: a room's plan, an item's thumbnail. */
function catalogPicture(item) {
  if (item.kind === 'room') return <RoomPicture roomType={item.roomType} />;
  if (item.kind === 'object') return <ItemPicture assetType={item.assetType} iconSize={24} />;
  return null; // the build tools keep their icons
}

function Slot({ item, index, selected, onClick }) {
  const Icon = itemIcon(item);
  return (
    <button
      className="hud-slot"
      onClick={onClick}
      title={item ? `${item.label} (${index + 1})` : `Empty slot (${index + 1})`}
      aria-label={item ? `Slot ${index + 1}: ${item.label}` : `Slot ${index + 1}: empty`}
      aria-pressed={selected}
    >
      <span className="hud-slot__number">{index + 1}</span>
      {Icon && <Icon size={22} strokeWidth={1.75} aria-hidden />}
      {item && <span className="hud-slot__name" data-slot-name>{shortLabel(item)}</span>}
      {item?.kind === 'room' && <span className="hud-slot__stripe" style={{ background: item.color }} />}
    </button>
  );
}

export default function PlayHUD({
  hud,                 // { locked, flying, firstPerson, hint, message, roomName, prompt }
  floorName,
  hotbar,              // array of 9 items (or null)
  selectedSlot,
  onSelectSlot,
  catalogOpen,
  onOpenCatalog,
  onCloseCatalog,
  onAssign,            // (item) => void   put item into the selected slot
  onResume,            // () => void       capture the mouse again
  onExitToStudio,
  interaction,         // { title, text } | null
  demoModules = false, // true when the demo teammate modules are running (?demoModules=1)
  onFloorUp,           // () => void   the floor above (Page Up)
  onFloorDown,         // () => void   the floor below (Page Down)
  onBackToEntrance,    // () => void   back to where walking starts (Home)
  newFloorAsk = false, // N was pressed: ask "copy rooms or empty?"
  copyFromName = '',   // name of the floor the rooms would be copied from
  onNewFloorChoice,    // (copyRooms: boolean | null) => void   null = cancel
  onMouseLook,         // () => void   mouse look on / off (M)
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const hint = hud?.hint;
  const selectedItem = hotbar[selectedSlot];
  const floor = hud?.floor;

  // Esc closes the catalog (B toggles it via the play controller), or cancels the new floor
  useEffect(() => {
    if (!catalogOpen && !newFloorAsk && !helpOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (catalogOpen) onCloseCatalog();
      else if (newFloorAsk) onNewFloorChoice?.(null);
      else setHelpOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [catalogOpen, onCloseCatalog, newFloorAsk, onNewFloorChoice, helpOpen]);

  // v0.15.2: walking starts at once (drag to look, the mouse stays), so there is no "click to start"
  // screen any more; the same list of keys opens from the "?" button. (A controller that still
  // captures the mouse, hud.mouseAim false, keeps the old screen.)
  const easy = !!hud?.mouseAim;
  const paused = !catalogOpen && !newFloorAsk && (easy ? helpOpen : hud ? !hud.locked : false);
  const closePaused = easy ? () => setHelpOpen(false) : onResume;

  return (
    <div className="hud">
      {/* ── Back to Studio, and where you are ── */}
      <div className="hud__top-left">
        <button className="hud-card hud-btn" aria-label="Back to Studio" title="Back to Studio (Tab)" onClick={onExitToStudio}>
          <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
          Back to Studio
          <Key>Tab</Key>
        </button>
        <span className="hud-card hud-pill" data-hud="room">
          <strong>{hud?.roomName ?? 'Outside'}</strong>
          {!floor && <span className="ui-muted">{floorName}</span>}
        </span>
        {floor && (
          <span className="hud-card hud-floor" data-hud="floor" title={`Floor ${floor.index} of ${floor.count}`}>
            <button className="hud-floor__btn" aria-label="Floor below" title="Floor below (Page Down)"
              disabled={floor.index <= 1} onClick={onFloorDown}>
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <span className="hud-floor__label">{floor.name ?? floorName}</span>
            <button className="hud-floor__btn" aria-label="Floor above" title="Floor above (Page Up)"
              disabled={floor.index >= floor.count} onClick={onFloorUp}>
              <ChevronUp size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </span>
        )}
        {onBackToEntrance && (
          <button className="hud-card hud-btn" aria-label="Back to entrance" title="Back to entrance (Home)" onClick={onBackToEntrance}>
            <DoorOpen size={18} strokeWidth={1.75} aria-hidden />
            Entrance
            <Key>Home</Key>
          </button>
        )}
        <span className="hud-card hud-pill ui-muted">
          {hud?.flying ? 'Flying' : 'Walking'}{hud?.firstPerson ? ', first person' : ''}
        </span>
        {demoModules && (
          <span className="hud-card hud-pill hud-pill--note" title="Fake teammate modules are connected (?demoModules=1)">
            Demo modules on
          </span>
        )}
      </div>

      <div className="hud__top-right">
        <button className="hud-card hud-btn" onClick={onOpenCatalog} title="Catalog of all items (B)">
          <CatalogIcon size={18} strokeWidth={1.75} aria-hidden />
          Catalog
          <Key>B</Key>
        </button>
        {easy && onMouseLook && (
          <button className="hud-card hud-btn" aria-label="Mouse look" aria-pressed={!!hud?.locked} data-hud="mouse-look"
            title="Mouse look: the mouse turns the view, a crosshair aims (M). Esc ends it." onClick={onMouseLook}>
            <Crosshair size={18} strokeWidth={1.75} aria-hidden />
            Mouse look
            <Key>M</Key>
          </button>
        )}
        {easy && (
          <button className="hud-card hud-btn" aria-label="Keys and mouse" aria-expanded={helpOpen} data-hud="help"
            title="Keys and mouse" onClick={() => setHelpOpen((open) => !open)}>
            <HelpCircle size={18} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>

      {/* ── Feedback ── */}
      {hud?.message && <div className="hud-card hud-toast" role="status" data-hud="toast">{hud.message}</div>}
      {interaction && (
        <div className="hud-card hud-interaction" role="status" data-hud="card">
          <strong>{interaction.title}</strong>
          <span className="ui-muted">{interaction.text}</span>
        </div>
      )}

      {/* ── Crosshair ── */}
      {hud?.locked && (
        <div className="hud-crosshair" aria-hidden>
          <span style={{ width: 16, height: 2 }} />
          <span style={{ width: 2, height: 16 }} />
        </div>
      )}

      {/* ── "Press E" prompt for what you look at (the easy controls: what the mouse points at) ── */}
      {(hud?.locked || easy) && hud?.prompt && (
        <div className="hud-card hud-prompt" data-hud="prompt" aria-live="polite">
          <Key tone={hud.prompt.handled ? 'ok' : undefined}>E</Key>
          <span>{hud.prompt.label}</span>
          {hud.prompt.name && <span className="ui-muted">{hud.prompt.name}</span>}
        </div>
      )}

      {/* ── What clicking will do + hotbar ── */}
      <div className="hud__bottom">
        <ToolHint hint={hint} />
        <div className="hud-card hud-hotbar" role="toolbar" aria-label="Hotbar">
          {hotbar.map((item, i) => (
            <Slot key={i} item={item} index={i} selected={i === selectedSlot} onClick={() => onSelectSlot(i)} />
          ))}
        </div>
      </div>

      {/* ── Paused: click to start ── */}
      {paused && (
        <div className="hud-scrim" onClick={closePaused}>
          <div className="ui-pop hud-panel" role={easy ? 'dialog' : undefined} aria-label={easy ? 'Keys and mouse' : undefined}
            data-hud={easy ? 'help-panel' : undefined} onClick={(e) => e.stopPropagation()}>
            <h2 className="hud-panel__title">Walk through your workplace</h2>
            <p className="hud-panel__text">
              Walk around as your character. You can still build with the item in your hand.
              {selectedItem ? ` You're holding: ${selectedItem.label}.` : ' Your hands are empty: a click walks there. Press 1–9 or B to pick something to build.'}
            </p>
            <dl className="hud-controls">
              {CONTROLS.map(([k, v]) => (
                <div key={k}>
                  <dt><Key>{k}</Key></dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="hud-panel__actions">
              <button className="ui-btn is-primary" onClick={closePaused} autoFocus>{easy ? 'Close' : 'Start preview'}</button>
              <button className="ui-btn" onClick={onExitToStudio}>Back to Studio</button>
            </div>
            {!easy && <p className="hud-panel__foot ui-muted">Press Esc any time to get your mouse back.</p>}
          </div>
        </div>
      )}

      {/* ── N: a new floor above, empty or with the rooms of the floor below ── */}
      {newFloorAsk && (
        <div className="hud-scrim" onClick={() => onNewFloorChoice(null)}>
          <div className="ui-pop hud-panel hud-newfloor" role="dialog" aria-label="New floor above"
            onClick={(e) => e.stopPropagation()}>
            <h2 className="hud-panel__title">New floor above</h2>
            <p className="hud-panel__text">You go up to it as soon as it is built.</p>
            <div className="hud-newfloor__choices">
              <button className="ui-btn is-primary" aria-label="Copy rooms from below" autoFocus
                onClick={() => onNewFloorChoice(true)}>
                <Copy size={16} strokeWidth={1.75} aria-hidden />
                Copy rooms from {copyFromName || 'below'}
              </button>
              <button className="ui-btn" aria-label="Empty floor" onClick={() => onNewFloorChoice(false)}>
                <Square size={16} strokeWidth={1.75} aria-hidden />
                Empty floor
              </button>
            </div>
            <p className="hud-panel__foot ui-muted">
              Copying keeps the room shapes, wall heights, doors and windows. No furniture or stairs.
            </p>
          </div>
        </div>
      )}

      {/* ── Catalog (search + category chips, like Studio's library) ── */}
      {catalogOpen && (
        <div className="hud-scrim" onClick={onCloseCatalog}>
          <div
            className="ui-pop hud-panel hud-catalog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Catalog"
          >
            <div className="hud-catalog__head">
              <div>
                <h2 className="hud-panel__title">Add to hotbar</h2>
                <p className="hud-catalog__sub ui-muted" data-catalog-sub>
                  {selectedSlot >= 0
                    ? `Pick an item: it goes into slot ${selectedSlot + 1}, and into your hand.`
                    : 'Pick an item: it goes into the first free slot, and into your hand.'}
                </p>
              </div>
              <button className="ui-btn" onClick={onCloseCatalog}>Close</button>
            </div>
            <CatalogPicker
              autoFocus
              sections={catalogSections()}
              itemKey={itemKey}
              iconFor={itemIcon}
              pictureFor={catalogPicture}
              isActive={(item) => itemKey(item) === itemKey(selectedItem)}
              onPick={onAssign}
            />
          </div>
        </div>
      )}
    </div>
  );
}

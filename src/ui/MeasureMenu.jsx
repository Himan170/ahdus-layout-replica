/**
 * ui/MeasureMenu.jsx
 *
 * The "Measure" button on the canvas card (ruler icon) and its small panel:
 * Measure Distance, Show Wall Lengths, Show Room Areas, Clear Measurements.
 * Esc or a click outside closes the panel. The button shows as active while
 * any measurement is on. While measuring, a small hint with "Exit Measurement
 * Mode" stays under the controls (the panel closes when you click the canvas).
 */

import { useRef, useState } from 'react';
import { Ruler, Trash2, X } from 'lucide-react';
import { usePopover } from './usePopover';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };

export default function MeasureMenu({
  measureMode,
  onToggleMeasure,
  onClearMeasurements,
  hasMeasurements,
  showWallLengths,
  onToggleWallLengths,
  showRoomAreas,
  onToggleRoomAreas,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const close = () => setOpen(false);
  usePopover(open, close, [wrapRef]);

  const active = measureMode || showWallLengths || showRoomAreas || hasMeasurements;

  return (
    <div className="measure-menu" ref={wrapRef}>
      <button
        className={`ui-icon-btn measure-menu__trigger${active ? ' is-active' : ''}`}
        aria-label="Measurements"
        title="Measure: distances, wall lengths, room areas"
        aria-haspopup="true"
        aria-expanded={open}
        data-active={active ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)}
      >
        <Ruler {...ICON} />
      </button>

      {open && (
        <div className="ui-pop measure-menu__pop" role="group" aria-label="Measurement tools">
          <button
            className="measure-menu__item"
            type="button"
            aria-pressed={measureMode}
            title="Measure distances by clicking two points on the floor plan"
            onClick={() => {
              // close first, so the next click goes to the canvas
              if (!measureMode) close();
              onToggleMeasure();
            }}
          >
            <Ruler {...ICON} />
            Measure Distance
          </button>
          <button
            className="measure-menu__item"
            type="button"
            aria-pressed={showWallLengths}
            onClick={onToggleWallLengths}
          >
            <span className="measure-menu__check" aria-hidden />
            Show Wall Lengths
          </button>
          <button
            className="measure-menu__item"
            type="button"
            aria-pressed={showRoomAreas}
            onClick={onToggleRoomAreas}
          >
            <span className="measure-menu__check" aria-hidden />
            Show Room Areas
          </button>
          <div className="measure-menu__sep" />
          <button
            className="measure-menu__item"
            type="button"
            onClick={onClearMeasurements}
            disabled={!hasMeasurements}
          >
            <Trash2 {...ICON} />
            Clear Measurements
          </button>
        </div>
      )}
    </div>
  );
}

/** "Click two points · Esc to cancel" + Exit Measurement Mode, under the canvas controls while measuring. */
export function MeasureHint({ onExit }) {
  return (
    <div className="measure-hint" role="status">
      <span>Click two points · Esc to cancel</span>
      <button className="ui-btn" type="button" onClick={onExit}>
        <X {...ICON} />
        Exit Measurement Mode
      </button>
    </div>
  );
}

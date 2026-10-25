/**
 * ui/CanvasCard.jsx
 *
 * The rounded card that holds the 3D view. Top-right: Export, 2D | 3D and Fit view.
 * Shows the empty state ("Build your workplace") while the layout has no rooms.
 * The <canvas> and the overlays are passed in as children so the canvas
 * element is never re-created (Babylon is bound to it).
 */

import { Boxes, Maximize2, Plus, Ruler, Trash2, X } from 'lucide-react';
import ExportMenu from './ExportMenu';

export default function CanvasCard({
  children,
  preview,          // true in Preview: the card fills the window, no Studio controls
  is3D,
  onSetView,        // (want3D: boolean) => void
  onFitView,
  showEmpty,
  onAddFirstRoom,
  // Export
  onExportPng,
  onExportPdf,
  exportDisabled,   // true when there are no rooms
  exportLoading,    // true while export is running
  measureMode,
  onToggleMeasure,
  onExitMeasure,
  onClearMeasurements,
  hasMeasurements,
  showWallLengths,
  onToggleWallLengths,
  showRoomAreas,
  onToggleRoomAreas,
}) {
  return (
    <section className={`canvas-card${preview ? ' is-preview' : ''}`} aria-label="Workplace view">
      {children}

      {!preview && (
        <div className="canvas-card__controls">
          <ExportMenu
            onExportPng={onExportPng}
            onExportPdf={onExportPdf}
            disabled={exportDisabled}
            loading={exportLoading}
          />
          <div className="ui-segmented" role="group" aria-label="View">
            <button aria-label="2D view" title="2D view from above" aria-pressed={!is3D} onClick={() => onSetView(false)}>2D</button>
            <button aria-label="3D view" title="3D view" aria-pressed={is3D} onClick={() => onSetView(true)}>3D</button>
          </div>
          <button className="ui-icon-btn canvas-card__fit" aria-label="Fit view" title="Fit view: show the whole floor" onClick={onFitView}>
            <Maximize2 size={18} strokeWidth={1.75} />
          </button>
        </div>
      )}

      {!preview && (
        <div className="measurement-controls" aria-label="Measurement tools">
          <button
            className="ui-btn"
            type="button"
            aria-pressed={measureMode}
            onClick={onToggleMeasure}
            title="Measure distances by clicking two points on the floor plan"
          >
            <Ruler size={16} aria-hidden />
            Measure Distance
          </button>
          {measureMode && (
            <>
              <span className="measurement-controls__hint">Click two points · Esc to cancel</span>
              <button className="ui-btn" type="button" onClick={onExitMeasure}>
                <X size={16} aria-hidden />
                Exit Measurement Mode
              </button>
            </>
          )}
          <button
            className="ui-btn measurement-controls__toggle"
            type="button"
            aria-pressed={showWallLengths}
            onClick={onToggleWallLengths}
          >
            Show Wall Lengths
          </button>
          <button
            className="ui-btn measurement-controls__toggle"
            type="button"
            aria-pressed={showRoomAreas}
            onClick={onToggleRoomAreas}
          >
            Show Room Areas
          </button>
          <button
            className="ui-btn"
            type="button"
            onClick={onClearMeasurements}
            disabled={!hasMeasurements}
          >
            <Trash2 size={16} aria-hidden />
            Clear Measurements
          </button>
        </div>
      )}

      {!preview && showEmpty && (
        <div className="empty-state">
          <Boxes size={40} strokeWidth={1.75} className="empty-state__icon" aria-hidden />
          <h2 className="empty-state__title">Build your workplace</h2>
          <p className="empty-state__text">Start by adding your first room to the workspace.</p>
          <button className="ui-btn is-primary empty-state__btn" aria-label="Add your first room" onClick={onAddFirstRoom}>
            <Plus size={18} strokeWidth={1.75} aria-hidden />
            Add your first room
          </button>
        </div>
      )}
    </section>
  );
}

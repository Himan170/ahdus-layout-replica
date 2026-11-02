/**
 * ui/CanvasCard.jsx
 *
 * The rounded card that holds the 3D view. Top-right: Export, Measure (not in Plan), 2D | 3D | Plan
 * and Fit view. The AHDUS look (`ahdus`): Export and Measure with their names, 2D | 3D | Plan and
 * Full screen top right; the camera card (`camera`, ui/CameraControls) top left; the floor switcher
 * and the hint (`footer`) along the bottom.
 * Plan = the floor plan (floorplan/FloorPlanView) in place of the 3D canvas.
 * Shows the empty state ("Build your workplace") while the layout has no rooms.
 * The <canvas> and the overlays are passed in as children so the canvas
 * element is never re-created (Babylon is bound to it).
 */

import { useEffect, useState } from 'react';
import { Boxes, Maximize2, Plus, Expand, Shrink } from 'lucide-react';
import ExportMenu from './ExportMenu';
import MeasureMenu, { MeasureHint } from './MeasureMenu';

/** Full screen for the whole page (the browser's Esc leaves it too). */
function FullScreenButton() {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  if (typeof document === 'undefined' || !document.fullscreenEnabled) return null;
  const label = on ? 'Exit full screen' : 'Full screen';
  return (
    <button className="ui-icon-btn canvas-card__full" aria-label={label} title={label}
      onClick={() => (on ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>
      {on ? <Shrink size={18} strokeWidth={1.75} aria-hidden /> : <Expand size={18} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}

export default function CanvasCard({
  children,
  ahdus = false,    // the AHDUS look's layout (see above)
  camera = null,    // AHDUS look: the camera card, top left (not in Plan view)
  footer = null,    // AHDUS look: floor switcher + hint, along the bottom
  preview,          // true in Preview: the card fills the window, no Studio controls
  is3D,
  onSetView,        // (want3D: boolean) => void
  planView,         // true while the floor plan is shown
  onSetPlan,        // () => void: show the floor plan
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
    <section className={`canvas-card${preview ? ' is-preview' : ''}${planView ? ' is-plan' : ''}`} aria-label="Workplace view">
      {children}

      {!preview && (
        <div className="canvas-card__controls">
          <ExportMenu
            onExportPng={onExportPng}
            onExportPdf={onExportPdf}
            disabled={exportDisabled}
            loading={exportLoading}
            label={ahdus ? 'Export' : undefined}
          />
          {!planView && (
            <MeasureMenu
              measureMode={measureMode}
              onToggleMeasure={onToggleMeasure}
              onClearMeasurements={onClearMeasurements}
              hasMeasurements={hasMeasurements}
              showWallLengths={showWallLengths}
              onToggleWallLengths={onToggleWallLengths}
              showRoomAreas={showRoomAreas}
              onToggleRoomAreas={onToggleRoomAreas}
              label={ahdus ? 'Measure' : undefined}
            />
          )}
          <div className="ui-segmented" role="group" aria-label="View">
            <button aria-label="2D view" title="2D view from above" aria-pressed={!planView && !is3D} onClick={() => onSetView(false)}>2D</button>
            <button aria-label="3D view" title="3D view" aria-pressed={!planView && is3D} onClick={() => onSetView(true)}>3D</button>
            <button aria-label="Plan view" title="Floor plan: rooms, walls, doors and items of this floor" aria-pressed={!!planView} onClick={onSetPlan}>Plan</button>
          </div>
          {ahdus ? <FullScreenButton /> : (
            <button className="ui-icon-btn canvas-card__fit" aria-label="Fit view" title="Fit view: show the whole floor" disabled={planView} onClick={onFitView}>
              <Maximize2 size={18} strokeWidth={1.75} />
            </button>
          )}
        </div>
      )}

      {!preview && !planView && camera}
      {!preview && footer}

      {!preview && !planView && measureMode && <MeasureHint onExit={onExitMeasure} />}

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

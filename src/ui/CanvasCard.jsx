/**
 * ui/CanvasCard.jsx
 *
 * The rounded card that holds the 3D view. Top-right: 2D | 3D and Fit view.
 * Shows the empty state ("Build your workplace") while the layout has no rooms.
 * The <canvas> and the overlays are passed in as children so the canvas
 * element is never re-created (Babylon is bound to it).
 */

import { Boxes, Maximize2, Plus } from 'lucide-react';

export default function CanvasCard({
  children,
  preview,          // true in Preview: the card fills the window, no Studio controls
  is3D,
  onSetView,        // (want3D: boolean) => void
  onFitView,
  showEmpty,
  onAddFirstRoom,
  hideCameraControls = false,
}) {
  return (
    <section className={`canvas-card${preview ? ' is-preview' : ''}`} aria-label="Workplace view">
      {children}

      {!preview && !hideCameraControls && (
        <div className="canvas-card__controls">
          <div className="ui-segmented" role="group" aria-label="View">
            <button aria-label="2D view" title="2D view from above" aria-pressed={!is3D} onClick={() => onSetView(false)}>2D</button>
            <button aria-label="3D view" title="3D view" aria-pressed={is3D} onClick={() => onSetView(true)}>3D</button>
          </div>
          <button className="ui-icon-btn canvas-card__fit" aria-label="Fit view" title="Fit view: show the whole floor" onClick={onFitView}>
            <Maximize2 size={18} strokeWidth={1.75} />
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

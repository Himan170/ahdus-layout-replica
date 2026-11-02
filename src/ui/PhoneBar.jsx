/**
 * ui/PhoneBar.jsx
 *
 * The AHDUS look on a phone: the row under the top bar, with the status (Saved · Unpublished)
 * and 2D | 3D | Plan (on a wider screen these are in the top bar and on the canvas).
 */

import { StatusPill } from './StudioHeader';

export default function PhoneBar({ saveStatus, saveError, publishState, onPublish, is3D, planView, onSetView, onSetPlan }) {
  return (
    <div className="phone-bar">
      <StatusPill saveStatus={saveStatus} saveError={saveError} publishState={publishState} onPublish={onPublish} short />
      <div className="ui-segmented phone-bar__views" role="group" aria-label="View">
        <button aria-label="2D view" aria-pressed={!planView && !is3D} onClick={() => onSetView(false)}>2D</button>
        <button aria-label="3D view" aria-pressed={!planView && is3D} onClick={() => onSetView(true)}>3D</button>
        <button aria-label="Plan view" aria-pressed={!!planView} onClick={onSetPlan}>Plan</button>
      </div>
    </div>
  );
}

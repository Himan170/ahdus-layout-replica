/**
 * ui/CameraControls.jsx
 *
 * The AHDUS look's camera card, top left of the canvas (not in Plan view): a view cube (click
 * Top, Front or Side), Reset view, Fit building, Zoom in / out, and Orbit / Pan (what the left
 * mouse button does). Every control has a tooltip with its key (WorkplaceEditor handles the
 * keys: tools.CAMERA_KEYS). On a phone (`compact`) only Reset view and Fit building show.
 * The camera moves themselves: utils/cameraControls.js.
 */

import { Home, Maximize, ZoomIn, ZoomOut, Rotate3d, Hand } from 'lucide-react';
import { CAMERA_KEYS } from './tools';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };

function CamButton({ label, tip = label, keyName, pressed, onClick, children, ...rest }) {
  return (
    <button className="cam-btn" aria-label={label} aria-keyshortcuts={keyName === '−' ? '-' : keyName}
      aria-pressed={pressed} onClick={onClick} {...rest}>
      {children}
      <span className="cam-tip" aria-hidden>{tip} <kbd>{keyName}</kbd></span>
    </button>
  );
}

const FACES = [
  { id: 'top', label: 'Top', points: '32,5 57,17.5 32,30 7,17.5', text: [32, 20] },
  { id: 'front', label: 'Front', points: '7,17.5 32,30 32,59 7,46.5', text: [19.5, 41] },
  { id: 'side', label: 'Side', points: '32,30 57,17.5 57,46.5 32,59', text: [44.5, 41] },
];

function ViewCube({ onView }) {
  return (
    <svg className="view-cube" viewBox="0 0 64 64" role="group" aria-label="View cube">
      {FACES.map((f) => (
        <g key={f.id} className={`view-cube__face is-${f.id}`} role="button" tabIndex={0}
          aria-label={`${f.label} view`} aria-keyshortcuts={CAMERA_KEYS[f.id]}
          onClick={() => onView(f.id)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onView(f.id); } }}>
          <title>{`${f.label} view (${CAMERA_KEYS[f.id]})`}</title>
          <polygon points={f.points} />
          <text x={f.text[0]} y={f.text[1]} textAnchor="middle">{f.label}</text>
        </g>
      ))}
    </svg>
  );
}

export default function CameraControls({ onView, onReset, onFit, onZoom, pan, onSetPan, fitDisabled = false, compact = false }) {
  if (compact) {
    return (
      <div className="camera-controls is-compact" role="toolbar" aria-label="Camera" aria-orientation="vertical">
        <CamButton label="Reset view" keyName={CAMERA_KEYS.reset} onClick={onReset}><Home {...ICON} size={20} /></CamButton>
        <CamButton label="Fit view" tip="Fit building" keyName={CAMERA_KEYS.fit} onClick={onFit} disabled={fitDisabled}><Maximize {...ICON} size={20} /></CamButton>
      </div>
    );
  }
  return (
    <div className="camera-controls" role="toolbar" aria-label="Camera">
      <ViewCube onView={onView} />
      <div className="camera-controls__grid">
        <CamButton label="Reset view" keyName={CAMERA_KEYS.reset} onClick={onReset}><Home {...ICON} /></CamButton>
        {/* "Fit view" stays its label (tests and the classic look use it); the tooltip says what it shows */}
        <CamButton label="Fit view" tip="Fit building" keyName={CAMERA_KEYS.fit} onClick={onFit} disabled={fitDisabled}><Maximize {...ICON} /></CamButton>
        <CamButton label="Zoom in" keyName={CAMERA_KEYS.zoomIn} onClick={() => onZoom(1)}><ZoomIn {...ICON} /></CamButton>
        <CamButton label="Zoom out" keyName={CAMERA_KEYS.zoomOut} onClick={() => onZoom(-1)}><ZoomOut {...ICON} /></CamButton>
        <CamButton label="Orbit" keyName={CAMERA_KEYS.orbit} pressed={!pan} onClick={() => onSetPan(false)}><Rotate3d {...ICON} /></CamButton>
        <CamButton label="Pan" keyName={CAMERA_KEYS.pan} pressed={pan} onClick={() => onSetPan(true)}><Hand {...ICON} /></CamButton>
      </div>
    </div>
  );
}

/**
 * ui/StudioShell.jsx
 *
 * Page layout of Workplace Studio:
 *   header (64 px), banner (a phone: PhoneBar)
 *   main:  [tool rail + library] [canvas 1fr] [Inspector 320 px, 0 when closed]
 * (the floor switcher and the hint are on the canvas: StudioFooter)
 * In Preview only the canvas card is shown, filling the window. The children
 * keep their positions in both modes, so the canvas is never re-created.
 */

import './studio.css';
import './ahdus.css';

export default function StudioShell({ preview, header, banner, buildPanel, canvas, inspector, inspectorOpen }) {
  return (
    <div className={`studio${preview ? ' is-preview' : ''}`}>
      {preview ? null : header}
      {preview ? null : banner}
      <div className="studio-main">
        {preview ? null : <div className="studio-build-col">{buildPanel}</div>}
        {canvas}
        {preview ? null : (
          <div className={`studio-inspector-col${inspectorOpen ? ' is-open' : ''}`} aria-hidden={!inspectorOpen}>
            {inspector}
          </div>
        )}
      </div>
    </div>
  );
}

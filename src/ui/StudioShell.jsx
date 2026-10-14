/**
 * ui/StudioShell.jsx
 *
 * Page layout of Workplace Studio:
 *   header (56 px)
 *   main:  [Build panel 168 px] [canvas card 1fr] [Inspector 320 px, 0 when closed]
 *   footer (44 px)
 * In Preview only the canvas card is shown, filling the window. The children
 * keep their positions in both modes, so the canvas is never re-created.
 */

import './studio.css';

export default function StudioShell({ preview, header, buildPanel, canvas, inspector, inspectorOpen, footer }) {
  return (
    <div className={`studio${preview ? ' is-preview' : ''}`}>
      {preview ? null : header}
      <div className="studio-main">
        {preview ? null : <div className="studio-build-col">{buildPanel}</div>}
        {canvas}
        {preview ? null : (
          <div className={`studio-inspector-col${inspectorOpen ? ' is-open' : ''}`} aria-hidden={!inspectorOpen}>
            {inspector}
          </div>
        )}
      </div>
      {preview ? null : footer}
    </div>
  );
}

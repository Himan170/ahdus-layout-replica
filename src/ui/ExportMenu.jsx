/**
 * ui/ExportMenu.jsx
 *
 * Dropdown menu with "Export PNG" and "Export PDF" actions.
 * Placed inside the CanvasCard controls overlay (top-right corner of the
 * canvas) when the editor is in 2D Studio mode (not Preview / Play).
 *
 * Props:
 *   onExportPng  () => Promise<void>
 *   onExportPdf  () => Promise<void>
 *   disabled     boolean   — true when there are no rooms to export
 *   loading      boolean   — true while an export is in progress
 */

import { useRef, useState } from 'react';
import { FileDown, FileImage, FileText, Loader2 } from 'lucide-react';
import { usePopover } from './usePopover';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };

export default function ExportMenu({ onExportPng, onExportPdf, disabled, loading }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const close   = () => setOpen(false);
  usePopover(open, close, [wrapRef]);

  const handlePng = async () => {
    close();
    await onExportPng?.();
  };

  const handlePdf = async () => {
    close();
    await onExportPdf?.();
  };

  return (
    <div className="export-menu" ref={wrapRef}>
      <button
        id="export-menu-trigger"
        className="ui-icon-btn export-menu__trigger"
        aria-label="Export floor plan"
        title={disabled ? 'Add rooms before exporting' : 'Export floor plan (PNG or PDF)'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled || loading}
        onClick={() => { if (!disabled && !loading) setOpen((v) => !v); }}
      >
        {loading
          ? <Loader2 size={16} strokeWidth={1.75} className="export-menu__spinner" aria-hidden />
          : <FileDown size={16} strokeWidth={1.75} aria-hidden />
        }
      </button>

      {open && (
        <div className="ui-pop export-menu__pop" role="menu" aria-label="Export options">
          <button
            id="export-png-btn"
            role="menuitem"
            className="export-menu__item"
            onClick={handlePng}
          >
            <FileImage {...ICON} className="export-menu__item-icon" />
            <span className="export-menu__item-text">
              <span className="export-menu__item-label">Export PNG</span>
              <span className="export-menu__item-detail">High-resolution image</span>
            </span>
          </button>

          <button
            id="export-pdf-btn"
            role="menuitem"
            className="export-menu__item"
            onClick={handlePdf}
          >
            <FileText {...ICON} className="export-menu__item-icon" />
            <span className="export-menu__item-text">
              <span className="export-menu__item-label">Export PDF</span>
              <span className="export-menu__item-detail">Print-ready A4 document</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * ui/TabNotice.jsx
 *
 * Banner at the top of the canvas when this layout is open in more than one tab
 * (services/apiService.js watches the other tabs):
 *   - "This layout was changed in another tab": saving has stopped so neither tab
 *     loses work. Reload (load theirs) or Save mine as a copy.
 *   - "Also open in another tab": a small note; changes in both would clash.
 * And when the browser's storage is almost full: export layouts, delete old ones.
 */

import { AlertTriangle, Copy, Download, Info, RotateCcw } from 'lucide-react';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };

export default function TabNotice({ conflict, openElsewhere, storageNearlyFull, onReload, onSaveCopy, onExport }) {
  if (conflict) {
    return (
      <div className="tab-notice is-bad" role="alertdialog" aria-label="Changed in another tab">
        <AlertTriangle {...ICON} />
        <p className="tab-notice__text">This layout was changed in another tab</p>
        <button className="ui-btn" aria-label="Reload" title="Load the other tab's version (your changes here are lost)"
          onClick={onReload}>
          <RotateCcw {...ICON} /> Reload
        </button>
        <button className="ui-btn is-primary" aria-label="Save mine as a copy" title="Keep your version as a new layout"
          onClick={onSaveCopy}>
          <Copy {...ICON} /> Save mine as a copy
        </button>
      </div>
    );
  }
  if (storageNearlyFull) {
    return (
      <div className="tab-notice is-bad" role="alert" aria-label="Storage almost full">
        <AlertTriangle {...ICON} />
        <p className="tab-notice__text">Browser storage is almost full. Export your layouts and delete old ones.</p>
        {onExport && (
          <button className="ui-btn" aria-label="Export this layout" onClick={onExport}>
            <Download {...ICON} /> Export
          </button>
        )}
      </div>
    );
  }
  if (openElsewhere) {
    return (
      <div className="tab-notice" role="status" aria-label="Also open in another tab">
        <Info {...ICON} />
        <p className="tab-notice__text">Also open in another tab</p>
      </div>
    );
  }
  return null;
}

/**
 * react/StudioPanel.jsx
 *
 * Workplace Studio as <LayoutEditor mode="edit" /> shows it: the editor with
 * its look (ui/theme.css) and its error card. Loaded only when an editor is
 * shown (LayoutEditor imports it lazily), so a page with only viewers never
 * loads Studio's code.
 */

import WorkplaceEditor from '../../components/WorkplaceEditor';
import EditorErrorBoundary from '../../ui/EditorErrorBoundary';
import '../../ui/theme.css';

export default function StudioPanel({ onExit }) {
  return (
    <EditorErrorBoundary onBack={onExit}>
      <WorkplaceEditor onExit={onExit} />
    </EditorErrorBoundary>
  );
}

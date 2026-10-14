/**
 * App.jsx
 *
 * Root application component.
 * Starts with CompanySelector for tenant/layout selection, then shows the
 * WorkplaceEditor once a layout is chosen. Leaving the editor goes back to
 * that company's layout list. If the editor fails, an error card with
 * "Back to layouts" is shown instead of a blank page.
 */

import { useState, useCallback } from 'react';
import CompanySelector from './components/CompanySelector';
import WorkplaceEditor from './components/WorkplaceEditor';
import EditorErrorBoundary from './ui/EditorErrorBoundary';
import { useWorkspaceStore } from './store/workspaceStore';
import { stopAutoSave } from './services/apiService';

export default function App() {
  const [view, setView] = useState('selector'); // 'selector' | 'editor'
  const [company, setCompany] = useState(null); // { id, name } whose layouts to list
  const [openCount, setOpenCount] = useState(0); // a fresh editor (and error boundary) per opening

  const handleEnterEditor = useCallback((c) => {
    if (c) setCompany(c);
    setOpenCount((n) => n + 1);
    setView('editor');
  }, []);

  const handleExitEditor = useCallback(() => {
    setView('selector');
  }, []);

  // After a crash: save anything still pending, then leave
  const handleBackAfterError = useCallback(() => {
    stopAutoSave();
    useWorkspaceStore.getState().resetWorkspace();
    setView('selector');
  }, []);

  if (view === 'editor') {
    return (
      <EditorErrorBoundary key={openCount} onBack={handleBackAfterError}>
        <WorkplaceEditor onExit={handleExitEditor} />
      </EditorErrorBoundary>
    );
  }

  return <CompanySelector onEnterEditor={handleEnterEditor} initialCompany={company} />;
}

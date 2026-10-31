/**
 * App.jsx
 *
 * Root application component.
 * Starts with CompanySelector for tenant/layout selection, then shows the
 * WorkplaceEditor once a layout is chosen. Leaving the editor goes back to
 * that company's layout list. If the editor fails, an error card with
 * "Back to layouts" is shown instead of a blank page.
 *
 * AHDUS mode (VITE_LAYOUT_BACKEND=ahdus): no companies screen. The site in the
 * address (?site=<id>) opens straight in Workplace Studio; leaving goes back to
 * AHDUS (AHDUS_HOME). Not logged in (no token, or the load answers 401): the
 * browser goes to AHDUS's login page, which comes back here afterwards.
 */

import { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import CompanySelector from './components/CompanySelector';
import WorkplaceEditor from './components/WorkplaceEditor';
import EditorErrorBoundary from './ui/EditorErrorBoundary';
import { useWorkspaceStore } from './store/workspaceStore';
import { loadWorkspace, stopAutoSave } from './services/apiService';
import { isAhdusBackendOn } from './services/backendFlags';
import { AHDUS_COMPANY, AHDUS_HOME, siteFromUrl, hasLoginToken, goToLogin } from './services/ahdusBackend';

function backToAhdus() {
  window.location.assign(AHDUS_HOME);
}

/** Workplace Studio on one AHDUS site: opening… / the editor / why it can't open. */
function AhdusStudio() {
  const [site] = useState(siteFromUrl);
  const [status, setStatus] = useState(site ? { state: 'loading' } : { state: 'error', error: 'No workplace was chosen.' });

  useEffect(() => {
    if (!site) return undefined;
    const toLogin = () => { setStatus({ state: 'login' }); goToLogin(); };
    if (!hasLoginToken()) { toLogin(); return undefined; }
    let cancelled = false;
    loadWorkspace(AHDUS_COMPANY, site).then(
      () => { if (!cancelled) setStatus({ state: 'open' }); },
      (err) => {
        if (cancelled) return;
        if (err?.loginExpired) toLogin();
        else setStatus({ state: 'error', error: err?.message ?? String(err) });
      },
    );
    return () => { cancelled = true; };
  }, [site]);

  const handleBackAfterError = useCallback(() => {
    stopAutoSave();
    useWorkspaceStore.getState().resetWorkspace();
    backToAhdus();
  }, []);

  if (status.state === 'open') {
    return (
      <EditorErrorBoundary onBack={handleBackAfterError} backLabel="Back to AHDUS">
        <WorkplaceEditor onExit={backToAhdus} />
      </EditorErrorBoundary>
    );
  }
  if (status.state === 'loading' || status.state === 'login') {
    return (
      <div className="editor-error ui-muted" role="status">
        {status.state === 'login' ? 'Taking you to the AHDUS login…' : 'Opening the workplace…'}
      </div>
    );
  }
  return (
    <div className="editor-error" role="alert">
      <div className="editor-error__card">
        <AlertTriangle size={28} strokeWidth={1.75} aria-hidden className="editor-error__icon" />
        <h1 className="editor-error__title">This workplace could not be opened</h1>
        <p className="editor-error__text">{status.error}</p>
        <button className="ui-btn is-primary" onClick={backToAhdus}>
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Back to AHDUS
        </button>
      </div>
    </div>
  );
}

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

  if (isAhdusBackendOn()) return <AhdusStudio />;

  if (view === 'editor') {
    return (
      <EditorErrorBoundary key={openCount} onBack={handleBackAfterError}>
        <WorkplaceEditor onExit={handleExitEditor} />
      </EditorErrorBoundary>
    );
  }

  return <CompanySelector onEnterEditor={handleEnterEditor} initialCompany={company} />;
}

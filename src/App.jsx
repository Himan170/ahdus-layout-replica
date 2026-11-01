/**
 * App.jsx
 *
 * Root application component.
 * Starts with CompanySelector for tenant/layout selection, then shows the
 * WorkplaceEditor once a layout is chosen. Leaving the editor goes back to
 * that company's layout list. If the editor fails, an error card with
 * "Try again" and "Back to layouts" is shown instead of a blank page.
 *
 * Opening the editor shows the loading screen (ui/StudioSplash.jsx) until the layout
 * is loaded and the editor has drawn its first full frame (onFirstFrame).
 *
 * AHDUS mode (VITE_LAYOUT_BACKEND=ahdus): no companies screen. The site in the
 * address (?site=<id>) opens straight in Workplace Studio; leaving goes back to
 * AHDUS (AHDUS_HOME). Not logged in (no token, or the load answers 401): the
 * browser goes to AHDUS's login page, which comes back here afterwards. A load that
 * fails, or takes longer than LOAD_TIMEOUT_MS, turns the loading screen into the
 * error card with "Try again".
 */

import { useState, useCallback, useEffect } from 'react';
import CompanySelector from './components/CompanySelector';
import WorkplaceEditor from './components/WorkplaceEditor';
import EditorErrorBoundary from './ui/EditorErrorBoundary';
import StudioSplash from './ui/StudioSplash';
import { useWorkspaceStore } from './store/workspaceStore';
import { loadWorkspace, stopAutoSave } from './services/apiService';
import { isAhdusBackendOn } from './services/backendFlags';
import { AHDUS_COMPANY, AHDUS_HOME, siteFromUrl, hasLoginToken, goToLogin } from './services/ahdusBackend';

function backToAhdus() {
  window.location.assign(AHDUS_HOME);
}

/** AHDUS has this long to send the layout before "Try again" is offered. */
export const LOAD_TIMEOUT_MS = 45_000;
const TOO_SLOW = 'AHDUS is taking too long to answer. Check your connection and try again.';

/** Workplace Studio on one AHDUS site: the loading screen / the editor / why it can't open. */
function AhdusStudio() {
  const [site] = useState(siteFromUrl);
  const [status, setStatus] = useState(site ? { state: 'loading' } : { state: 'error', error: 'No workplace was chosen.' });
  const [attempt, setAttempt] = useState(0); // "Try again" loads once more
  const [splash, setSplash] = useState('loading'); // 'done' after the editor's first frame

  useEffect(() => {
    if (!site) return undefined;
    const toLogin = () => { setStatus({ state: 'login' }); goToLogin(); };
    if (!hasLoginToken()) { toLogin(); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      cancelled = true;
      setStatus({ state: 'error', error: TOO_SLOW });
    }, LOAD_TIMEOUT_MS);
    loadWorkspace(AHDUS_COMPANY, site).then(
      () => { if (!cancelled) setStatus({ state: 'open' }); },
      (err) => {
        if (cancelled) return;
        if (err?.loginExpired) toLogin();
        else setStatus({ state: 'error', error: err?.message ?? String(err) });
      },
    ).finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [site, attempt]);

  const handleBackAfterError = useCallback(() => {
    stopAutoSave();
    useWorkspaceStore.getState().resetWorkspace();
    backToAhdus();
  }, []);
  const handleRetry = useCallback(() => {
    setStatus({ state: 'loading' });
    setSplash('loading');
    setAttempt((n) => n + 1);
  }, []);

  if (status.state === 'error') {
    return (
      <StudioSplash
        phase="error"
        ahdus
        errorTitle="This workplace could not be opened"
        error={status.error}
        onRetry={site ? handleRetry : null}
        onBack={backToAhdus}
        backLabel="Back to AHDUS"
      />
    );
  }
  return (
    <>
      {status.state === 'open' && (
        <EditorErrorBoundary key={attempt} onBack={handleBackAfterError} backLabel="Back to AHDUS"
          onError={() => setSplash('done')} onRetry={handleRetry}>
          <WorkplaceEditor onExit={backToAhdus} onFirstFrame={() => setSplash('done')} />
        </EditorErrorBoundary>
      )}
      <StudioSplash
        phase={status.state === 'open' ? splash : 'loading'}
        ahdus
        text={status.state === 'login' ? 'Taking you to the AHDUS login…' : 'Opening Workplace Studio…'}
      />
    </>
  );
}

export default function App() {
  const [view, setView] = useState('selector'); // 'selector' | 'editor'
  const [company, setCompany] = useState(null); // { id, name } whose layouts to list
  const [openCount, setOpenCount] = useState(0); // a fresh editor (and error boundary) per opening
  const [splash, setSplash] = useState('loading'); // 'done' after the editor's first frame

  const handleEnterEditor = useCallback((c) => {
    if (c) setCompany(c);
    setOpenCount((n) => n + 1);
    setSplash('loading');
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
  // After a crash: open the same layout again (a new editor)
  const handleRetry = useCallback(() => {
    setOpenCount((n) => n + 1);
    setSplash('loading');
  }, []);

  if (isAhdusBackendOn()) return <AhdusStudio />;

  if (view === 'editor') {
    return (
      <>
        <EditorErrorBoundary key={openCount} onBack={handleBackAfterError}
          onError={() => setSplash('done')} onRetry={handleRetry}>
          <WorkplaceEditor onExit={handleExitEditor} onFirstFrame={() => setSplash('done')} />
        </EditorErrorBoundary>
        <StudioSplash key={`splash-${openCount}`} phase={splash} />
      </>
    );
  }

  return <CompanySelector onEnterEditor={handleEnterEditor} initialCompany={company} />;
}

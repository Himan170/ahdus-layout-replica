/**
 * viewer/main.jsx — the blank test page for <LayoutViewer /> (viewer.html)
 *
 *   http://localhost:3000/viewer.html                      the sample company, walking through
 *   …/viewer.html?mode=view                                orbit instead
 *   …/viewer.html?companyId=…&layoutId=…                   a layout saved in this browser
 *   …/viewer.html?demoModules=1                            with the teammates' demo modules
 *
 * Only the viewer, a mode switch and a live list of the bridge's events and
 * anchors: no Workplace Studio code is loaded (e2e/viewer-smoke.mjs checks).
 */

import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { LayoutViewer } from '../engine/react/LayoutViewer';
import { layoutBridge } from '../integration/layoutBridge';
import { SAMPLE_LAYOUT } from './sampleLayout';

const params = new URLSearchParams(window.location.search);
const companyId = params.get('companyId') ?? undefined;
const layoutId = params.get('layoutId') ?? undefined;
const layout = companyId && layoutId ? undefined : SAMPLE_LAYOUT;
const EVENTS = ['enterRoom', 'exitRoom', 'interact'];

if (params.has('demoModules')) {
  import('../integration/demoModules').then((m) => m.installDemoModules(layoutBridge));
}

function describe(event, p) {
  if (event === 'interact') return `${p.object?.label ?? p.kind}${p.anchorKind ? ` (${p.anchorKind})` : ''}`;
  return p.room?.name ?? p.roomId;
}

function ViewerPage() {
  const [mode, setMode] = useState(params.get('mode') === 'view' ? 'view' : 'walkthrough');
  const [log, setLog] = useState([]);
  const [anchors, setAnchors] = useState([]);

  // Everything the bridge tells modules, as they get it
  useEffect(() => {
    const offs = EVENTS.map((event) => layoutBridge.on(event, (payload) => {
      if (import.meta.env.DEV) (window.__viewerEvents ??= []).push({ event, payload });
      setLog((l) => [{ event, text: describe(event, payload), at: new Date().toLocaleTimeString() }, ...l].slice(0, 30));
    }));
    offs.push(layoutBridge.on('anchorsChange', ({ anchors: list }) => setAnchors(list)));
    return () => offs.forEach((off) => off());
  }, []);

  const onReady = useCallback((engine) => {
    setAnchors(layoutBridge.getAnchors());
    if (import.meta.env.DEV) {
      // for tests and the console (as in Studio)
      window.__ahdusViewer = engine;
      window.__ahdusScene = engine.scene;
      window.ahdus = layoutBridge;
    }
  }, []);
  const onCard = useCallback((card) => {
    if (import.meta.env.DEV) (window.__ahdusCards ??= []).push({ title: card.title, text: card.body ?? card.text ?? '' });
  }, []);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <strong>AHDUS viewer</strong>
        <span style={{ opacity: 0.7 }}>{layout ? 'Sample company' : `Saved layout ${layoutId}`}</span>
        <span style={{ flex: 1 }} />
        {[['view', 'View'], ['walkthrough', 'Walk through']].map(([m, label]) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
            style={{ ...styles.button, ...(mode === m ? styles.on : {}) }}>
            {label}
          </button>
        ))}
      </header>
      <main style={styles.main}>
        <LayoutViewer
          layout={layout} companyId={companyId} layoutId={layoutId} mode={mode}
          onReady={onReady} onCard={onCard} style={{ flex: 1, minWidth: 0 }}
        />
        <aside style={styles.aside} aria-label="Bridge events">
          <h2 style={styles.h2}>Events</h2>
          <ol style={styles.list} data-viewer-log>
            {log.length === 0 && <li style={{ opacity: 0.6 }}>Walk into a room, or press E on something.</li>}
            {log.map((e, i) => <li key={i}><code>{e.event}</code> {e.text} <span style={{ opacity: 0.6 }}>{e.at}</span></li>)}
          </ol>
          <h2 style={styles.h2}>Hook points ({anchors.length})</h2>
          <ul style={styles.list}>
            {anchors.map((a) => (
              <li key={a.id}><code>{a.kind}</code> {a.label ?? layoutBridge.getObject(a.objectId)?.label ?? a.objectId} · floor {a.floorId}</li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', font: '14px/1.4 Inter, system-ui, sans-serif', color: '#0f172a', background: '#f8fafc' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid #e2e8f0', background: '#fff' },
  button: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, padding: '4px 12px', font: 'inherit', cursor: 'pointer' },
  on: { background: '#1e40af', border: '1px solid #1e40af', color: '#fff' },
  main: { flex: 1, display: 'flex', minHeight: 0 },
  aside: { width: 300, maxWidth: '40%', overflowY: 'auto', borderLeft: '1px solid #e2e8f0', background: '#fff', padding: '8px 16px' },
  h2: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7, margin: '12px 0 6px' },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4, fontSize: 13 },
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ViewerPage />
  </StrictMode>,
);

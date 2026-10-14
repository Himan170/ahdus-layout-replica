/**
 * CompanySelector.jsx
 *
 * Entry screen for the Digital Workplace Editor.
 * Lets the user select or create a company (tenant), then pick or
 * create a workspace layout to edit. Supports layout versioning
 * (save snapshots, restore previous versions).
 *
 * Phase 4 — Multi-Tenant & Data Sync
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  loadWorkspace,
  createWorkspace,
  listLayouts,
  deleteLayout,
  exportLayout,
  importLayout,
  storageUse,
} from '../services/apiService';
import { downloadText } from '../ui/download';

const mb = (chars) => (chars / 1_000_000).toFixed(1);

/** "14 Oct, 10:42" (or "Never saved") */
function formatEdited(iso) {
  if (!iso) return 'Never saved';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never saved';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function CompanySelector({ onEnterEditor, initialCompany = null }) {
  const [step, setStep] = useState('company'); // 'company' | 'layout'
  const [companyName, setCompanyName] = useState('');
  const [companyId, setCompanyId] = useState(null);
  const [layouts, setLayouts] = useState([]);
  const [newLayoutName, setNewLayoutName] = useState('');
  const [savedCompanies, setSavedCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // layout id waiting for "Delete?" confirmation

  // Load saved companies from localStorage on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('dwtwin_companies') || '[]');
      setSavedCompanies(stored);
    } catch {
      setSavedCompanies([]);
    }
  }, []);

  // Save a company to the local list
  const _persistCompany = useCallback((id, name) => {
    const companies = JSON.parse(localStorage.getItem('dwtwin_companies') || '[]');
    if (!companies.find((c) => c.id === id)) {
      companies.push({ id, name, createdAt: new Date().toISOString() });
      localStorage.setItem('dwtwin_companies', JSON.stringify(companies));
      setSavedCompanies(companies);
    }
  }, []);

  // ─── Select an existing company ───
  const handleSelectCompany = useCallback(async (id, name) => {
    setCompanyId(id);
    setCompanyName(name);
    setLoading(true);
    setError(null);
    try {
      const list = await listLayouts(id);
      setLayouts(list);
      setStep('layout');
    } catch (err) {
      setError('Failed to load layouts: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Create a new company ───
  const handleCreateCompany = useCallback(() => {
    if (!companyName.trim()) return;
    const id = `company_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    _persistCompany(id, companyName.trim());
    handleSelectCompany(id, companyName.trim());
  }, [companyName, _persistCompany, handleSelectCompany]);

  // ─── Open an existing layout ───
  const handleOpenLayout = useCallback(async (layoutId) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadWorkspace(companyId, layoutId);
      if (!loaded) {
        setError('This layout no longer exists.');
        setLayouts(await listLayouts(companyId));
        return;
      }
      onEnterEditor({ id: companyId, name: companyName });
    } catch (err) {
      console.error('[CompanySelector] could not open layout', layoutId, err);
      setError('This layout could not be opened: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId, companyName, onEnterEditor]);

  // ─── Create a new layout ───
  const handleCreateLayout = useCallback(async () => {
    const name = newLayoutName.trim() || 'Untitled Layout';
    setLoading(true);
    try {
      await createWorkspace(companyId, name);
      _persistCompany(companyId, companyName);
      onEnterEditor({ id: companyId, name: companyName });
    } catch (err) {
      setError('Failed to create layout: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId, companyName, newLayoutName, _persistCompany, onEnterEditor]);

  // ─── Delete a layout (after "Delete?" is confirmed) ───
  const handleDeleteLayout = useCallback(async (layoutId) => {
    setConfirmDelete(null);
    try {
      await deleteLayout(companyId, layoutId);
      setLayouts(await listLayouts(companyId));
    } catch (err) {
      setError('Failed to delete: ' + err.message);
    }
  }, [companyId]);

  // ─── Backup: export a layout as a file / add one from a file ───
  const importRef = useRef(null);
  const [notice, setNotice] = useState(null);
  const [storage, setStorage] = useState(() => storageUse());
  const handleExportLayout = useCallback(async (layoutId) => {
    try {
      const { fileName, text } = await exportLayout(companyId, layoutId);
      downloadText(fileName, text);
    } catch (err) {
      setError(err.message);
    }
  }, [companyId]);
  const handleImportFile = useCallback(async (file) => {
    setError(null);
    try {
      const { name } = await importLayout(companyId, await file.text());
      setLayouts(await listLayouts(companyId));
      setNotice(`Added "${name}"`);
    } catch (err) {
      setError(err.message);
    }
  }, [companyId]);
  useEffect(() => { setStorage(storageUse()); }, [layouts]);

  // Coming back from the editor: show that company's layouts again
  useEffect(() => {
    if (initialCompany?.id) handleSelectCompany(initialCompany.id, initialCompany.name);
  }, [initialCompany, handleSelectCompany]);

  // ─── Back to company selection ───
  const handleBack = useCallback(() => {
    setStep('company');
    setCompanyId(null);
    setLayouts([]);
    setError(null);
  }, []);

  // ─── Render ───
  return (
    <div style={styles.backdrop}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.logo}>AHDUS</span>
          <span style={styles.subtitle}>Digital Workplace Engine</span>
        </div>

        {error && (
          <div style={styles.errorBanner}>{error}</div>
        )}

        {step === 'company' ? (
          <>
            <h2 style={styles.heading}>Select Company</h2>

            {/* Saved companies */}
            {savedCompanies.length > 0 && (
              <div style={styles.listSection}>
                {savedCompanies.map((c) => (
                  <button
                    key={c.id}
                    style={styles.listItem}
                    onClick={() => handleSelectCompany(c.id, c.name)}
                    disabled={loading}
                  >
                    <span style={styles.listIcon}>🏢</span>
                    <span style={styles.listLabel}>{c.name}</span>
                    <span style={styles.listArrow}>→</span>
                  </button>
                ))}
              </div>
            )}

            <div style={styles.divider}>
              <span style={styles.dividerText}>or create new</span>
            </div>

            <div style={styles.inputRow}>
              <input
                style={styles.input}
                placeholder="Company name…"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCompany()}
                disabled={loading}
              />
              <button
                style={styles.primaryButton}
                onClick={handleCreateCompany}
                disabled={loading || !companyName.trim()}
              >
                Create
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={styles.breadcrumb}>
              <button style={styles.backButton} onClick={handleBack}>← Back</button>
              <span style={styles.breadcrumbText}>{companyName}</span>
            </div>

            <h2 style={styles.heading}>Workspace Layouts</h2>

            {storage.nearlyFull && (
              <div style={styles.errorBanner} role="alert" aria-label="Storage almost full">
                Browser storage is almost full ({mb(storage.used)} of {mb(storage.quota)} MB).
                Export your layouts to keep a copy, then delete old ones.
              </div>
            )}
            {notice && <div style={styles.noticeBanner} role="status">{notice}</div>}

            {layouts.length > 0 ? (
              <div style={styles.listSection}>
                {layouts.map((l) => (confirmDelete === l.id ? (
                  <div key={l.id} style={styles.confirmRow} role="alertdialog" aria-label={`Delete ${l.name}?`}>
                    <span style={styles.confirmText}>Delete “{l.name}”? This can’t be undone.</span>
                    <button style={styles.dangerButton} onClick={() => handleDeleteLayout(l.id)}>Delete</button>
                    <button style={styles.cancelButton} onClick={() => setConfirmDelete(null)} autoFocus>Cancel</button>
                  </div>
                ) : (
                  <div key={l.id} style={styles.layoutItem} data-layout-id={l.id}>
                    <button
                      style={styles.listItem}
                      onClick={() => handleOpenLayout(l.id)}
                      disabled={loading}
                      aria-label={`Open ${l.name}`}
                    >
                      <span style={styles.listIcon}>📐</span>
                      <div style={styles.layoutInfo}>
                        <span style={styles.listLabel}>{l.name}</span>
                        <span style={styles.layoutMeta} data-layout-meta>
                          {l.broken
                            ? 'This save is damaged and can’t be opened'
                            : `Edited ${formatEdited(l.updatedAt)} · ${plural(l.rooms, 'room')} · ${plural(l.floors, 'floor')}`}
                        </span>
                      </div>
                      <span style={styles.listArrow}>→</span>
                    </button>
                    {!l.broken && (
                      <button
                        style={styles.deleteButton}
                        onClick={() => handleExportLayout(l.id)}
                        title="Export: download this layout as a file (a backup)"
                        aria-label={`Export ${l.name}`}
                      >
                        ⤓
                      </button>
                    )}
                    <button
                      style={styles.deleteButton}
                      onClick={() => setConfirmDelete(l.id)}
                      title="Delete layout"
                      aria-label={`Delete ${l.name}`}
                    >
                      ✕
                    </button>
                  </div>
                )))}
              </div>
            ) : (
              <p style={styles.emptyText}>No layouts yet. Create one to get started.</p>
            )}

            <button style={styles.cancelButton} aria-label="Import layout" title="Add a layout from an exported file"
              onClick={() => importRef.current?.click()}>
              Import layout…
            </button>
            <input ref={importRef} type="file" accept=".json,application/json" hidden aria-label="Import layout file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) handleImportFile(file);
              }} />

            <div style={styles.divider}>
              <span style={styles.dividerText}>new layout</span>
            </div>

            <div style={styles.inputRow}>
              <input
                style={styles.input}
                placeholder="Layout name…"
                value={newLayoutName}
                onChange={(e) => setNewLayoutName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateLayout()}
                disabled={loading}
              />
              <button
                style={styles.primaryButton}
                onClick={handleCreateLayout}
                disabled={loading}
              >
                {loading ? '…' : 'Create'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───
const styles = {
  backdrop: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0a0c10 0%, #141824 100%)',
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  },
  card: {
    width: 420,
    maxHeight: '80vh',
    overflowY: 'auto',
    background: '#12151c',
    borderRadius: 12,
    border: '1px solid #1e2330',
    padding: '32px 28px',
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 28,
  },
  logo: {
    color: '#6c8cff',
    fontWeight: 700,
    fontSize: 20,
    letterSpacing: 2,
  },
  subtitle: {
    color: '#556677',
    fontSize: 12,
  },
  heading: {
    color: '#c0ccdd',
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 14,
    marginTop: 0,
  },
  errorBanner: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#2a1520',
    border: '1px solid #442030',
    color: '#e88',
    fontSize: 12,
    marginBottom: 14,
  },
  noticeBanner: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#15202a',
    border: '1px solid #20384a',
    color: '#9cd',
    fontSize: 12,
    marginBottom: 14,
  },
  listSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 12,
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    background: '#1a1e2a',
    border: '1px solid transparent',
    borderRadius: 6,
    cursor: 'pointer',
    color: '#c0ccdd',
    fontSize: 13,
    textAlign: 'left',
    width: '100%',
    transition: 'all 0.15s',
  },
  listIcon: {
    fontSize: 16,
    flexShrink: 0,
  },
  listLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  listArrow: {
    color: '#556677',
    fontSize: 14,
    flexShrink: 0,
  },
  layoutItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  layoutInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  layoutMeta: {
    fontSize: 10,
    color: '#556677',
    marginTop: 2,
  },
  deleteButton: {
    background: 'none',
    border: 'none',
    color: '#556677',
    fontSize: 14,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 4,
    flexShrink: 0,
  },
  confirmRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: '#2a1520',
    border: '1px solid #442030',
    borderRadius: 6,
  },
  confirmText: {
    flex: 1,
    color: '#e8c0c8',
    fontSize: 12,
  },
  dangerButton: {
    padding: '6px 12px',
    background: '#c94a4a',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  cancelButton: {
    padding: '6px 12px',
    background: 'none',
    border: '1px solid #2a3040',
    borderRadius: 6,
    color: '#c0ccdd',
    fontSize: 12,
    cursor: 'pointer',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '16px 0',
  },
  dividerText: {
    color: '#3a4a5e',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    whiteSpace: 'nowrap',
  },
  inputRow: {
    display: 'flex',
    gap: 8,
  },
  input: {
    flex: 1,
    padding: '9px 12px',
    background: '#1a1e2a',
    border: '1px solid #2a3040',
    borderRadius: 6,
    color: '#c0ccdd',
    fontSize: 13,
    outline: 'none',
  },
  primaryButton: {
    padding: '9px 18px',
    background: '#4a6cff',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#6c8cff',
    fontSize: 13,
    cursor: 'pointer',
    padding: 0,
  },
  breadcrumbText: {
    color: '#8899b0',
    fontSize: 13,
  },
  emptyText: {
    color: '#556677',
    fontSize: 13,
    textAlign: 'center',
    padding: '20px 0',
  },
};

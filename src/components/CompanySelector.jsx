/**
 * CompanySelector.jsx
 *
 * Entry screen: pick or create a company, then open, create, export, import
 * or delete one of its layouts. Companies can be renamed and deleted (with
 * all their layouts, after confirming). Same look as Workplace Studio
 * (ui/theme.css tokens, lucide icons; styles in ui/selector.css).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Building2, ChevronRight, ArrowLeft, Plus, Pencil, Trash2, Download, Upload, LayoutGrid, AlertTriangle, Check,
} from 'lucide-react';
import { LAYOUT_TEMPLATES } from '../templates';
import {
  loadWorkspace,
  createWorkspace,
  listLayouts,
  deleteLayout,
  exportLayout,
  importLayout,
  storageUse,
  listCompanies,
  addCompany,
  renameCompany,
  deleteCompany,
  countLayouts,
} from '../services/apiService';
import { downloadText } from '../ui/download';
import '../ui/selector.css';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };

/** "14 Oct, 10:42" (or "Never saved") */
function formatEdited(iso) {
  if (!iso) return 'Never saved';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never saved';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const mb = (chars) => (chars / 1_000_000).toFixed(1);
const BLANK_TEMPLATE = {
  id: 'blank',
  name: 'Start from Blank Layout',
  description: 'Begin with an empty floor and add rooms, walls and furniture yourself.',
  layout: { floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } }, rooms: [], objects: [], anchorData: {} },
};

function TemplatePreview({ layout }) {
  const rooms = layout?.rooms ?? [];
  if (!rooms.length) {
    return (
      <svg className="template-card__preview" viewBox="0 0 120 72" aria-hidden="true">
        <rect x="7" y="7" width="106" height="58" rx="4" className="template-preview__blank" />
        <path d="M20 22h18M20 29h30M20 36h13M20 43h24" className="template-preview__grid" />
      </svg>
    );
  }
  const minX = Math.min(...rooms.map((room) => room.x - room.width / 2));
  const maxX = Math.max(...rooms.map((room) => room.x + room.width / 2));
  const minZ = Math.min(...rooms.map((room) => room.z - room.depth / 2));
  const maxZ = Math.max(...rooms.map((room) => room.z + room.depth / 2));
  const scale = Math.min(104 / (maxX - minX), 56 / (maxZ - minZ));
  const offsetX = (120 - (maxX - minX) * scale) / 2;
  const offsetY = (72 - (maxZ - minZ) * scale) / 2;
  return (
    <svg className="template-card__preview" viewBox="0 0 120 72" aria-hidden="true">
      {rooms.map((room) => (
        <rect
          key={room.id}
          x={offsetX + (room.x - room.width / 2 - minX) * scale}
          y={offsetY + (maxZ - room.z - room.depth / 2) * scale}
          width={Math.max(2, room.width * scale)}
          height={Math.max(2, room.depth * scale)}
          rx="1"
          fill={room.color ?? '#4a7dff'}
          className="template-preview__room"
        />
      ))}
    </svg>
  );
}

/** "Delete …? This can't be undone." with Delete / Cancel. */
function ConfirmRow({ label, text, onConfirm, onCancel }) {
  return (
    <div className="selector-row is-confirm" role="alertdialog" aria-label={label}>
      <AlertTriangle {...ICON} className="selector-row__warn" />
      <span className="selector-row__text">{text}</span>
      <button className="ui-btn" onClick={onCancel} autoFocus>Cancel</button>
      <button className="ui-btn is-danger" onClick={onConfirm}>Delete</button>
    </div>
  );
}

/** Name box + Create (Enter works too). */
function CreateRow({ placeholder, value, onChange, onCreate, disabled, canCreate = true }) {
  return (
    <div className="selector-create">
      <input
        className="ui-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && canCreate && onCreate()}
        disabled={disabled}
      />
      <button className="ui-btn is-primary" onClick={onCreate} disabled={disabled || !canCreate}>
        <Plus {...ICON} /> Create
      </button>
    </div>
  );
}

export default function CompanySelector({ onEnterEditor, initialCompany = null }) {
  const [step, setStep] = useState('company'); // 'company' | 'layout'
  const [companyName, setCompanyName] = useState('');   // the open company's name
  const [newCompanyName, setNewCompanyName] = useState('');
  const [companyId, setCompanyId] = useState(null);
  const [layouts, setLayouts] = useState([]);
  const [newLayoutName, setNewLayoutName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('blank');
  const [companies, setCompanies] = useState(() => listCompanies());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);  // layout id waiting for "Delete?"
  const [confirmCompany, setConfirmCompany] = useState(null); // company id waiting for "Delete?"
  const [renaming, setRenaming] = useState(null);             // { id, name } of the company being renamed
  const [storage, setStorage] = useState(() => storageUse());
  const importRef = useRef(null);

  const refreshCompanies = useCallback(() => setCompanies(listCompanies()), []);

  // ─── Select an existing company ───
  const handleSelectCompany = useCallback(async (id, name) => {
    setCompanyId(id);
    setCompanyName(name);
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      setLayouts(await listLayouts(id));
      setStep('layout');
    } catch (err) {
      setError('Failed to load layouts: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Create a new company ───
  const handleCreateCompany = useCallback(() => {
    if (!newCompanyName.trim()) return;
    const c = addCompany(newCompanyName);
    refreshCompanies();
    setNewCompanyName('');
    handleSelectCompany(c.id, c.name);
  }, [newCompanyName, refreshCompanies, handleSelectCompany]);

  // ─── Rename / delete a company ───
  const handleRenameCompany = useCallback(() => {
    if (renaming?.name.trim()) renameCompany(renaming.id, renaming.name);
    setRenaming(null);
    refreshCompanies();
  }, [renaming, refreshCompanies]);
  const handleDeleteCompany = useCallback((id) => {
    deleteCompany(id);
    setConfirmCompany(null);
    refreshCompanies();
    setStorage(storageUse());
  }, [refreshCompanies]);

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
    const finalName = newLayoutName.trim() || 'Untitled Layout';
    const template = selectedTemplateId === 'blank'
      ? BLANK_TEMPLATE
      : LAYOUT_TEMPLATES.find((item) => item.id === selectedTemplateId);
    if (!template) {
      setError('The selected layout template is unavailable.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await createWorkspace(companyId, finalName, template.id === 'blank' ? null : template.layout);
      onEnterEditor({ id: companyId, name: companyName });
    } catch (err) {
      setError('Failed to create layout: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId, companyName, newLayoutName, selectedTemplateId, onEnterEditor]);

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
    setNotice(null);
    setSelectedTemplateId('blank');
    refreshCompanies();
  }, [refreshCompanies]);

  // ─── Render ───
  return (
    <div className="selector">
      <div className={`selector-card${step === 'layout' ? ' selector-card--templates' : ''}`}>
        <header className="selector-card__brand">
          <Building2 size={22} strokeWidth={1.75} aria-hidden />
          <span className="selector-card__logo">AHDUS</span>
          <span className="ui-muted">Workplace Studio</span>
        </header>

        {error && <div className="selector-banner is-bad" role="alert">{error}</div>}
        {notice && <div className="selector-banner" role="status"><Check {...ICON} /> {notice}</div>}
        {storage.nearlyFull && (
          <div className="selector-banner is-bad" role="alert" aria-label="Storage almost full">
            <AlertTriangle {...ICON} />
            <span>
              Browser storage is almost full ({mb(storage.used)} of {mb(storage.quota)} MB).
              Export your layouts to keep a copy, then delete old ones.
            </span>
          </div>
        )}

        {step === 'company' ? (
          <>
            <h2 className="selector-card__title">Companies</h2>

            {companies.length > 0 ? (
              <ul className="selector-list">
                {companies.map((c) => (
                  <li key={c.id}>
                    {confirmCompany === c.id ? (
                      <ConfirmRow
                        label={`Delete ${c.name}?`}
                        text={`Delete “${c.name}” and its ${plural(countLayouts(c.id), 'layout')}? This can’t be undone.`}
                        onConfirm={() => handleDeleteCompany(c.id)}
                        onCancel={() => setConfirmCompany(null)}
                      />
                    ) : renaming?.id === c.id ? (
                      <div className="selector-row is-editing">
                        <Building2 {...ICON} className="selector-row__icon" />
                        <input
                          className="ui-input"
                          aria-label="Company name"
                          value={renaming.name}
                          autoFocus
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameCompany();
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                        />
                        <button className="ui-btn is-primary" onClick={handleRenameCompany}>Save</button>
                      </div>
                    ) : (
                      <div className="selector-row">
                        <button
                          className="selector-row__main"
                          onClick={() => handleSelectCompany(c.id, c.name)}
                          disabled={loading}
                        >
                          <Building2 {...ICON} className="selector-row__icon" />
                          <span className="selector-row__name">{c.name}</span>
                          <ChevronRight {...ICON} className="selector-row__go" />
                        </button>
                        <button className="ui-icon-btn" aria-label={`Rename company ${c.name}`} title="Rename"
                          onClick={() => setRenaming({ id: c.id, name: c.name })}>
                          <Pencil {...ICON} />
                        </button>
                        <button className="ui-icon-btn is-danger" aria-label={`Delete company ${c.name}`}
                          title="Delete the company and its layouts" onClick={() => setConfirmCompany(c.id)}>
                          <Trash2 {...ICON} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="selector-empty ui-muted">No companies yet. Create one to start.</p>
            )}

            <p className="ui-section-title selector-card__section">New company</p>
            <CreateRow
              placeholder="Company name…"
              value={newCompanyName}
              onChange={setNewCompanyName}
              onCreate={handleCreateCompany}
              disabled={loading}
              canCreate={!!newCompanyName.trim()}
            />
          </>
        ) : (
          <>
            <button className="ui-btn is-ghost selector-back" onClick={handleBack}>
              <ArrowLeft {...ICON} /> All companies
            </button>
            <h2 className="selector-card__title">
              Workspace Layouts <span className="ui-muted">· {companyName}</span>
            </h2>

            {layouts.length > 0 ? (
              <ul className="selector-list">
                {layouts.map((l) => (
                  <li key={l.id}>
                    {confirmDelete === l.id ? (
                      <ConfirmRow
                        label={`Delete ${l.name}?`}
                        text={`Delete “${l.name}”? This can’t be undone.`}
                        onConfirm={() => handleDeleteLayout(l.id)}
                        onCancel={() => setConfirmDelete(null)}
                      />
                    ) : (
                      <div className="selector-row" data-layout-id={l.id}>
                        <button
                          className="selector-row__main"
                          onClick={() => handleOpenLayout(l.id)}
                          disabled={loading}
                          aria-label={`Open ${l.name}`}
                        >
                          <LayoutGrid {...ICON} className="selector-row__icon" />
                          <span className="selector-row__info">
                            <span className="selector-row__name">{l.name}</span>
                            <span className={`selector-row__meta${l.broken ? ' is-bad' : ''}`} data-layout-meta>
                              {l.broken
                                ? 'This save is damaged and can’t be opened'
                                : `Edited ${formatEdited(l.updatedAt)} · ${plural(l.rooms, 'room')} · ${plural(l.floors, 'floor')}`}
                            </span>
                          </span>
                          <ChevronRight {...ICON} className="selector-row__go" />
                        </button>
                        {!l.broken && (
                          <button className="ui-icon-btn" aria-label={`Export ${l.name}`}
                            title="Export: download this layout as a file (a backup)" onClick={() => handleExportLayout(l.id)}>
                            <Download {...ICON} />
                          </button>
                        )}
                        <button className="ui-icon-btn is-danger" aria-label={`Delete ${l.name}`} title="Delete layout"
                          onClick={() => setConfirmDelete(l.id)}>
                          <Trash2 {...ICON} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="selector-empty ui-muted">No layouts yet. Create one to get started.</p>
            )}

            <button className="ui-btn is-ghost selector-import" aria-label="Import layout"
              title="Add a layout from an exported file (.ahdus.json)" onClick={() => importRef.current?.click()}>
              <Upload {...ICON} /> Import layout…
            </button>
            <input ref={importRef} type="file" accept=".json,application/json" hidden aria-label="Import layout file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) handleImportFile(file);
              }} />

            <p className="ui-section-title selector-card__section">New layout</p>
            <p className="template-picker__intro">Choose a starting point</p>
            <div className="template-picker" role="radiogroup" aria-label="Layout template">
              {[BLANK_TEMPLATE, ...LAYOUT_TEMPLATES].map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="template-card"
                  role="radio"
                  aria-checked={selectedTemplateId === template.id}
                  aria-label={template.name}
                  onClick={() => setSelectedTemplateId(template.id)}
                  disabled={loading}
                >
                  <TemplatePreview layout={template.layout} />
                  <span className="template-card__content">
                    <span className="template-card__name">{template.name}</span>
                    <span className="template-card__description">{template.description}</span>
                  </span>
                  <span className="template-card__check" aria-hidden>
                    {selectedTemplateId === template.id && <Check {...ICON} />}
                  </span>
                </button>
              ))}
            </div>
            <CreateRow
              placeholder="Layout name…"
              value={newLayoutName}
              onChange={setNewLayoutName}
              onCreate={handleCreateLayout}
              disabled={loading}
              canCreate={!!newLayoutName.trim()}
            />
          </>
        )}
      </div>
    </div>
  );
}

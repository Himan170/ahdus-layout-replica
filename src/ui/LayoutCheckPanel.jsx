import { useEffect } from 'react';
import { ClipboardCheck, Check, X } from 'lucide-react';
import './layoutCheck.css';

export function CheckButton({ checks = { open: false, count: 0 }, onClick }) {
  return <button className="ui-icon-btn ui-labeled-btn check-button" aria-label="Check layout" aria-expanded={checks.open}
    title={`Check my layout: ${checks.count} problems`} onClick={onClick}>
    <ClipboardCheck size={18} aria-hidden />
    {checks.count > 0 ? <span className="check-badge">{checks.count}</span> : <Check className="check-ok" size={12} aria-label="No problems" />}
    <span className="ui-labeled-btn__label">Check</span>
  </button>;
}

export default function LayoutCheckPanel({ checks, floors, inspectorOpen, onSelect, onIgnore, onClose }) {
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  const ignored = checks.problems.filter((p) => checks.ignored.includes(p.key));
  const row = (p, hidden = false) => <li key={p.key} data-check-kind={p.kind} className={`check-row is-${p.severity}`}>
    <button className="check-message" onClick={() => onSelect(p)}>{p.message}</button>
    <button className="ui-btn" onClick={() => onIgnore(p.key, !hidden)}>{hidden ? 'Show again' : 'Ignore'}</button>
  </li>;
  const ids = [...new Set(checks.visible.map((p) => p.floorId))];
  return <section className={`ui-pop layout-check${inspectorOpen ? ' has-inspector' : ''}`} role="dialog" aria-label="Check my layout">
    <div className="layout-check__head"><h2>Check my layout</h2><button className="ui-icon-btn" aria-label="Close layout check" onClick={onClose}><X size={18} /></button></div>
    <p role="status">{checks.count ? `${checks.count} ${checks.count === 1 ? 'problem' : 'problems'} to look at` : 'No problems found'}</p>
    <p className="ui-muted">You can always save and publish. Click a problem to find it.</p>
    <div className="layout-check__list">
      {ids.map((id) => <section key={id}><h3>{floors[id]?.name ?? 'Building'}</h3><ul>{checks.visible.filter((p) => p.floorId === id).map((p) => row(p))}</ul></section>)}
      {ignored.length > 0 && <details><summary>Ignored ({ignored.length})</summary><ul>{ignored.map((p) => row(p, true))}</ul></details>}
    </div>
    <span className="ui-muted">Checked in {Math.round(checks.ms)} ms</span>
  </section>;
}

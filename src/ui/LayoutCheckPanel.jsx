import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Check, X, Wrench } from 'lucide-react';
import './layoutCheck.css';

export function CheckButton({ checks = { open: false, count: 0 }, onClick }) {
  const ignored = checks.ignoredCount ?? 0;
  return <button className="ui-icon-btn ui-labeled-btn check-button" aria-label="Check layout" aria-expanded={checks.open}
    title={`Check my layout: ${checks.count} ${checks.count === 1 ? 'problem' : 'problems'}${ignored ? `, ${ignored} ignored` : ''}`} onClick={onClick}>
    <ClipboardCheck size={18} aria-hidden />
    {checks.count > 0 ? <span className="check-badge">{checks.count}</span> : <Check className="check-ok" size={12} aria-label="No problems" />}
    <span className="ui-labeled-btn__label">Check</span>
  </button>;
}

/** Why ignoring a problem that stops people walking is asked once more (v0.17.4). */
export const IGNORE_WALKING_TEXT = "People can't walk there while this is wrong. Ignore it anyway?";

/**
 * Check my layout (v0.15.3). v0.17.4: "Fix it" on what a move can fix (one undo step), "N ignored · Show",
 * and ignoring a problem that stops people walking asks once to confirm.
 */
export default function LayoutCheckPanel({ checks, floors, inspectorOpen, onSelect, onIgnore, onFix, onClose }) {
  const [asking, setAsking] = useState(null); // the key of a walking problem whose Ignore waits for a yes
  const [showIgnored, setShowIgnored] = useState(false);
  const ignoredRef = useRef(null);
  useEffect(() => {
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (asking) setAsking(null);
      else onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose, asking]);
  const ignored = checks.problems.filter((p) => checks.ignored.includes(p.key));
  const ignore = (p, on) => {
    if (on && p.blocksWalking && asking !== p.key) { setAsking(p.key); return; }
    setAsking(null);
    onIgnore(p.key, on);
  };
  const row = (p, hidden = false) => <li key={p.key} data-check-kind={p.kind} data-check-key={p.key} data-blocks-walking={p.blocksWalking ? '' : undefined}
    className={`check-row is-${p.severity}`}>
    <button className="check-message" onClick={() => onSelect(p)}>{p.message}</button>
    {p.fix && onFix && <button className="ui-btn is-primary check-fix" data-check-fix onClick={() => onFix(p)} title={p.fix.label}>
      <Wrench size={14} aria-hidden /> {p.kind === 'THIN_GAP' || p.kind === 'ITEM_IN_WALL' ? p.fix.label : 'Fix it'}</button>}
    <button className="ui-btn" onClick={() => ignore(p, !hidden)} data-check-ignore>{hidden ? 'Show again' : 'Ignore'}</button>
    {asking === p.key && <div className="check-confirm" role="alertdialog" aria-label="Ignore this problem?" data-check-confirm>
      <p>{IGNORE_WALKING_TEXT}</p>
      <button className="ui-btn is-danger" onClick={() => ignore(p, true)} data-check-confirm-yes>Ignore anyway</button>
      <button className="ui-btn" onClick={() => setAsking(null)} autoFocus>Cancel</button>
    </div>}
  </li>;
  const ids = [...new Set(checks.visible.map((p) => p.floorId))];
  const openIgnored = () => {
    setShowIgnored(true);
    requestAnimationFrame(() => ignoredRef.current?.scrollIntoView?.({ block: 'nearest' }));
  };
  return <section className={`ui-pop layout-check${inspectorOpen ? ' has-inspector' : ''}`} role="dialog" aria-label="Check my layout">
    <div className="layout-check__head"><h2>Check my layout</h2><button className="ui-icon-btn" aria-label="Close layout check" onClick={onClose}><X size={18} /></button></div>
    <p role="status">{checks.count ? `${checks.count} ${checks.count === 1 ? 'problem' : 'problems'} to look at` : 'No problems found'}
      {ignored.length > 0 && <span className="check-ignored-note" data-check-ignored={ignored.length}>
        {' · '}{ignored.length} ignored <button className="ui-link-btn" onClick={openIgnored} data-check-show-ignored>Show</button>
      </span>}
    </p>
    <p className="ui-muted">You can always save and publish. Click a problem to find it.</p>
    <div className="layout-check__list">
      {ids.map((id) => <section key={id}><h3>{floors[id]?.name ?? 'Building'}</h3><ul>{checks.visible.filter((p) => p.floorId === id).map((p) => row(p))}</ul></section>)}
      {ignored.length > 0 && <details ref={ignoredRef} open={showIgnored} onToggle={(e) => setShowIgnored(e.currentTarget.open)} data-check-ignored-list>
        <summary>Ignored ({ignored.length})</summary><ul>{ignored.map((p) => row(p, true))}</ul></details>}
    </div>
    <span className="ui-muted">Checked in {Math.round(checks.ms)} ms</span>
  </section>;
}

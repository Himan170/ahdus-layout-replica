/**
 * ui/ShortcutsPopover.jsx
 *
 * The keyboard shortcuts of Workplace Studio (tools.SHORTCUT_GROUPS), opened from the
 * AHDUS look's tool rail. Esc or a click outside closes it.
 */

import { useRef } from 'react';
import { X } from 'lucide-react';
import { SHORTCUT_GROUPS } from './tools';
import { usePopover } from './usePopover';

export default function ShortcutsPopover({ onClose, anchorRef }) {
  const ref = useRef(null);
  usePopover(true, onClose, [ref, anchorRef]);
  return (
    <div className="ui-pop shortcuts-pop" ref={ref} role="dialog" aria-label="Keyboard shortcuts">
      <div className="shortcuts-pop__head">
        <h2 className="shortcuts-pop__title">Keyboard shortcuts</h2>
        <button className="ui-icon-btn" aria-label="Close shortcuts" title="Close (Esc)" onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
      <div className="shortcuts-pop__groups">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="ui-section-title">{g.title}</h3>
            <dl className="shortcuts-pop__list">
              {g.keys.map(([keys, what]) => (
                <div key={`${keys.join('+')}-${what}`} className="shortcuts-pop__row">
                  <dt>{keys.map((k, i) => (
                    <span key={k}>{i > 0 && ' + '}<kbd className="ui-kbd">{k}</kbd></span>
                  ))}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * ui/CatalogPicker.jsx
 *
 * Search box + category chips + a grid of items: the catalog (B) in Preview.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { isComposing } from '../utils/keys';

const ALL = '__all__';

/**
 * @param {{
 *   sections: Array<{ title: string, items: object[] }>,
 *   itemKey: (item) => string,
 *   iconFor: (item) => React.ComponentType,
 *   pictureFor?: (item) => React.ReactNode | null,   // a picture instead of the icon (v0.15.2: as Studio's library)
 *   isActive?: (item) => boolean,
 *   onPick: (item) => void,
 *   onDragStart?: (item, event) => void,   // set → items can be dragged onto the canvas
 *   autoFocus?: boolean,
 *   compact?: boolean,                      // small size (2 columns)
 * }} props
 */
export default function CatalogPicker({
  sections, itemKey, iconFor, pictureFor = null, isActive = () => false, onPick, onDragStart, autoFocus = false, compact = false,
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const searchRef = useRef(null);

  // Focus the search box one tick later: when a key opened this (B, 6), that
  // key must not end up typed into the search
  useEffect(() => {
    if (!autoFocus) return undefined;
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sections
      .filter((s) => category === ALL || s.title === category)
      .map((s) => ({
        ...s,
        items: s.items.filter((i) => !q || i.label.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)),
      }))
      .filter((s) => s.items.length > 0);
  }, [sections, query, category]);

  return (
    <div className={`catalog${compact ? ' catalog--compact' : ''}`}>
      <div className="catalog__search">
        <Search size={16} strokeWidth={1.75} aria-hidden />
        <input
          type="text"
          placeholder="Search"
          aria-label="Search items"
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Esc clears the search first
            if (e.key === 'Escape' && query && !isComposing(e)) { e.stopPropagation(); setQuery(''); }
          }}
        />
        {query && (
          <button className="ui-icon-btn catalog__clear" aria-label="Clear search" title="Clear search" onClick={() => setQuery('')}>
            <X size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="catalog__chips" role="group" aria-label="Categories">
        {[ALL, ...sections.map((s) => s.title)].map((c) => (
          <button key={c} className="catalog__chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
            {c === ALL ? 'All' : c}
          </button>
        ))}
      </div>

      <div className="catalog__list">
        {shown.length === 0 && <p className="catalog__empty ui-muted">Nothing matches “{query}”.</p>}
        {shown.map((section) => (
          <section key={section.title}>
            {(category === ALL) && <h3 className="ui-section-title catalog__heading">{section.title}</h3>}
            <div className="catalog__grid">
              {section.items.map((item) => {
                const Icon = iconFor(item);
                const picture = pictureFor?.(item) ?? null;
                return (
                  <button
                    key={itemKey(item)}
                    className={`catalog__item${picture ? ' has-picture' : ''}`}
                    title={item.label}
                    aria-pressed={isActive(item)}
                    draggable={!!onDragStart}
                    onDragStart={onDragStart ? (e) => onDragStart(item, e) : undefined}
                    onClick={() => onPick(item)}
                  >
                    {picture
                      ? <span className="catalog__pic" aria-hidden>{picture}</span>
                      : Icon && <Icon size={20} strokeWidth={1.75} aria-hidden />}
                    <span>{item.label}</span>
                    {item.color && <span className="catalog__stripe" style={{ background: item.color }} />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

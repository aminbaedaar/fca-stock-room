import { useMemo, useState } from 'react';
import { fmtQty, itemLabel, matchesSearch, type Item } from '@fca/core';

/** Searchable item chooser ("glossy 1.27"). Keyboard: ↑ ↓ Enter. */
export function ItemPicker({ items, value, onChange, autoFocus }: { items: Item[]; value: string | null; onChange: (id: string) => void; autoFocus?: boolean }) {
  const selected = items.find((i) => i.id === value) ?? null;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => items.filter((i) => matchesSearch(i, query)).slice(0, 40), [items, query]);

  const choose = (i: Item) => {
    onChange(i.id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="picker">
      <input
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder="Type to search, e.g. glossy 1.27"
        value={open ? query : selected ? itemLabel(selected) : query}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault();
            choose(matches[active]);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="picker-list" role="listbox">
          {matches.length === 0 && <div className="muted small" style={{ padding: 10 }}>No matching items</div>}
          {matches.map((i, n) => (
            <button type="button" key={i.id} role="option" aria-selected={n === active} className={n === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
              <span>{itemLabel(i)}</span>
              <span className="muted small num">
                {fmtQty(i.qty)} {i.unit}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

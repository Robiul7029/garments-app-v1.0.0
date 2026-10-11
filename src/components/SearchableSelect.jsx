import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * A filterable dropdown.
 *
 * Used for the two places in the production workflow where a plain `<select>`
 * stops working once the factory has real data: picking a style/order out of
 * hundreds, and picking an operation out of an uploaded process sheet. Both need
 * type-to-filter, and both need to stay a single form control so they sit in the
 * existing form layout.
 *
 * Deliberate choices:
 *   - It is NOT a native `<select>`: a native control cannot be typed into, and
 *     the whole point is filtering a long list.
 *   - Keyboard is complete — ↑/↓ to move, Enter to choose, Esc to close — because
 *     a supervisor filling twenty forms a day will not use a mouse.
 *   - The current value stays visible as text in the box when closed, so the form
 *     still reads like a form and not like a search bar.
 *   - Clicking outside closes it; the listener is on `mousedown` so it fires
 *     before a click on the page behind can be swallowed.
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  emptyMessage = 'No matches',
  disabled = false,
  id,
  ariaLabel,
  // Lets a caller store a value but display a longer label (style -> "STY-1 — PO-9").
  renderOption,
  getOptionValue = (o) => (typeof o === 'string' ? o : o.value),
  getOptionLabel = (o) => (typeof o === 'string' ? o : o.label),
  getOptionHint = (o) => (typeof o === 'string' ? '' : o.hint || ''),
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selected = useMemo(
    () => options.find((o) => String(getOptionValue(o)) === String(value)) || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, value],
  );

  // What the closed control shows: the selected option's label, or the raw value
  // when the option is not in the list (a style whose order was deleted).
  const display = selected ? getOptionLabel(selected) : (value || '');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const label = String(getOptionLabel(o)).toLowerCase();
      const hint = String(getOptionHint(o)).toLowerCase();
      return label.includes(q) || hint.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query]);

  // Close on an outside press. `mousedown` rather than `click`, so it runs before
  // the underlying element handles the same gesture.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted row in view as the keyboard moves through a long list.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.children[highlight];
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function openList() {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setHighlight(Math.max(0, filtered.findIndex((o) => String(getOptionValue(o)) === String(value))));
  }

  function choose(option) {
    onChange(getOptionValue(option));
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) choose(filtered[highlight]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="ss-wrap" ref={boxRef}>
      {/* The closed control is a button, so a click anywhere on it opens the list
          rather than placing a text caret. Once open it swaps to a real input for
          filtering, which is the one case where typing matters. */}
      {!open ? (
        <button
          type="button"
          id={id}
          className={`ss-control${disabled ? ' ss-disabled' : ''}${display ? '' : ' ss-placeholder'}`}
          onClick={openList}
          onKeyDown={onKeyDown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={false}
          aria-label={ariaLabel}
        >
          <span className="ss-value">{display || placeholder}</span>
          <span className="ss-caret" aria-hidden="true">▾</span>
        </button>
      ) : (
        <input
          ref={(node) => {
            inputRef.current = node;
            if (node) node.focus();
          }}
          id={id}
          className="ss-control ss-input"
          value={query}
          placeholder={selected ? getOptionLabel(selected) : placeholder}
          onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded
          aria-label={ariaLabel}
          aria-autocomplete="list"
        />
      )}

      {open && (
        <ul className="ss-list" role="listbox" ref={listRef}>
          {filtered.length === 0 && <li className="ss-empty">{emptyMessage}</li>}
          {filtered.map((option, i) => {
            const optionValue = getOptionValue(option);
            const isSelected = String(optionValue) === String(value);
            const hint = getOptionHint(option);
            return (
              <li
                key={`${optionValue}-${i}`}
                role="option"
                aria-selected={isSelected}
                className={`ss-option${i === highlight ? ' ss-highlighted' : ''}${isSelected ? ' ss-selected' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(option); }}
              >
                <span className="ss-option-label">{renderOption ? renderOption(option) : getOptionLabel(option)}</span>
                {hint && <span className="ss-option-hint">{hint}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

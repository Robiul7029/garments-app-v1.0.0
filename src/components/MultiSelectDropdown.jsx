import React, { useEffect, useMemo, useRef, useState } from 'react';
import { splitValues, joinValues } from '../config/orderWorkflow';

/**
 * A searchable multi-select dropdown with checkboxes.
 *
 * The Colour and Size Range fields on Order Input both hold SEVERAL values chosen
 * from a known list, and both accept a value the list does not carry. A plain
 * text box makes a multi-value field easy to under-fill silently, and a native
 * `<select multiple>` is unusable on a factory tablet (ctrl-click to pick two).
 *
 * This control is the one shape that fits both:
 *   - a closed box that shows what is selected, with a counter badge beside it
 *   - a dropdown of CHECKBOXES so tapping toggles a value without losing the list
 *   - a search box that filters as you type
 *   - a free-text row so a colour or size the list does not carry can still be
 *     added, which is what keeps the control from ever blocking a real order
 *
 * The VALUE it reports is always the stored string form ("Navy, Black"), so every
 * existing reader of `row.color` / `row.size_range` is unaffected.
 */
export default function MultiSelectDropdown({
  value = '',
  onChange,
  options = [],
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  addLabel = 'Add',
  id,
  ariaLabel,
  disabled = false,
  // Styling hook so each field keeps its own tint (colour vs size).
  className = '',
  optionTone = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const boxRef = useRef(null);

  const selected = useMemo(() => splitValues(value), [value]);

  // The checkbox list is the standard options plus any selected value the list
  // does not carry, so a custom entry stays visible and removable rather than
  // disappearing the moment it is added.
  const allOptions = useMemo(() => {
    const known = new Set(options.map((o) => String(o).toLowerCase()));
    const extras = selected.filter((s) => !known.has(String(s).toLowerCase()));
    return [...options, ...extras];
  }, [options, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((o) => String(o).toLowerCase().includes(q));
  }, [allOptions, query]);

  const has = (option) => selected.some((s) => String(s).toLowerCase() === String(option).toLowerCase());

  /** Toggles one value, keeping the stored string form. */
  function toggle(option) {
    if (disabled) return;
    onChange(has(option)
      ? joinValues(selected.filter((s) => String(s).toLowerCase() !== String(option).toLowerCase()))
      : joinValues([...selected, option]));
  }

  function remove(option) {
    if (disabled) return;
    onChange(joinValues(selected.filter((s) => String(s).toLowerCase() !== String(option).toLowerCase())));
  }

  /** Adds whatever is typed — one value, or a comma/space separated list. */
  function addManual() {
    const parts = splitValues(draft);
    if (parts.length === 0) return;
    onChange(joinValues([...selected, ...parts]));
    setDraft('');
    setQuery('');
  }

  // Close on an outside press. `mousedown` so it runs before the page behind
  // can swallow the same gesture.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function onSearchKeyDown(e) {
    // Enter adds the typed text as a custom value rather than submitting the
    // enclosing order form — one field must never save a half-built order.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (draft.trim()) addManual();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={`msd-wrap${disabled ? ' msd-disabled' : ''} ${className}`.trim()} ref={boxRef}>
      {/* The closed control: a button so a click anywhere opens the list, with
          the chosen values shown as chips and the count as a badge beside it. */}
      <button
        type="button"
        id={id}
        className={`msd-control${open ? ' msd-open' : ''}`}
        onClick={() => { if (!disabled) { setOpen((o) => !o); setQuery(''); } }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="msd-values">
          {selected.length === 0 && <span className="msd-placeholder">{placeholder}</span>}
          {selected.map((item) => (
            <span className={`msd-chip ${optionTone}`.trim()} key={item}>
              <span className="msd-chip-label">{item}</span>
              {!disabled && (
                <span
                  className="msd-chip-remove"
                  role="button"
                  tabIndex={-1}
                  aria-label={`Remove ${item}`}
                  onClick={(e) => { e.stopPropagation(); remove(item); }}
                >
                  ×
                </span>
              )}
            </span>
          ))}
        </span>
        <span className="msd-caret" aria-hidden="true">▾</span>
      </button>

      {/* The counter box: the exact number selected, always visible next to the
          field so an under-filled order is obvious before it is saved. */}
      <span className="msd-counter" title={`${selected.length} selected`} aria-hidden="true">
        {selected.length}
      </span>

      {open && (
        <div className="msd-menu">
          <input
            className="msd-search"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            aria-label={`${ariaLabel} — search`}
          />

          <ul className="msd-list" role="listbox" aria-multiselectable="true">
            {filtered.length === 0 && <li className="msd-empty">No matches</li>}
            {filtered.map((option) => {
              const on = has(option);
              return (
                <li
                  key={option}
                  role="option"
                  aria-selected={on}
                  className={`msd-option${on ? ' msd-option-on' : ''} ${optionTone}`.trim()}
                  // Toggle on CLICK (not mousedown) and stop the event from
                  // reaching the enclosing control button. Toggling on mousedown
                  // re-rendered the row mid-gesture, so the browser delivered the
                  // follow-up click to the button underneath and snapped the menu
                  // shut after a single pick.
                  onClick={(e) => { e.stopPropagation(); toggle(option); }}
                >
                  <span className={`msd-checkbox${on ? ' msd-checkbox-on' : ''}`} aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                  <span className="msd-option-label">{option}</span>
                </li>
              );
            })}
          </ul>

          {/* Manual entry, so a value the list does not carry can still be set. */}
          {!disabled && (
            <div className="msd-add">
              <input
                className="msd-add-input"
                value={draft}
                placeholder={addLabel}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onSearchKeyDown}
                aria-label={`${ariaLabel} — add a custom value`}
              />
              <button type="button" className="btn btn-outline btn-sm" onClick={addManual}>
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

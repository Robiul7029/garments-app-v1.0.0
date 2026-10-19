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
 *
 * It forwards `className`, `aria-invalid` and a ref to the box that wraps the
 * control, so a caller can flag the field (an error outline + focus) without the
 * dropdown having to know anything about validation.
 *
 * MULTI-SELECT
 * ------------
 * `multiple` turns the same control into a tag/chip picker: options toggle
 * instead of closing the list, the chosen ones show as removable chips, and the
 * value the caller owns becomes an ARRAY. Kept deliberately in this one
 * component so the single- and multi-value pickers behave identically for
 * keyboard, click-outside and filtering — the three places a hand-rolled second
 * dropdown would drift.
 *
 * The multi-select list shows a real square CHECKBOX per option rather than a
 * bare tick: it is the shape a supervisor already associates with "tick several
 * of these", and a dropdown where the marks move position as the list filters is
 * hard to scan. The box is a presentational span, not an <input>, because the row
 * itself is the click target — a nested input would take the click and fight the
 * list's own focus handling.
 *
 * `onAddOption` adds a footer with a text box and an Add button, so a value that
 * is not in the list yet (a process the sheet missed) can be created without
 * leaving the form. The component does NOT add it to `options` itself — the
 * caller owns that list and where it is persisted — it just reports the value.
 */
const SearchableSelect = React.forwardRef(function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  emptyMessage = 'No matches',
  disabled = false,
  id,
  ariaLabel,
  className = '',
  ariaInvalid,
  // Multi-select: `value` is then an array and each pick toggles in place.
  multiple = false,
  // Multi-select only: adds a "type a new one and Add" row at the foot of the
  // list. Wired by the caller, which owns where the new value is stored.
  onAddOption,
  addPlaceholder = 'Add another…',
  addLabel = 'Add',
  // Lets a caller store a value but display a longer label (style -> "STY-1 — PO-9").
  renderOption,
  getOptionValue = (o) => (typeof o === 'string' ? o : o.value),
  getOptionLabel = (o) => (typeof o === 'string' ? o : o.label),
  getOptionHint = (o) => (typeof o === 'string' ? '' : o.hint || ''),
}, ref) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  // The text in the footer's "add a new one" box, kept apart from `query` so
  // typing there does not filter the list out from under the user.
  const [newValue, setNewValue] = useState('');
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // The chosen values, normalised to an array so the single- and multi-select
  // paths below can share one membership test.
  const chosen = useMemo(
    () => (multiple
      ? (Array.isArray(value) ? value : (value ? [value] : []))
      : (value === undefined || value === null || value === '' ? [] : [value])),
    [multiple, value],
  );

  const selected = useMemo(
    () => options.find((o) => String(getOptionValue(o)) === String(chosen[0])) || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, chosen],
  );

  const isChosen = (optionValue) => chosen.some((v) => String(v) === String(optionValue));

  // What the closed control shows. Multi-select shows chips, so there is no
  // single label to fall back to; single-select shows the option's label, or the
  // raw value when the option is not in the list (a style whose order was
  // deleted).
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
    setNewValue('');
    setHighlight(Math.max(0, filtered.findIndex((o) => String(getOptionValue(o)) === String(value))));
  }

  /** Reports a brand-new value upward; the caller decides where it is stored. */
  function addNewOption() {
    const value = newValue.trim();
    if (!value || !onAddOption) return;
    onAddOption(value);
    setNewValue('');
  }

  function choose(option) {
    const optionValue = getOptionValue(option);
    if (multiple) {
      // Toggle, and keep the list open so several processes can be ticked in one
      // visit — closing on the first pick would make multi-select a chore.
      const next = isChosen(optionValue)
        ? chosen.filter((v) => String(v) !== String(optionValue))
        : [...chosen, optionValue];
      onChange(next);
      setQuery('');
      setHighlight(0);
      return;
    }
    onChange(optionValue);
    setOpen(false);
    setQuery('');
  }

  /** Drops one chip without having to reopen the list. */
  function removeChip(optionValue) {
    onChange(chosen.filter((v) => String(v) !== String(optionValue)));
  }

  function onKeyDown(e) {
    if (disabled) return;
    // In multi-select, Enter on the closed control opens the list rather than
    // submitting the form — a supervisor ticking five processes should not save
    // the entry on the third one.
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
    <div className={`ss-wrap${className ? ` ${className}` : ''}`} ref={boxRef}>
      {/* The closed control is a button, so a click anywhere on it opens the list
          rather than placing a text caret. Once open it swaps to a real input for
          filtering, which is the one case where typing matters. */}
      {!open ? (
        <button
          type="button"
          id={id}
          className={`ss-control${disabled ? ' ss-disabled' : ''}${multiple ? ' ss-multi' : ''}${display || chosen.length ? '' : ' ss-placeholder'}`}
          onClick={openList}
          onKeyDown={onKeyDown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={false}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid || undefined}
          ref={ref}
        >
          {multiple && chosen.length > 0 ? (
            <span className="ss-chips">
              {chosen.map((v) => (
                <span key={String(v)} className="ss-chip">
                  {String(v)}
                  {/* A span with a click handler, not a nested <button>: a button
                      inside a button is invalid HTML and would be dropped by the
                      browser's parser. */}
                  <span
                    className="ss-chip-x"
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remove ${v}`}
                    onClick={(e) => { e.stopPropagation(); removeChip(v); }}
                  >
                    ×
                  </span>
                </span>
              ))}
            </span>
          ) : (
            // An empty multi-select shows its PLACEHOLDER, not a blank control. The
            // single-select path below already did this via `display`; the multi path
            // did not, so a fresh multi-select rendered as an empty box with no hint
            // of what it was for.
            <span className="ss-value">{multiple ? placeholder : (display || placeholder)}</span>
          )}
          <span className="ss-caret" aria-hidden="true">▾</span>
        </button>
      ) : (
        <input
          ref={(node) => {
            inputRef.current = node;
            if (node) node.focus();
          }}
          id={id}
          className={`ss-control ss-input${multiple ? ' ss-multi' : ''}`}
          value={query}
          placeholder={selected ? getOptionLabel(selected) : placeholder}
          onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-invalid={ariaInvalid || undefined}
        />
      )}

      {open && (
        <ul className="ss-list" role="listbox" ref={listRef}>
          {filtered.length === 0 && <li className="ss-empty">{emptyMessage}</li>}
          {filtered.map((option, i) => {
            const optionValue = getOptionValue(option);
            const isSelected = isChosen(optionValue);
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
                {multiple && (
                  // A presentational checkbox: the row is the click target, so a
                  // real input here would swallow the click and fight the list's
                  // own focus handling.
                  <span
                    className={`ss-check${isSelected ? ' ss-check-on' : ''}`}
                    aria-hidden="true"
                  >
                    {isSelected && <span className="ss-check-mark">✓</span>}
                  </span>
                )}
                <span className="ss-option-label">{renderOption ? renderOption(option) : getOptionLabel(option)}</span>
                {hint && <span className="ss-option-hint">{hint}</span>}
              </li>
            );
          })}

          {/* "Add Other Process" footer. Shown only for a multi-select that wired
              it up, and only while the list is open, so it sits exactly where the
              user is already looking for a value that is not there. */}
          {multiple && onAddOption && (
            <li className="ss-add-row">
              <span className="ss-check ss-check-legend" aria-hidden="true">+</span>
              <input
                className="ss-add-input"
                value={newValue}
                placeholder={addPlaceholder}
                aria-label={addPlaceholder}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  // Enter commits the new value instead of choosing the highlighted
                  // option or submitting the form.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    addNewOption();
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="ss-add-btn"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); addNewOption(); }}
              >
                {addLabel}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
});

export default SearchableSelect;

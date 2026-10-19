import React, { useState } from 'react';
import { splitValues, joinValues } from '../config/orderWorkflow';

/**
 * A multi-value field you can both pick from and type into.
 *
 * Colour and Size Range hold SEVERAL values on a real order ("Navy, Black" /
 * "S, M, L"), and the stored value stays a plain comma-separated STRING — that is
 * the contract the tables, the CSV export and the chips in the Full Sheet all
 * read. So this control owns the list while it is being edited and hands back one
 * joined string, rather than widening the column's type.
 *
 * It is deliberately not a <select multiple>: a native multi-select cannot be
 * typed into, and the two things a supervisor needs here are to tick the three
 * sizes they have and to write the colour that is not on the list. Suggestions are
 * offered as a filterable list, and anything typed is accepted and kept.
 */
export default function MultiValueInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Type a value, then press Enter',
  label,
  readOnly = false,
  id,
}) {
  const [draft, setDraft] = useState('');
  const chosen = splitValues(value);

  const query = draft.trim().toLowerCase();
  const matches = suggestions
    .filter((s) => !chosen.some((c) => c.toLowerCase() === String(s).toLowerCase()))
    .filter((s) => (query ? String(s).toLowerCase().includes(query) : true))
    .slice(0, 8);

  /** Adds one value (typed or suggested) unless it is already on the list. */
  function add(raw) {
    const next = String(raw || '').trim();
    if (!next) return;
    if (chosen.some((c) => c.toLowerCase() === next.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange(joinValues([...chosen, next]));
    setDraft('');
  }

  function remove(target) {
    onChange(joinValues(chosen.filter((c) => c !== target)));
  }

  return (
    <div className="mv-input" id={id}>
      {chosen.length > 0 && (
        <div className="mv-input-chips">
          {chosen.map((part) => (
            <span className="mv-chip" key={part}>
              {part}
              {!readOnly && (
                // A span, not a nested button: a button inside a label is invalid
                // HTML and the browser drops it.
                <span
                  className="mv-chip-x"
                  role="button"
                  tabIndex={-1}
                  aria-label={`Remove ${part}`}
                  onClick={(e) => { e.preventDefault(); remove(part); }}
                >
                  ×
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {!readOnly && (
        <>
          <input
            className="mv-input-box"
            value={draft}
            aria-label={label ? `${label} — add a value` : 'Add a value'}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter commits the typed value rather than submitting the whole
              // form — a supervisor adding the fourth size should not save the day.
              if (e.key === 'Enter') {
                e.preventDefault();
                add(draft);
              } else if (e.key === 'Backspace' && !draft && chosen.length > 0) {
                remove(chosen[chosen.length - 1]);
              }
            }}
          />
          {matches.length > 0 && (
            <div className="mv-input-suggest">
              {matches.map((s) => (
                <button
                  type="button"
                  key={s}
                  className="mv-suggest-chip"
                  onClick={() => add(s)}
                >
                  + {s}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

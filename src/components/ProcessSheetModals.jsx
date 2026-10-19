import React, { useEffect, useState } from 'react';
import SearchableSelect from './SearchableSelect';
import {
  orderLabel,
  selectableOrders,
  withRecomputedTotals,
  dirtyAgainstSheet,
} from '../config/orderWorkflow';

/**
 * View / Edit / Delete for one uploaded process sheet.
 *
 * The Uploaded Sheets table is a summary — style, file, a count. Everything that
 * acts on a sheet lives here, so the table itself stays readable and the three
 * verbs share one place to get their fields, their wording and their saving right.
 *
 * VIEW is the one that matters day to day: it lists the operations the sheet
 * actually holds, and lets a supervisor add a process it missed without
 * re-uploading the whole spreadsheet and re-typing the rest. Adding one
 * RECOMPUTES the sheet's total SMV from its operations rather than trusting the
 * number that was uploaded, so the table and the targets follow the rows.
 *
 * LINE OUTPUT COLUMN
 * ------------------
 * A dedicated "Line Output" column carries a searchable dropdown of every
 * operation on the sheet (the brief's Option B). Picking one designates it as the
 * line-output process — the operation whose summed operator output IS the line's
 * output — with no change to the uploaded file and no prior setup. The choice is
 * saved on the sheet as `lineOutputProcess`, which is what the aggregation and the
 * dashboards read.
 *
 * EDIT re-points a sheet at a different style/order. That is the one field worth
 * changing after the fact: the operations were read from the file and are editable
 * in View, but a sheet saved against the wrong style would offer its processes to
 * the wrong product.
 */
export default function ProcessSheetModals({
  sheet,
  mode,          // 'view' | 'edit' | 'delete'
  orders = [],
  onClose,
  onSaveSheet,   // (updatedSheet) => void
  onDelete,      // (sheet) => void
  isAdmin = true,
}) {
  // The draft is seeded through `withRecomputedTotals` so the derived target columns
  // are populated on the FIRST render, not only after the effect below runs. A sheet
  // saved before those fields existed would otherwise flash a row of dashes.
  const [draft, setDraft] = useState(() => (sheet ? withRecomputedTotals(sheet) : null));
  // A brand-new operation being typed in the View modal. Kept in one object so
  // "Add" is a single, obvious action rather than four separate saves.
  const [newOp, setNewOp] = useState({ operation: '', machine: '', section: '', smv: '' });
  const [viewError, setViewError] = useState('');

  // Re-seed whenever a different sheet is opened, so the modal never shows the
  // previous sheet's values.
  useEffect(() => routeDraft(sheet, setDraft, setNewOp, setViewError), [sheet]);

  // Escape closes, matching every other dialog in the app.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!sheet || !mode) return null;

  const changeStyle = (next) => {
    const order = orders.find((o) => String(o.style || o.order_no) === String(next)) || {};
    setDraft((prev) => ({ ...prev, style: next, order_no: order.order_no || prev.order_no || '' }));
  };

  /** Adds the typed operation to the sheet and re-derives its totals. */
  function addProcess() {
    const name = String(newOp.operation || '').trim();
    if (!name) {
      setViewError('Enter an operation name before adding it.');
      return;
    }
    if ((draft.operations || []).some((o) => String(o.operation || '').trim().toLowerCase() === name.toLowerCase())) {
      setViewError(`"${name}" is already on this sheet.`);
      return;
    }
    const op = {
      operation: name,
      machine: String(newOp.machine || '').trim(),
      section: String(newOp.section || '').trim(),
      smv: Number(newOp.smv) || 0,
    };
    setViewError('');
    setNewOp({ operation: '', machine: '', section: '', smv: '' });
    setDraft((prev) => withRecomputedTotals({ ...prev, operations: [...(prev.operations || []), op] }));
  }

  /** Removes one operation and re-derives the totals. */
  function removeProcess(index) {
    setDraft((prev) => withRecomputedTotals({
      ...prev,
      operations: (prev.operations || []).filter((_, i) => i !== index),
    }));
  }

  function changeOpSmv(index, value) {
    setDraft((prev) => withRecomputedTotals({
      ...prev,
      operations: (prev.operations || []).map((o, i) => (i === index ? { ...o, smv: value } : o)),
    }));
  }

  /**
   * The operations offered in the Line Output dropdown: every operation on the
   * sheet, in sheet order. This is the brief's "all available processes for that
   * style" — the sheet IS the style's process list, so the two cannot differ.
   */
  const operationOptions = (draft?.operations || [])
    .map((o) => String(o.operation || '').trim())
    .filter(Boolean)
    .map((name) => ({ value: name, label: name }));

  // `dirty` decides whether "Save changes" is offered. Comparing the raw JSON would
  // be wrong now that the draft carries derived fields the sheet does not, so the
  // comparison is made on the fields a user can actually change. The derived figures
  // are excluded because they follow their SMV and are recomputed on save anyway.
  const dirty = dirtyAgainstSheet(draft, sheet);

  return (
    <div
      className="dp-modal-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className={`dp-modal ${mode === 'view' || mode === 'edit' ? 'dp-modal-wide' : 'dp-confirm'}`}
        role={mode === 'delete' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={
          mode === 'view' ? `Operations on ${sheet.style}`
            : mode === 'edit' ? `Edit sheet for ${sheet.style}`
              : 'Delete process sheet'
        }
      >
        <header className="dp-modal-head">
          <h3>
            {mode === 'view' && `Processes — ${sheet.style}`}
            {mode === 'edit' && `Edit sheet — ${sheet.style}`}
            {mode === 'delete' && 'Delete this process sheet?'}
          </h3>
          <button type="button" className="dp-modal-close" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="dp-modal-body">
          {mode === 'delete' ? (
            <DeleteBody sheet={sheet} isAdmin={isAdmin} onDelete={onDelete} onClose={onClose} />
          ) : draft && (
            <>
              {/* ---- Common header: what the sheet is, its totals ---- */}
              <div className="dp-entry-metrics" style={{ marginBottom: 12 }}>
                <Metric label="Operations" value={(draft.operations || []).length} />
                <Metric label="Total SMV" value={`${draft.totalSmv ?? 0} min`} />
                <Metric
                  label={draft.smvUnit === 'seconds' ? 'In seconds' : 'Source'}
                  value={draft.smvUnit === 'seconds' ? `${draft.totalSmvSeconds ?? 0} s` : (draft.fileName || '—')}
                />
              </div>

              {mode === 'edit' && (
                <div className="dp-detail-grid" style={{ marginBottom: 14 }}>
                  <label className="form-field">
                    <span>Style / Order</span>
                    <SearchableSelect
                      value={draft.style}
                      onChange={changeStyle}
                      options={selectableOrders(orders).map((o) => ({
                        value: o.style || o.order_no,
                        label: orderLabel(o),
                        hint: [o.buyer, o.qty ? `${o.qty} pcs` : ''].filter(Boolean).join(' · '),
                      }))}
                      placeholder="Search style or order no…"
                      emptyMessage="No orders yet"
                      ariaLabel="Move this sheet to a different style"
                    />
                  </label>
                  <label className="form-field">
                    <span>File name</span>
                    <input
                      value={draft.fileName || ''}
                      onChange={(e) => setDraft((prev) => ({ ...prev, fileName: e.target.value }))}
                      placeholder="breakdown.xlsx"
                    />
                  </label>
                  {/* The percentage buffer applied to every auto target derived from
                      this sheet. Editable here so an agreed margin can be corrected
                      without re-uploading the whole spreadsheet. */}
                  <label className="form-field">
                    <span>Manpower</span>
                    <input type="number" min="0" value={draft.manpower ?? ''} onChange={(e) => setDraft((prev) => withRecomputedTotals({ ...prev, manpower: e.target.value }))} placeholder="e.g. 25" />
                  </label>
                  <label className="form-field">
                    <span>Line Input Process</span>
                    <SearchableSelect
                      value={draft.lineInputProcess || draft.inputProcess || ''}
                      onChange={(value) => setDraft((prev) => ({ ...prev, lineInputProcess: value, inputProcess: value }))}
                      options={operationOptions}
                      placeholder="Select Line Input Process..."
                      emptyMessage="No operations yet"
                      ariaLabel="Line Input Process"
                    />
                  </label>
                  <label className="form-field">
                    <span>Line Output Process</span>
                    <SearchableSelect
                      value={draft.lineOutputProcess || draft.outputProcess || ''}
                      onChange={(value) => setDraft((prev) => ({ ...prev, lineOutputProcess: value, outputProcess: value }))}
                      options={operationOptions}
                      placeholder="Select Line Output Process..."
                      emptyMessage="No operations yet"
                      ariaLabel="Line Output Process"
                    />
                  </label>
                  <label className="form-field">
                    <span>Add Percentage (%)</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={draft.targetBuffer ?? ''}
                      onChange={(e) => setDraft((prev) => withRecomputedTotals({ ...prev, targetBuffer: e.target.value }))}
                      placeholder="0"
                    />
                  </label>
                </div>
              )}

              {/* ---- The operations ---- */}
              <div className="table-wrap">
                <table className="dp-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Operation</th><th>Machine</th><th>Section</th>
                      <th>SMV (min)</th>
                      <th>Base Hr Cap</th>
                      <th>Hr Target</th>
                      <th>Daily Target</th>
                      <th>Monthly Target</th>
                      <th>Manpower</th>
                      <th>Line Output Process</th>
                      {isAdmin && <th><span className="sr-only">Row actions</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(draft.operations || []).length === 0 && (
                      <tr>
                        <td colSpan={isAdmin ? 11 : 10} className="empty-row">
                          This sheet has no operations yet — add one below.
                        </td>
                      </tr>
                    )}
                    {(draft.operations || []).map((o, i) => (
                      <tr key={`${o.operation}-${i}`}>
                        <td className="mono-cell">{i + 1}</td>
                        <td>{o.operation || '—'}</td>
                        <td>{o.machine || '—'}</td>
                        <td>{o.section || '—'}</td>
                        <td className="mono-cell">
                          {isAdmin ? (
                            <input
                              type="number"
                              className="dp-hour-input"
                              value={o.smv ?? ''}
                              onChange={(e) => changeOpSmv(i, e.target.value)}
                              aria-label={`SMV for ${o.operation}`}
                            />
                          ) : (o.smv ?? '—')}
                        </td>
                        {/* The derived figures, shown here as in the uploader's preview.
                            They follow the SMV box live: `withRecomputedTotals` recomputes
                            them on every keystroke, so an edit above moves these three
                            without a re-save. */}
                        <td className="mono-cell ps-computed">
                          {o.baseHourlyCapacity ? Math.round(o.baseHourlyCapacity * 100) / 100 : '—'}
                        </td>
                        <td className="mono-cell ps-computed">
                          {o.autoHourlyTarget || '—'}
                        </td>
                        <td className="mono-cell ps-computed">
                          {o.autoDailyTarget || '—'}
                        </td>
                        <td className="mono-cell ps-computed">{o.autoMonthlyTarget || (o.autoDailyTarget ? o.autoDailyTarget * 26 : '—')}</td>
                        <td className="mono-cell ps-computed">{draft.manpower || '—'}</td>
                        <td className="ps-line-output-cell">
                          {String(draft.lineOutputProcess || '').trim().toLowerCase()
                            === String(o.operation || '').trim().toLowerCase() && String(o.operation || '').trim() !== ''
                            ? <span className="ps-line-badge">✔ Line Output</span>
                            : <span className="ps-line-none">—</span>}
                        </td>
                        {isAdmin && (
                          <td>
                            <button
                              type="button"
                              className="btn-icon"
                              title={`Remove ${o.operation}`}
                              onClick={() => removeProcess(i)}
                            >
                              🗑️
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ---- Add New Process ---- */}
              {isAdmin && (
                <div className="ps-add-process">
                  <h4 className="ps-add-title">Add New Process</h4>
                  <div className="ps-add-grid">
                    <label className="form-field">
                      <span>Operation <em className="req-star">*</em></span>
                      <input
                        value={newOp.operation}
                        onChange={(e) => { setNewOp((p) => ({ ...p, operation: e.target.value })); setViewError(''); }}
                        placeholder="e.g. Bottom Hem"
                      />
                    </label>
                    <label className="form-field">
                      <span>Machine</span>
                      <input
                        value={newOp.machine}
                        onChange={(e) => setNewOp((p) => ({ ...p, machine: e.target.value }))}
                        placeholder="e.g. Flatlock"
                      />
                    </label>
                    <label className="form-field">
                      <span>Section</span>
                      <input
                        value={newOp.section}
                        onChange={(e) => setNewOp((p) => ({ ...p, section: e.target.value }))}
                        placeholder="e.g. Bottom"
                      />
                    </label>
                    <label className="form-field">
                      <span>SMV (min)</span>
                      <input
                        type="number"
                        value={newOp.smv}
                        onChange={(e) => setNewOp((p) => ({ ...p, smv: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                  </div>
                  {viewError && <p className="ps-add-error" role="alert">⚠ {viewError}</p>}
                  <button type="button" className="btn btn-outline btn-sm" onClick={addProcess}>
                    + Add Process
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {mode !== 'delete' && (
          <footer className="dp-modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              {mode === 'view' ? 'Close' : 'Cancel'}
            </button>
            {mode === 'view' ? (
              isAdmin && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!dirty}
                  onClick={() => onSaveSheet?.(draft)}
                >
                  Save changes
                </button>
              )
            ) : (
              isAdmin && (
                <button type="button" className="btn btn-primary" onClick={() => onSaveSheet?.(draft)}>
                  Save changes
                </button>
              )
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

/** Resets the draft when a different sheet is opened. */
function routeDraft(sheet, setDraft, setNewOp, setViewError) {
  // The draft is passed through `withRecomputedTotals`, so the derived target
  // columns are filled in even for a sheet saved before those fields existed.
  // Opening an old sheet must not show a row of dashes where the targets belong.
  setDraft(sheet
    ? withRecomputedTotals({ ...sheet, operations: [...(sheet.operations || [])] })
    : null);
  setNewOp({ operation: '', machine: '', section: '', smv: '' });
  setViewError('');
}

function DeleteBody({ sheet, isAdmin, onDelete, onClose }) {
  return (
    <>
      <p className="dp-confirm-question">
        Remove the sheet for <strong>{sheet.style}</strong>?
      </p>
      <p className="dp-confirm-meta">
        {(sheet.operations || []).length} operation{(sheet.operations || []).length === 1 ? '' : 's'}
        {sheet.fileName ? ` · ${sheet.fileName}` : ''} · total SMV {sheet.totalSmv ?? 0} min
      </p>
      <p className="dp-confirm-meta">
        The processes stop being offered on Hourly Production, Daily Production and Worker
        Production for this style. A saved capacity for the style is left alone.
      </p>
      <div className="dp-modal-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={!isAdmin}
          onClick={() => onDelete?.(sheet)}
        >
          Delete sheet
        </button>
      </div>
    </>
  );
}

function Metric({ label, value }) {
  return (
    <div className="dp-metric">
      <span className="dp-metric-label">{label}</span>
      <span className="dp-metric-value">{value}</span>
    </div>
  );
}

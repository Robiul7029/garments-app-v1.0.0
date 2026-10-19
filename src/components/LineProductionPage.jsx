import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadCSV } from '../utils/csv';
import { ConfirmDialog } from './erp/Primitives';
import { dateKey } from '../config/productionAggregation';
import { COLLECTIONS } from '../config/orderWorkflow';
import {
  monthlyCollectionFor,
  applyAutoLineOutput,
  autoLineTooltip,
  isAutoLineRecord,
  lineOutputDailyRow,
  orderDetailsFor,
  monthlyDueByLine,
  dueOf,
  EMPTY_CELL,
} from '../config/monthlyLineOutput';

/**
 * ROBIUL GARMENTS ERP — Line Production.
 *
 * The day's line-by-line output, in one table: what each line made, where the figure
 * came from, and the two actions a supervisor needs (Edit, Delete).
 *
 * WHERE THE ROWS COME FROM
 * ------------------------
 * Two sources, and the table says which is which on every row:
 *
 *   SUBMITTED  a Total Line Output entry a supervisor signed off. Their figure, and
 *              it wins — the fallback never overwrites it.
 *   AUTO       derived by summing the day's individual employee entries for that
 *              line, because nobody submitted a total. See `applyAutoLineOutput`.
 *
 * The auto rows are not a display trick: they are WRITTEN into the same monthly
 * `line-output-YYYY-MM` collection a hand entry goes into, so the day's line
 * production is never zero while employee entries exist, and every other reader of
 * that collection (the monthly sheet, the summary cards, an export) sees the same
 * figures without knowing the fallback exists.
 *
 * The sync runs whenever the day or the underlying rows change, so a corrected
 * employee entry flows into the line total without a button to press.
 *
 * ORDER DETAILS ARE JOINED, NOT COPIED
 * ------------------------------------
 * A line row stores the Order No it was booked to and nothing else about the order.
 * Buyer, Style No, Product / Item, PO Qty and Color live on the Master Order record
 * Order Management maintains, so they are joined here at read time — the table always
 * shows what the order currently says, and correcting the order needs no back-fill.
 *
 * DUE, DAILY AND MONTHLY
 * ----------------------
 * `Daily Due` is how far short of the day's target the line finished; `Monthly Due`
 * accumulates that over the month's rows for the same line. Both are derived from the
 * stored targets and output, never stored themselves, so a corrected figure moves them
 * without a migration.
 */

const todayKey = () => new Date().toISOString().slice(0, 10);

export default function LineProductionPage() {
  const { getData, setRaw } = useData();
  const { isAdmin } = useRole();

  const [date, setDate] = useState(todayKey());
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  // The row a delete confirmation is asking about. Nothing is removed until YES.
  const [pendingDelete, setPendingDelete] = useState(null);
  // The row being edited in place, and the draft of the two figures that may change.
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ achievement: '', line_no: '', supervisor: '' });
  const [rowError, setRowError] = useState('');

  const hourlyRows = getData('hourly-timesheet-rows');
  // The Master Order records the order details are joined from. Read once, here, so
  // the join is a lookup rather than a per-row scan of storage.
  const orders = getData(COLLECTIONS.ORDERS);
  const collection = monthlyCollectionFor(date);
  const monthlyRows = getData(collection);

  /**
   * Fills in every line that has employee output but no submitted total.
   *
   * Runs as an effect rather than during render because it WRITES: a render must not
   * have a side effect on storage. It is safe to run repeatedly — `applyAutoLineOutput`
   * is idempotent (one row per date + line), so re-running refreshes the derived
   * figures instead of adding to them.
   *
   * The write only happens when the result actually differs, so a steady state costs
   * nothing and cannot loop: `setRaw` with an equal list would re-render, re-run this
   * effect and write again forever.
   */
  useEffect(() => {
    if (!collection) return;
    const { records, added, replaced } = applyAutoLineOutput(monthlyRows, hourlyRows, date);
    const changed = added.length > 0 || replaced.length > 0
      || records.length !== monthlyRows.length;
    if (!changed) return;
    setRaw(collection, records);
    if (added.length > 0) {
      setNotice(
        `${added.length} line${added.length === 1 ? '' : 's'} had no submitted total — `
        + `calculated automatically from employee entries.`,
      );
    }
    // `monthlyRows` is intentionally not a dependency: this effect WRITES it, and
    // depending on it would re-run on its own output. `collection` and `date` change
    // together, and `hourlyRows` is the input that can actually make the result stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, date, hourlyRows, setRaw]);

  /**
   * The day's rows, each enriched with its order details and its two due figures.
   *
   * Enriched in ONE pass here rather than re-joining inside the render: the table body,
   * the CSV export and the search all read the same derived row, so a column can never
   * show one order while the export writes another.
   */
  const dayRows = useMemo(() => {
    const day = dateKey(date);
    // The month's dues are computed across EVERY row of the month, not just the day's,
    // because "monthly due" is by definition a month-wide figure.
    const monthlyDue = monthlyDueByLine(monthlyRows);
    return (Array.isArray(monthlyRows) ? monthlyRows : [])
      .filter((r) => r && dateKey(r.date) === day)
      .map((r) => {
        const details = orderDetailsFor(r, orders);
        return {
          ...r,
          details,
          dailyDue: dueOf(r),
          monthlyDue: monthlyDue.get(String(r.line_no || '').trim().toLowerCase()) || 0,
        };
      })
      .sort((a, b) => Number(b.achievement || b.output || 0) - Number(a.achievement || a.output || 0));
  }, [monthlyRows, orders, date]);

  /** The search filter: line, order, supervisor, style, buyer or product. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dayRows;
    return dayRows.filter((r) => [
      r.line_no, r.order_no, r.supervisor, r.employee, r.style, r.process,
      // The joined order details are searchable too, so "H&M" or "Basic Tee" finds the
      // line without the reader having to know its order number.
      r.details?.buyer, r.details?.style, r.details?.item, r.details?.color,
    ].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [dayRows, query]);

  /** The day's totals, across every row shown. */
  const totals = useMemo(() => {
    const output = filtered.reduce((sum, r) => sum + Number(r.achievement || r.output || 0), 0);
    const target = filtered.reduce((sum, r) => sum + Number(r.dailyTarget || 0), 0);
    const autoCount = filtered.filter(isAutoLineRecord).length;
    return {
      output,
      target,
      autoCount,
      dailyDue: filtered.reduce((sum, r) => sum + r.dailyDue, 0),
      monthlyDue: filtered.reduce((sum, r) => sum + r.monthlyDue, 0),
      achievement: target > 0 ? Math.round((output / target) * 1000) / 10 : 0,
    };
  }, [filtered]);

  /** Writes the month's rows back, and keeps the day-level row in step. */
  function saveMonth(nextRows, message) {
    if (!collection) return;
    setRaw(collection, nextRows);
    // The Overall Summary and the KPI cards read `daily-production`, so the day's
    // rows are re-derived there too. Without this an edited or deleted line would
    // keep its old figure on the summary until something else rewrote that day.
    syncDayRows(nextRows);
    if (message) setNotice(message);
  }

  /**
   * Rebuilds the day's `daily-production` rows from the month's line records.
   *
   * Only the rows this screen owns are touched (`source: 'line-output'`), so a row
   * another module wrote for the same day is left exactly as it was.
   */
  function syncDayRows(nextRows) {
    const day = dateKey(date);
    const dailyRows = getData('daily-production');
    const others = (Array.isArray(dailyRows) ? dailyRows : []).filter(
      (r) => !(r && r.source === 'line-output' && dateKey(r.date) === day),
    );
    const mine = (Array.isArray(nextRows) ? nextRows : [])
      .filter((r) => r && dateKey(r.date) === day)
      .map(lineOutputDailyRow);
    setRaw('daily-production', [...others, ...mine]);
  }

  /** Opens one row for in-place editing. Nothing is written until Save. */
  function startEdit(row) {
    setEditingId(row.id);
    setDraft({
      achievement: String(row.achievement ?? row.output ?? ''),
      line_no: String(row.line_no || ''),
      supervisor: String(row.supervisor || ''),
    });
    setRowError('');
    setNotice('');
  }

  /**
   * Saves the edited row.
   *
   * A row edited by hand stops being an auto row: the supervisor has now stated the
   * figure themselves, so it is marked as submitted and the fallback will leave it
   * alone from then on — otherwise the next sync would overwrite the correction with
   * the sum it was derived from.
   */
  function commitEdit(row) {
    const output = Number(draft.achievement);
    if (!Number.isFinite(output) || output < 0) {
      setRowError('The output must be a number of pieces, 0 or more.');
      return;
    }
    const target = Number(row.dailyTarget || 0);
    const next = monthlyRows.map((r) => (r.id === row.id ? {
      ...r,
      achievement: output,
      quantity: output,
      output,
      line_no: draft.line_no.trim(),
      supervisor: draft.supervisor.trim(),
      // Naming a supervisor makes it a submitted entry; the fallback marker goes.
      source: draft.supervisor.trim() ? undefined : AUTO_LINE_SOURCE,
      achievementPercent: target > 0 ? Math.round((output / target) * 1000) / 10 : 0,
      savedAt: new Date().toISOString(),
    } : r));
    saveMonth(next, `${row.line_no || 'Line'} updated to ${output.toLocaleString()} pcs.`);
    setEditingId(null);
    setDraft({ achievement: '', line_no: '', supervisor: '' });
    setRowError('');
  }

  /** Removes one row from the month. Confirmed first — there is no undo. */
  function confirmRemove() {
    const row = pendingDelete;
    setPendingDelete(null);
    if (!row) return;
    const next = monthlyRows.filter((r) => r.id !== row.id);
    saveMonth(next, `${row.line_no || 'Line'} removed from ${date}.`);
    // The row is gone, so the fallback may legitimately re-derive it on the next
    // effect run — which is correct: if employees really did record that line's
    // output, the derived figure belongs on the table. Say so, rather than leaving
    // the reader thinking a delete silently came back.
    if (isAutoLineRecord(row)) {
      setNotice((prev) => `${prev} It was a calculated row, so it will reappear if employee entries still cover that line.`);
    }
  }

  function exportRows() {
    if (filtered.length === 0) {
      window.alert('No line production records to export for the selected day.');
      return;
    }
    downloadCSV(`line-production-${date}.csv`, filtered.map((r) => ({
      date: r.date,
      line_no: r.line_no,
      order_no: r.order_no,
      // The joined order details, written from the SAME derived row the table renders,
      // so the export can never disagree with the screen.
      buyer: r.details?.buyer || '',
      style: r.details?.style || r.style || '',
      item: r.details?.item || '',
      po_qty: r.details?.po_qty === '' ? '' : r.details?.po_qty,
      color: r.details?.color || '',
      supervisor: r.supervisor,
      source: isAutoLineRecord(r) ? 'Auto (from employee entries)' : 'Submitted',
      achievement: r.achievement ?? r.output,
      dailyTarget: r.dailyTarget,
      achievementPercent: r.achievementPercent,
      dailyDue: r.dailyDue,
      monthlyDue: r.monthlyDue,
    })), [
      { name: 'date', label: 'Date' },
      { name: 'line_no', label: 'Line' },
      { name: 'order_no', label: 'Order No' },
      { name: 'buyer', label: 'Buyer' },
      { name: 'style', label: 'Style No' },
      { name: 'item', label: 'Product / Item' },
      { name: 'po_qty', label: 'PO Qty' },
      { name: 'color', label: 'Color' },
      { name: 'supervisor', label: 'Supervisor' },
      { name: 'source', label: 'Source' },
      { name: 'achievement', label: 'Line Output' },
      { name: 'dailyTarget', label: 'Daily Target' },
      { name: 'achievementPercent', label: 'Achievement %' },
      { name: 'dailyDue', label: 'Daily Due' },
      { name: 'monthlyDue', label: 'Monthly Due' },
    ]);
  }

  return (
    <div className="module">
      <div className="module-header">
        <h2 style={{ margin: 0 }}>🏭 Line Production</h2>
        <p className="hint" style={{ maxWidth: '82ch' }}>
          Every line&rsquo;s output for the day. A line a supervisor submitted a Total Line Output
          entry for shows that figure; any line they did not is calculated automatically by summing
          the day&rsquo;s individual employee entries, so the day is never blank while the floor
          recorded work.
        </p>
      </div>

      {notice && <div className="erp-notice erp-notice-success dp-notice">{notice}</div>}
      {rowError && (
        <div className="erp-notice erp-notice-error dp-notice" role="alert">{rowError}</div>
      )}

      <div className="lp-bar">
        <label className="form-field">
          <span>Working Day</span>
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setNotice(''); }} />
        </label>
        <label className="form-field lp-search">
          <span>Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search line, order, buyer or product…"
            aria-label="Search line production"
          />
        </label>
        <button
          type="button"
          className="btn btn-outline"
          onClick={exportRows}
          disabled={filtered.length === 0}
        >
          ⬇ Export
        </button>
      </div>

      <div className="lp-kpis">
        <div className="lp-kpi">
          <span className="lp-kpi-label">Line Output</span>
          <strong>{totals.output.toLocaleString()} pcs</strong>
        </div>
        <div className="lp-kpi">
          <span className="lp-kpi-label">Daily Target</span>
          <strong>{totals.target.toLocaleString()} pcs</strong>
        </div>
        <div className="lp-kpi">
          <span className="lp-kpi-label">Achievement</span>
          <strong>{totals.target > 0 ? `${totals.achievement}%` : '—'}</strong>
        </div>
        <div className="lp-kpi">
          <span className="lp-kpi-label">Lines</span>
          <strong>{filtered.length}</strong>
        </div>
        <div className="lp-kpi">
          <span className="lp-kpi-label">Calculated</span>
          <strong>{totals.autoCount}</strong>
        </div>
        <div className="lp-kpi">
          <span className="lp-kpi-label">Daily Due</span>
          <strong>{totals.dailyDue.toLocaleString()} pcs</strong>
        </div>
        <div className="lp-kpi">
          <span className="lp-kpi-label">Monthly Due</span>
          <strong>{totals.monthlyDue.toLocaleString()} pcs</strong>
        </div>
      </div>

      <div className="table-wrap lp-table-wrap">
        <table className="dp-table lp-table">
          <thead>
            {/* The order-detail columns sit between Order No and Supervisor, because
                they are the order's own attributes: a reader scans left to right as
                "which line, which order, and what is that order". */}
            <tr className="lp-thead-row sticky top-0 z-10 bg-surface">
              <th style={{ width: 100 }}>Line</th>
              <th style={{ width: 120 }}>Order No</th>
              <th style={{ width: 110 }}>Buyer</th>
              <th style={{ width: 120 }}>Style No</th>
              <th style={{ width: 150 }}>Product / Item</th>
              <th style={{ width: 100 }}>PO Qty</th>
              <th style={{ width: 130 }}>Color</th>
              <th style={{ width: 140 }}>Supervisor</th>
              <th style={{ width: 120 }}>Source</th>
              <th style={{ width: 120 }}>Line Output</th>
              <th style={{ width: 120 }}>Daily Target</th>
              <th style={{ width: 110 }}>Achievement</th>
              <th style={{ width: 110 }}>Daily Due</th>
              <th style={{ width: 120 }}>Monthly Due</th>
              {isAdmin && <th style={{ width: 120 }}>Action</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 15 : 14} className="empty-row">
                  {dayRows.length === 0
                    ? 'No line output recorded for this day yet — record employee work on Hourly Production and the line totals are calculated automatically.'
                    : 'No line matches that search.'}
                </td>
              </tr>
            )}
            {filtered.map((row) => {
              const isEditing = editingId === row.id;
              const auto = isAutoLineRecord(row);
              return (
                <tr key={row.id} className={isEditing ? 'dp-row-editing' : undefined}>
                  <td className="dp-strong">
                    {isEditing ? (
                      <input
                        className="dp-remark-input"
                        value={draft.line_no}
                        onChange={(e) => setDraft((d) => ({ ...d, line_no: e.target.value }))}
                        aria-label={`Line for ${row.line_no || 'this row'}`}
                      />
                    ) : (row.line_no || '—')}
                  </td>
                  <td>{row.order_no || EMPTY_CELL}</td>
                  {/* The order details, joined from the Master Order record. Each cell
                      states WHERE its value came from when the join found nothing, so
                      a dash is never ambiguous. */}
                  <td>{row.details?.buyer || <span className="lp-missing" title="No Master Order record matches this order number.">{EMPTY_CELL}</span>}</td>
                  <td>{row.details?.style || <span className="lp-missing" title="No style on the Master Order record.">{EMPTY_CELL}</span>}</td>
                  <td>{row.details?.item || <span className="lp-missing" title="No product name on the Master Order record.">{EMPTY_CELL}</span>}</td>
                  <td className="mono-cell">
                    {row.details?.po_qty === '' || row.details?.po_qty === undefined
                      ? <span className="lp-missing" title="No PO quantity on the Master Order record.">{EMPTY_CELL}</span>
                      : Number(row.details.po_qty).toLocaleString()}
                  </td>
                  <td>{row.details?.color || <span className="lp-missing" title="No colour on the Master Order record.">{EMPTY_CELL}</span>}</td>
                  <td>
                    {isEditing ? (
                      <input
                        className="dp-remark-input"
                        value={draft.supervisor}
                        onChange={(e) => setDraft((d) => ({ ...d, supervisor: e.target.value }))}
                        placeholder="Supervisor name"
                        aria-label="Supervisor for this line"
                      />
                    ) : (row.supervisor || (auto ? '—' : row.employee || '—'))}
                  </td>
                  <td>
                    {/* Where the figure came from, stated on every row. The tooltip on
                        a calculated row says exactly what was summed, so an
                        unexplained number never appears on the table. */}
                    {auto ? (
                      <span className="lp-badge lp-badge-auto" title={autoLineTooltip(row)}>
                        Calculated
                      </span>
                    ) : (
                      <span className="lp-badge lp-badge-manual" title="Submitted as a Total Line Output entry.">
                        Submitted
                      </span>
                    )}
                  </td>
                  <td className="mono-cell">
                    {isEditing ? (
                      <input
                        className="dp-remark-input"
                        type="number"
                        min="0"
                        value={draft.achievement}
                        onChange={(e) => setDraft((d) => ({ ...d, achievement: e.target.value }))}
                        aria-label="Line output pieces"
                      />
                    ) : (
                      <span className="dp-strong">{Number(row.achievement || row.output || 0).toLocaleString()}</span>
                    )}
                  </td>
                  <td className="mono-cell">{Number(row.dailyTarget || 0).toLocaleString()}</td>
                  <td className="mono-cell">
                    {Number(row.dailyTarget || 0) > 0 ? `${row.achievementPercent}%` : EMPTY_CELL}
                  </td>
                  {/* How far short of the day's target the line finished. Zero is
                      stated as "Met" rather than 0, so a line that hit its plan is
                      never confused with a line that has no target at all. */}
                  <td className="mono-cell">
                    {row.dailyDue > 0
                      ? <span className="lp-due" title={`${row.dailyDue.toLocaleString()} pcs short of the day's target.`}>{row.dailyDue.toLocaleString()}</span>
                      : <span className="lp-met" title="The day's target was met.">Met</span>}
                  </td>
                  {/* The same shortfall accumulated over the month's rows for this line. */}
                  <td className="mono-cell">
                    {row.monthlyDue > 0
                      ? <span className="lp-due" title={`${row.monthlyDue.toLocaleString()} pcs short across this month's entries for ${row.line_no || 'this line'}.`}>{row.monthlyDue.toLocaleString()}</span>
                      : <span className="lp-met" title="No shortfall recorded this month.">Met</span>}
                  </td>
                  {isAdmin && (
                    <td className="row-actions">
                      {isEditing ? (
                        <>
                          <button className="btn btn-outline btn-sm" onClick={() => commitEdit(row)}>Save</button>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => { setEditingId(null); setDraft({ achievement: '', line_no: '', supervisor: '' }); setRowError(''); }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn-icon"
                            title={`Edit ${row.line_no || 'this line'}`}
                            aria-label={`Edit ${row.line_no || 'this line'}`}
                            onClick={() => startEdit(row)}
                          >
                            ✏️
                          </button>
                          <button
                            className="btn-icon"
                            title={`Delete ${row.line_no || 'this line'}`}
                            aria-label={`Delete ${row.line_no || 'this line'}`}
                            onClick={() => setPendingDelete(row)}
                          >
                            🗑️
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this line record?"
        message={pendingDelete
          ? `${pendingDelete.line_no || 'This line'} — ${Number(pendingDelete.achievement || pendingDelete.output || 0).toLocaleString()} pcs on ${date}. `
            + (isAutoLineRecord(pendingDelete)
              ? 'It was calculated from employee entries, so it will be recalculated if those entries still cover this line.'
              : 'This removes the submitted figure from the month.')
          : ''}
        confirmLabel="Delete"
        danger
        onConfirm={confirmRemove}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

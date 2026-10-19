import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { useHourlyErpMirror } from '../hooks/useHourlyErpMirror';
import { ConfirmDialog } from './erp/Primitives';
import { downloadCSV } from '../utils/csv';
import {
  aggregateDaily,
  groupDailyByEmployee,
  summariseDay,
} from '../config/productionAggregation';
import { SHIFT_HOURS, PRODUCTIVE_SHIFT_HOURS } from '../config/workingHours';

/**
 * ROBIUL GARMENTS ERP — Daily Production, Tab 1: the Daily All-Employee Sheet.
 *
 * One row per Employee + Process + Style + Date, summed from the hourly entries
 * that produced it — so the same process recorded at 10:00 and again at 15:00 is
 * ONE line, with both hours shown in the breakdown columns.
 *
 * THE COLUMNS THE BRIEF ASKS FOR
 * ------------------------------
 *   Employee            written once per person, merged with a rowSpan
 *   Line                the line the work was booked to
 *   Order / Style       the order number and style, together
 *   Process Name        the operation
 *   Target/hr           the rate the row is measured against
 *   Daily Target (10h)  the hourly rate over a standard ten-hour day
 *   Hourly Breakdown    a column per shift hour, 08:00 → 18:00
 *   Total Produced      the day's pieces
 *   Efficiency %        output against the daily target
 *   Variance / Due      red when short, green when met or beaten
 *
 * VARIANCE IS COLOURED, NOT JUST SIGNED
 * ------------------------------------
 * A shortfall reads "12 Due" in red; a target met or beaten reads "+8 Achieved"
 * in green. The wording and the tone both come from `varianceText` /
 * `varianceTone` in the aggregation module, so the table, its totals row and the
 * CSV cannot describe the same figure two different ways.
 *
 * MERGED EMPLOYEE NAMES
 * ---------------------
 * An operator who ran three processes has three rows but ONE name: the employee
 * cell is written once with a `rowSpan` covering their rows. The name cell also
 * carries that person's DAY TOTAL, so the merge is informative rather than merely
 * a way to save a column.
 *
 * EDIT AND DELETE PER ROW
 * -----------------------
 * Both actions act on the HOURLY entries the row was aggregated from — the brief's
 * point being that Hourly Production is the single source of truth, so correcting
 * a day means correcting the hour that was wrong rather than editing a derived
 * copy.
 */
export default function DailyEmployeeSheet({ date, onEditEntry }) {
  const { getData, deleteEntry } = useData();
  const { isAdmin } = useRole();
  const rows = getData('hourly-timesheet-rows');
  // Deleting from this sheet removes the hourly entries the row was aggregated
  // from, so the ERP mirror has to be reconciled for the day too — otherwise the
  // ERP dashboard would keep counting entries the floor has taken away.
  const { mirrorRows } = useHourlyErpMirror();

  // Which row's hourly detail is expanded. One at a time, so the table does not
  // grow a second sub-table under every row at once.
  const [expanded, setExpanded] = useState(null);
  // The breakdown columns are wide; a supervisor checking totals often wants them
  // out of the way, so the grid can be collapsed to the summary figures.
  const [showBreakdown, setShowBreakdown] = useState(true);
  // The row the delete confirmation is asking about (null = no dialog). The hourly
  // entries behind it stay in storage until YES is clicked.
  const [pendingDelete, setPendingDelete] = useState(null);

  const dailyRows = useMemo(() => aggregateDaily(rows, date), [rows, date]);
  const groups = useMemo(() => groupDailyByEmployee(dailyRows), [dailyRows]);
  const summary = useMemo(() => summariseDay(rows, date), [rows, date]);

  /**
   * The hour columns to draw.
   *
   * The standard shift slots, plus any custom slot an entry recorded (a written
   * label like '18:30-19:30' from the "Others Time…" box). A custom slot is
   * appended after the clock hours rather than sorted into them, because a range
   * has no meaningful place in a lexicographic sort of '08'…'18'.
   */
  const hourColumns = useMemo(() => {
    const extra = new Set();
    dailyRows.forEach((r) => {
      Object.keys(r.hours || {}).forEach((slot) => {
        if (!SHIFT_HOURS.includes(slot)) extra.add(slot);
      });
    });
    return [...SHIFT_HOURS, ...[...extra].sort()];
  }, [dailyRows]);

  const colCount = 10 + (showBreakdown ? hourColumns.length : 0) + (isAdmin ? 1 : 0);

  /**
   * Edit a row: hand the underlying hourly entries back to the page, which opens
   * the Hourly form on them. The page owns that wiring because the Hourly form is
   * a separate component with its own editing state.
   */
  function editRow(row) {
    if (typeof onEditEntry === 'function') {
      onEditEntry(row.entries);
    }
  }

  /**
   * Asks before deleting.
   *
   * The row is parked in state and the English Yes/No dialog is shown. The hourly
   * entries behind it are NOT touched until YES — NO, Escape or a backdrop click
   * just clears the pending row. A window.confirm() used to guard this; the in-app
   * dialog replaces it so the wording is fixed and the same on every screen.
   */
  function deleteRow(row) {
    setPendingDelete(row);
  }

  /** YES — delete every hourly entry the row was aggregated from. */
  function confirmDeleteRow() {
    const row = pendingDelete;
    setPendingDelete(null);
    if (!row) return;
    const ids = new Set(row.entryIds || []);
    // The day's rows AFTER the deletes, computed from this render's list rather
    // than re-read from the store afterwards. The store's React state does not
    // update until the next render, so re-reading in this same tick could still
    // return the deleted rows — and the mirror would keep their ERP documents.
    const remaining = rows.filter((r) => !ids.has(r.id));
    (row.entryIds || []).forEach((id) => deleteEntry('hourly-timesheet-rows', id));
    // Reconcile the ERP mirror for the day, so the deleted entries' ERP documents
    // go with them.
    void mirrorRows(date, remaining);
  }

  /** NO — cancel the deletion and leave the row's entries in storage. */
  function cancelDeleteRow() {
    setPendingDelete(null);
  }

  function download() {
    downloadCSV(
      `daily-all-employee-${date}.csv`,
      dailyRows.map((r) => ({
        date: r.date,
        employee: r.employee,
        line: r.line,
        orderNo: r.order_no,
        style: r.style,
        process: r.process,
        targetPerHour: r.target,
        dailyTarget: r.dailyTarget,
        ...Object.fromEntries(hourColumns.map((h) => [h, r.hours?.[h] ?? ''])),
        totalOutput: r.output,
        defects: r.defects,
        good: r.good,
        efficiency: `${r.efficiency}%`,
        variance: r.variance,
        varianceLabel: r.varianceLabel,
      })),
      [
        { name: 'date', label: 'Date' },
        { name: 'employee', label: 'Employee' },
        { name: 'line', label: 'Line' },
        { name: 'orderNo', label: 'Order No' },
        { name: 'style', label: 'Style' },
        { name: 'process', label: 'Process' },
        { name: 'targetPerHour', label: 'Target/hr' },
        { name: 'dailyTarget', label: 'Daily Target (10h)' },
        ...hourColumns.map((h) => ({ name: h, label: hourLabel(h) })),
        { name: 'totalOutput', label: 'Total Produced' },
        { name: 'defects', label: 'Defects' },
        { name: 'good', label: 'Good' },
        { name: 'efficiency', label: 'Efficiency' },
        { name: 'variance', label: 'Variance' },
        { name: 'varianceLabel', label: 'Variance / Due' },
      ],
    );
  }

  return (
    <div className="dp-tab-view">
      <div className="dp-tab-toolbar">
        <div className="dp-tab-summary">
          <span className="dp-tab-summary-item"><strong>{summary.completedPieces.toLocaleString()}</strong> pcs</span>
          <span className="dp-tab-summary-item"><strong>{summary.defects.toLocaleString()}</strong> defects</span>
          <span className="dp-tab-summary-item"><strong>{summary.activeEmployees}</strong> employees</span>
          <span className="dp-tab-summary-item"><strong>{summary.activeProcesses}</strong> processes</span>
        </div>
        <div className="dp-tab-toolbar-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setShowBreakdown((v) => !v)}
            aria-pressed={showBreakdown}
          >
            {showBreakdown ? 'Hide hourly breakdown' : 'Show hourly breakdown'}
          </button>
          {isAdmin && dailyRows.length > 0 && (
            <button type="button" className="btn btn-outline btn-sm" onClick={download}>⬇ Download Sheet</button>
          )}
        </div>
      </div>

      <div className="table-wrap dp-daily-wrap">
        <table className="dp-table dp-daily-sheet">
          <thead>
            <tr>
              <th className="dp-employee-col">Employee</th>
              <th>Line</th>
              <th>Order / Style</th>
              <th>Process Name</th>
              <th className="dp-num">Target/hr</th>
              <th className="dp-num">Daily Target (10h)</th>
              {showBreakdown && hourColumns.map((h) => (
                <th key={h} className="dp-hour-head">{hourLabel(h)}</th>
              ))}
              <th className="dp-num">Total Produced</th>
              <th className="dp-num">Efficiency %</th>
              <th className="dp-num">Variance / Due</th>
              {isAdmin && <th className="dp-actions-col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty-row">
                  No production recorded for {date}. Entries appear here the moment an hourly row is saved.
                </td>
              </tr>
            )}
            {groups.map((group) => group.rows.map((row, i) => {
              const isFirst = i === 0;
              return (
                <tr key={row.key} className={isFirst ? 'dp-group-start' : 'dp-group-cont'}>
                  {/* The name is written ONCE, with a rowSpan covering every process
                      this person ran, and carries their day total so the merge says
                      something rather than merely saving a column. */}
                  {isFirst && (
                    <td rowSpan={group.rows.length} className="dp-employee-cell">
                      <span className="dp-employee-name">{group.employee}</span>
                      {group.rows.length > 1 && (
                        <span className="dp-employee-sub">{group.rows.length} processes</span>
                      )}
                      <span className="dp-employee-total">
                        {group.totals.output.toLocaleString()} pcs
                      </span>
                    </td>
                  )}
                  <td>{row.line || '—'}</td>
                  <td>
                    <span className="dp-order-cell">
                      {row.order_no || '—'}
                      {row.style ? <em className="dp-style-note">{row.style}</em> : null}
                    </span>
                  </td>
                  <td>{row.process}</td>
                  <td className="mono-cell dp-num">{row.target || '—'}</td>
                  <td className="mono-cell dp-num">{row.dailyTarget.toLocaleString()}</td>
                  {showBreakdown && hourColumns.map((h) => {
                    const value = row.hours?.[h] || 0;
                    return (
                      <td
                        key={h}
                        className={`mono-cell dp-hour-cell${value > 0 ? ' has-value' : ''}`}
                        title={value > 0 ? `${hourLabel(h)}: ${value} pcs` : `${hourLabel(h)}: no output`}
                      >
                        {value > 0 ? value.toLocaleString() : '·'}
                      </td>
                    );
                  })}
                  <td className="mono-cell dp-num dp-strong">{row.output.toLocaleString()}</td>
                  <td className="mono-cell dp-num">
                    <span className={`dp-eff-badge ${effTone(row.efficiency)}`}>{row.efficiency}%</span>
                  </td>
                  {/* Red when the target was missed, green when it was met or
                      beaten — the colour and the wording both come from the
                      aggregation, so the export matches the screen. */}
                  <td className={`mono-cell dp-num dp-variance dp-variance-${row.varianceTone}`}>
                    {row.varianceLabel}
                  </td>
                  {isAdmin && (
                    <td className="dp-actions-col">
                      <div className="hourly-row-actions">
                        <button
                          type="button"
                          className="btn-icon"
                          title="Edit the hourly entries behind this row"
                          aria-label={`Edit ${row.employee} — ${row.process}`}
                          onClick={() => editRow(row)}
                        >✏️</button>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Delete the hourly entries behind this row"
                          aria-label={`Delete ${row.employee} — ${row.process}`}
                          onClick={() => deleteRow(row)}
                        >🗑️</button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            }))}
            {/* The hourly detail behind one row: the raw entries, so a supervisor can
                see which hour produced what without leaving the sheet. */}
            {groups.map((group) => group.rows.map((row) => (
              expanded === row.key ? (
                <tr key={`${row.key}-detail`} className="dp-detail-row">
                  <td colSpan={colCount}>
                    <div className="dp-detail-inner">
                      <span className="dp-detail-title">Hourly entries — {row.employee} · {row.process}</span>
                      <div className="dp-detail-hours">
                        {(row.entries || []).map((entry) => (
                          <span key={entry.id} className="dp-hour-chip">
                            {Object.entries(entry.hours || {})
                              .filter(([, v]) => Number(v) > 0)
                              .map(([h, v]) => `${hourLabel(h)} → ${v}`)
                              .join(' · ') || 'no hours recorded'}
                          </span>
                        ))}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null
            )))}
          </tbody>
          {dailyRows.length > 0 && (
            <tfoot>
              <tr className="dp-sheet-total">
                <td colSpan={5}>Day total</td>
                <td className="mono-cell dp-num">{summary.target.toLocaleString()}</td>
                {showBreakdown && hourColumns.map((h) => (
                  <td key={h} className="mono-cell dp-hour-cell">
                    {dailyRows.reduce((s, r) => s + (r.hours?.[h] || 0), 0).toLocaleString()}
                  </td>
                ))}
                <td className="mono-cell dp-num">{summary.completedPieces.toLocaleString()}</td>
                <td className="mono-cell dp-num">
                  <span className={`dp-eff-badge ${effTone(summary.achievement)}`}>{summary.achievement}%</span>
                </td>
                <td className={`mono-cell dp-num dp-variance dp-variance-${summary.completedPieces - summary.target >= 0 ? 'good' : 'bad'}`}>
                  {summary.completedPieces - summary.target >= 0
                    ? `+${(summary.completedPieces - summary.target).toLocaleString()} Achieved`
                    : `${Math.abs(summary.completedPieces - summary.target).toLocaleString()} Due`}
                </td>
                {isAdmin && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* A note under the table stating what the breakdown covers, so the excluded
          lunch half-hour is not a mystery when the columns are read as a shift. */}
      {dailyRows.length > 0 && (
        <p className="dp-table-foot-note">
          {showBreakdown
            ? `Hourly breakdown shown for ${hourColumns.length} shift hour${hourColumns.length === 1 ? '' : 's'} (08:00 → 18:00; the 13:00 lunch half-hour is excluded from the target).`
            : 'Hourly breakdown hidden — totals and variance only.'}
        </p>
      )}

      {/* ---- The delete confirmation ----
          Yes/No, English only. The row's hourly entries are deleted only on YES. */}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Confirm Deletion"
        message="Are you sure you want to delete this production record? This action cannot be undone."
        confirmLabel="YES"
        cancelLabel="NO"
        danger
        onConfirm={confirmDeleteRow}
        onCancel={cancelDeleteRow}
      />
    </div>
  );
}

/** The label for a shift slot: a clock key reads '08:00', anything else as typed. */
export function hourLabel(slot) {
  return /^\d{1,2}$/.test(String(slot)) ? `${slot}:00` : String(slot);
}

/** The tone class for an efficiency badge: ≥85 green, ≥70 amber, else red. */
export function effTone(value) {
  const n = Number(value) || 0;
  if (n >= 85) return 'dp-eff-good';
  if (n >= 70) return 'dp-eff-warn';
  return 'dp-eff-bad';
}

export { PRODUCTIVE_SHIFT_HOURS };
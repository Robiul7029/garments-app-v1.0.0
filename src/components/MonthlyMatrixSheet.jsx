import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadCSV } from '../utils/csv';
import {
  aggregateMonthly,
  applyOrderMonthlyTargets,
  summariseMonth,
  daysInMonth,
  efficiencyTone,
} from '../config/productionAggregation';
import {
  downloadMonthlyMatrixWorkbook,
  downloadMonthlyMatrixPDF,
} from '../utils/monthlyProductionExcel';
import { effTone } from './DailyEmployeeSheet';
import { COLLECTIONS } from '../config/orderWorkflow';

/**
 * ROBIUL GARMENTS ERP — Daily Production, Tab 2: the Monthly All-Employee Sheet.
 *
 * A matrix: one row per employee, one column per day of the month (1–31).
 *
 * EACH DATE CELL IS A DAY IN FULL
 * -------------------------------
 * A bare piece count in the cell told a reader how much was made but nothing
 * about how. Every cell now carries the day:
 *
 *   * the department and attendance status (e.g. "SEWING | Present");
 *   * an itemised line per process worked — process name, its achieved output
 *     against its own target, and that process's achievement %;
 *   * the day's cumulative totals — output / target, the remaining balance (Due),
 *     and the overall day efficiency as a colour-coded badge (green ≥100%,
 *     yellow 80–99%, red <80%).
 *
 * All of it is computed in `aggregateMonthly`, in the same pass as the flat
 * per-day figure the cell has always shown — so the number in the cell and the
 * breakdown behind it cannot describe the day differently.
 *
 * CLICK FOR THE DETAIL
 * --------------------
 * Every cell with a value is a button. Clicking it opens the day-breakdown modal
 * for that employee on that date: the same figures, given room to be read, with
 * the full process table. The modal is the brief's mobile answer too — on a
 * compact screen the cell collapses to "380 / 400 Pcs | 95%" and the detail lives
 * in the modal rather than in a cramped column.
 *
 * THE MONTH-END SUMMARY THE BRIEF ASKS FOR
 * ----------------------------------------
 *   Total Present Days      days carrying any output
 *   Total Active Hours      the month's productive hours
 *   Monthly Target          the day targets added up
 *   Achieved Output         the month's pieces
 *   Total Defects           the month's defects
 *   Overall Efficiency %    achieved against target
 *   Variance                the two, in the brief's red/green wording
 *
 * DATE-RANGE FILTERS
 * ------------------
 * A from/to pair narrows every figure to that window. The grid keeps all 31
 * columns — a partial month is still a month grid — but a day outside the range
 * contributes nothing. The filter is applied inside `aggregateMonthly` against the
 * DATE, so the grid, the row totals, the footer and the export are all reading one
 * filtered set and cannot disagree.
 *
 * EXPORTS
 * -------
 * "Download Monthly Report" offers the styled Excel workbook and a print-ready PDF
 * (via the browser's own print dialog — see `utils/monthlyProductionExcel`).
 */
export default function MonthlyMatrixSheet({ month, onMonthChange, initialOpenDay = null }) {
  const { getData } = useData();
  const { isAdmin } = useRole();
  const rows = getData('hourly-timesheet-rows');
  const orders = getData(COLLECTIONS.ORDERS);
  const processSheets = getData(COLLECTIONS.PROCESS_SHEETS);

  const [showAllDays, setShowAllDays] = useState(true);
  // The date-range filter. Empty means "the whole month", which is the default —
  // a filter that silently excluded data on first open would misrepresent the
  // month before the user touched anything.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // The day-breakdown modal's subject: { employee, day }. Null when closed.
  // `initialOpenDay` lets a test open the modal without a click, which a static
  // render cannot perform; in the app it is always null and the cell opens it.
  const [openDay, setOpenDay] = useState(initialOpenDay);

  const monthKey = month || new Date().toISOString().slice(0, 7);
  const dayCount = daysInMonth(monthKey);

  const monthRows = useMemo(() => {
    const employeeRows = aggregateMonthly(rows, monthKey, { from, to });
    return applyOrderMonthlyTargets(employeeRows, rows, orders, monthKey, { from, to }, processSheets);
  }, [rows, orders, processSheets, monthKey, from, to]);
  const totals = useMemo(() => summariseMonth(monthRows), [monthRows]);
  const displayMonthlyTarget = monthRows.orderTargetTotal ?? totals.target;

  /**
   * Which day columns to draw. A month has up to 31 columns, which is a lot of
   * horizontal scrolling on a phone, so by default only the days that carry any
   * output are shown — the grid stays readable and no row is misread. The toggle
   * brings the full 1–31 range back for anyone who wants the paper shape.
   */
  const activeDayNumbers = useMemo(() => {
    const set = new Set();
    monthRows.forEach((r) => r.days.forEach((v, i) => { if (v > 0) set.add(i + 1); }));
    return [...set].sort((a, b) => a - b);
  }, [monthRows]);

  const dayNumbers = showAllDays || activeDayNumbers.length === 0
    ? Array.from({ length: dayCount }, (_, i) => i + 1)
    : activeDayNumbers;

  /**
   * The payload every export reads.
   *
   * One object, built once, so the Excel workbook, the PDF and the CSV are all
   * describing the same filtered set of rows with the same day columns. Three
   * exports assembling their own view is how one of them quietly disagrees.
   */
  const exportPayload = useMemo(() => ({
    monthRows,
    dayNumbers,
    totals,
    monthKey,
    from,
    to,
  }), [monthRows, dayNumbers, totals, monthKey, from, to]);

  const rangeActive = Boolean(from || to);
  const rangeInvalid = Boolean(from && to && from > to);

  /**
   * Escape closes the day modal.
   *
   * A modal that can only be dismissed by finding its close button traps a
   * keyboard user, so the key is bound for as long as the modal is open and
   * removed the moment it closes.
   */
  useEffect(() => {
    if (!openDay) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpenDay(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openDay]);

  /** The day detail currently open, resolved from the live rows by employee+day. */
  const openDayDetail = useMemo(() => {
    if (!openDay) return null;
    const row = monthRows.find((r) => r.employee === openDay.employee);
    const detail = row?.dayDetails?.[openDay.day - 1];
    return detail ? { employee: openDay.employee, detail } : null;
  }, [openDay, monthRows]);

  /** Clears the range back to the whole month. */
  function clearRange() {
    setFrom('');
    setTo('');
  }

  function downloadExcel() {
    downloadMonthlyMatrixWorkbook(exportPayload, `monthly-production-matrix-${monthKey}.xlsx`);
  }

  function downloadPdf() {
    downloadMonthlyMatrixPDF(exportPayload, { title: 'Monthly Production Matrix' });
  }

  function download() {
    downloadCSV(
      `monthly-matrix-${monthKey}.csv`,
      monthRows.map((r) => ({
        employee: r.employee,
        ...Object.fromEntries(dayNumbers.map((d) => [`d${d}`, r.days[d - 1] || 0])),
        presentDays: r.activeDays,
        activeHours: r.workingHours,
        monthlyTarget: r.totalTarget,
        achievedOutput: r.totalOutput,
        totalDefects: r.totalDefects,
        efficiency: `${r.efficiency}%`,
        variance: r.varianceLabel,
      })),
      [
        { name: 'employee', label: 'Employee' },
        ...dayNumbers.map((d) => ({ name: `d${d}`, label: `Day ${d}` })),
        { name: 'presentDays', label: 'Total Present Days' },
        { name: 'activeHours', label: 'Total Active Hours' },
        { name: 'monthlyTarget', label: 'Monthly Target' },
        { name: 'achievedOutput', label: 'Achieved Output' },
        { name: 'totalDefects', label: 'Total Defects' },
        { name: 'efficiency', label: 'Efficiency' },
        { name: 'variance', label: 'Variance' },
      ],
    );
  }

  return (
    <div className="dp-tab-view">
      <div className="dp-tab-toolbar">
        <label className="form-field dp-month-picker">
          <span>Month</span>
          <input
            type="month"
            value={monthKey}
            onChange={(e) => onMonthChange(e.target.value)}
          />
        </label>

        {/* ---- Date-range filters ----
            Narrow every figure to a window inside the month. Both are clamped to
            the month's own first and last day, so a range can never be set to a
            date the grid does not carry. */}
        <label className="form-field dp-range-field">
          <span>From</span>
          <input
            type="date"
            value={from}
            min={`${monthKey}-01`}
            max={`${monthKey}-${String(dayCount).padStart(2, '0')}`}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="form-field dp-range-field">
          <span>To</span>
          <input
            type="date"
            value={to}
            min={`${monthKey}-01`}
            max={`${monthKey}-${String(dayCount).padStart(2, '0')}`}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <div className="dp-tab-summary">
          {/* Safe defaults throughout: `totals` is derived from `summariseMonth`,
              and a missing key must render 0 rather than crash the whole tab.
              `?? 0` catches `undefined`/`null`; `Number(...)` catches a string. */}
          <span className="dp-tab-summary-item"><strong>{Number(totals?.output ?? 0).toLocaleString()}</strong> pcs</span>
          <span className="dp-tab-summary-item"><strong>{Number(totals?.defects ?? 0).toLocaleString()}</strong> defects</span>
          <span className="dp-tab-summary-item"><strong>{Math.round(Number(totals?.hours ?? 0)).toLocaleString()}</strong> hrs</span>
          <span className="dp-tab-summary-item">
            <span className={`dp-eff-badge ${effTone(totals?.efficiency ?? 0)}`}>{Number(totals?.efficiency ?? 0)}%</span>
          </span>
        </div>
        <div className="dp-tab-toolbar-actions">
          {rangeActive && (
            <button type="button" className="btn btn-outline btn-sm" onClick={clearRange}>
              Clear range
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setShowAllDays((v) => !v)}
            aria-pressed={showAllDays}
          >
            {showAllDays ? 'Active days only' : `Show all ${dayCount} days`}
          </button>
          {isAdmin && monthRows.length > 0 && (
            <>
              <button type="button" className="btn btn-primary btn-sm" onClick={downloadExcel}>
                ⬇ Download Monthly Report (Excel)
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={downloadPdf}>
                🖨 Export PDF
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={download}>
                ⬇ CSV
              </button>
            </>
          )}
        </div>
      </div>

      {rangeInvalid && (
        <div className="erp-notice erp-notice-error dp-notice" role="alert">
          The From date is after the To date — nothing falls inside that range.
        </div>
      )}

      {/* ---- The month-end summary the brief asks for ----
          Every figure reads through `?? 0` so an empty month (or a row missing a
          key) renders zeros rather than throwing and blanking the whole tab. */}
      <div className="dp-month-summary">
        <SummaryTile icon="🗓️" label="Total Present Days" value={Number(totals?.presentDays ?? 0).toLocaleString()} />
        <SummaryTile icon="⏱️" label="Total Active Hours" value={Math.round(Number(totals?.hours ?? 0)).toLocaleString()} unit="h" />
        <SummaryTile
          icon="🎯"
          label="Monthly Target"
          value={Number(displayMonthlyTarget ?? 0).toLocaleString()}
          unit="pcs"
          title="Sum of order Monthly Targets from PO Qty divided by order duration."
        />
        <SummaryTile icon="📦" label="Achieved Output" value={Number(totals?.output ?? 0).toLocaleString()} unit="pcs" />
        <SummaryTile
          icon="🐞"
          label="Total Defects"
          value={Number(totals?.defects ?? 0).toLocaleString()}
          unit="pcs"
          level={Number(totals?.defects ?? 0) === 0 ? 'good' : 'warning'}
        />
        <SummaryTile
          icon="⚡"
          label="Overall Monthly Efficiency"
          value={`${Number(totals?.efficiency ?? 0)}%`}
          level={Number(totals?.efficiency ?? 0) >= 85 ? 'good' : Number(totals?.efficiency ?? 0) >= 70 ? 'warning' : 'critical'}
        />
      </div>

      <div className="table-wrap dp-matrix-wrap">
        <table className="dp-table dp-matrix">
          <thead>
            <tr>
              <th className="dp-matrix-name">Employee</th>
              {dayNumbers.map((d) => <th key={d} className="dp-matrix-day">{d}</th>)}
              <th className="dp-num">Present Days</th>
              <th className="dp-num">Active Hours</th>
              <th className="dp-num" title="The employee's allocated share of the same PO-based Monthly Target shown in Master Buyer & Order Summary.">Monthly Target</th>
              <th className="dp-num">Achieved Output</th>
              <th className="dp-num">Total Defects</th>
              <th className="dp-num">Efficiency %</th>
              <th className="dp-num">Variance</th>
            </tr>
          </thead>
          <tbody>
            {monthRows.length === 0 && (
              <tr>
                <td colSpan={dayNumbers.length + 8} className="empty-row">
                  No production recorded for {monthKey}{rangeActive ? ' in the selected range' : ''}.
                  The matrix fills in as hourly entries are saved.
                </td>
              </tr>
            )}
            {monthRows.map((row) => (
              <tr key={row.employee}>
                <td className="dp-matrix-name">{row.employee}</td>
                {dayNumbers.map((d) => {
                  // `row.days` is a fixed-length array, but a row built by an older
                  // reader could lack it entirely — defaulted so the grid renders
                  // rather than throwing on the first cell.
                  const value = (row.days?.[d - 1]) || 0;
                  const detail = row.dayDetails?.[d - 1] || null;
                  return (
                    <DayCell
                      key={d}
                      day={d}
                      value={value}
                      detail={detail}
                      onOpen={() => setOpenDay({ employee: row.employee, day: d })}
                    />
                  );
                })}
                <td className="mono-cell dp-num">{Number(row.activeDays ?? 0)}</td>
                <td className="mono-cell dp-num">{Number(row.workingHours ?? 0).toLocaleString()}</td>
                <td className="mono-cell dp-num" title="The employee's allocated share of the same PO-based Monthly Target shown in Master Buyer & Order Summary.">{Number(row.totalTarget ?? 0).toLocaleString()}</td>
                <td className="mono-cell dp-num dp-strong">{Number(row.totalOutput ?? 0).toLocaleString()}</td>
                <td className="mono-cell dp-num">{Number(row.totalDefects ?? 0).toLocaleString()}</td>
                <td className="mono-cell dp-num">
                  <span className={`dp-eff-badge ${effTone(row.efficiency ?? 0)}`}>{Number(row.efficiency ?? 0)}%</span>
                </td>
                <td className={`mono-cell dp-num dp-variance dp-variance-${row.varianceTone || 'bad'}`}>
                  {row.varianceLabel || '—'}
                </td>
              </tr>
            ))}
          </tbody>
          {monthRows.length > 0 && (
            <tfoot>
              <tr className="dp-sheet-total">
                <td className="dp-matrix-name">Month total</td>
                {dayNumbers.map((d) => (
                  <td key={d} className="dp-matrix-cell">
                    {monthRows.reduce((s, r) => s + ((r.days?.[d - 1]) || 0), 0).toLocaleString()}
                  </td>
                ))}
                <td className="mono-cell dp-num">{Number(totals?.presentDays ?? 0).toLocaleString()}</td>
                <td className="mono-cell dp-num">{Math.round(Number(totals?.hours ?? 0)).toLocaleString()}</td>
                <td className="mono-cell dp-num">{Number(displayMonthlyTarget ?? 0).toLocaleString()}</td>
                <td className="mono-cell dp-num">{Number(totals?.output ?? 0).toLocaleString()}</td>
                <td className="mono-cell dp-num">{Number(totals?.defects ?? 0).toLocaleString()}</td>
                <td className="mono-cell dp-num">
                  <span className={`dp-eff-badge ${effTone(totals?.efficiency ?? 0)}`}>{Number(totals?.efficiency ?? 0)}%</span>
                </td>
                <td className={`mono-cell dp-num dp-variance dp-variance-${Number(totals?.variance ?? 0) >= 0 ? 'good' : 'bad'}`}>
                  {Number(totals?.variance ?? 0) >= 0
                    ? `+${Number(totals?.variance ?? 0).toLocaleString()} Achieved`
                    : `${Math.abs(Number(totals?.variance ?? 0)).toLocaleString()} Due`}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {monthRows.length > 0 && (
        <p className="dp-table-foot-note">
          {rangeActive
            ? `Filtered to ${from || 'start'} → ${to || 'end'}. The grid still shows every day of ${monthKey}; days outside the range contribute nothing to the totals.`
            : `Whole month of ${monthKey}. ${monthRows.length} employee${monthRows.length === 1 ? '' : 's'} recorded production.`}
          {' '}Select any date cell to open that employee's full day breakdown.
        </p>
      )}

      {/* The day-breakdown modal. Rendered only while a day is open, so the grid
          itself carries no dialog markup. */}
      {openDayDetail && (
        <DayBreakdownModal
          employee={openDayDetail.employee}
          detail={openDayDetail.detail}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The rich date cell.
 *
 * Renders the day in full on a wide screen and the brief's streamlined
 * "380 / 400 Pcs | 95%" summary on a compact one. Both are inside the same
 * button, so the cell is one click target whatever size it is drawn at — and
 * the modal always carries the complete breakdown either way.
 * ------------------------------------------------------------------ */

function DayCell({ day, value, detail, onOpen }) {
  // A day with no output is not a button: there is nothing to open, and making
  // it clickable would promise a dialog that has no figures to show.
  if (!value || !detail) {
    return (
      <td
        className="dp-matrix-cell"
        title={`Day ${day}: no output`}
      >
        ·
      </td>
    );
  }

  const effToneClass = `dp-day-eff-${detail.tone}`;
  const attendanceTone = attendanceToneClass(detail.attendance);

  return (
    <td className="dp-matrix-cell dp-day-cell has-value">
      <button
        type="button"
        className="dp-day-btn"
        onClick={onOpen}
        title={`Day ${day}: ${value.toLocaleString()} of ${detail.totalTarget.toLocaleString()} pcs — open the full breakdown`}
        aria-label={`Day ${day} breakdown for this employee — ${value.toLocaleString()} of ${detail.totalTarget.toLocaleString()} pieces, ${detail.efficiency}% efficiency`}
      >
        {/* ---- The full breakdown (wide screens) ---- */}
        <span className="dp-day-full">
          <span className="dp-day-head">
            <span className="dp-day-dept">{detail.department || 'UNASSIGNED'}</span>
            {detail.attendance && (
              <span className={`dp-day-attendance ${attendanceTone}`}>{detail.attendance}</span>
            )}
          </span>

          <span className="dp-day-processes">
            {detail.processes.slice(0, 4).map((p) => (
              <span className="dp-day-process" key={p.process}>
                <span className="dp-day-process-name" title={p.process}>{p.process}</span>
                <span className="dp-day-process-num">
                  {p.output.toLocaleString()}/{p.target.toLocaleString()}
                </span>
                <span className={`dp-day-process-pct dp-text-${p.achievement >= 100 ? 'good' : p.achievement >= 80 ? 'warning' : 'critical'}`}>
                  {p.achievement}%
                </span>
              </span>
            ))}
            {detail.processes.length > 4 && (
              <span className="dp-day-process dp-day-process-more">
                <span className="dp-day-process-name">+{detail.processes.length - 4} more process(es)</span>
              </span>
            )}
          </span>

          <span className="dp-day-totals">
            <span className="dp-day-total-line">
              <span>Output / Target</span>
              <span>{value.toLocaleString()} / {detail.totalTarget.toLocaleString()}</span>
            </span>
            <span className={`dp-day-total-line ${detail.due > 0 ? 'dp-day-due' : 'dp-day-over'}`}>
              <span>{detail.due > 0 ? 'Shortage (Due)' : 'Balance'}</span>
              <span>
                {detail.due > 0
                  ? `${detail.due.toLocaleString()} pcs`
                  : `${detail.surplus.toLocaleString()} pcs`}
              </span>
            </span>
          </span>

          <span className={`dp-day-eff ${effToneClass}`}>{detail.efficiency}% Efficiency</span>
        </span>

        {/* ---- The streamlined summary (compact screens) ---- */}
        <span className="dp-day-compact">
          <span className="dp-day-compact-output">
            {value.toLocaleString()} / {detail.totalTarget.toLocaleString()} Pcs
          </span>
          <span className={`dp-day-compact-eff dp-text-${detail.tone}`}>{detail.efficiency}%</span>
        </span>
      </button>
    </td>
  );
}

/** The pill colour for an attendance status, by what the status says. */
function attendanceToneClass(attendance) {
  const t = String(attendance || '').toLowerCase();
  if (/(absent|no show|leave)/.test(t)) return 'dp-day-att-absent';
  if (/(half|late|partial)/.test(t)) return 'dp-day-att-half';
  if (/(present|p|yes)/.test(t)) return 'dp-day-attendance-default';
  return 'dp-day-att-neutral';
}

/* ------------------------------------------------------------------ *
 * The day-breakdown modal.
 *
 * The full process-wise statistics for one employee on one date: the same
 * figures the cell carries, given room to be read. The close button and the
 * backdrop both dismiss it, and Escape is bound by the parent.
 * ------------------------------------------------------------------ */

function DayBreakdownModal({ employee, detail, onClose }) {
  const effClass = `dp-modal-kpi-${detail.tone}`;

  return (
    <div
      className="dp-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dp-day-modal-title"
      onClick={onClose}
    >
      <div className="dp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dp-modal-head">
          <div>
            <h3 className="dp-modal-title" id="dp-day-modal-title">
              Daily Production Breakdown
            </h3>
            <span className="dp-modal-sub">
              {employee} · {detail.date} (Day {detail.dayNumber})
            </span>
          </div>
          <button
            type="button"
            className="dp-modal-close"
            onClick={onClose}
            aria-label="Close the day breakdown"
          >
            ×
          </button>
        </div>

        <div className="dp-modal-body">
          {/* ---- Who, and were they in ---- */}
          <div className="dp-modal-badges">
            <span className="dp-modal-badge">
              🏭 {detail.department || 'Unassigned department'}
            </span>
            <span className="dp-modal-badge">
              🕘 {detail.attendance || 'Attendance not recorded'}
            </span>
            {detail.line && <span className="dp-modal-badge">🧵 {detail.line}</span>}
            {detail.order_no && <span className="dp-modal-badge">📑 {detail.order_no}</span>}
            {detail.style && <span className="dp-modal-badge">👕 {detail.style}</span>}
            <span className="dp-modal-badge">⏱️ {detail.hours} active hours</span>
          </div>

          {/* ---- The day's cumulative totals ---- */}
          <div className="dp-modal-kpis">
            <div className="dp-modal-kpi">
              <div className="dp-modal-kpi-label">Total Daily Output</div>
              <div className="dp-modal-kpi-value">
                {detail.totalOutput.toLocaleString()}
                <span className="dp-modal-kpi-unit"> pcs</span>
              </div>
            </div>
            <div className="dp-modal-kpi">
              <div className="dp-modal-kpi-label">Total Daily Target</div>
              <div className="dp-modal-kpi-value">
                {detail.totalTarget.toLocaleString()}
                <span className="dp-modal-kpi-unit"> pcs</span>
              </div>
            </div>
            <div className={`dp-modal-kpi ${detail.due > 0 ? 'dp-modal-kpi-warning' : 'dp-modal-kpi-good'}`}>
              <div className="dp-modal-kpi-label">
                {detail.due > 0 ? 'Remaining Balance (Due)' : 'Surplus Achieved'}
              </div>
              <div className="dp-modal-kpi-value">
                {(detail.due > 0 ? detail.due : detail.surplus).toLocaleString()}
                <span className="dp-modal-kpi-unit"> pcs</span>
              </div>
            </div>
            <div className={`dp-modal-kpi ${effClass}`}>
              <div className="dp-modal-kpi-label">Day Efficiency</div>
              <div className="dp-modal-kpi-value">
                {detail.efficiency}
                <span className="dp-modal-kpi-unit">%</span>
              </div>
            </div>
          </div>

          {/* ---- Process-wise statistics ---- */}
          <h4 className="dp-modal-section-title">
            Process-wise breakdown · {detail.processCount} process{detail.processCount === 1 ? '' : 'es'}
          </h4>
          {detail.processes.length === 0 ? (
            <p className="dp-empty">No process was recorded for this day.</p>
          ) : (
            <div className="table-wrap">
              <table className="dp-table">
                <thead>
                  <tr>
                    <th>Process</th>
                    <th>Style</th>
                    <th className="dp-num">Output</th>
                    <th className="dp-num">Target</th>
                    <th className="dp-num">Variance</th>
                    <th className="dp-num">Defects</th>
                    <th className="dp-num">Achievement</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.processes.map((p) => {
                    const variance = p.output - p.target;
                    return (
                      <tr key={p.process}>
                        <td className="dp-strong">{p.process}</td>
                        <td>{p.style || '—'}</td>
                        <td className="mono-cell dp-num">{p.output.toLocaleString()}</td>
                        <td className="mono-cell dp-num">{p.target.toLocaleString()}</td>
                        <td className={`mono-cell dp-num ${variance >= 0 ? 'dp-good' : 'dp-bad'}`}>
                          {variance === 0
                            ? 'On target'
                            : variance > 0
                              ? `+${variance.toLocaleString()} Achieved`
                              : `${Math.abs(variance).toLocaleString()} Due`}
                        </td>
                        <td className="mono-cell dp-num">{p.defects.toLocaleString()}</td>
                        <td className="mono-cell dp-num">
                          <span className={`dp-eff-badge ${effTone(p.achievement)}`}>{p.achievement}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="dp-sheet-total">
                    <td colSpan={2}>Day total</td>
                    <td className="mono-cell dp-num">{detail.totalOutput.toLocaleString()}</td>
                    <td className="mono-cell dp-num">{detail.totalTarget.toLocaleString()}</td>
                    <td className={`mono-cell dp-num ${detail.variance >= 0 ? 'dp-good' : 'dp-bad'}`}>
                      {detail.varianceLabel}
                    </td>
                    <td className="mono-cell dp-num">{detail.defects.toLocaleString()}</td>
                    <td className="mono-cell dp-num">
                      <span className={`dp-eff-badge ${effTone(detail.efficiency)}`}>{detail.efficiency}%</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="dp-modal-foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** One month-end figure. `level` tints the value the way the KPI cards do. */
function SummaryTile({ icon, label, value, unit, level }) {
  return (
    <div className="dp-month-tile">
      <div className="dp-month-tile-label">
        {icon && <span aria-hidden="true">{icon}</span>} {label}
      </div>
      <div className={`dp-month-tile-value${level ? ` dp-kpi-${level}` : ''}`}>
        {value}{unit && <span className="dp-month-tile-unit"> {unit}</span>}
      </div>
    </div>
  );
}
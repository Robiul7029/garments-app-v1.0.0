import React, { useEffect, useMemo, useState } from 'react';
import { useRole } from '../context/RoleContext';
import { getAttendanceFromFirestore, getWorkersFromFirestore } from '../utils/attendance';
import { buildDateRangeReport, downloadDateRangeAttendanceReport } from '../utils/attendanceExport';

const COMPANY_NAME = 'ART BOUTIQUE SRL';
const DEPARTMENTS = ['Cutting', 'Sewing', 'Finishing', 'Washing', 'Delivery', 'Iron', 'Other'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** First and last ISO day of a YYYY-MM key. */
function monthBounds(monthValue) {
  const [year, month] = String(monthValue || '').split('-').map(Number);
  if (!year || !month) return null;
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: isoDate(new Date(year, month, 0)),
  };
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currentRange() {
  const now = new Date();
  return { start: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), end: isoDate(now) };
}

function rangeForMonths(months) {
  const now = new Date();
  return { start: isoDate(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)), end: isoDate(now) };
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Single letter code for the register grid. '·' means no record for that day yet.
function dayCode(status) {
  const value = String(status || '').toLowerCase();
  if (!value) return '·';
  if (value.startsWith('p')) return 'P';
  if (value.startsWith('a')) return 'A';
  if (value.startsWith('l')) return 'L';
  return '·';
}

// True when the 1-based day of the given YYYY-MM month lands on a Sunday. Built from a
// local Date so the result always follows the month/year shown in the register.
function isSundayDay(monthValue, day) {
  const [year, month] = String(monthValue || '').split('-').map(Number);
  if (!year || !month) return false;
  return new Date(year, month - 1, day).getDay() === 0;
}

// Cell contents for one worker/day. A Sunday with no saved status is a holiday, so it
// renders blank instead of the usual '·' placeholder; an explicit Sunday record (P/A/L)
// is shown normally, and every non-Sunday keeps the '·'.
function registerCell(monthValue, day, status) {
  const hasStatus = Boolean(String(status || '').trim());
  if (!hasStatus && isSundayDay(monthValue, day)) return '';
  return dayCode(status);
}

export default function AttendanceReport() {
  const { isAdmin } = useRole();
  const initialRange = currentRange();
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [workers, setWorkers] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Preview filters. The exported .xlsx always covers the full date range so an
  // official document is never narrowed by what happens to be on screen.
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  // The Worker Summary's own month picker. Defaults to the running month and drives BOTH the
  // summary preview and the printable register below it, so the two can never disagree.
  const [summaryMonth, setSummaryMonth] = useState(currentMonthKey);

  useEffect(() => {
    async function loadReportData() {
      try {
        const [workerRows, attendanceRows] = await Promise.all([getWorkersFromFirestore(), getAttendanceFromFirestore()]);
        setWorkers(workerRows);
        setRecords(attendanceRows);
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    }
    loadReportData();
  }, []);

  function applyPreset(months) {
    const range = months === 1 ? currentRange() : rangeForMonths(months);
    setStartDate(range.start);
    setEndDate(range.end);
    setMessage('');
  }

  function validateRange() {
    if (!startDate || !endDate) {
      setError('Please select both a start date and an end date.');
      return false;
    }
    if (startDate > endDate) {
      setError('Start date cannot be after end date.');
      return false;
    }
    return true;
  }

  async function handleExport() {
    setMessage('');
    setError('');
    if (!validateRange()) return;
    setExporting(true);
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      downloadDateRangeAttendanceReport(workers, records, startDate, endDate);
      setMessage('Attendance report downloaded successfully.');
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setExporting(false);
    }
  }

  // Hooks must run before the admin early-return below, so all derived data is
  // computed first and the guard stays where it was.
  // The printable register is driven by the Worker Summary month picker, so the register and
  // the preview above it always show the same month.
  const registerYear = Number(String(summaryMonth).slice(0, 4));
  const registerMonthIndex = Number(String(summaryMonth).slice(5, 7)) - 1;
  const registerDays = Number.isFinite(registerYear) && Number.isFinite(registerMonthIndex)
    ? daysInMonth(registerYear, registerMonthIndex)
    : 0;
  const registerMonthKey = summaryMonth;
  // The Worker Summary preview reads exactly the month the register prints.
  const summaryBounds = monthBounds(summaryMonth) || { start: startDate, end: endDate };

  const registerRows = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return workers
      .map((worker) => {
        const workerRecords = records.filter((record) => (
          String(record.workerId) === String(worker.workerId)
          && String(record.date || '').startsWith(registerMonthKey)
        ));
        return {
          workerId: worker.workerId,
          name: worker.name,
          department: workerRecords.find((record) => record.department)?.department || worker.department || '-',
          byDay: Object.fromEntries(workerRecords.map((record) => [Number(String(record.date).slice(-2)), record.status])),
          present: workerRecords.filter((record) => ['Present', 'Late'].includes(record.status)).length,
          late: workerRecords.filter((record) => record.status === 'Late').length,
          leave: workerRecords.filter((record) => record.status === 'Leave').length,
          absent: workerRecords.filter((record) => record.status === 'Absent').length,
          overtime: workerRecords.reduce((total, record) => total + Number(record.overtimeHours || 0), 0),
        };
      })
      .filter((row) => {
        if (!term) return true;
        return row.name.toLowerCase().includes(term) || String(row.workerId).toLowerCase().includes(term);
      })
      .filter((row) => !department || row.department === department);
  }, [workers, records, registerMonthKey, search, department]);

  const totals = useMemo(() => registerRows.reduce((acc, row) => ({
    present: acc.present + row.present,
    late: acc.late + row.late,
    leave: acc.leave + row.leave,
    absent: acc.absent + row.absent,
    overtime: acc.overtime + row.overtime,
  }), { present: 0, late: 0, leave: 0, absent: 0, overtime: 0 }), [registerRows]);

  // Attendance rate counts anyone on the floor (present or late) against everyone on
  // the register for the month, so an unmarked day counts as a non-attendance.
  const registeredDays = registerRows.length * registerDays;
  const attendanceRate = registeredDays
    ? Math.round(((totals.present + totals.late) / registeredDays) * 1000) / 10
    : 0;

  const filteredSummary = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return buildDateRangeReport(workers, records, summaryBounds.start, summaryBounds.end).summaryRows.filter((row) => {
      const matchesTerm = !term
        || String(row['Worker Name']).toLowerCase().includes(term)
        || String(row['Worker ID']).toLowerCase().includes(term);
      return matchesTerm && (!department || row.Department === department);
    });
  }, [workers, records, summaryBounds.start, summaryBounds.end, search, department]);

  if (!isAdmin) return <div className="module"><div className="module-header"><h2>📊 Attendance Report</h2></div><div className="restricted-card"><p className="hint">Only approved managers can export attendance reports.</p></div></div>;

  // Built from the summary month, so the record count under the preview matches the register.
  const preview = buildDateRangeReport(workers, records, summaryBounds.start, summaryBounds.end);
  const registerPeriod = `${MONTH_NAMES[registerMonthIndex] || ''} ${registerYear}`.trim();

  return <div className="module attendance-report-page">
    <div className="module-header"><h2>📊 Attendance Report</h2><p className="hint">Generate detailed logs, worker summaries and an official printable register.</p></div>
    <div className="report-range-panel">
      <div className="report-date-fields"><label className="form-field"><span>Start Date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label className="form-field"><span>End Date</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
      <div className="report-presets"><span className="hint">Quick range</span><button className="btn btn-outline" onClick={() => applyPreset(1)}>This Month</button><button className="btn btn-outline" onClick={() => applyPreset(2)}>Last 2 Months</button><button className="btn btn-outline" onClick={() => applyPreset(3)}>Last 3 Months</button><button className="btn btn-outline" onClick={() => applyPreset(6)}>Last 6 Months</button><button className="btn btn-outline" onClick={() => applyPreset(12)}>Full Year (12 Months)</button></div>
      <div className="report-action-row">
        <button className="btn btn-primary" onClick={handleExport} disabled={loading || exporting}>{exporting ? 'Generating Excel...' : '⬇ Export Attendance Report (.xlsx)'}</button>
        <button
          className="btn btn-outline"
          disabled={loading}
          onClick={() => {
            if (!validateRange()) return;
            setMessage('');
            // The print stylesheet hides everything except the register block, so the
            // browser's own "Save as PDF" produces the official sheet.
            window.print();
          }}
        >
          🖨 Print / PDF Register
        </button>
      </div>
    </div>
    {loading && <p className="hint">Loading attendance data...</p>}
    {exporting && <p className="report-progress">Preparing records and generating Excel workbook...</p>}
    {message && <p className="settings-success">{message}</p>}{error && <p className="auth-error">{error}</p>}

    // A 2-column grid on every screen size, so the four summary metrics always read as a
    // tidy 2x2 block instead of one long vertical list.
    <div className="att-dash-cards report-kpi-cards report-kpi-grid">
      <div className="att-card att-card-green"><span className="att-card-count">{registerRows.length}</span><span className="att-card-label">👷 Total Workers</span></div>
      <div className="att-card att-card-orange"><span className="att-card-count">{attendanceRate}%</span><span className="att-card-label">📈 Attendance Rate</span></div>
      <div className="att-card att-card-amber"><span className="att-card-count">{totals.overtime.toFixed(2)}</span><span className="att-card-label">⏰ Total OT Hours</span></div>
      <div className="att-card att-card-red"><span className="att-card-count">{totals.absent + totals.leave}</span><span className="att-card-label">🚫 Absences &amp; Leaves</span></div>
    </div>

    <div className="attendance-toolbar report-filters">
      <label className="form-field"><span>🗓️ Worker Summary Month</span><input type="month" value={summaryMonth} onChange={(event) => setSummaryMonth(event.target.value)} /></label>
      <label className="form-field"><span>🔎 Search Worker</span><input type="search" value={search} placeholder="Name or ID" onChange={(event) => setSearch(event.target.value)} /></label>
      <label className="form-field"><span>Department</span><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">All Departments</option>{DEPARTMENTS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <span className="hint">The month picker drives the Worker Summary preview and the printable register below — both follow it.</span>
    </div>

    <div className="report-preview">
      <h3 className="section-sub">Worker Summary Preview — {registerPeriod}</h3>
      <div className="table-wrap report-sticky-wrap">
        <table>
          <thead><tr><th>Worker ID</th><th>Worker Name</th><th>Department</th><th>Total Present</th><th>Total Late</th><th>Total Absent</th><th>Leave</th><th>Total OT Hours</th></tr></thead>
          <tbody>
            {filteredSummary.map((row) => <tr key={row['Worker ID']}><td>{row['Worker ID']}</td><td>{row['Worker Name']}</td><td>{row.Department}</td><td>{row['Total Present']}</td><td>{row['Total Late']}</td><td>{row['Total Absent']}</td><td>{row.Leave}</td><td>{row['Total OT Hours'].toFixed(2)}</td></tr>)}
            {!filteredSummary.length && <tr><td colSpan="8" className="empty-row">No workers found.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">{preview.detailedRows.length} detailed attendance records match this range. The Excel file contains both this summary and the detailed daily logs.</p>
    </div>

    {/* ---------------- Official printable register ---------------- */}
    <section className="print-register" id="attendance-register">
      <header className="print-register-header">
        <h2 className="print-register-company">{COMPANY_NAME}</h2>
        <p className="print-register-title">Factory Attendance Register</p>
        <p className="print-register-period">{registerPeriod}</p>
      </header>

      <div className="print-register-table-wrap">
        <table className="print-register-table">
          <thead>
            <tr>
              <th rowSpan={2} className="print-register-sticky">Worker ID</th>
              <th rowSpan={2} className="print-register-sticky print-register-sticky-name">Worker Name</th>
              <th rowSpan={2}>Department</th>
              <th colSpan={registerDays}>Daily Status (P = Present, A = Absent, L = Leave)</th>
              <th rowSpan={2}>Total Present</th>
              <th rowSpan={2}>Total Absent</th>
              <th rowSpan={2}>Total Late</th>
              <th rowSpan={2}>Total OT Hours</th>
            </tr>
            <tr>{Array.from({ length: registerDays }, (_, index) => <th key={index + 1} className={`print-register-sticky-head${isSundayDay(registerMonthKey, index + 1) ? ' print-register-sunday' : ''}`}>{index + 1}</th>)}</tr>
          </thead>
          <tbody>
            {registerRows.map((row) => (
              <tr key={row.workerId}>
                <td className="print-register-sticky">{row.workerId}</td>
                <td className="print-register-name print-register-sticky print-register-sticky-name">{row.name}</td>
                <td>{row.department}</td>
                {Array.from({ length: registerDays }, (_, index) => { const sunday = isSundayDay(registerMonthKey, index + 1); return <td key={index + 1} className={`print-register-day${sunday ? ' print-register-sunday' : ''}`}>{registerCell(registerMonthKey, index + 1, row.byDay[index + 1])}</td>; })}
                <td>{row.present}</td>
                <td>{row.absent}</td>
                <td>{row.late}</td>
                <td>{row.overtime.toFixed(2)}</td>
              </tr>
            ))}
            {!registerRows.length && <tr><td colSpan={registerDays + 7} className="empty-row">No workers match the current filters.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="print-register-sticky">TOTAL</td>
              {Array.from({ length: registerDays }, (_, index) => <td key={`total-${index + 1}`} />)}
              <td>{totals.present}</td>
              <td>{totals.absent}</td>
              <td>{totals.late}</td>
              <td>{totals.overtime.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="print-register-meta">
        <span>Total Workers: {registerRows.length}</span>
        <span>Present: {totals.present}</span>
        <span>Absent: {totals.absent}</span>
        <span>Late: {totals.late}</span>
        <span>Leave: {totals.leave}</span>
        <span>Total OT: {totals.overtime.toFixed(2)} h</span>
      </div>

      <footer className="print-register-footer">
        <div className="print-notes">
          <span className="print-notes-label">Notes / Remarks:</span>
          <span className="print-notes-rule" />
        </div>
        <div className="print-signature"><span className="print-signature-line" /><span>Prepared By</span></div>
        <div className="print-signature"><span className="print-signature-line" /><span>Checked By</span></div>
        <div className="print-signature"><span className="print-signature-line" /><span>Approved By</span></div>
      </footer>
    </section>
  </div>;
}

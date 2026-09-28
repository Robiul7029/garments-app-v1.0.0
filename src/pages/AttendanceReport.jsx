import React, { useEffect, useMemo, useState } from 'react';
import { useRole } from '../context/RoleContext';
import { getAttendanceFromFirestore, getWorkersFromFirestore } from '../utils/attendance';
import { buildDateRangeReport, downloadDateRangeAttendanceReport } from '../utils/attendanceExport';

const COMPANY_NAME = 'ART BOUTIQUE SRL';
const DEPARTMENTS = ['Cutting', 'Sewing', 'Finishing', 'Washing', 'Delivery', 'Iron', 'Other'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
  // The printable sheet is a single month, taken from the start date.
  const registerYear = Number(String(startDate).slice(0, 4));
  const registerMonthIndex = Number(String(startDate).slice(5, 7)) - 1;
  const registerDays = daysInMonth(registerYear, registerMonthIndex);
  const registerMonthKey = `${registerYear}-${String(registerMonthIndex + 1).padStart(2, '0')}`;

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
    return buildDateRangeReport(workers, records, startDate, endDate).summaryRows.filter((row) => {
      const matchesTerm = !term
        || String(row['Worker Name']).toLowerCase().includes(term)
        || String(row['Worker ID']).toLowerCase().includes(term);
      return matchesTerm && (!department || row.Department === department);
    });
  }, [workers, records, startDate, endDate, search, department]);

  if (!isAdmin) return <div className="module"><div className="module-header"><h2>📊 Attendance Report</h2></div><div className="restricted-card"><p className="hint">Only approved managers can export attendance reports.</p></div></div>;

  const preview = buildDateRangeReport(workers, records, startDate, endDate);
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

    <div className="att-dash-cards report-kpi-cards">
      <div className="att-card att-card-green"><span className="att-card-count">{registerRows.length}</span><span className="att-card-label">👷 Total Workers</span></div>
      <div className="att-card att-card-orange"><span className="att-card-count">{attendanceRate}%</span><span className="att-card-label">📈 Attendance Rate</span></div>
      <div className="att-card att-card-amber"><span className="att-card-count">{totals.overtime.toFixed(2)}</span><span className="att-card-label">⏰ Total OT Hours</span></div>
      <div className="att-card att-card-red"><span className="att-card-count">{totals.absent + totals.leave}</span><span className="att-card-label">🚫 Absences &amp; Leaves</span></div>
    </div>

    <div className="attendance-toolbar report-filters">
      <label className="form-field"><span>🔎 Search Worker</span><input type="search" value={search} placeholder="Name or ID" onChange={(event) => setSearch(event.target.value)} /></label>
      <label className="form-field"><span>Department</span><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">All Departments</option>{DEPARTMENTS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <span className="hint">Filters apply to the preview and the printable register below.</span>
    </div>

    <div className="report-preview">
      <h3 className="section-sub">Worker Summary Preview</h3>
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
              <th rowSpan={2}>Worker ID</th>
              <th rowSpan={2}>Worker Name</th>
              <th rowSpan={2}>Department</th>
              <th colSpan={registerDays}>Daily Status (P = Present, A = Absent, L = Leave)</th>
              <th rowSpan={2}>Total Present</th>
              <th rowSpan={2}>Total Absent</th>
              <th rowSpan={2}>Total Late</th>
              <th rowSpan={2}>Total OT Hours</th>
            </tr>
            <tr>{Array.from({ length: registerDays }, (_, index) => <th key={index + 1}>{index + 1}</th>)}</tr>
          </thead>
          <tbody>
            {registerRows.map((row) => (
              <tr key={row.workerId}>
                <td>{row.workerId}</td>
                <td className="print-register-name">{row.name}</td>
                <td>{row.department}</td>
                {Array.from({ length: registerDays }, (_, index) => <td key={index + 1} className="print-register-day">{dayCode(row.byDay[index + 1])}</td>)}
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
              <td colSpan={3}>TOTAL</td>
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

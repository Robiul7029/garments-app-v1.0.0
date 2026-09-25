import React, { useEffect, useState } from 'react';
import { useRole } from '../context/RoleContext';
import { getAttendanceFromFirestore, getWorkersFromFirestore } from '../utils/attendance';
import { buildDateRangeReport, downloadDateRangeAttendanceReport } from '../utils/attendanceExport';

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

  async function handleExport() {
    setMessage('');
    setError('');
    if (!startDate || !endDate) {
      setError('Please select both a start date and an end date.');
      return;
    }
    if (startDate > endDate) {
      setError('Start date cannot be after end date.');
      return;
    }
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

  if (!isAdmin) return <div className="module"><div className="module-header"><h2>📊 Attendance Report</h2></div><div className="restricted-card"><p className="hint">Only approved managers can export attendance reports.</p></div></div>;

  const preview = buildDateRangeReport(workers, records, startDate, endDate);

  return <div className="module attendance-report-page">
    <div className="module-header"><h2>📊 Attendance Report</h2><p className="hint">Generate detailed logs and worker summaries for any date range.</p></div>
    <div className="report-range-panel">
      <div className="report-date-fields"><label className="form-field"><span>Start Date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label className="form-field"><span>End Date</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
      <div className="report-presets"><span className="hint">Quick range</span><button className="btn btn-outline" onClick={() => applyPreset(1)}>This Month</button><button className="btn btn-outline" onClick={() => applyPreset(2)}>Last 2 Months</button><button className="btn btn-outline" onClick={() => applyPreset(3)}>Last 3 Months</button><button className="btn btn-outline" onClick={() => applyPreset(6)}>Last 6 Months</button><button className="btn btn-outline" onClick={() => applyPreset(12)}>Full Year (12 Months)</button></div>
      <button className="btn btn-primary" onClick={handleExport} disabled={loading || exporting}>{exporting ? 'Generating Excel...' : '⬇ Export Attendance Report (.xlsx)'}</button>
    </div>
    {loading && <p className="hint">Loading attendance data...</p>}
    {exporting && <p className="report-progress">Preparing records and generating Excel workbook...</p>}
    {message && <p className="settings-success">{message}</p>}{error && <p className="auth-error">{error}</p>}
    <div className="report-preview"><h3 className="section-sub">Worker Summary Preview</h3><div className="table-wrap"><table><thead><tr><th>Worker ID</th><th>Worker Name</th><th>Total Present</th><th>Total Late</th><th>Total Absent</th><th>Leave</th><th>Total OT Hours</th></tr></thead><tbody>{preview.summaryRows.map((row) => <tr key={row['Worker ID']}><td>{row['Worker ID']}</td><td>{row['Worker Name']}</td><td>{row['Total Present']}</td><td>{row['Total Late']}</td><td>{row['Total Absent']}</td><td>{row.Leave}</td><td>{row['Total OT Hours'].toFixed(2)}</td></tr>)}{!preview.summaryRows.length && <tr><td colSpan="7" className="empty-row">No workers found.</td></tr>}</tbody></table></div><p className="hint">{preview.detailedRows.length} detailed attendance records match this range. The Excel file contains both this summary and the detailed daily logs.</p></div>
  </div>;
}

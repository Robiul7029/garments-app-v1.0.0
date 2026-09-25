import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRole } from '../context/RoleContext';
import { getAttendanceFromFirestore, getWorkersFromFirestore } from '../utils/attendance';
import { buildMonthlyRegister, downloadMonthlyAttendanceWorkbook } from '../utils/attendanceExport';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function AttendanceExport() {
  const { isAdmin } = useRole();
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState(() => new URLSearchParams(window.location.search).get('month') || currentMonth());
  const [workers, setWorkers] = useState([]);
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [year, month] = selectedMonth.split('-').map(Number);
  const registerRows = useMemo(() => buildMonthlyRegister(workers, records, year, month - 1), [workers, records, year, month]);

  useEffect(() => {
    async function load() {
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
    load();
  }, []);

  function handleDownload() {
    downloadMonthlyAttendanceWorkbook(workers, records, selectedMonth);
    setMessage(`Monthly register downloaded for ${selectedMonth}.`);
  }

  if (!isAdmin) return <div className="module"><div className="module-header"><h2>📊 Monthly Attendance Export</h2></div><div className="restricted-card"><p className="hint">Only approved managers can export attendance registers.</p></div></div>;

  return (
    <div className="module attendance-export-page">
      <div className="module-header"><h2>📊 Monthly Attendance Register</h2><p className="hint">One row per worker with Day 1–31 status and detailed time logs in the second Excel tab.</p></div>
      <div className="attendance-toolbar"><label className="form-field"><span>Month & Year</span><input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></label><button className="btn btn-primary" onClick={handleDownload}>⬇ Download Monthly Attendance Sheet (.xlsx)</button><button className="btn btn-outline" onClick={() => navigate('/attendance/daily-attendance')}>← Daily Attendance</button></div>
      {loading && <p className="hint">Loading attendance register...</p>}
      {error && <p className="auth-error">{error}</p>}
      {message && <p className="settings-success">{message}</p>}
      <div className="table-wrap attendance-register-wrap"><table><thead><tr><th>Worker ID</th><th>Worker Name</th><th>Department</th>{Array.from({ length: 31 }, (_, index) => <th key={index + 1}>Day {index + 1}</th>)}<th>Total Present</th><th>Total Late</th><th>Total Absent</th><th>Total OT Hours</th></tr></thead><tbody>{registerRows.map((row) => <tr key={row['Worker ID']}><td>{row['Worker ID']}</td><td>{row['Worker Name']}</td><td>{row.Department || '-'}</td>{Array.from({ length: 31 }, (_, index) => <td key={index + 1}>{row[`Day ${index + 1}`] || '·'}</td>)}<td>{row['Total Present']}</td><td>{row['Total Late']}</td><td>{row['Total Absent']}</td><td>{row['Total OT Hours'].toFixed(2)}</td></tr>)}{!registerRows.length && <tr><td colSpan="38" className="empty-row">No workers found. Seed the worker list from Smart Attendance first.</td></tr>}</tbody></table></div>
    </div>
  );
}

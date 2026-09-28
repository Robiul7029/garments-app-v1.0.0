import React, { useEffect, useMemo, useState } from 'react';
import {
  getAttendanceFromFirestore,
  getWorkersFromFirestore,
  isInMonth,
} from '../utils/attendance';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return today().slice(0, 7);
}

function monthDays(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

// Excel-style status abbreviation rendered in the top line of every day cell.
const STATUS_MARKS = {
  Present: 'P',
  Absent: 'A',
  Late: 'L',
  Leave: 'LV',
};

/**
 * Monthly Attendance Matrix Grid — an Excel-like sheet where each row is a worker and each
 * of the 1..31 columns is a day. Every cell stacks Department / Status / In-Time / Out-Time.
 * The first column is sticky so names stay visible while scrolling through 31 days.
 */
export default function AttendanceMatrixGrid() {
  const [workers, setWorkers] = useState([]);
  const [records, setRecords] = useState([]);
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [workerRows, attendanceRows] = await Promise.all([getWorkersFromFirestore(), getAttendanceFromFirestore()]);
        if (cancelled) return;
        setWorkers(workerRows || []);
        setRecords(attendanceRows || []);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Unable to load attendance data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const activeWorkers = useMemo(
    () => (workers || []).filter((worker) => worker && worker.active !== false && worker.status !== 'inactive'),
    [workers]
  );

  // workerId -> { [day]: record }. Later entries overwrite earlier ones so an edit
  // replaces the original value for that day instead of adding a second cell.
  const byWorkerDay = useMemo(() => {
    const [year, monthIndex] = month.split('-').map(Number);
    const map = {};
    (records || []).forEach((record) => {
      if (!isInMonth(record.date, year, monthIndex - 1)) return;
      const key = String(record.workerId);
      (map[key] = map[key] || {})[Number(String(record.date).slice(-2))] = record;
    });
    return map;
  }, [records, month]);

  // Days actually rendered: 31 for a full month, only the real length otherwise.
  const totalDays = useMemo(() => monthDays(month), [month]);
  const elapsedDays = String(month) === currentMonth() ? Number(today().slice(-2)) : totalDays;

  const rows = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return activeWorkers.filter((worker) => {
      if (!term) return true;
      return String(worker.workerId || '').toLowerCase().includes(term)
        || String(worker.name || '').toLowerCase().includes(term)
        || String(worker.department || '').toLowerCase().includes(term);
    });
  }, [activeWorkers, search]);

  return (
    <section className="att-matrix">
      <div className="att-dash-filters">
        <label className="form-field"><span>🗓 Month</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label className="form-field att-search-field"><span>🔎 Search Worker</span><input type="search" value={search} placeholder="Name, ID or Department" onChange={(event) => setSearch(event.target.value)} /></label>
        <span className="hint">P = Present · A = Absent · L = Late · LV = Leave · “–” = no entry</span>
      </div>

      {loading && <p className="empty-row">Loading matrix…</p>}
      {!loading && error && <p className="auth-error">{error}</p>}

      {!loading && !error && (
        <div className="att-matrix-scroll">
          <table className="att-matrix-table">
            <thead>
              <tr>
                <th className="att-matrix-sticky-col att-matrix-head">Name / Emp ID</th>
                {Array.from({ length: totalDays }, (_, index) => {
                  const day = index + 1;
                  const isFuture = day > elapsedDays;
                  return <th key={day} className={`att-matrix-head att-matrix-day-head ${isFuture ? 'is-future' : ''}`}>{day}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((worker, index) => {
                const workerRecords = byWorkerDay[String(worker.workerId)] || {};
                // Excel zebra striping: row 1, 3, 5 are the darker sky blue.
                const rowClass = index % 2 === 0 ? 'att-row-odd' : 'att-row-even';
                return (
                  <tr key={worker.workerId} className={rowClass}>
                    <th scope="row" className="att-matrix-sticky-col">
                      <span className="att-matrix-name">{worker.name}</span>
                      <span className="att-matrix-id">{worker.workerId}</span>
                    </th>
                    {Array.from({ length: totalDays }, (_, dayIndex) => {
                      const day = dayIndex + 1;
                      const record = workerRecords[day];
                      const department = record?.department || worker.department || '–';
                      const status = record?.status;
                      return (
                        <td key={day} className={`att-matrix-cell ${status ? `att-cell-${String(status).toLowerCase()}` : ''}`}>
                          <span className="att-cell-dept">{department}</span>
                          <span className="att-cell-status">{status ? STATUS_MARKS[status] || status : '–'}</span>
                          <span className="att-cell-time">{record?.inTime || '–'}</span>
                          <span className="att-cell-time">{record?.outTime || '–'}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr className="att-row-odd"><td colSpan={totalDays + 1} className="empty-row">No workers match this search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

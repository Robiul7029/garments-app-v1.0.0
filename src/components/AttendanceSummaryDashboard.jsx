import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

const CATEGORY_TONES = [
  ['present', '\u{1F7E2} Present', 'att-card-green'],
  ['absent', '\u{1F534} Auto Absent', 'att-card-red'],
  ['leave', '\u{1F7E1} Leave', 'att-card-amber'],
  ['late', '\u{1F7E0} Late / Other', 'att-card-orange'],
];

/**
 * Attendance Summary Dashboard — single source of truth for the PRESENT / AUTO ABSENT /
 * LEAVE / LATE cards. Supports Single Day and Monthly View plus a worker search, and is
 * self-contained so any page can mount it right under its heading.
 */
export default function AttendanceSummaryDashboard() {
  const [workers, setWorkers] = useState([]);
  const [records, setRecords] = useState([]);
  const [mode, setMode] = useState('daily');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('present');
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

  // Only registered, non-inactive workers are counted — otherwise a deactivated worker
  // would show up as "Auto Absent" forever.
  const activeWorkers = useMemo(
    () => (workers || []).filter((worker) => worker && worker.active !== false && worker.status !== 'inactive'),
    [workers]
  );

  const matchesSearch = useCallback((worker) => {
    const term = String(search || '').trim().toLowerCase();
    if (!term) return true;
    return String(worker?.workerId || '').toLowerCase().includes(term)
      || String(worker?.name || '').toLowerCase().includes(term)
      || String(worker?.department || '').toLowerCase().includes(term);
  }, [search]);

  // Single day: buckets are derived per worker for the chosen date. Any worker without a
  // Present/Late/Leave record for that day is automatically Absent.
  const dayBuckets = useMemo(() => {
    const byId = {};
    (records || []).forEach((record) => {
      const key = String(record.workerId);
      (byId[key] = byId[key] || []).push(record);
    });
    const buckets = { present: [], absent: [], leave: [], late: [] };
    activeWorkers.filter(matchesSearch).forEach((worker) => {
      const rows = (byId[String(worker.workerId)] || []).filter((row) => row.date === date);
      const present = rows.find((row) => row.status === 'Present');
      const late = rows.find((row) => row.status === 'Late');
      const leave = rows.find((row) => row.status === 'Leave');
      const explicitAbsent = rows.find((row) => row.status === 'Absent');
      if (present) buckets.present.push({ ...worker, record: present, checkIn: present.inTime || '-', department: present.department || worker.department || '-', detail: `In ${present.inTime || '-'} · Out ${present.outTime || '-'}` });
      else if (late) buckets.late.push({ ...worker, record: late, checkIn: late.inTime || '-', department: late.department || worker.department || '-', detail: 'Late arrival' });
      else if (leave) buckets.leave.push({ ...worker, record: leave, checkIn: '-', department: leave.department || worker.department || '-', detail: leave.reason || 'Approved leave' });
      else if (explicitAbsent) buckets.absent.push({ ...worker, record: explicitAbsent, checkIn: '-', department: explicitAbsent.department || worker.department || '-', detail: 'Marked absent' });
      else buckets.absent.push({ ...worker, checkIn: '-', department: worker.department || '-', detail: 'No attendance entry' });
    });
    return buckets;
  }, [records, activeWorkers, matchesSearch, date]);

  // Monthly view: real records per status, and Auto Absent is derived from every elapsed
  // calendar day of the month that has no entry for that worker.
  const monthBuckets = useMemo(() => {
    const [year, monthIndex] = month.split('-').map(Number);
    const elapsed = String(month) === currentMonth() ? Number(today().slice(-2)) : monthDays(month);
    const buckets = { present: [], absent: [], leave: [], late: [] };
    activeWorkers.filter(matchesSearch).forEach((worker) => {
      const rows = (records || []).filter((record) => String(record.workerId) === String(worker.workerId) && isInMonth(record.date, year, monthIndex - 1));
      const markedDays = new Set(rows.map((record) => Number(String(record.date).slice(-2))));
      const base = { ...worker, department: worker.department || rows.find((record) => record.department)?.department || '-' };
      rows.filter((record) => record.status === 'Present').forEach((record) => buckets.present.push({ ...base, checkIn: `${record.date}`, department: record.department || base.department, detail: `In ${record.inTime || '-'} · OT ${Number(record.overtimeHours || 0).toFixed(2)}h` }));
      rows.filter((record) => record.status === 'Late').forEach((record) => buckets.late.push({ ...base, checkIn: `${record.date}`, department: record.department || base.department, detail: 'Late arrival' }));
      rows.filter((record) => record.status === 'Leave').forEach((record) => buckets.leave.push({ ...base, checkIn: `${record.date}`, department: record.department || base.department, detail: record.reason || 'Approved leave' }));
      const autoAbsent = Math.max(0, elapsed - markedDays.size);
      if (autoAbsent > 0) buckets.absent.push({ ...base, checkIn: `${autoAbsent} day${autoAbsent === 1 ? '' : 's'}`, detail: 'No attendance entry' });
    });
    return buckets;
  }, [records, activeWorkers, matchesSearch, month]);

  const buckets = mode === 'daily' ? dayBuckets : monthBuckets;
  const activeEntries = buckets[statusFilter] || [];
  const scopeLabel = mode === 'daily' ? date : month;

  return (
    <section className="att-dash">
      <div className="att-dash-head">
        <div className="att-dash-filters">
          <div className="attendance-detail-tabs">
            <button type="button" className={`attendance-tab ${mode === 'daily' ? 'active' : ''}`} onClick={() => setMode('daily')}>Single Day</button>
            <button type="button" className={`attendance-tab ${mode === 'monthly' ? 'active' : ''}`} onClick={() => setMode('monthly')}>Monthly View</button>
          </div>
          {mode === 'daily' ? (
            <label className="form-field"><span>📅 Single Day</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          ) : (
            <label className="form-field"><span>🗓 Monthly View</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
          )}
          <label className="form-field att-search-field"><span>🔎 Search Worker</span><input type="search" value={search} placeholder="Name, ID or Department" onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
        <div className="att-dash-cards">
          {CATEGORY_TONES.map(([key, label, tone]) => (
            <button key={key} type="button" className={`att-card ${tone} ${statusFilter === key ? 'active' : ''}`} onClick={() => setStatusFilter(key)}>
              <span className="att-card-count">{(buckets[key] || []).length}</span>
              <span className="att-card-label">{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="att-card-body">
        {loading && <p className="empty-row">Loading attendance…</p>}
        {!loading && error && <p className="auth-error">{error}</p>}
        {!loading && !error && (activeEntries.length === 0
          ? <p className="empty-row">No workers in this category for {scopeLabel}.</p>
          : <ul className="att-list">{activeEntries.map((entry) => <li key={`${statusFilter}-${entry.workerId}-${entry.checkIn}`} className="att-list-row"><span className="att-id">{entry.workerId}</span><span className="att-name">{entry.name}</span><span className="att-dept">{entry.department}</span><span className="att-time">{entry.checkIn}</span>{entry.detail && <span className="att-reason">{entry.detail}</span>}</li>)}</ul>)}
      </div>
    </section>
  );
}

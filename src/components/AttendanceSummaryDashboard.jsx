import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAttendanceFromFirestore,
  getWorkersFromFirestore,
  isInMonth,
} from '../utils/attendance';
import AttendanceMatrixGrid, { bucketForStatus } from './AttendanceMatrixGrid';

/** Short human description shown next to a record in the filtered list. */
function describeRecord(record) {
  const status = String(record?.status || '').toLowerCase();
  if (status === 'leave') return record?.reason || 'Approved leave';
  if (status === 'absent') return 'Marked absent';
  if (status === 'late') return 'Late arrival';
  return `In ${record?.inTime || 'N/A'} · Out ${record?.outTime || 'N/A'}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Month portion of today as YYYY-MM, which is the format <input type="month"> needs. */
function currentMonth() {
  return today().slice(0, 7);
}

function emptyBuckets() {
  return { present: [], absent: [], leave: [], late: [] };
}

/**
 * Normalises whatever the attendance query returned into a flat array of records.
 * Tolerates a single object, an array, or a `{ items }` / `{ docs }` style envelope so a
 * shape change upstream can never crash the dashboard.
 */
function attendanceLogs(payload) {
  if (Array.isArray(payload)) return payload.filter(Boolean);
  if (payload && Array.isArray(payload.items)) return payload.items.filter(Boolean);
  if (payload && Array.isArray(payload.docs)) return payload.docs.filter(Boolean);
  if (payload && typeof payload === 'object') return [payload];
  return [];
}

const CATEGORY_TONES = [
  ['present', '\u{1F7E2} Present', 'att-card-green'],
  ['absent', '\u{1F534} Absent', 'att-card-red'],
  ['leave', '\u{1F7E1} Leave', 'att-card-amber'],
  ['late', '\u{1F7E0} Late / Other', 'att-card-orange'],
];

/**
 * Attendance Summary Dashboard — single source of truth for the PRESENT / ABSENT / LEAVE /
 * LATE cards and the Monthly Attendance Matrix below them.
 *
 * Every count comes from records actually saved in the Smart Attendance form (daily
 * attendance). Nothing is derived automatically: a day with no saved entry is not counted
 * and shows N/A in the grid.
 *
 * viewMode is 'all' | 'daily' | 'monthly'. 'all' is the default: no toggle is highlighted
 * and the whole current month is aggregated, so the cards and the matrix show full-month
 * data straight after page load. Clicking the active toggle returns to 'all'.
 *
 * Clicking a card filters the matrix (and the list) to that single status within the
 * currently selected period; clicking the same card again clears the filter.
 */
export default function AttendanceSummaryDashboard() {
  const [workers, setWorkers] = useState([]);
  const [records, setRecords] = useState([]);
  // 'all' = no toggle selected, so the full current month is shown.
  const [viewMode, setViewMode] = useState('all');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState('');
  // null = no status filter, the full matrix is shown.
  const [statusFilter, setStatusFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Runs once on mount. Every state setter below is guarded by the `active` flag and the
  // effect has an empty dependency array, so it can never re-trigger itself.
  useEffect(() => {
    // `active` is the single guard used by every setter below; the empty dependency array
    // means this effect can never re-trigger itself, so no render loop is possible.
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [workerRows, attendanceRows] = await Promise.all([getWorkersFromFirestore(), getAttendanceFromFirestore()]);
        if (!active) return;
        // Defensive: a null/undefined payload must never reach the array helpers below.
        setWorkers(Array.isArray(workerRows) ? workerRows : []);
        setRecords(attendanceLogs(attendanceRows));
      } catch (loadError) {
        if (!active) return;
        setWorkers([]);
        setRecords([]);
        setError(loadError?.message || 'Unable to load attendance data.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  // Only registered, non-inactive workers are listed.
  const activeWorkers = useMemo(() => {
    const source = Array.isArray(workers) ? workers : [];
    return source.filter((worker) => worker && worker.active !== false && worker.status !== 'inactive');
  }, [workers]);

  // One pass over the records builds workerId -> rows. Without this index every bucket
  // below would rescan the whole collection per worker, which is what froze the UI.
  const recordsByWorker = useMemo(() => {
    const map = new Map();
    const source = Array.isArray(records) ? records : [];
    source.forEach((record) => {
      if (!record) return;
      const key = String(record.workerId);
      const existing = map.get(key);
      if (existing) existing.push(record);
      else map.set(key, [record]);
    });
    return map;
  }, [records]);

  // Normalised lowercase search term, computed once instead of per worker.
  const searchTerm = useMemo(() => String(search || '').trim().toLowerCase(), [search]);

  const matchesSearch = useCallback((worker) => {
    if (!searchTerm) return true;
    if (!worker) return false;
    return String(worker.workerId || '').toLowerCase().includes(searchTerm)
      || String(worker.name || '').toLowerCase().includes(searchTerm)
      || String(worker.department || '').toLowerCase().includes(searchTerm);
  }, [searchTerm]);

  // Workers that survive the search box, computed once for both bucket sets.
  const filteredWorkers = useMemo(
    () => activeWorkers.filter(matchesSearch),
    [activeWorkers, matchesSearch]
  );

  // Single day: one entry per saved record for that date, bucketed by the status the user
  // chose. No record means no entry at all — nobody is counted as Absent automatically.
  const dayBuckets = useMemo(() => {
    const buckets = emptyBuckets();
    filteredWorkers.forEach((worker) => {
      const rows = (recordsByWorker.get(String(worker.workerId)) || [])
        .filter((row) => row && String(row.date || '').slice(0, 10) === date);
      rows.forEach((row) => {
        const bucket = bucketForStatus(row.status);
        if (!bucket) return;
        buckets[bucket].push({
          ...worker,
          record: row,
          checkIn: row.inTime || 'N/A',
          department: row.department || worker.department || 'N/A',
          detail: describeRecord(row),
        });
      });
    });
    return buckets;
  }, [filteredWorkers, recordsByWorker, date]);

  // Monthly view: one bucket entry per saved record. No auto-absent — only days the user
  // actually saved in Smart Attendance appear anywhere.
  const monthBuckets = useMemo(() => {
    const [year, monthIndex] = String(month || '').split('-').map(Number);
    const buckets = emptyBuckets();
    filteredWorkers.forEach((worker) => {
      const rows = (recordsByWorker.get(String(worker.workerId)) || [])
        .filter((row) => row && isInMonth(row.date, year, monthIndex - 1));
      const base = {
        ...worker,
        department: worker.department || rows.find((row) => row.department)?.department || 'N/A',
      };
      rows.forEach((row) => {
        const bucket = bucketForStatus(row.status);
        if (!bucket) return;
        buckets[bucket].push({
          ...base,
          record: row,
          checkIn: `${row.date}`,
          department: row.department || base.department,
          detail: describeRecord(row),
        });
      });
    });
    return buckets;
  }, [filteredWorkers, recordsByWorker, month]);

  // Workers that survive the active status card. The filter is applied globally so the
  // upper list AND the lower matrix show the same people, and it is a worker-level filter
  // (a worker is kept when they have at least one matching record in the current scope).
  const statusFilteredWorkers = useMemo(() => {
    if (!statusFilter) return filteredWorkers;
    const [year, monthIndex] = viewMode === 'daily'
      ? String(date || '').split('-').map(Number)
      : String(month || '').split('-').map(Number);
    return filteredWorkers.filter((worker) => {
      const rows = recordsByWorker.get(String(worker.workerId)) || [];
      return rows.some((row) => {
        if (!row) return false;
        const inScope = viewMode === 'daily'
          ? String(row.date || '').slice(0, 10) === date
          : isInMonth(row.date, year, monthIndex - 1);
        return inScope && bucketForStatus(row.status) === statusFilter;
      });
    });
  }, [filteredWorkers, recordsByWorker, statusFilter, viewMode, date, month]);

  // Only one bucket set is ever read by the render, so a view switch cannot cascade.
  const buckets = viewMode === 'daily' ? dayBuckets : monthBuckets;
  const activeEntries = statusFilter ? buckets[statusFilter] || [] : [];
  const scopeLabel = viewMode === 'daily' ? date : month;

  // Toggling the active view returns to 'all' (full current month).
  const toggleView = useCallback((next) => {
    setViewMode((current) => (current === next ? 'all' : next));
  }, []);

  // Toggling the active card clears the status filter.
  const toggleFilter = useCallback((key) => {
    setStatusFilter((current) => (current === key ? null : key));
  }, []);

  const handleSearchChange = useCallback((event) => setSearch(event.target.value), []);
  const handleDateChange = useCallback((event) => setDate(event.target.value), []);
  const handleMonthChange = useCallback((event) => setMonth(event.target.value), []);

  return (
    <section className="att-dash">
      <div className="att-dash-head">
        <div className="att-dash-filters">
          <div className="attendance-detail-tabs">
            <button type="button" aria-pressed={viewMode === 'daily'} className={`attendance-tab ${viewMode === 'daily' ? 'active' : ''}`} onClick={() => toggleView('daily')}>Single Day</button>
            <button type="button" aria-pressed={viewMode === 'monthly'} className={`attendance-tab ${viewMode === 'monthly' ? 'active' : ''}`} onClick={() => toggleView('monthly')}>Monthly View</button>
          </div>
          {viewMode === 'daily' ? (
            <label className="form-field"><span>📅 Single Day</span><input type="date" value={date} onChange={handleDateChange} /></label>
          ) : (
            <label className="form-field"><span>🗓 Monthly View</span><input type="month" value={month} onChange={handleMonthChange} /></label>
          )}
          <label className="form-field att-search-field"><span>🔎 Search Worker</span><input type="search" value={search} placeholder="Name, ID or Department" onChange={handleSearchChange} /></label>
        </div>
        <div className="att-dash-cards">
          {CATEGORY_TONES.map(([key, label, tone]) => (
            <button key={key} type="button" className={`att-card ${tone} ${statusFilter === key ? 'active' : ''}`} onClick={() => toggleFilter(key)}>
              <span className="att-card-count">{(buckets[key] || []).length}</span>
              <span className="att-card-label">{label}</span>
            </button>
          ))}
        </div>
      </div>
      {statusFilter && (
        <div className="att-card-body">
          {loading && <p className="empty-row">Loading attendance…</p>}
          {!loading && error && <p className="auth-error">{error}</p>}
          {!loading && !error && (activeEntries.length === 0
            ? <p className="empty-row">No workers in this category for {scopeLabel}.</p>
            // Each row is keyed by status, worker, period and record id, so a re-sort or
            // a second record for the same day can never collide in React.
            : <ul className="att-list">{activeEntries.map((entry) => <li key={`${statusFilter}-${entry.workerId}-${entry.checkIn}-${entry.record?.id ?? ''}`} className="att-list-row"><span className="att-id">{entry.workerId}</span><span className="att-name">{entry.name}</span><span className="att-dept">{entry.department}</span><span className="att-time">{entry.checkIn}</span>{entry.detail && <span className="att-reason">{entry.detail}</span>}</li>)}</ul>)}
        </div>
      )}

      {/* The matrix sits directly under the global header controls (tabs, date/month
          picker, search) and follows the same month + search + card filter. */}
      <AttendanceMatrixGrid
        workers={statusFilteredWorkers}
        records={records}
        month={month}
        date={viewMode === 'daily' ? date : null}
        search={search}
        statusFilter={statusFilter}
        loading={loading}
        error={error}
      />
    </section>
  );
}

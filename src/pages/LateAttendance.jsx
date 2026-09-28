import React, { useEffect, useMemo, useState } from 'react';
import { deleteAttendanceRecord, subscribeToAttendance } from '../utils/attendance';
import { downloadCSV } from '../utils/csv';

// A shift that starts after this minute counts as late.
const SCHEDULED_MINUTES = 8 * 60;

function todayKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function monthKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function minutesFromTime(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function formatScheduledTime() {
  const hours = Math.floor(SCHEDULED_MINUTES / 60);
  const minutes = SCHEDULED_MINUTES % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Only two things make an attendance record late: an explicit `lateMinutes` above zero, or
// an in-time that is past the scheduled start. Everything else is ignored.
function lateMinutesFor(record = {}) {
  const stored = Number(record.lateMinutes);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  const arrived = minutesFromTime(record.inTime);
  if (arrived === null) return 0;
  return Math.max(0, arrived - SCHEDULED_MINUTES);
}

function isLateRecord(record = {}) {
  if (lateMinutesFor(record) > 0) return true;
  const status = String(record.status || '').toLowerCase();
  return status.includes('late');
}

function workerName(record = {}) {
  return record.userName || record.workerName || record.name || record.employee || `Worker ${record.workerId ?? ''}`.trim();
}

export default function LateAttendance() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [viewMode, setViewMode] = useState('day');
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [selectedMonth, setSelectedMonth] = useState(monthKey());
  const [search, setSearch] = useState('');
  // Row currently being deleted, so only that button shows its progress state.
  const [deletingId, setDeletingId] = useState(null);
  const [actionError, setActionError] = useState('');

  async function handleDelete(record) {
    if (!window.confirm(`Delete the late record for ${workerName(record)} on ${record.date}?`)) return;
    setDeletingId(record.id);
    setActionError('');
    try {
      await deleteAttendanceRecord(record.id);
      // The onSnapshot listener above refreshes the table on its own.
    } catch (error) {
      setActionError(error.message || 'Could not delete the record.');
    } finally {
      setDeletingId(null);
    }
  }

  // Live sync straight from the Smart Attendance collection: there is no manual entry
  // here, every row is an existing attendance record.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    let unsubscribe = () => { };
    try {
      unsubscribe = subscribeToAttendance(
        (rows) => {
          if (!active) return;
          setRecords(Array.isArray(rows) ? rows : []);
          setLoading(false);
        },
        (error) => {
          if (!active) return;
          // A denied or offline read must show a message, never an empty white screen.
          setRecords([]);
          setLoadError(error?.message || 'Could not load attendance records.');
          setLoading(false);
        }
      );
    } catch (error) {
      setRecords([]);
      setLoadError(error?.message || 'Could not load attendance records.');
      setLoading(false);
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const allLate = useMemo(
    () => (records || []).filter((record) => record && isLateRecord(record)),
    [records]
  );

  const dayRows = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return allLate
      .filter((record) => !selectedDate || String(record.date || '').slice(0, 10) === selectedDate)
      .filter((record) => !term || workerName(record).toLowerCase().includes(term) || String(record.workerId || '').includes(term))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [allLate, selectedDate, search]);

  const monthSummary = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    const buckets = new Map();
    (allLate || []).forEach((record) => {
      if (selectedMonth && !String(record.date || '').startsWith(selectedMonth)) return;
      const key = String(record.workerId ?? workerName(record));
      if (term && !workerName(record).toLowerCase().includes(term) && !key.includes(term)) return;
      const current = buckets.get(key) || {
        key,
        name: workerName(record),
        department: record.department || '',
        instances: 0,
        totalMinutes: 0,
        worstMinutes: 0,
      };
      const minutes = lateMinutesFor(record);
      current.instances += 1;
      current.totalMinutes += minutes;
      current.worstMinutes = Math.max(current.worstMinutes, minutes);
      buckets.set(key, current);
    });
    return Array.from(buckets.values()).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [allLate, selectedMonth, search]);

  const dayTotalMinutes = (dayRows || []).reduce((total, row) => total + lateMinutesFor(row), 0);
  // Average delay across the currently filtered set, not across the whole month.
  const averageLateMinutes = (dayRows || []).length
    ? Math.round(dayTotalMinutes / dayRows.length)
    : 0;
  // Distinct people, so one worker arriving late twice is not counted twice.
  const lateWorkersToday = useMemo(
    () => new Set((dayRows || []).map((row) => String(row.workerId ?? workerName(row)))).size,
    [dayRows]
  );

  function handleDownload() {
    const columns = [
      { label: 'Worker ID', name: 'workerId' },
      { label: 'Worker Name', name: 'name' },
      { label: 'Department', name: 'department' },
      { label: 'Date', name: 'date' },
      { label: 'Scheduled Time', name: 'scheduled' },
      { label: 'Actual Time', name: 'actual' },
      { label: 'Minutes Late', name: 'minutesLate' },
    ];
    const rows = (viewMode === 'day' ? dayRows : monthSummary).map((row) => (viewMode === 'day'
      ? {
        workerId: row.workerId ?? '-',
        name: workerName(row),
        department: row.department || '-',
        date: row.date || '-',
        scheduled: formatScheduledTime(),
        actual: row.inTime || '-',
        minutesLate: lateMinutesFor(row),
      }
      : {
        workerId: row.key,
        name: row.name,
        department: row.department || '-',
        date: selectedMonth || '-',
        scheduled: formatScheduledTime(),
        actual: '-',
        minutesLate: row.totalMinutes,
      }));
    const stamp = viewMode === 'day' ? selectedDate : selectedMonth;
    downloadCSV(`late-attendance-${stamp || 'report'}.csv`, rows, columns);
  }

  return (
    <div className="module-page late-attendance-page">
      <div className="module-header">
        <h2>⏰ Late Attendance</h2>
        <p className="hint">Synced automatically from Smart Attendance — no manual entry.</p>
      </div>

      <div className="attendance-toolbar">
        <div className="attendance-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={viewMode === 'day'} className={`attendance-tab ${viewMode === 'day' ? 'active' : ''}`} onClick={() => setViewMode('day')}>
            📅 Day View
          </button>
          <button type="button" role="tab" aria-selected={viewMode === 'month'} className={`attendance-tab ${viewMode === 'month' ? 'active' : ''}`} onClick={() => setViewMode('month')}>
            🗓️ Month Summary
          </button>
        </div>

        {viewMode === 'day' ? (
          <label className="form-field">
            <span>Date</span>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
        ) : (
          <label className="form-field">
            <span>Month</span>
            <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
          </label>
        )}

        <label className="form-field">
          <span>Search Worker</span>
          <input
            type="text"
            value={search}
            placeholder="Name or ID"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <button className="btn btn-outline" onClick={handleDownload} disabled={loading}>
          ⬇ Download Report
        </button>
      </div>

      {loadError && <p className="hint late-attendance-error">⚠ {loadError}</p>}
      {actionError && <p className="auth-error">{actionError}</p>}
      {loading && <p className="hint">Loading attendance records…</p>}

      {viewMode === 'day' ? (
        <>
          <div className="att-dash-cards">
            <div className="att-card att-card-orange">
              <span className="att-card-count">{lateWorkersToday}</span>
              <span className="att-card-label">🟠 Late Employees Today</span>
            </div>
            <div className="att-card att-card-red">
              <span className="att-card-count">{dayTotalMinutes}</span>
              <span className="att-card-label">⏱ Total Minutes Late</span>
            </div>
            <div className="att-card att-card-amber">
              <span className="att-card-count">{averageLateMinutes}</span>
              <span className="att-card-label">⏳ Average Late (Minutes)</span>
            </div>
          </div>

          <div className="table-wrap attendance-daily-table">
            <table>
              <thead>
                <tr>
                  <th>Worker ID</th>
                  <th>Worker Name</th>
                  <th>Department</th>
                  <th>Date</th>
                  <th>Scheduled Time</th>
                  <th>Actual Arrival</th>
                  <th>Minutes Late</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(dayRows || []).map((row, index) => (
                  <tr key={row.id || `${row.workerId}-${row.date}-${index}`}>
                    <td>{row.workerId ?? '-'}</td>
                    <td>{workerName(row)}</td>
                    <td>{row.department || '-'}</td>
                    <td>{row.date || '-'}</td>
                    <td>{formatScheduledTime()}</td>
                    <td>{row.inTime || '-'}</td>
                    <td>{lateMinutesFor(row)} min</td>
                    <td className="attendance-actions">
                      <button
                        className="btn attendance-delete-btn attendance-view-btn"
                        disabled={deletingId === row.id}
                        onClick={() => handleDelete(row)}
                      >
                        {deletingId === row.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
                {(dayRows || []).length === 0 && (
                  <tr>
                    <td colSpan="8" className="empty-row">
                      {loading ? 'Loading…' : `No late arrivals recorded for ${selectedDate || 'the selected day'}.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="table-wrap attendance-daily-table">
          <table>
            <thead>
              <tr>
                <th>Worker Name</th>
                <th>Department</th>
                <th>Late Instances</th>
                <th>Total Minutes Late</th>
                <th>Worst Delay</th>
              </tr>
            </thead>
            <tbody>
              {(monthSummary || []).map((row) => (
                <tr key={row.key}>
                  <td>{row.name}</td>
                  <td>{row.department || '-'}</td>
                  <td>{row.instances}</td>
                  <td>{row.totalMinutes} min</td>
                  <td>{row.worstMinutes} min</td>
                </tr>
              ))}
              {(monthSummary || []).length === 0 && (
                <tr>
                  <td colSpan="5" className="empty-row">
                    {loading ? 'Loading…' : `No late arrivals recorded for ${selectedMonth || 'the selected month'}.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

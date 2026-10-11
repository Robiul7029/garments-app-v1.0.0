import React, { useEffect, useMemo, useState } from 'react';
import { deleteAttendanceRecord, subscribeToAttendance } from '../utils/attendance';
import { downloadCSV } from '../utils/csv';
import AttendancePeriodFilter from '../components/AttendancePeriodFilter';

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

function monthDays(monthValue) {
  const [year, month] = String(monthValue).split('-').map(Number);
  if (!year || !month) return 0;
  return new Date(year, month, 0).getDate();
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

/** Renders a 24h "HH:MM" value as a 12-hour clock time, e.g. 08:12 AM. */
function formatClockTime(value) {
  const total = minutesFromTime(value);
  if (total === null) return null;
  const suffix = total >= 720 ? 'PM' : 'AM';
  const hour24 = Math.floor(total / 60) % 24;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${String(hour12).padStart(2, '0')}:${String(total % 60).padStart(2, '0')} ${suffix}`;
}

/**
 * Late Attendance Matrix — the late-only twin of the main monthly attendance matrix.
 *
 * One row per worker, one column per day of the selected month, and a cell only carries
 * content when that worker was actually late that day. Everything is read from the same
 * Smart Attendance collection the main matrix uses, so a deletion here refreshes both.
 */
export default function LateAttendance() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // 'month' by default, so the grid opens on the full current month.
  const [viewMode, setViewMode] = useState('month');
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [selectedMonth, setSelectedMonth] = useState(monthKey());
  const [search, setSearch] = useState('');
  // Cell currently being deleted, so only that button shows its progress state.
  const [deletingId, setDeletingId] = useState(null);
  const [actionError, setActionError] = useState('');

  // The month the grid columns are built from. In day mode the date's own month is used
  // so the day-number column header is always correct.
  const activeMonth = viewMode === 'day' ? String(selectedDate || '').slice(0, 7) : selectedMonth;
  const isDayMode = viewMode === 'day';

  // Picking a day in month mode drops straight into the single-day view, and clearing the
  // day returns to the full month. The month always follows the picked date.
  const handleFilterDateChange = (value) => {
    setViewMode(value ? 'day' : 'month');
    setSelectedDate(value || todayKey());
    if (value) setSelectedMonth(value.slice(0, 7));
  };
  const handleFilterMonthChange = (value) => {
    setViewMode('month');
    setSelectedMonth(value);
    if (selectedDate && selectedDate.slice(0, 7) !== value) setSelectedDate(todayKey());
  };

  async function handleDelete(record) {
    if (!window.confirm(`Delete the late record for ${workerName(record)} on ${record.date}?`)) return;
    setDeletingId(record.id);
    setActionError('');
    try {
      await deleteAttendanceRecord(record.id);
      // The onSnapshot listener below refreshes the grid on its own.
    } catch (error) {
      setActionError(error.message || 'Could not delete the record.');
    } finally {
      setDeletingId(null);
    }
  }

  // Live sync straight from the Smart Attendance collection: there is no manual entry
  // here, every cell is an existing attendance record.
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

  // Only late records are ever considered — lateMinutes > 0 or status containing "late".
  const allLate = useMemo(
    () => (records || []).filter((record) => record && isLateRecord(record)),
    [records]
  );

  // Late records in the selected period, matched against the global search box.
  const periodLate = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return allLate.filter((record) => {
      const dateValue = String(record.date || '').slice(0, 10);
      if (isDayMode) {
        if (selectedDate && dateValue !== selectedDate) return false;
      } else if (activeMonth && !dateValue.startsWith(activeMonth)) {
        return false;
      }
      if (!term) return true;
      return workerName(record).toLowerCase().includes(term)
        || String(record.workerId ?? '').toLowerCase().includes(term)
        || String(record.department || '').toLowerCase().includes(term);
    });
  }, [allLate, isDayMode, selectedDate, activeMonth, search]);

  // workerKey -> { id, workerId, name, department, days: { [day]: record } }.
  // Only workers with at least one late arrival in the period get a row.
  const rows = useMemo(() => {
    const map = new Map();
    periodLate.forEach((record) => {
      const day = Number(String(record.date || '').slice(-2));
      if (!day) return;
      const key = String(record.workerId ?? workerName(record));
      let entry = map.get(key);
      if (!entry) {
        entry = {
          key,
          workerId: record.workerId ?? 'N/A',
          name: workerName(record),
          department: record.department || '',
          days: {},
        };
        map.set(key, entry);
      }
      // Last write wins, so an edit replaces the day rather than stacking two records.
      entry.days[day] = record;
      if (!entry.department && record.department) entry.department = record.department;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [periodLate]);

  // Day columns: every day of the month, or just the selected day in Single Day mode.
  const totalDays = useMemo(() => (activeMonth ? monthDays(activeMonth) : 0), [activeMonth]);
  const singleDay = isDayMode ? Number(String(selectedDate || '').slice(-2)) : 0;
  const visibleDays = useMemo(
    () => (isDayMode ? (singleDay ? [singleDay] : []) : Array.from({ length: totalDays }, (_, index) => index + 1)),
    [isDayMode, singleDay, totalDays]
  );

  const totalInstances = periodLate.length;
  const totalMinutes = periodLate.reduce((total, record) => total + lateMinutesFor(record), 0);
  const averageLateMinutes = totalInstances ? Math.round(totalMinutes / totalInstances) : 0;

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
    const rowsToExport = periodLate.map((record) => ({
      workerId: record.workerId ?? '-',
      name: workerName(record),
      department: record.department || '-',
      date: record.date || '-',
      scheduled: formatScheduledTime(),
      actual: record.inTime || '-',
      minutesLate: lateMinutesFor(record),
    }));
    const stamp = isDayMode ? selectedDate : activeMonth;
    downloadCSV(`late-attendance-${stamp || 'report'}.csv`, rowsToExport, columns);
  }

  return (
    <div className="module-page late-attendance-page">
      <div className="module-header">
        <h2>⏰ Late Attendance</h2>
        <p className="hint">Synced automatically from Smart Attendance — only days a worker actually arrived late are shown.</p>
      </div>

      <div className="attendance-toolbar">
        <div className="attendance-tabs" role="tablist">
          {/* Toggle: a second click on the active tab falls back to the full month. */}
          <button type="button" role="tab" aria-selected={isDayMode} className={`attendance-tab ${isDayMode ? 'active' : ''}`} onClick={() => setViewMode((current) => (current === 'day' ? 'month' : 'day'))}>
            📅 Single Day
          </button>
          <button type="button" role="tab" aria-selected={!isDayMode} className={`attendance-tab ${!isDayMode ? 'active' : ''}`} onClick={() => setViewMode('month')}>
            🗓️ Monthly View
          </button>
        </div>

        <AttendancePeriodFilter
          month={activeMonth}
          onMonthChange={handleFilterMonthChange}
          date={isDayMode ? selectedDate : ''}
          onDateChange={handleFilterDateChange}
          search={search}
          onSearchChange={setSearch}
          label="Late attendance filter"
        />

        <button className="btn btn-outline" onClick={handleDownload} disabled={loading}>
          ⬇ Download Report
        </button>
      </div>

      {loadError && <p className="hint late-attendance-error">⚠ {loadError}</p>}
      {actionError && <p className="auth-error">{actionError}</p>}

      <div className="att-dash-cards">
        <div className="att-card att-card-orange">
          <span className="att-card-count">{rows.length}</span>
          <span className="att-card-label">🟠 Late Workers</span>
        </div>
        <div className="att-card att-card-red">
          <span className="att-card-count">{totalInstances}</span>
          <span className="att-card-label">⏱ Late Instances</span>
        </div>
        <div className="att-card att-card-amber">
          <span className="att-card-count">{totalMinutes}</span>
          <span className="att-card-label">⏱ Total Minutes Late</span>
        </div>
        <div className="att-card att-card-green">
          <span className="att-card-count">{averageLateMinutes}</span>
          <span className="att-card-label">⏳ Average Late (Minutes)</span>
        </div>
      </div>

      <section className="att-matrix">
        {loading && <p className="empty-row">Loading late records…</p>}

        {!loading && !loadError && (
          <div className="att-matrix-scroll">
            <table className="att-matrix-table">
              <thead>
                <tr>
                  <th className="att-matrix-sticky-col att-matrix-head">Name / Emp ID</th>
                  {visibleDays.map((day) => (
                    <th key={day} className="att-matrix-head att-matrix-day-head">{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  // Excel zebra striping: row 1, 3, 5 are the darker sky blue.
                  const rowClass = index % 2 === 0 ? 'att-row-odd' : 'att-row-even';
                  return (
                    <tr key={row.key} className={rowClass}>
                      <th scope="row" className="att-matrix-sticky-col">
                        <span className="att-matrix-name">{row.name}</span>
                        <span className="att-matrix-id">{row.workerId}</span>
                      </th>
                      {visibleDays.map((day) => {
                        const record = row.days[day];
                        // Not late that day, or no entry at all — nothing to report.
                        if (!record) {
                          return (
                            <td key={day} className="att-matrix-cell att-cell-none">
                              <span className="att-cell-late-na">N/A</span>
                            </td>
                          );
                        }
                        // Same five-line cell layout as the main attendance matrix, so a
                        // manager reads both reports identically.
                        const lateMinutes = lateMinutesFor(record);
                        return (
                          <td key={day} className="att-matrix-cell att-cell-late-filled">
                            <span className="att-cell-dept">{(record.department || row.department || 'N/A').toUpperCase()}</span>
                            <span className="att-cell-status">Late</span>
                            <span className="att-cell-time">In: {formatClockTime(record.inTime) || 'N/A'}</span>
                            <span className="att-cell-time">Out: {formatClockTime(record.outTime) || 'N/A'}</span>
                            <span className="att-cell-late-min">{lateMinutes} mins late</span>
                            <button
                              type="button"
                              className="att-cell-late-del"
                              title={`Delete late record for ${row.name} on ${record.date}`}
                              disabled={deletingId === record.id}
                              onClick={() => handleDelete(record)}
                            >
                              {deletingId === record.id ? '…' : '×'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr className="att-row-odd">
                    <td colSpan={visibleDays.length + 1} className="empty-row">
                      {loading ? 'Loading…' : `No late arrivals recorded for ${isDayMode ? selectedDate || 'the selected day' : activeMonth || 'the selected month'}.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

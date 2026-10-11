import React, { useMemo } from 'react';
import { isInMonth } from '../utils/attendance';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthDays(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

// Short weekday names indexed by Date#getDay() (0 = Sunday).
const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "1 Sun", "2 Mon", … for a 1-based day number in the given YYYY-MM month. Built with a
// local Date so the weekday always matches the month/year the user actually selected.
function dayHeaderLabel(activeMonth, day) {
  const [year, month] = String(activeMonth || '').split('-').map(Number);
  if (!year || !month) return String(day);
  const weekday = SHORT_DAY_NAMES[new Date(year, month - 1, day).getDay()] || '';
  return weekday ? `${day} ${weekday}` : String(day);
}

function isSunday(activeMonth, day) {
  const [year, month] = String(activeMonth || '').split('-').map(Number);
  if (!year || !month) return false;
  return new Date(year, month - 1, day).getDay() === 0;
}

// A shift that starts after this minute counts as late. Mirrors the rule in
// LateAttendance.jsx so both reports agree on what "late" and "N mins late" mean.
const SCHEDULED_MINUTES = 8 * 60;

function minutesFromTime(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

export function lateMinutesFor(record = {}) {
  const stored = Number(record.lateMinutes);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  const arrived = minutesFromTime(record.inTime);
  if (arrived === null) return 0;
  return Math.max(0, arrived - SCHEDULED_MINUTES);
}

// The four summary-card buckets. Every cell maps into exactly one bucket so the cards
// and the grid always agree with each other.
export const FILTER_PRESENT = 'present';
export const FILTER_ABSENT = 'absent';
export const FILTER_LEAVE = 'leave';
export const FILTER_LATE = 'late';

/** Maps a raw status string to its summary bucket (Late / Other catches anything else). */
export function bucketForStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'present') return FILTER_PRESENT;
  if (value === 'absent') return FILTER_ABSENT;
  if (value === 'leave') return FILTER_LEAVE;
  return value ? FILTER_LATE : null;
}

/** The label shown inside a cell — always the full status name, never a shortform. */
export function labelForStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) return 'N/A';
  if (value === 'present') return 'Present';
  if (value === 'absent') return 'Absent';
  if (value === 'late') return 'Late';
  if (value === 'leave') return 'Leave';
  return status;
}

/**
 * Monthly Attendance Matrix Grid — an Excel-like sheet where each row is a worker and each
 * of the 1..31 columns is a day. Every cell stacks Department / Status / In-Time / Out-Time.
 * The first column is sticky so names stay visible while scrolling through 31 days.
 *
 * This component is purely presentational: workers, records, month/date, search term and the
 * active summary-card filter all come from AttendanceSummaryDashboard, so the grid always
 * renders underneath the global header controls with no duplicated title / month picker /
 * search box of its own.
 */
export default function AttendanceMatrixGrid({
  workers = [],
  records = [],
  month,
  // When set, the grid collapses to a single column for this YYYY-MM-DD date.
  date = null,
  search = '',
  statusFilter = null,
  loading = false,
  error = '',
}) {
  const activeWorkers = useMemo(
    () => (workers || []).filter((worker) => worker && worker.active !== false && worker.status !== 'inactive'),
    [workers]
  );

  // The month the grid covers. In single-day mode the date's own month is used so the
  // day number column header is always correct.
  const activeMonth = date ? String(date).slice(0, 7) : month;

  // workerId -> { [day]: record }. Only records saved in the Smart Attendance form exist
  // here — nothing is auto-generated, so a worker with no saved entry simply shows N/A.
  const byWorkerDay = useMemo(() => {
    if (!activeMonth) return {};
    const [year, monthIndex] = activeMonth.split('-').map(Number);
    const map = {};
    (records || []).forEach((record) => {
      if (!isInMonth(record.date, year, monthIndex - 1)) return;
      const key = String(record.workerId);
      (map[key] = map[key] || {})[Number(String(record.date).slice(-2))] = record;
    });
    return map;
  }, [records, activeMonth]);

  // Days actually rendered: 31 for a full month, only the real length otherwise.
  const totalDays = useMemo(() => (activeMonth ? monthDays(activeMonth) : 0), [activeMonth]);
  const elapsedDays = activeMonth === today().slice(0, 7) ? Number(today().slice(-2)) : totalDays;

  // In single-day mode only the selected day is a column, so the other days are hidden
  // instead of being rendered as empty N/A cells.
  const isDayMode = Boolean(date);
  const singleDay = isDayMode ? Number(String(date).slice(-2)) : 0;
  const visibleDays = useMemo(
    () => (isDayMode ? [singleDay] : Array.from({ length: totalDays }, (_, index) => index + 1)),
    [isDayMode, singleDay, totalDays]
  );

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
      {loading && <p className="empty-row">Loading matrix…</p>}
      {!loading && error && <p className="auth-error">{error}</p>}

      {!loading && !error && (
        <div className="att-matrix-scroll">
          <table className="att-matrix-table">
            <thead>
              <tr>
                <th className="att-matrix-sticky-col att-matrix-head">Name / Emp ID</th>
                {visibleDays.map((day) => {
                  const isFuture = day > elapsedDays;
                  const sunday = isSunday(activeMonth, day);
                  const className = [
                    'att-matrix-head',
                    'att-matrix-day-head',
                    isFuture ? 'is-future' : '',
                    sunday ? 'is-sunday' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <th key={day} className={className} title={sunday ? 'Sunday' : undefined}>
                      {dayHeaderLabel(activeMonth, day)}
                    </th>
                  );
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
                    {visibleDays.map((day) => {
                      const record = workerRecords[day];
                      const status = record?.status;
                      const bucket = bucketForStatus(status);
                      const label = labelForStatus(status);
                      const department = record?.department || worker.department || 'N/A';
                      // With a card filter active, cells of the other buckets are blanked out
                      // so the grid shows only the selected category.
                      const hidden = Boolean(statusFilter) && bucket !== statusFilter;
                      const lateMinutes = record ? lateMinutesFor(record) : 0;
                      const sunday = isSunday(activeMonth, day);
                      // A Sunday with no saved record is a holiday, so it renders as a blank
                      // tinted cell rather than a row of "N/A" text. An explicit Sunday
                      // entry (someone did work) is still shown exactly like any other day.
                      const isHoliday = sunday && !status;
                      const className = [
                        'att-matrix-cell',
                        !hidden && bucket ? `att-cell-${bucket}` : '',
                        hidden ? 'att-cell-muted' : '',
                        !status ? 'att-cell-none' : '',
                        sunday ? 'att-matrix-sunday-cell' : '',
                        isHoliday ? 'att-cell-holiday' : '',
                      ].filter(Boolean).join(' ');
                      return (
                        <td key={day} className={className} title={isHoliday ? 'Sunday' : undefined}>
                          {hidden || isHoliday ? null : (
                            <>
                              <span className="att-cell-dept">{department}</span>
                              <span className="att-cell-status">{label}</span>
                              <span className="att-cell-time">{record?.inTime || 'N/A'}</span>
                              <span className="att-cell-time">{record?.outTime || 'N/A'}</span>
                              {lateMinutes > 0 && <span className="att-cell-late-min">{lateMinutes} mins late</span>}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr className="att-row-odd"><td colSpan={visibleDays.length + 1} className="empty-row">No workers match this search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

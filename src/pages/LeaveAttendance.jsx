import React, { useEffect, useMemo, useState } from 'react';
import { saveLeaveRange, subscribeToAttendance, subscribeToWorkers } from '../utils/attendance';
import AttendancePeriodFilter from '../components/AttendancePeriodFilter';

const DEPARTMENTS = ['Cutting', 'Sewing', 'Finishing', 'Washing', 'Delivery', 'Iron', 'Other'];
const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Unpaid Leave', 'Maternity Leave', 'Other'];

function todayKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function workerName(record = {}) {
  return record.userName || record.workerName || record.name || record.employee || (record.workerId ? `Worker ${record.workerId}` : 'Unknown');
}

function leaveType(record = {}) {
  return record.leaveType || record.leave_type || record.type || 'Leave';
}

function reason(record = {}) {
  return record.comment || record.reason || record.remarks || record.note || '-';
}

function toDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A record counts as leave when the status says so, or when leave-specific fields are set.
function isLeaveRecord(record = {}) {
  const status = String(record.status || record.leaveStatus || record.leave_status || '').toLowerCase();
  if (status.includes('leave')) return true;
  if (status === 'absent' && record.leaveType) return true;
  return Boolean(record.leaveType || record.leave_type || record.fromDate || record.toDate || record.from_date || record.to_date);
}

// The leave span, falling back to the record's own date for a single-day leave.
function leaveSpan(record = {}) {
  const own = toDate(record.date || record.day || record.createdAt);
  const start = toDate(record.fromDate || record.from_date || record.from) || own;
  const end = toDate(record.toDate || record.to_date || record.to) || start;
  return { start, end };
}

// Inclusive overlap test: a multi-day leave matches when either endpoint falls in the window.
function withinRange(start, end, from, to) {
  if (!from && !to) return true;
  if (!start && !end) return false;
  const s = start || '0000-00-00';
  const e = end || s;
  if (from && e < from) return false;
  if (to && s > to) return false;
  return true;
}

export default function LeaveAttendance() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // 'day' and 'month' are separate views: in day mode the month picker is ignored, and in
  // month mode the date picker is ignored. They must not filter each other.
  const [viewMode, setViewMode] = useState('day');
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [selectedMonth, setSelectedMonth] = useState(monthKey());
  const [search, setSearch] = useState('');
  // Manual advance-leave form. The list above is still driven by Firestore; this only
  // writes new Leave records into the same collection.
  const [showAddModal, setShowAddModal] = useState(false);
  const [workers, setWorkers] = useState([]);
  const [savingLeave, setSavingLeave] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    workerId: '',
    department: '',
    fromDate: todayKey(),
    toDate: todayKey(),
    // Empty by default: the Leave Type dropdown is required and starts on its placeholder.
    leaveType: '',
    comment: '',
  });
  const [leaveError, setLeaveError] = useState('');
  // Per-field validation state so each empty input can be highlighted and carry its own
  // inline hint instead of a single generic message.
  const [fieldErrors, setFieldErrors] = useState({});

  // Worker list for the modal's picker.
  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeToWorkers(
        (rows) => {
          if (active) setWorkers(Array.isArray(rows) ? rows : []);
        },
        () => {
          if (active) setWorkers([]);
        }
      );
    } catch (error) {
      setWorkers([]);
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Every field is required. Submit is blocked while any one is empty, each empty control is
// highlighted, and each carries its own inline hint saying exactly what is missing.
  function validateLeaveForm() {
    const errors = {};
    if (!String(leaveForm.workerId || '').trim()) errors.workerId = 'Please select a worker.';
    if (!String(leaveForm.department || '').trim()) errors.department = 'Please select a department.';
    if (!String(leaveForm.fromDate || '').trim()) errors.fromDate = 'Please select a start date.';
    if (!String(leaveForm.toDate || '').trim()) errors.toDate = 'Please select an end date.';
    // A native <select> left on its placeholder is the classic empty case; the message is
    // the one browsers show for it.
    if (!String(leaveForm.leaveType || '').trim()) errors.leaveType = 'Please select an item in the list';
    if (!String(leaveForm.comment || '').trim()) errors.comment = 'Please enter a reason for the leave.';
    return errors;
  }

  function updateLeaveField(field, value) {
    setLeaveForm((current) => ({ ...current, [field]: value }));
    // Clear a field's hint as soon as the user starts fixing it.
    setFieldErrors((current) => (current[field] ? { ...current, [field]: '' } : current));
  }

  async function handleSaveLeave(event) {
    event.preventDefault();
    setLeaveError('');
    const errors = validateLeaveForm();
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setLeaveError('Please complete all required fields before saving.');
      return;
    }
    setFieldErrors({});
    if (leaveForm.toDate && leaveForm.toDate < leaveForm.fromDate) {
      setFieldErrors({ toDate: 'The end date cannot be before the start date.' });
      setLeaveError('The end date cannot be before the start date.');
      return;
    }
    const worker = workers.find((row) => String(row.workerId) === String(leaveForm.workerId));
    if (!worker) {
      setLeaveError('Could not find the selected worker.');
      return;
    }
    setSavingLeave(true);
    try {
      const result = await saveLeaveRange({
        worker,
        department: leaveForm.department || worker.department || '',
        fromDate: leaveForm.fromDate,
        toDate: leaveForm.toDate || leaveForm.fromDate,
        leaveType: leaveForm.leaveType,
        comment: leaveForm.comment,
      });
      setShowAddModal(false);
      setLeaveForm({ workerId: '', department: '', fromDate: todayKey(), toDate: todayKey(), leaveType: '', comment: '' });
      setFieldErrors({});
      // The onSnapshot above refreshes the table on its own; this is just feedback.
      if (!result.created.length) {
        setLeaveError('Those days already have an attendance record — nothing was overwritten.');
      }
    } catch (saveError) {
      setLeaveError(saveError.message);
    } finally {
      setSavingLeave(false);
    }
  }

  // Live sync from Smart Attendance: leave rows are derived from attendance records, so
  // there is no manual entry form on this page.
  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    setLoading(true);
    setLoadError('');
    try {
      unsubscribe = subscribeToAttendance(
        (rows) => {
          if (!active) return;
          setRecords(Array.isArray(rows) ? rows : []);
          setLoading(false);
        },
        (error) => {
          if (!active) return;
          setRecords([]);
          setLoadError(error?.message || 'Could not load leave records.');
          setLoading(false);
        }
      );
    } catch (error) {
      setRecords([]);
      setLoadError(error?.message || 'Could not load leave records.');
      setLoading(false);
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Picking a day drops into the single-date view, clearing it returns to the whole month.
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

  const allLeaves = useMemo(() => (records || []).filter((record) => record && isLeaveRecord(record)), [records]);

  const visibleLeaves = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    const from = viewMode === 'day' ? selectedDate : `${selectedMonth}-01`;
    const to = viewMode === 'day' ? selectedDate : `${selectedMonth}-31`;
    return (allLeaves || [])
      .filter((record) => {
        const { start, end } = leaveSpan(record);
        if (!withinRange(start, end, from, to)) return false;
        if (term) {
          const haystack = `${workerName(record)} ${record.workerId ?? ''} ${record.department ?? ''} ${reason(record)} ${leaveType(record)}`.toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => leaveSpan(b).start.localeCompare(leaveSpan(a).start));
  }, [allLeaves, viewMode, selectedDate, selectedMonth, search]);

  const typeBreakdown = useMemo(() => {
    const counts = new Map();
    (visibleLeaves || []).forEach((record) => {
      const key = leaveType(record);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
  }, [visibleLeaves]);

  return (
    <div className="module-page leave-attendance-page">
      <div className="module-header">
        <h2>🗓️ Leave Attendance</h2>
        <p className="hint">Synced automatically from Smart Attendance — leave records are read from the attendance collection.</p>
      </div>

      <div className="attendance-toolbar">
        <div className="attendance-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'day'}
            className={`attendance-tab ${viewMode === 'day' ? 'active' : ''}`}
            onClick={() => setViewMode('day')}
          >
            📅 Day View
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'month'}
            className={`attendance-tab ${viewMode === 'month' ? 'active' : ''}`}
            onClick={() => setViewMode('month')}
          >
            🗓️ Month View
          </button>
        </div>

        <AttendancePeriodFilter
          month={selectedMonth}
          onMonthChange={handleFilterMonthChange}
          date={viewMode === 'day' ? selectedDate : ''}
          onDateChange={handleFilterDateChange}
          search={search}
          onSearchChange={setSearch}
          label="Leave attendance filter"
        />

        <button className="btn btn-primary" onClick={() => { setLeaveError(''); setFieldErrors({}); setShowAddModal(true); }}>
          + Add Entry
        </button>
      </div>

      {loadError && <p className="hint late-attendance-error">⚠ {loadError}</p>}
      {loading && <p className="hint">Loading leave records…</p>}

      <div className="att-dash-cards">
        <div className="att-card att-card-yellow">
          <span className="att-card-count">{(visibleLeaves || []).length}</span>
          <span className="att-card-label">🟡 Leaves</span>
        </div>
        {(typeBreakdown || []).map((row) => (
          <div className="att-card" key={row.type}>
            <span className="att-card-count">{row.count}</span>
            <span className="att-card-label">{row.type}</span>
          </div>
        ))}
      </div>

      <div className="table-wrap attendance-daily-table">
        <table>
          <thead>
            <tr>
              <th>Employee Name</th>
              <th>Department</th>
              <th>Leave Type</th>
              <th>From Date</th>
              <th>To Date</th>
              <th>Comment / Reason</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(visibleLeaves || []).map((record, index) => (
              <tr key={record.id || `${record.workerId}-${record.date}-${index}`}>
                <td>{workerName(record)}</td>
                <td>{record.department || '-'}</td>
                <td>{leaveType(record)}</td>
                <td>{leaveSpan(record).start || '-'}</td>
                <td>{leaveSpan(record).end || '-'}</td>
                <td>{reason(record)}</td>
                <td>
                  <span className="att-status-pill">{String(record.status || 'Leave')}</span>
                </td>
              </tr>
            ))}
            {(visibleLeaves || []).length === 0 && (
              <tr>
                <td colSpan="7" className="empty-row">
                  {loading ? 'Loading…' : 'No leave records found for the selected date/month.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="attendance-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <section className="attendance-modal" onClick={(event) => event.stopPropagation()}>
            <div className="attendance-modal-header">
              <div>
                <h2>Add Leave Entry</h2>
                <p className="hint">Records an advance leave across a date range. One record is written per day; days that already have attendance are left untouched.</p>
              </div>
              <button className="btn btn-outline" onClick={() => setShowAddModal(false)}>Close</button>
            </div>

            <form className="attendance-entry-form" onSubmit={handleSaveLeave} noValidate>
              <label className={`form-field ${fieldErrors.workerId ? 'is-invalid' : ''}`}>
                <span>Worker <em className="required-mark">*</em></span>
                <select value={leaveForm.workerId} aria-invalid={Boolean(fieldErrors.workerId)} onChange={(event) => updateLeaveField('workerId', event.target.value)}>
                  <option value="">Select worker</option>
                  {workers.map((worker) => (
                    <option key={worker.workerId} value={worker.workerId}>{worker.workerId} — {worker.name}</option>
                  ))}
                </select>
                {fieldErrors.workerId && <small className="field-error">{fieldErrors.workerId}</small>}
              </label>
              <label className={`form-field ${fieldErrors.department ? 'is-invalid' : ''}`}>
                <span>Department <em className="required-mark">*</em></span>
                <select value={leaveForm.department} aria-invalid={Boolean(fieldErrors.department)} onChange={(event) => updateLeaveField('department', event.target.value)}>
                  <option value="">Select department</option>
                  {DEPARTMENTS.map((department) => <option key={department}>{department}</option>)}
                </select>
                {fieldErrors.department && <small className="field-error">{fieldErrors.department}</small>}
              </label>
              <label className={`form-field ${fieldErrors.fromDate ? 'is-invalid' : ''}`}>
                <span>From Date <em className="required-mark">*</em></span>
                <input type="date" value={leaveForm.fromDate} aria-invalid={Boolean(fieldErrors.fromDate)} onChange={(event) => updateLeaveField('fromDate', event.target.value)} />
                {fieldErrors.fromDate && <small className="field-error">{fieldErrors.fromDate}</small>}
              </label>
              <label className={`form-field ${fieldErrors.toDate ? 'is-invalid' : ''}`}>
                <span>To Date <em className="required-mark">*</em></span>
                <input type="date" value={leaveForm.toDate} min={leaveForm.fromDate} aria-invalid={Boolean(fieldErrors.toDate)} onChange={(event) => updateLeaveField('toDate', event.target.value)} />
                {fieldErrors.toDate && <small className="field-error">{fieldErrors.toDate}</small>}
              </label>
              <label className={`form-field ${fieldErrors.leaveType ? 'is-invalid' : ''}`}>
                <span>Leave Type <em className="required-mark">*</em></span>
                <select value={leaveForm.leaveType} aria-invalid={Boolean(fieldErrors.leaveType)} onChange={(event) => updateLeaveField('leaveType', event.target.value)}>
                  <option value="">Select Leave Type</option>
                  {LEAVE_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
                {fieldErrors.leaveType && <small className="field-error">{fieldErrors.leaveType}</small>}
              </label>
              <label className={`form-field ${fieldErrors.comment ? 'is-invalid' : ''}`}>
                <span>Comment / Reason <em className="required-mark">*</em></span>
                <input type="text" value={leaveForm.comment} placeholder="Reason for leave" aria-invalid={Boolean(fieldErrors.comment)} onChange={(event) => updateLeaveField('comment', event.target.value)} />
                {fieldErrors.comment && <small className="field-error">{fieldErrors.comment}</small>}
              </label>
              {/* The actions row is intentionally empty apart from the Save button: no stray
                  helper or background text sits above it. */}
              <div className="attendance-entry-actions">
                <button className="btn btn-primary" type="submit" disabled={savingLeave}>{savingLeave ? 'Saving...' : 'Save Leave'}</button>
              </div>
            </form>

            {leaveError && <p className="auth-error">{leaveError}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

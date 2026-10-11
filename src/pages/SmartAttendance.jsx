import React, { useEffect, useMemo, useState } from 'react';
import { useRole } from '../context/RoleContext';
import AttendancePeriodFilter from '../components/AttendancePeriodFilter';
import {
  calculateOvertimeHours,
  calculateLateMinutes,
  calculateDutyHours,
  getAttendanceFromFirestore,
  getWorkersFromFirestore,
  isInMonth,
  saveAttendanceRecord,
  findAttendanceForWorkerDate,
  seedWorkersToFirestore,
  deleteAttendanceRecord,
  updateAttendanceRecord,
  subscribeToWorkers,
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

function statusClass(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '-');
}

// Worker names are stored as a single full-name string, so a query is tested against
// every space-separated token: first, middle and last name all match independently.
function workerNameTokens(worker = {}) {
  return String(worker.name || worker.fullName || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function workerMatchesQuery(worker, query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return true;
  if (String(worker.workerId ?? '').toLowerCase().includes(term)) return true;
  // The shared Employee ID (EMP-007) is searchable too, so a supervisor can find a
  // person by the same identifier the directory shows them.
  if (String(worker.employeeId ?? '').toLowerCase().includes(term)) return true;
  const tokens = workerNameTokens(worker);
  if (tokens.some((token) => token.startsWith(term))) return true;
  // Also allow the raw full-name string to match, so "son ltd" works across tokens.
  return tokens.join(' ').includes(term);
}

export default function SmartAttendance() {
  const { isAdmin } = useRole();
  const [workers, setWorkers] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  // Single-day drill-down. Empty means "whole month", which is the default view.
  const [selectedDate, setSelectedDate] = useState('');
  // Live worker search: filters the grid and the monthly summary instantly by name/ID.
  const [workerSearch, setWorkerSearch] = useState('');
  // status starts empty so the manager must either pick a status explicitly (Leave /
  // Absent) or let the In-Time derive one. A page refresh therefore always returns here.
  const [form, setForm] = useState({ date: today(), workerId: '', department: '', inTime: '', outTime: '', status: '', lateMinutes: 0 });
  // True only while the status is untouched or derived from the clock. Any explicit
  // dropdown pick clears it, which is what gives the manual selection absolute priority.
  const [autoStatus, setAutoStatus] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState('');
  const [seeded, setSeeded] = useState(false);
  // Exclusive accordion: exactly one section may be open at a time, or none.
  // 'daily' is open on page load / refresh. Clicking the open section closes it.
  const [activeSection, setActiveSection] = useState('daily');
  function toggleSection(section) {
    setActiveSection((current) => (current === section ? null : section));
  }
  const [activeTab, setActiveTab] = useState('all');
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [detailMode, setDetailMode] = useState('monthly');
  const [detailDate, setDetailDate] = useState(today);
  const [detailMonth, setDetailMonth] = useState(currentMonth);
  const [deletingId, setDeletingId] = useState(null);
  const [editWorker, setEditWorker] = useState(null);
  const [year, month] = selectedMonth.split('-').map(Number);
  const daysInSelectedMonth = monthDays(selectedMonth);
  // Day columns for the daily grid: the whole month, or only the picked single day.
  const visibleDayColumns = useMemo(() => {
    if (!selectedDate) return Array.from({ length: daysInSelectedMonth }, (_, index) => index + 1);
    const day = Number(selectedDate.slice(-2));
    return day ? [day] : [];
  }, [selectedDate, daysInSelectedMonth]);
  // In/Out times stay permanently editable. Absent only freezes the fields that are
  // meaningless for a non-attending worker, and the submit handler falls back to the
  // worker's profile department.
  const isAbsent = form.status === 'Absent';
  const selectedWorkerProfile = workers.find((worker) => String(worker.workerId) === String(form.workerId));
  // A manual pick always wins: `autoStatus` is true only while the status is untouched
  // or was derived from the clock, and any explicit dropdown choice turns it off.
  const statusLocked = autoStatus && Boolean(form.status);
  const lockDepartment = isAbsent;
  const lateMinutes = isAbsent ? 0 : calculateLateMinutes(form.inTime);

  // Auto status mode only. A manual Leave/Present/Absent must never be overwritten, so
  // when autoStatus is off the clock just records the time and nothing else.
  function onInTimeChange(inTime) {
    setInvalidField('');
    if (!autoStatus) {
      setForm((current) => ({ ...current, inTime }));
      return;
    }
    if (!inTime) {
      // Clearing the time returns the form to "Select Status" and releases the lock.
      setForm((current) => ({ ...current, inTime: '', status: '', lateMinutes: 0 }));
      return;
    }
    const [hours, minutes] = inTime.split(':').map(Number);
    const minutesFromMidnight = (hours * 60) + minutes;
    setForm({
      ...form,
      inTime,
      status: minutesFromMidnight > 480 ? 'Late' : 'Present',
      lateMinutes: Math.max(0, minutesFromMidnight - 480),
    });
  }

  function onOutTimeChange(outTime) {
    setInvalidField('');
    setForm((current) => ({ ...current, outTime }));
  }

  // Explicit user selection. Whatever is picked is locked in: auto-calc is switched off
  // so later time edits cannot contradict it.
  function onStatusChange(status) {
    setInvalidField('');
    if (!status) {
      // Back to auto mode — the clock decides again.
      setAutoStatus(true);
      setForm((current) => ({ ...current, status: '', lateMinutes: 0 }));
      return;
    }
    setAutoStatus(false);
    if (status === 'Absent') {
      // No times may survive under an Absent record, so clear and disable them.
      setForm({ ...form, status, department: '', inTime: '', outTime: '', lateMinutes: 0 });
      return;
    }
    setForm({ ...form, status, lateMinutes: status === 'Late' ? lateMinutes : 0 });
  }

  // Only active workers are offered in the entry dropdown. Inactive/deactivated
  // workers are filtered out of the picker only — no worker document is ever
  // deleted, so all of their historic attendance stays intact and searchable.
  const activeWorkers = useMemo(
    () => (workers || []).filter((worker) => worker && (worker.active !== false && worker.status !== 'inactive')),
    [workers]
  );
  // Monthly view: Present / Leave / Late are counted from real records, Absent is derived
  // for every elapsed calendar day of the month that has no entry for the worker.
  const monthlySummary = useMemo(() => {
    const list = activeWorkers;
    return list.map((worker) => {
      const key = String(worker.workerId);
      const rows = (records || []).filter((record) => String(record.workerId) === key && isInMonth(record.date, year, month - 1));
      const markedDays = new Set(rows.map((record) => Number(String(record.date).slice(-2))));
      const present = rows.filter((record) => record.status === 'Present').length;
      const late = rows.filter((record) => record.status === 'Late').length;
      const leave = rows.filter((record) => record.status === 'Leave').length;
      const explicitAbsent = rows.filter((record) => record.status === 'Absent').length;
      const elapsedDays = (today() === today().slice(0, 7) + today().slice(7)) && String(selectedMonth) === currentMonth()
        ? Number(today().slice(-2))
        : daysInSelectedMonth;
      const autoAbsent = Math.max(0, elapsedDays - markedDays.size);
      return {
        worker,
        workerId: worker.workerId,
        name: worker.name,
        department: worker.department || rows.find((record) => record.department)?.department || '-',
        present,
        late,
        leave,
        absent: explicitAbsent + autoAbsent,
        overtime: rows.reduce((total, record) => total + Number(record.overtimeHours || 0), 0),
      };
    });
  }, [activeWorkers, records, year, month, selectedMonth, daysInSelectedMonth]);

  function exitStatus(record) {
    if (!record.outTime) return '-';
    const [hours, minutes] = String(record.outTime).split(':').map(Number);
    const exitMinutes = hours * 60 + minutes;
    if (exitMinutes > 18 * 60 + 30) return 'Late Exit';
    if (exitMinutes < 18 * 60 + 30) return 'Early Exit';
    return 'On Time';
  }

  function recordDetails(record) {
    return {
      lateMinutes: Number(record.lateMinutes ?? calculateLateMinutes(record.inTime)),
      dutyHours: calculateDutyHours(record.inTime, record.outTime),
      overtimeHours: calculateOvertimeHours(record.inTime, record.outTime),
      exitStatus: exitStatus(record),
    };
  }

  async function loadData() {
    setLoading(true);
    setError('');
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

  useEffect(() => { loadData(); }, []);

  // Live roster: Manpower Management → Line Deployment is the single place a worker
  // is created or renamed, and it mirrors every change into the `workers` collection.
  // Subscribing here means a new hire appears in this screen's picker and grids
  // without a manual refresh — the two modules share one master list.
  useEffect(() => {
    const unsubscribe = subscribeToWorkers(
      (rows) => setWorkers(rows),
      (subscribeError) => console.error('[SmartAttendance] worker subscription failed', subscribeError),
    );
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  // A single day narrows every grid/list below to that date; an empty date shows the whole
  // selected month. The month always follows the picked date so the day columns stay valid.
  const handleDateChange = (value) => {
    setSelectedDate(value);
    if (value) setSelectedMonth(value.slice(0, 7));
  };
  const handleMonthChange = (value) => {
    setSelectedMonth(value);
    // Dropping a stale single-day filter keeps the grid valid when the month moves away
    // from the day that was pinned.
    if (selectedDate && selectedDate.slice(0, 7) !== value) setSelectedDate('');
  };
  const matchesWorkerSearch = (worker, record) => {
    const term = String(workerSearch || '').trim().toLowerCase();
    if (!term) return true;
    return String(worker?.workerId ?? '').toLowerCase().includes(term)
      || String(worker?.name ?? '').toLowerCase().includes(term)
      || String(record?.userName ?? '').toLowerCase().includes(term);
  };

  const monthlyRecords = useMemo(() => {
    const base = records.filter((record) => isInMonth(record.date, year, month - 1));
    if (!selectedDate) return base;
    return base.filter((record) => String(record.date).slice(0, 10) === selectedDate);
  }, [records, year, month, selectedDate]);
  const dailyRecords = useMemo(() => {
    const base = records.filter((record) => (selectedDate || form.date) === record.date);
    const term = String(workerSearch || '').trim().toLowerCase();
    if (!term) return base;
    return base.filter((record) => String(record.userName || '').toLowerCase().includes(term)
      || String(record.workerId ?? '').toLowerCase().includes(term));
  }, [records, selectedDate, form.date, workerSearch]);
  const filteredDailyRecords = useMemo(() => {
    if (activeTab === 'present') return dailyRecords.filter((record) => record.status === 'Present');
    if (activeTab === 'late') return dailyRecords.filter((record) => record.status === 'Late');
    if (activeTab === 'overtime') return dailyRecords.filter((record) => Number(record.overtimeHours || 0) > 0);
    if (activeTab === 'absent') return dailyRecords.filter((record) => record.status === 'Absent');
    return dailyRecords;
  }, [activeTab, dailyRecords]);
  const summaries = useMemo(() => workers.filter((worker) => matchesWorkerSearch(worker)).map((worker) => {
    const workerRows = monthlyRecords.filter((record) => String(record.workerId) === String(worker.workerId));
    const present = workerRows.filter((record) => record.status === 'Present').length;
    const late = workerRows.filter((record) => record.status === 'Late').length;
    const leave = workerRows.filter((record) => record.status === 'Leave').length;
    return {
      worker,
      present,
      late,
      leave,
      // A working day is any day the worker was on the floor: present, late or on leave.
      workingDays: present + late + leave,
      absent: workerRows.filter((record) => record.status === 'Absent').length,
      overtime: workerRows.reduce((total, record) => total + Number(record.overtimeHours || 0), 0),
      department: workerRows.find((record) => record.department)?.department || worker.department || '-',
      rows: workerRows,
    };
  }), [workers, monthlyRecords, workerSearch]);

  async function handleSeed() {
    setError('');
    setMessage('');
    try {
      const result = await seedWorkersToFirestore();
      setMessage(result.seeded ? `${result.count} workers added to Firestore.` : 'Workers collection already contains data.');
      await loadData();
    } catch (seedError) {
      setError(seedError.message);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setInvalidField('');
    if (!form.workerId) {
      setError('Please select a Worker before saving.');
      setInvalidField('workerId');
      return;
    }
    if (!form.department && !isAbsent) {
      setError('Please select a Department before saving.');
      setInvalidField('department');
      return;
    }
    if (!form.date) {
      setError('Please select a Date before saving.');
      setInvalidField('date');
      return;
    }
    if (!form.status) {
      setError('Please select a Status before saving.');
      setInvalidField('status');
      return;
    }
    if (['Present', 'Late'].includes(form.status)) {
      if (!form.inTime) {
        setError('Please select In-Time for Present/Late status.');
        setInvalidField('inTime');
        return;
      }
      if (!form.outTime) {
        setError('Please select Out-Time for Present/Late status.');
        setInvalidField('outTime');
        return;
      }
    }
    const worker = activeWorkers.find((item) => String(item.workerId) === String(form.workerId));
    if (!worker) {
      setError('Select an active worker.');
      return;
    }
    // Absent: use the worker's profile department so the record is never saved with an
    // empty department, falling back to 'N/A' when the profile has none.
    const department = isAbsent
      ? (worker.department || selectedWorkerProfile?.department || 'N/A')
      : form.department;
    // Duplicate guard: a worker can only hold one record per date, so check Firestore
    // before writing anything.
    setSaving(true);
    try {
      const existing = await findAttendanceForWorkerDate(form.workerId, form.date);
      if (existing) {
        setMessage('');
        setError(`Your data is already saved for ${form.date}. Please try another data.`);
        setInvalidField('workerId');
        return;
      }
      await saveAttendanceRecord({ ...form, department, worker });
      setMessage(`Attendance saved for ${worker.name}.`);
      setInvalidField('');
      // Reset every entry, keeping the date so consecutive absences can be logged fast.
      setForm({ date: form.date, workerId: '', department: '', inTime: '', outTime: '', status: '', lateMinutes: 0 });
      setAutoStatus(true);
      await loadData();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleInlineDelete(record) {
    if (!window.confirm(`Are you sure you want to delete this specific log for ${record.userName} on ${record.date}?`)) return;
    setDeletingId(record.id);
    setError('');
    setMessage('');
    try {
      await deleteAttendanceRecord(record.id);
      setMessage('Attendance entry deleted successfully.');
      await loadData();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeletingId(null);
    }
  }

  if (!isAdmin) {
    return <div className="module"><div className="module-header"><h2>📅 Smart Attendance</h2></div><div className="restricted-card"><h3 className="section-sub" style={{ marginTop: 0 }}>Manager access required</h3><p className="hint">Only approved managers can enter and export attendance.</p></div></div>;
  }

  return (
    <div className="module smart-attendance-page">
      <div className="module-header"><h2>📅 Smart Attendance</h2><p className="hint">Daily entries are stored in Firestore and summarized by month.</p></div>
      <div className="attendance-toolbar">
        {workers.length === 0 && <button className="btn btn-outline" onClick={handleSeed}>Seed 50 Workers</button>}
        <AttendancePeriodFilter
          month={selectedMonth}
          onMonthChange={handleMonthChange}
          date={selectedDate}
          onDateChange={handleDateChange}
          search={workerSearch}
          onSearchChange={setWorkerSearch}
        />
      </div>
      {loading && <p className="hint">Loading attendance...</p>}
      {message && <p className="settings-success">{message}</p>}
      {error && <p className="auth-error">{error}</p>}

      <form className="attendance-entry-form" onSubmit={handleSubmit}>
        <label className="form-field"><span>📅 Date</span><input type="date" value={form.date} aria-invalid={invalidField === 'date'} onChange={(event) => { setInvalidField(''); setForm({ ...form, date: event.target.value }); }} required /></label>
        <label className="form-field"><span>Worker</span><WorkerCombobox workers={activeWorkers} value={form.workerId} invalid={invalidField === 'workerId'} onChange={(workerId) => { setInvalidField(''); setForm((current) => ({ ...current, workerId })); }} /></label>
        <label className={`form-field ${lockDepartment ? 'is-locked' : ''}`}><span>Department</span><select value={form.department} disabled={lockDepartment} aria-invalid={invalidField === 'department'} onChange={(event) => { setInvalidField(''); setForm({ ...form, department: event.target.value }); }} required><option value="">Select department</option>{['Cutting', 'Sewing', 'Finishing', 'Washing', 'Delivery', 'Iron', 'Other'].map((department) => <option key={department}>{department}</option>)}</select></label>
        <label className={`form-field attendance-time-field ${isAbsent ? 'is-locked' : ''}`}><span>🕘 In-Time</span><input type="time" value={form.inTime} disabled={isAbsent} aria-invalid={invalidField === 'inTime'} onChange={(event) => onInTimeChange(event.target.value)} /></label>
        <label className={`form-field attendance-time-field ${isAbsent ? 'is-locked' : ''}`}><span>🕘 Out-Time</span><input type="time" value={form.outTime} disabled={isAbsent} aria-invalid={invalidField === 'outTime'} onChange={(event) => onOutTimeChange(event.target.value)} /></label>
        <label className={`form-field ${statusLocked ? 'is-locked' : ''}`}><span>Status{statusLocked ? ' 🔒' : ''}</span><select value={form.status} disabled={statusLocked} aria-invalid={invalidField === 'status'} onChange={(event) => onStatusChange(event.target.value)}><option value="">Select status</option><option>Present</option><option>Absent</option><option>Late</option><option>Leave</option></select></label>
        <div className="attendance-entry-actions"><span className="hint">Late: {lateMinutes} min · OT: {calculateOvertimeHours(form.inTime, form.outTime)} hours{statusLocked ? ` · Auto-set from In-Time (${form.status})` : isAbsent ? ' · Absent: times cleared, saved without times' : form.status === 'Leave' ? ' · Manual Leave — auto-calc off' : ' · Pick a status or enter In-Time'}</span><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Attendance'}</button></div>
      </form>

      <div className="attendance-section">
        <button
          type="button"
          className="attendance-accordion-header"
          aria-expanded={activeSection === 'daily'}
          onClick={() => toggleSection('daily')}
        >
          <span className="attendance-accordion-title">Daily Attendance Grid — {selectedMonth}{selectedDate ? ` · ${selectedDate}` : ''}</span>
          <span className={`chevron ${activeSection === 'daily' ? 'chevron-up' : 'chevron-down'}`} aria-hidden="true" />
        </button>
        {activeSection === 'daily' && <div className="attendance-grid-section"><div className="table-wrap attendance-grid-wrap attendance-scroll-area"><table><thead><tr><th>Worker</th>{visibleDayColumns.map((day) => <th key={day}>{day}</th>)}</tr></thead><tbody>{summaries.map((summary) => { const byDay = Object.fromEntries(summary.rows.map((row) => [Number(row.date.slice(-2)), row.status])); return <tr key={summary.worker.workerId}><td>{summary.worker.name}</td>{visibleDayColumns.map((day) => <td key={day}><span className={`attendance-status ${statusClass(byDay[day])}`}>{byDay[day]?.slice(0, 1) || '·'}</span></td>)}</tr>; })}</tbody></table></div></div>}
      </div>

      <div className="attendance-section">
        <button
          type="button"
          className="attendance-accordion-header"
          aria-expanded={activeSection === 'filtered'}
          onClick={() => toggleSection('filtered')}
        >
          <span className="attendance-accordion-title">Filtered Status Records — {form.date}</span>
          <span className={`chevron ${activeSection === 'filtered' ? 'chevron-up' : 'chevron-down'}`} aria-hidden="true" />
        </button>
        {activeSection === 'filtered' && <>
        <div className="attendance-tabs" role="tablist">
          {[['all', '📂 All Records'], ['present', '🟢 Present'], ['late', '🟡 Late List'], ['overtime', '⏰ Overtime'], ['absent', '🔴 Absent List']].map(([key, label]) => <button key={key} className={`attendance-tab ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)}>{label}</button>)}
        </div>
      <div className="table-wrap attendance-daily-table attendance-scroll-area"><table><thead><tr><th>Worker</th><th>Department</th><th>Date</th><th>Entry Time</th><th>Exit Time</th><th>Status</th><th>Late Minutes</th><th>OT Hours</th><th>Action</th></tr></thead><tbody>{filteredDailyRecords.map((record) => <tr key={record.id}><td>{record.userName}</td><td>{record.department || '-'}</td><td>{record.date}</td><td>{record.inTime || '-'}</td><td>{record.outTime || '-'}</td><td><span className={`badge ${record.status === 'Present' ? 'badge-green' : record.status === 'Late' ? 'badge-amber' : record.status === 'Absent' ? 'badge-red' : 'badge-amber'}`}>{record.status}</span></td><td>{record.lateMinutes || 0}</td><td>{Number(record.overtimeHours || 0).toFixed(2)}</td><td><button className="btn attendance-delete-btn attendance-view-btn" disabled={deletingId === record.id} onClick={() => handleInlineDelete(record)}>{deletingId === record.id ? 'Deleting...' : 'Delete'}</button></td></tr>)}{filteredDailyRecords.length === 0 && <tr><td colSpan="9" className="empty-row">No records for {form.date} in this filter.</td></tr>}</tbody></table></div>
        </>}
      </div>

      <div className="attendance-section">
        <button
          type="button"
          className="attendance-accordion-header"
          aria-expanded={activeSection === 'monthly'}
          onClick={() => toggleSection('monthly')}
        >
          <span className="attendance-accordion-title">Monthly Summary — {selectedMonth}</span>
          <span className={`chevron ${activeSection === 'monthly' ? 'chevron-up' : 'chevron-down'}`} aria-hidden="true" />
        </button>
        {activeSection === 'monthly' && <div className="table-wrap attendance-scroll-area"><table><thead><tr><th>Employee ID</th><th>Worker Name</th><th>Department</th><th>Total Working Days</th><th>Total Present</th><th>Total Absent</th><th>Total Late</th><th>Total Leave</th><th>Total Overtime (Hours)</th><th>Actions</th></tr></thead><tbody>{summaries.map((summary) => <tr key={summary.worker.workerId}><td className="mono-cell">{summary.worker.employeeId || summary.worker.workerId}</td><td>{summary.worker.name}</td><td>{summary.department}</td><td>{summary.workingDays}</td><td>{summary.present}</td><td>{summary.absent}</td><td>{summary.late}</td><td>{summary.leave}</td><td>{summary.overtime.toFixed(2)} h</td><td className="attendance-actions"><button className="btn btn-outline attendance-view-btn" onClick={() => { setSelectedWorker(summary.worker); setDetailMonth(selectedMonth); setDetailDate(form.date); setDetailMode('monthly'); }}>View Days</button><button className="btn btn-primary attendance-view-btn" onClick={() => { setEditWorker(summary.worker); setDetailMonth(selectedMonth); }}>Edit</button></td></tr>)}{!summaries.length && <tr><td colSpan="10" className="empty-row">Seed workers to begin attendance entry.</td></tr>}</tbody></table></div>}
      </div>

      {selectedWorker && <AttendanceDetailModal worker={selectedWorker} records={records} mode={detailMode} date={detailDate} month={detailMonth} onModeChange={setDetailMode} onDateChange={setDetailDate} onMonthChange={setDetailMonth} onClose={() => setSelectedWorker(null)} getDetails={recordDetails} />}
      {editWorker && <AttendanceEditModal worker={editWorker} records={records} month={detailMonth} onMonthChange={setDetailMonth} onClose={() => setEditWorker(null)} onSaved={loadData} getDetails={recordDetails} />}
    </div>
  );
}

function AttendanceEditModal({ worker, records, month, onMonthChange, onClose, onSaved, getDetails }) {
  const [year, monthIndex] = month.split('-').map(Number);
  const [savingId, setSavingId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const workerRecords = records.filter((record) => String(record.workerId) === String(worker.workerId) && isInMonth(record.date, year, monthIndex - 1));
  const [drafts, setDrafts] = useState(() => Object.fromEntries(workerRecords.map((record) => [record.id, { ...record }])));

  function changeDraft(id, field, value) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  }

  async function saveRow(recordId) {
    const draft = drafts[recordId];
    if (!draft?.date || !draft.status) {
      setError('Date and status are required.');
      return;
    }
    if (!window.confirm('Save these attendance changes?')) return;
    setSavingId(recordId);
    setError('');
    setMessage('');
    try {
      await updateAttendanceRecord(recordId, draft);
      setMessage('Attendance record updated successfully.');
      await onSaved();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingId(null);
    }
  }

  async function deleteRow(recordId) {
    if (!window.confirm('Are you sure you want to delete this attendance record? This action cannot be undone.')) return;
    setSavingId(recordId);
    setError('');
    setMessage('');
    try {
      await deleteAttendanceRecord(recordId);
      setMessage('Attendance record deleted successfully.');
      await onSaved();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSavingId(null);
    }
  }

  return <div className="attendance-modal-backdrop" onClick={onClose}>
    <section className="attendance-modal attendance-edit-modal" onClick={(event) => event.stopPropagation()}>
      <div className="attendance-modal-header"><div><h2>Edit Attendance — {worker.name}</h2><p className="hint">Employee ID: {worker.employeeId || worker.workerId}</p></div><button className="btn btn-outline" onClick={onClose}>Close</button></div>
      <div className="attendance-detail-controls"><label className="form-field"><span>Month</span><input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} /></label></div>
      {message && <p className="settings-success">{message}</p>}{error && <p className="auth-error">{error}</p>}
      <div className="table-wrap attendance-detail-table"><table><thead><tr><th>Date</th><th>Department</th><th>In-Time</th><th>Out-Time</th><th>Status</th><th>Late Minutes</th><th>OT Hours</th><th>Action</th></tr></thead><tbody>{workerRecords.map((record) => { const draft = drafts[record.id] || record; const details = getDetails(draft); return <tr key={record.id}><td><input type="date" value={draft.date || ''} onChange={(event) => changeDraft(record.id, 'date', event.target.value)} /></td><td><select value={draft.department || ''} onChange={(event) => changeDraft(record.id, 'department', event.target.value)}><option value="">Select department</option>{['Cutting', 'Sewing', 'Finishing', 'Washing', 'Delivery', 'Iron', 'Other'].map((department) => <option key={department}>{department}</option>)}</select></td><td><input type="time" value={draft.inTime || ''} onChange={(event) => changeDraft(record.id, 'inTime', event.target.value)} /></td><td><input type="time" value={draft.outTime || ''} onChange={(event) => changeDraft(record.id, 'outTime', event.target.value)} /></td><td><select value={draft.status || 'Present'} onChange={(event) => changeDraft(record.id, 'status', event.target.value)}><option>Present</option><option>Absent</option><option>Late</option><option>Leave</option></select></td><td>{details.lateMinutes}</td><td>{details.overtimeHours.toFixed(2)}</td><td className="attendance-actions"><button className="btn btn-primary attendance-view-btn" disabled={savingId === record.id} onClick={() => saveRow(record.id)}>{savingId === record.id ? 'Saving...' : 'Save Changes'}</button><button className="btn attendance-delete-btn attendance-view-btn" disabled={savingId === record.id} onClick={() => deleteRow(record.id)}>Delete</button></td></tr>; })}{workerRecords.length === 0 && <tr><td colSpan="8" className="empty-row">No records for this worker in the selected month.</td></tr>}</tbody></table></div>
    </section>
  </div>;
}

function AttendanceDetailModal({ worker, records, mode, date, month, onModeChange, onDateChange, onMonthChange, onClose, getDetails }) {
  const [year, monthIndex] = month.split('-').map(Number);
  const days = monthDays(month);
  const workerRecords = records.filter((record) => String(record.workerId) === String(worker.workerId));
  const dailyRecords = workerRecords.filter((record) => record.date === date);
  const monthlyRecords = workerRecords.filter((record) => isInMonth(record.date, year, monthIndex - 1));
  const byDay = Object.fromEntries(monthlyRecords.map((record) => [Number(record.date.slice(-2)), record]));

  return <div className="attendance-modal-backdrop" onClick={onClose}>
    <section className="attendance-modal" onClick={(event) => event.stopPropagation()}>
      <div className="attendance-modal-header"><div><h2>{worker.name}</h2><p className="hint">Employee ID: {worker.employeeId || worker.workerId}</p></div><button className="btn btn-outline" onClick={onClose}>Close</button></div>
      <div className="attendance-detail-controls"><div className="attendance-detail-tabs"><button className={`attendance-tab ${mode === 'daily' ? 'active' : ''}`} onClick={() => onModeChange('daily')}>Single Day</button><button className={`attendance-tab ${mode === 'monthly' ? 'active' : ''}`} onClick={() => onModeChange('monthly')}>Monthly View</button></div>{mode === 'daily' ? <label className="form-field"><span>Date</span><input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} /></label> : <label className="form-field"><span>Month</span><input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} /></label>}</div>
      {mode === 'daily' ? <div className="table-wrap attendance-detail-table"><table><thead><tr><th>Date</th><th>Department</th><th>Entry</th><th>Exit</th><th>Status</th><th>Duty Hours</th><th>Late Minutes</th><th>Exit Status</th><th>OT Hours</th></tr></thead><tbody>{dailyRecords.map((record) => { const details = getDetails(record); return <tr key={record.id}><td>{record.date}</td><td>{record.department || '-'}</td><td>{record.inTime || '-'}</td><td>{record.outTime || '-'}</td><td>{record.status}</td><td>{details.dutyHours.toFixed(2)}</td><td>{details.lateMinutes}</td><td>{details.exitStatus}</td><td>{details.overtimeHours.toFixed(2)}</td></tr>; })}{dailyRecords.length === 0 && <tr><td colSpan="9" className="empty-row">No log for this day.</td></tr>}</tbody></table></div> : <div className="table-wrap attendance-detail-table"><table><thead><tr><th>Date</th><th>Department</th><th>Entry</th><th>Exit</th><th>Status</th><th>Late Minutes</th><th>Exit Status</th><th>OT Hours</th></tr></thead><tbody>{Array.from({ length: days }, (_, index) => { const record = byDay[index + 1]; const details = record ? getDetails(record) : null; return <tr key={index + 1}><td>{`${month}-${String(index + 1).padStart(2, '0')}`}</td><td>{record?.department || '-'}</td><td>{record?.inTime || '-'}</td><td>{record?.outTime || '-'}</td><td>{record?.status || 'No Entry'}</td><td>{details?.lateMinutes || 0}</td><td>{details?.exitStatus || '-'}</td><td>{details?.overtimeHours.toFixed(2) || '0.00'}</td></tr>; })}</tbody></table></div>}
    </section>
  </div>;
}

// Searchable worker picker. Typing filters the active workers by first, middle or last
// name (and by worker ID) as you type; the list is keyboard navigable and falls back to
// the plain "no match" hint when nothing fits. It replaces the old <select> so a name
// can be found by any part of it without scrolling a long option list.
function WorkerCombobox({ workers, value, invalid, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // Enter must not submit the surrounding attendance form.
  const blurTimer = React.useRef(null);

  const selected = workers.find((worker) => String(worker.workerId) === String(value));
  // While the box is closed the input mirrors the chosen worker; once it is open the raw
  // query is shown so the user can keep refining what they typed.
  const inputValue = open ? query : (selected ? `${selected.workerId} — ${selected.name}` : '');

  const matches = useMemo(
    () => workers.filter((worker) => workerMatchesQuery(worker, query)).slice(0, 50),
    [workers, query]
  );

  // Keep the highlighted row inside the current result set as it narrows.
  useEffect(() => {
    setHighlight((current) => (current >= matches.length ? 0 : current));
  }, [matches.length]);

  function openList() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setQuery('');
    setHighlight(0);
    setOpen(true);
  }

  function choose(worker) {
    if (!worker) return;
    onChange(String(worker.workerId));
    setQuery('');
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      if (matches.length === 0) return;
      setHighlight((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
        return (next + matches.length) % matches.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      // Only swallow Enter when a suggestion is actually being picked.
      if (open && matches[highlight]) {
        event.preventDefault();
        choose(matches[highlight]);
      }
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div
      className="worker-combobox"
      onBlur={() => {
        // A short delay lets a click on a suggestion land before the list closes.
        blurTimer.current = setTimeout(() => setOpen(false), 150);
      }}
    >
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-invalid={invalid}
        autoComplete="off"
        placeholder={selected ? `${selected.employeeId || selected.workerId} — ${selected.name}` : 'Search worker by name or ID…'}
        value={inputValue}
        onFocus={openList}
        onClick={openList}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul className="worker-combobox-list" role="listbox">
          {matches.length === 0 && (
            <li className="worker-combobox-empty" aria-disabled="true">No worker matches “{query}”.</li>
          )}
          {matches.map((worker, index) => (
            <li
              key={worker.workerId}
              role="option"
              aria-selected={String(worker.workerId) === String(value)}
              className={`worker-combobox-option ${index === highlight ? 'is-highlighted' : ''} ${String(worker.workerId) === String(value) ? 'is-selected' : ''}`}
              onMouseDown={(event) => {
                // Fire before the input's blur closes the list.
                event.preventDefault();
                choose(worker);
              }}
              onMouseEnter={() => setHighlight(index)}
            >
              <span className="worker-combobox-name">{worker.name || worker.fullName || 'Unnamed worker'}</span>
              <span className="worker-combobox-id">{worker.employeeId || worker.workerId}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

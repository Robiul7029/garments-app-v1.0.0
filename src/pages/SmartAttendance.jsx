import React, { useEffect, useMemo, useState } from 'react';
import { useRole } from '../context/RoleContext';
import {
  calculateOvertimeHours,
  calculateLateMinutes,
  calculateDutyHours,
  getAttendanceFromFirestore,
  getWorkersFromFirestore,
  isInMonth,
  saveAttendanceRecord,
  seedWorkersToFirestore,
  deleteAttendanceRecord,
  updateAttendanceRecord,
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

export default function SmartAttendance() {
  const { isAdmin } = useRole();
  const [workers, setWorkers] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [form, setForm] = useState({ date: today(), workerId: '', department: '', inTime: '', outTime: '', status: 'Present' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [detailMode, setDetailMode] = useState('monthly');
  const [detailDate, setDetailDate] = useState(today);
  const [detailMonth, setDetailMonth] = useState(currentMonth);
  const [deletingId, setDeletingId] = useState(null);
  const [editWorker, setEditWorker] = useState(null);
  const [year, month] = selectedMonth.split('-').map(Number);
  const daysInSelectedMonth = monthDays(selectedMonth);

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

  const monthlyRecords = useMemo(() => records.filter((record) => isInMonth(record.date, year, month - 1)), [records, year, month]);
  const dailyRecords = useMemo(() => records.filter((record) => record.date === form.date), [records, form.date]);
  const filteredDailyRecords = useMemo(() => {
    if (activeTab === 'present') return dailyRecords.filter((record) => record.status === 'Present');
    if (activeTab === 'late') return dailyRecords.filter((record) => record.status === 'Late');
    if (activeTab === 'overtime') return dailyRecords.filter((record) => Number(record.overtimeHours || 0) > 0);
    if (activeTab === 'absent') return dailyRecords.filter((record) => record.status === 'Absent');
    return dailyRecords;
  }, [activeTab, dailyRecords]);
  const summaries = useMemo(() => workers.map((worker) => {
    const workerRows = monthlyRecords.filter((record) => String(record.workerId) === String(worker.workerId));
    return {
      worker,
      present: workerRows.filter((record) => record.status === 'Present').length,
      absent: workerRows.filter((record) => record.status === 'Absent').length,
      late: workerRows.filter((record) => record.status === 'Late').length,
      leave: workerRows.filter((record) => record.status === 'Leave').length,
      overtime: workerRows.reduce((total, record) => total + Number(record.overtimeHours || 0), 0),
      department: workerRows.find((record) => record.department)?.department || worker.department || '-',
      rows: workerRows,
    };
  }), [workers, monthlyRecords]);

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
    if (!form.department) {
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
    const worker = workers.find((item) => String(item.workerId) === String(form.workerId));
    if (!worker) {
      setError('Select an active worker.');
      return;
    }
    setSaving(true);
    try {
      await saveAttendanceRecord({ ...form, worker });
      setMessage(`Attendance saved for ${worker.name}.`);
      setInvalidField('');
      setForm((current) => ({ ...current, inTime: '', outTime: '', status: 'Present' }));
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
        <button className="btn btn-outline" onClick={() => setShowGrid((current) => !current)}>{showGrid ? 'Hide Daily Grid' : 'Show Daily Grid'}</button>
        {workers.length === 0 && <button className="btn btn-outline" onClick={handleSeed}>Seed 50 Workers</button>}
      </div>
      {loading && <p className="hint">Loading attendance...</p>}
      {message && <p className="settings-success">{message}</p>}
      {error && <p className="auth-error">{error}</p>}

      <form className="attendance-entry-form" onSubmit={handleSubmit}>
        <label className="form-field"><span>📅 Date</span><input type="date" value={form.date} aria-invalid={invalidField === 'date'} onChange={(event) => { setInvalidField(''); setForm({ ...form, date: event.target.value }); }} required /></label>
        <label className="form-field"><span>Worker</span><select value={form.workerId} aria-invalid={invalidField === 'workerId'} onChange={(event) => { setInvalidField(''); setForm({ ...form, workerId: event.target.value }); }} required><option value="">Select worker</option>{workers.map((worker) => <option key={worker.workerId} value={worker.workerId}>{worker.workerId} — {worker.name}</option>)}</select></label>
        <label className="form-field"><span>Department</span><select value={form.department} aria-invalid={invalidField === 'department'} onChange={(event) => { setInvalidField(''); setForm({ ...form, department: event.target.value }); }} required><option value="">Select department</option>{['Cutting', 'Sewing', 'Finishing', 'Washing', 'Delivery', 'Iron', 'Other'].map((department) => <option key={department}>{department}</option>)}</select></label>
        <label className="form-field attendance-time-field"><span>🕘 In-Time</span><input type="time" value={form.inTime} aria-invalid={invalidField === 'inTime'} onChange={(event) => { const inTime = event.target.value; const [hours, minutes] = inTime.split(':').map(Number); const status = inTime ? (hours * 60 + minutes > 480 ? 'Late' : 'Present') : form.status; setInvalidField(''); setForm({ ...form, inTime, status }); }} disabled={form.status === 'Absent' || form.status === 'Leave'} /></label>
        <label className="form-field attendance-time-field"><span>🕘 Out-Time</span><input type="time" value={form.outTime} aria-invalid={invalidField === 'outTime'} onChange={(event) => { setInvalidField(''); setForm({ ...form, outTime: event.target.value }); }} disabled={form.status === 'Absent' || form.status === 'Leave'} /></label>
        <label className="form-field"><span>Status</span><select value={form.status} aria-invalid={invalidField === 'status'} disabled={Boolean(form.inTime)} onChange={(event) => { setInvalidField(''); const status = event.target.value; setForm({ ...form, status, inTime: ['Absent', 'Leave'].includes(status) ? '' : form.inTime, outTime: ['Absent', 'Leave'].includes(status) ? '' : form.outTime }); }}><option value="">Select status</option><option>Present</option><option>Absent</option><option>Late</option><option>Leave</option></select></label>
        <div className="attendance-entry-actions"><span className="hint">Late: {calculateLateMinutes(form.inTime)} min · OT: {calculateOvertimeHours(form.inTime, form.outTime)} hours</span><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Attendance'}</button></div>
      </form>

      <div className="attendance-tabs" role="tablist">
        {[['all', '📂 All Records'], ['present', '🟢 Present'], ['late', '🟡 Late List'], ['overtime', '⏰ Overtime'], ['absent', '🔴 Absent List']].map(([key, label]) => <button key={key} className={`attendance-tab ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)}>{label}</button>)}
      </div>
      <div className="table-wrap attendance-daily-table"><table><thead><tr><th>Worker</th><th>Department</th><th>Date</th><th>Entry Time</th><th>Exit Time</th><th>Status</th><th>Late Minutes</th><th>OT Hours</th><th>Action</th></tr></thead><tbody>{filteredDailyRecords.map((record) => <tr key={record.id}><td>{record.userName}</td><td>{record.department || '-'}</td><td>{record.date}</td><td>{record.inTime || '-'}</td><td>{record.outTime || '-'}</td><td><span className={`badge ${record.status === 'Present' ? 'badge-green' : record.status === 'Late' ? 'badge-amber' : record.status === 'Absent' ? 'badge-red' : 'badge-amber'}`}>{record.status}</span></td><td>{record.lateMinutes || 0}</td><td>{Number(record.overtimeHours || 0).toFixed(2)}</td><td><button className="btn attendance-delete-btn attendance-view-btn" disabled={deletingId === record.id} onClick={() => handleInlineDelete(record)}>{deletingId === record.id ? 'Deleting...' : 'Delete'}</button></td></tr>)}{filteredDailyRecords.length === 0 && <tr><td colSpan="9" className="empty-row">No records for {form.date} in this filter.</td></tr>}</tbody></table></div>

      <div className="table-wrap"><table><thead><tr><th>Worker ID</th><th>Worker Name</th><th>Department</th><th>Total Present</th><th>Total Absent</th><th>Total Late</th><th>Overtime</th><th>Actions</th></tr></thead><tbody>{summaries.map((summary) => <tr key={summary.worker.workerId}><td>{summary.worker.workerId}</td><td>{summary.worker.name}</td><td>{summary.department}</td><td>{summary.present}</td><td>{summary.absent}</td><td>{summary.late}</td><td>{summary.overtime.toFixed(2)} h</td><td className="attendance-actions"><button className="btn btn-outline attendance-view-btn" onClick={() => { setSelectedWorker(summary.worker); setDetailMonth(selectedMonth); setDetailDate(form.date); setDetailMode('monthly'); }}>View Days</button><button className="btn btn-primary attendance-view-btn" onClick={() => { setEditWorker(summary.worker); setDetailMonth(selectedMonth); }}>Edit</button></td></tr>)}{!summaries.length && <tr><td colSpan="8" className="empty-row">Seed workers to begin attendance entry.</td></tr>}</tbody></table></div>

      {showGrid && <div className="attendance-grid-section"><h3 className="section-sub">Daily Status Grid — {selectedMonth}</h3><div className="table-wrap attendance-grid-wrap"><table><thead><tr><th>Worker</th>{Array.from({ length: daysInSelectedMonth }, (_, index) => <th key={index + 1}>{index + 1}</th>)}</tr></thead><tbody>{summaries.map((summary) => { const byDay = Object.fromEntries(summary.rows.map((row) => [Number(row.date.slice(-2)), row.status])); return <tr key={summary.worker.workerId}><td>{summary.worker.name}</td>{Array.from({ length: daysInSelectedMonth }, (_, index) => <td key={index + 1}><span className={`attendance-status ${statusClass(byDay[index + 1])}`}>{byDay[index + 1]?.slice(0, 1) || '·'}</span></td>)}</tr>; })}</tbody></table></div></div>}

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
      <div className="attendance-modal-header"><div><h2>Edit Attendance — {worker.name}</h2><p className="hint">Worker ID: {worker.workerId}</p></div><button className="btn btn-outline" onClick={onClose}>Close</button></div>
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
      <div className="attendance-modal-header"><div><h2>{worker.name}</h2><p className="hint">Worker ID: {worker.workerId}</p></div><button className="btn btn-outline" onClick={onClose}>Close</button></div>
      <div className="attendance-detail-controls"><div className="attendance-detail-tabs"><button className={`attendance-tab ${mode === 'daily' ? 'active' : ''}`} onClick={() => onModeChange('daily')}>Single Day</button><button className={`attendance-tab ${mode === 'monthly' ? 'active' : ''}`} onClick={() => onModeChange('monthly')}>Monthly View</button></div>{mode === 'daily' ? <label className="form-field"><span>Date</span><input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} /></label> : <label className="form-field"><span>Month</span><input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} /></label>}</div>
      {mode === 'daily' ? <div className="table-wrap attendance-detail-table"><table><thead><tr><th>Date</th><th>Department</th><th>Entry</th><th>Exit</th><th>Status</th><th>Duty Hours</th><th>Late Minutes</th><th>Exit Status</th><th>OT Hours</th></tr></thead><tbody>{dailyRecords.map((record) => { const details = getDetails(record); return <tr key={record.id}><td>{record.date}</td><td>{record.department || '-'}</td><td>{record.inTime || '-'}</td><td>{record.outTime || '-'}</td><td>{record.status}</td><td>{details.dutyHours.toFixed(2)}</td><td>{details.lateMinutes}</td><td>{details.exitStatus}</td><td>{details.overtimeHours.toFixed(2)}</td></tr>; })}{dailyRecords.length === 0 && <tr><td colSpan="9" className="empty-row">No log for this day.</td></tr>}</tbody></table></div> : <div className="table-wrap attendance-detail-table"><table><thead><tr><th>Date</th><th>Department</th><th>Entry</th><th>Exit</th><th>Status</th><th>Late Minutes</th><th>Exit Status</th><th>OT Hours</th></tr></thead><tbody>{Array.from({ length: days }, (_, index) => { const record = byDay[index + 1]; const details = record ? getDetails(record) : null; return <tr key={index + 1}><td>{`${month}-${String(index + 1).padStart(2, '0')}`}</td><td>{record?.department || '-'}</td><td>{record?.inTime || '-'}</td><td>{record?.outTime || '-'}</td><td>{record?.status || 'No Entry'}</td><td>{details?.lateMinutes || 0}</td><td>{details?.exitStatus || '-'}</td><td>{details?.overtimeHours.toFixed(2) || '0.00'}</td></tr>; })}</tbody></table></div>}
    </section>
  </div>;
}

import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadCSV } from '../utils/csv';
import { targetForProcess, dueLabel } from '../utils/calc';
import FieldInput from './FieldInput';
import AttendanceView from './AttendanceView';
import SmartAttendance from '../pages/SmartAttendance';
import AttendanceReport from '../pages/AttendanceReport';
import QualityControlView from './QualityControlView';
import EmployeeTargetChart from './EmployeeTargetChart';
import LineStatusView from './LineStatusView';
import HourlyTimesheet from './HourlyTimesheet';
import FinishingPlanView from './FinishingPlanView';
import { ProductionReportView, CuttingReportView, FinishingReportView } from './ReportViews';
import { SHORTFALL_REASONS } from '../config/menuConfig';
import { subscribeToAttendance, subscribeToWorkers } from '../utils/attendance';

const MONTHLY_TARGET = 10000;

export default function DataModule({ category, item }) {
  const { getData, addEntry, updateEntry, deleteEntry } = useData();
  const { isAdmin } = useRole();
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [editingId, setEditingId] = useState(null);

  // ---- route to specialized views ----
  if (item.variant === 'attendance') {
    if (item.key === 'daily-attendance') return <SmartAttendance />;
    return <AttendanceView category={category} item={item} />;
  }
  if (item.key === 'attendance-report') return <AttendanceReport />;
  if (item.variant === 'quality-control') return <QualityControlView category={category} item={item} />;
  if (item.variant === 'employee-chart') return <EmployeeTargetChart item={item} />;
  if (item.variant === 'line-status') return <LineStatusView item={item} />;
  if (item.variant === 'hourly-timesheet') return <HourlyTimesheet />;
  if (item.variant === 'finishing-plan') return <FinishingPlanView />;
  if (item.variant === 'production-report') return <ProductionReportView />;
  if (item.variant === 'cutting-report') return <CuttingReportView />;
  if (item.variant === 'finishing-report') return <FinishingReportView />;
  if (item.variant === 'progress') return <ProgressView item={item} getData={getData} />;
  if (item.variant === 'present-absent') return <PresentAbsentView item={item} getData={getData} isAdmin={isAdmin} />;
  if (item.variant === 'report') return <ReportView item={item} getData={getData} isAdmin={isAdmin} />;

  // ---- default: table view (with optional auto target/due columns) ----
  const rows = getData(item.key);
  const canAdd = isAdmin || item.userCanAdd;
  const canEditDelete = isAdmin;
  const canDownload = isAdmin && item.downloadable;

  function openAddForm() {
    setEditingId(null);
    setFormValues({});
    setShowForm(true);
  }
  function openEditForm(row) {
    setEditingId(row.id);
    setFormValues(row);
    setShowForm(true);
  }
  function handleSubmit(e) {
    e.preventDefault();
    if (editingId) updateEntry(item.key, editingId, formValues);
    else addEntry(item.key, formValues);
    setShowForm(false);
    setFormValues({});
    setEditingId(null);
  }

  const extraFields = item.shortfallReason ? [{ name: 'shortfall_reason', label: 'Reason (if under target)', type: 'select', options: SHORTFALL_REASONS }] : [];
  const allFields = [...item.fields, ...extraFields];

  function computeRow(row) {
    if (item.autoTarget) {
      const target = targetForProcess(row.process);
      const due = dueLabel(target, Number(row.quantity || 0));
      return { ...row, target, due: due.label, dueOk: due.ok };
    }
    if (item.diffCalc) {
      const target = Number(row[item.diffCalc.target] || 0);
      const actual = Number(row[item.diffCalc.actual] || 0);
      const due = dueLabel(target, actual);
      return { ...row, diff: due.label, diffOk: due.ok };
    }
    return row;
  }

  const downloadColumns = item.autoTarget
    ? [...allFields, { name: 'target', label: 'Target' }, { name: 'due', label: 'Due' }]
    : item.diffCalc
    ? [...allFields, { name: 'diff', label: 'Difference' }]
    : allFields;

  return (
    <div className="module">
      <ModuleHeader item={item} category={category} showViewOnly={!canEditDelete} />

      <div className="module-actions">
        {canAdd && <button className="btn btn-primary" onClick={openAddForm}>+ Add Entry</button>}
        {canDownload && (
          <button className="btn btn-outline" onClick={() => downloadCSV(`${item.key}.csv`, rows.map(computeRow), downloadColumns)}>
            ⬇ Download Report
          </button>
        )}
      </div>

      {showForm && (
        <form className="entry-form" onSubmit={handleSubmit}>
          {allFields.map((f) => (
            <FieldInput key={f.name} field={f} value={formValues[f.name]} formValues={formValues}
              onChange={(v) => setFormValues({ ...formValues, [f.name]: v })} />
          ))}
          {item.autoTarget && <p className="hint" style={{ gridColumn: '1 / -1' }}>Target and Due are calculated automatically from the selected process.</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">{editingId ? 'Save Changes' : 'Add'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {allFields.map((f) => <th key={f.name}>{f.label}</th>)}
              {item.autoTarget && <><th>Target</th><th>Due</th></>}
              {item.diffCalc && <th>Difference</th>}
              {canEditDelete && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={allFields.length + (item.autoTarget ? 2 : 0) + (item.diffCalc ? 1 : 0) + 1} className="empty-row">No entries yet.</td></tr>
            )}
            {rows.map((row) => {
              const c = computeRow(row);
              return (
                <tr key={row.id}>
                  {allFields.map((f) => <td key={f.name}>{row[f.name]}</td>)}
                  {item.autoTarget && (
                    <>
                      <td className="mono-cell">{c.target}</td>
                      <td style={{ color: c.dueOk ? '#34d399' : '#f87171' }}>{c.due}</td>
                    </>
                  )}
                  {item.diffCalc && (
                    <td style={{ color: c.diffOk ? '#34d399' : '#f87171' }}>{c.diff}</td>
                  )}
                  {canEditDelete && (
                    <td className="row-actions">
                      <button className="btn-icon" onClick={() => openEditForm(row)}>✏️</button>
                      <button className="btn-icon" onClick={() => deleteEntry(item.key, row.id)}>🗑️</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModuleHeader({ item, category, showViewOnly }) {
  return (
    <div className="module-header">
      <div className="breadcrumb">{category.icon} {category.label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0 }}>{item.icon} {item.label}</h2>
        {showViewOnly && <span className="badge badge-amber">View Only</span>}
      </div>
    </div>
  );
}

function ProgressView({ item, getData }) {
  const rows = getData(item.source);
  const qtyField = rows[0] && ('achieved' in rows[0] ? 'achieved' : 'quantity' in rows[0] ? 'quantity' : null);
  const totalDone = qtyField ? rows.reduce((s, r) => s + Number(r[qtyField] || 0), 0) : 0;
  const pct = Math.min(100, Math.round((totalDone / MONTHLY_TARGET) * 100));
  const remaining = Math.max(0, MONTHLY_TARGET - totalDone);

  return (
    <div className="module">
      <div className="module-header"><h2>{item.icon} {item.label}</h2></div>
      <div className="progress-card">
        <div className="progress-stats">
          <div><span className="big-num">{totalDone.toLocaleString()}</span><span className="stat-label">Done so far</span></div>
          <div><span className="big-num">{remaining.toLocaleString()}</span><span className="stat-label">Remaining</span></div>
          <div><span className="big-num" style={{ color: pct >= 80 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171' }}>{pct}%</span><span className="stat-label">of target</span></div>
        </div>
        <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}

function formatDate(dateValue) {
  if (!dateValue) return '';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${dateValue}T00:00:00`));
}

function PresentAbsentView({ item }) {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [rows, setRows] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleError = (loadError) => setError(loadError.message || 'Unable to load attendance data.');
    const unsubscribeAttendance = subscribeToAttendance(setRows, handleError);
    const unsubscribeWorkers = subscribeToWorkers(setWorkers, handleError);
    return () => { unsubscribeAttendance(); unsubscribeWorkers(); };
  }, []);

  function changeDate(dateValue) {
    setSelectedDate(dateValue);
    setSelectedMonth(dateValue.slice(0, 7));
  }

  const dailyRows = useMemo(() => rows.filter((row) => row.date === selectedDate), [rows, selectedDate]);
  const absent = dailyRows.filter((row) => row.status === 'Absent');
  const present = dailyRows.filter((row) => ['Present', 'Late'].includes(row.status));
  const other = dailyRows.filter((row) => !['Absent', 'Present', 'Late'].includes(row.status));
  const monthlyRows = useMemo(() => rows.filter((row) => row.date?.startsWith(selectedMonth)), [rows, selectedMonth]);

  function workerName(row) {
    return row.userName || row.employee || workers.find((worker) => String(worker.workerId) === String(row.workerId))?.name || 'Unknown worker';
  }

  return (
    <div className="module">
      <div className="module-header"><h2>{item.icon} {item.label}</h2></div>
      <div className="attendance-toolbar">
        <label className="form-field"><span>Date</span><input type="date" value={selectedDate} onChange={(event) => changeDate(event.target.value)} /></label>
        <label className="form-field"><span>Month View</span><input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></label>
      </div>
      <h3 className="section-sub">{formatDate(selectedDate)}</h3>
      {error && <p className="auth-error">{error}</p>}
      <div className="status-summary">
        <div className="status-chip status-red">{absent.length} Absent</div>
        <div className="status-chip status-green">{present.length} Present</div>
        <div className="status-chip status-amber">{other.length} Leave / Other</div>
      </div>
      <h3 className="section-sub">Absent Today</h3>
      {absent.length === 0 ? <p className="hint">Nobody is marked absent.</p> : (
        <ul className="status-list">{absent.map((r) => <li key={r.id} className="status-red">{workerName(r)}</li>)}</ul>
      )}
      <h3 className="section-sub">Present Today</h3>
      {present.length === 0 ? <p className="hint">Nobody is marked present.</p> : (
        <ul className="status-list">{present.map((r) => <li key={r.id} className="status-green">{workerName(r)}{r.status === 'Late' ? ' (Late)' : ''}</li>)}</ul>
      )}
      <h3 className="section-sub">Monthly Attendance Summary · {selectedMonth}</h3>
      <div className="status-summary">
        <div className="status-chip status-red">{monthlyRows.filter((row) => row.status === 'Absent').length} Absent</div>
        <div className="status-chip status-green">{monthlyRows.filter((row) => ['Present', 'Late'].includes(row.status)).length} Present</div>
        <div className="status-chip status-amber">{monthlyRows.filter((row) => !['Absent', 'Present', 'Late'].includes(row.status)).length} Leave / Other</div>
      </div>
    </div>
  );
}

function ReportView({ item, getData, isAdmin }) {
  const rows = getData(item.source);
  const columns = rows.length ? Object.keys(rows[0]).filter((k) => k !== 'id').map((k) => ({ name: k, label: k })) : [];

  return (
    <div className="module">
      <div className="module-header">
        <h2>{item.icon} {item.label}</h2>
        {!isAdmin && <span className="badge badge-amber" style={{ marginTop: 8, display: 'inline-block' }}>View Only</span>}
      </div>
      {isAdmin && (
        <div className="module-actions">
          <button className="btn btn-outline" onClick={() => downloadCSV(`${item.key}.csv`, rows, columns)}>⬇ Download Report</button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c) => <th key={c.name}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}>{columns.map((c) => <td key={c.name}>{r[c.name]}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

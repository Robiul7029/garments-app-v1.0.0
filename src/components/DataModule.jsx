import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadCSV } from '../utils/csv';
import { targetForProcess, dueLabel } from '../utils/calc';
import FieldInput from './FieldInput';
import AttendanceView from './AttendanceView';
import SmartAttendance from '../pages/SmartAttendance';
import LateAttendance from '../pages/LateAttendance';
import LeaveAttendance from '../pages/LeaveAttendance';
import AttendanceReport from '../pages/AttendanceReport';
import QualityControlView from './QualityControlView';
import EmployeeTargetChart from './EmployeeTargetChart';
import LineStatusView from './LineStatusView';
import HourlyTimesheet from './HourlyTimesheet';
import FinishingPlanView from './FinishingPlanView';
<<<<<<< Updated upstream:src/components/DataModule.jsx
=======
import DailyProductionTabs from './DailyProductionTabs';
import OperatorPerformance from '../pages/erp/production/OperatorPerformance';
import DailyProductionEntry from '../pages/DailyProductionEntry';
import WorkerProductionPage from '../pages/WorkerProductionPage';
import LineProductionPage from './LineProductionPage';
import OrderInputPage from '../pages/OrderInputPage';
import ProcessUploadPage from '../pages/ProcessUploadPage';
import OrderManagementTabs from '../pages/OrderManagementTabs';
import ManpowerManagementTabs from '../pages/ManpowerManagementTabs';
import TnaCalendarPage from '../pages/TnaCalendarPage';
import LineDeploymentPage from '../pages/LineDeploymentPage';
>>>>>>> Stashed changes:garments-full-app/src/components/DataModule.jsx
import { ProductionReportView, CuttingReportView, FinishingReportView } from './ReportViews';
import { SHORTFALL_REASONS } from '../config/menuConfig';
import AttendanceSummaryDashboard from './AttendanceSummaryDashboard';
import AttendanceMatrixGrid from './AttendanceMatrixGrid';

const MONTHLY_TARGET = 10000;

export default function DataModule({ category, item }) {
  const { getData, addEntry, updateEntry, deleteEntry } = useData();
  const { isAdmin } = useRole();
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [editingId, setEditingId] = useState(null);

  // A notification can deep-link here asking for read-only. The flag is consumed on the
  // first render so a normal visit to the same page is unaffected.
  const [openedReadOnly, setOpenedReadOnly] = useState(() => {
    const forced = sessionStorage.getItem('viewOnlyTarget') === '1';
    if (forced) sessionStorage.removeItem('viewOnlyTarget');
    return forced;
  });
  const readOnly = openedReadOnly || !isAdmin;

  // ---- route to specialized views ----
<<<<<<< Updated upstream:src/components/DataModule.jsx
  if (item.variant === 'attendance') {
    if (item.key === 'daily-attendance') return <SmartAttendance />;
    if (item.key === 'late') return <LateAttendance />;
    if (item.key === 'attendance-leave') return <LeaveAttendance />;
    return <AttendanceView category={category} item={item} />;
  }
=======
// The attendance screens are matched by their key first, not by the variant: `late` and
// `attendance-leave` carry `variant: 'table'` in the config (they describe the shape of a
// row, not the screen), so a variant-first check rendered the plain generic table and the
// dedicated Late / Leave pages were unreachable even though the route existed.
// Daily Production is now the 3-tab aggregated view (Daily All-Employee sheet,
// Monthly matrix, Overall Summary) plus an Hourly Entry tab that hosts the same
// Hourly Production form — so the screen is a set of views of the hourly rows
// rather than a second place to type the same day in.
if (item.key === 'daily-production' || item.variant === 'daily-production-tabs') return <DailyProductionTabs />;
// Worker Production is its own entry screen: a supervisor picks the employee and
// operation, the target is derived from the uploaded sheet's SMV, and only the
// actual output and defects are typed. It writes to `daily-production`, so a
// worker entry appears in the Daily Production summary immediately.
if (item.key === 'worker-production') return <WorkerProductionPage category={category} item={item} />;
// Line Production: the day's line-by-line output, with Edit / Delete per row. A line
// nobody submitted a Total Line Output entry for is filled in from the day's employee
// entries, so the table is never empty while the floor recorded work.
if (item.variant === 'line-production' || item.key === 'line-production') {
  return <LineProductionPage />;
}
// The sidebar's nested "Daily Production Entry" link lands here: the same
// three-section Hourly Production Tracking form, rendered as a full page
// rather than a modal, so every hour box is directly tabbable.
if (item.variant === 'daily-production-entry') {
  return <DailyProductionEntry category={category} item={item} parentItem={parentItem} />;
}
// Order Management and TNA Management screens. Each is routed here by its own
// variant, the same way every other bespoke screen in this file is, so the
// sidebar entry and the screen stay in step through menuConfig alone.
// Order Management is ONE screen with a tab bar, so its sidebar entry routes
// here rather than to an accordion of three separate pages. The individual
// `order-input` / `process-upload` branches below are kept so a bookmark or a
// notification deep-link to one of the old URLs still opens the right screen
// instead of falling through to the catch-all.
if (item.variant === 'order-management-tabs') return <OrderManagementTabs />;
if (item.variant === 'order-input') return <OrderInputPage category={category} item={item} />;
if (item.variant === 'process-upload') return <ProcessUploadPage category={category} item={item} />;
if (item.variant === 'tna-calendar') return <TnaCalendarPage category={category} item={item} />;
// Manpower Management is ONE screen with a tab bar (Line Deployment /
// Absenteeism), so its sidebar entry routes here rather than to an accordion of
// two separate pages. The individual `line-deployment` / `manpower-absent`
// branches below are kept so a bookmark or a notification deep-link to one of
// the old URLs still opens the right screen instead of falling through to the
// catch-all.
if (item.variant === 'manpower-management-tabs'
  || item.key === 'manpower-deployment'
  || item.key === 'manpower-management') {
  return <ManpowerManagementTabs />;
}
// The employee directory — a name in, a generated Employee ID out. Every other
// employee dropdown in the app selects from the list it maintains.
if (item.variant === 'line-deployment') return <LineDeploymentPage category={category} item={item} />;
if (item.key === 'daily-attendance') return <SmartAttendance />;
  if (item.key === 'late') return <LateAttendance />;
  if (item.key === 'attendance-leave') return <LeaveAttendance />;
>>>>>>> Stashed changes:garments-full-app/src/components/DataModule.jsx
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
  if (item.variant === 'monthly-matrix') return <MonthlyMatrixView item={item} />;
  // Operator Performance is ONE screen with an in-page segmented switch (Operator
  // Output / Efficiency %), so both old sub-menu entries now route here.
  if (item.variant === 'operator-performance'
    || item.key === 'operator-output'
    || item.key === 'operator-efficiency') {
    return <OperatorPerformance />;
  }
  if (item.variant === 'report') return <ReportView item={item} getData={getData} isAdmin={isAdmin} />;

  // A general user is always read-only here, and a notification deep-link hides the
  // controls even for a manager, so the screen only shows the data that was entered.
  const rows = getData(item.key);
  const canAdd = !readOnly && (isAdmin || item.userCanAdd);
  const canEditDelete = isAdmin && !openedReadOnly;
  const canDownload = isAdmin && item.downloadable && !openedReadOnly;

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

function PresentAbsentView({ item }) {
  return (
    <div className="module">
      <div className="module-header"><h2>{item.icon} {item.label}</h2></div>
      <AttendanceSummaryDashboard />
      <h3 className="section-sub">Monthly Attendance Matrix — {item.label}</h3>
      <AttendanceMatrixGrid />
    </div>
  );
}

function MonthlyMatrixView({ item }) {
  return (
    <div className="module">
      <div className="module-header"><h2>{item.icon} {item.label}</h2></div>
      <AttendanceMatrixGrid />
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

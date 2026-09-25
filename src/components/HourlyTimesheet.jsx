import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { targetForProcess } from '../utils/calc';
import FieldInput from './FieldInput';
import { downloadCSV } from '../utils/csv';

const HOURS = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17'];

export default function HourlyTimesheet() {
  const { getData, setRaw } = useData();
  const { isAdmin } = useRole();
  const rows = getData('hourly-timesheet-rows');
  const employees = getData('employees');
  const [newRow, setNewRow] = useState({});
  const [showForm, setShowForm] = useState(false);

  function addRow(e) {
    e.preventDefault();
    const id = Date.now();
    setRaw('hourly-timesheet-rows', [...rows, { id, employee: newRow.employee, process: newRow.process, hours: {} }]);
    setShowForm(false);
    setNewRow({});
  }

  function setHourValue(rowId, hour, value) {
    setRaw('hourly-timesheet-rows', rows.map((r) => r.id === rowId ? { ...r, hours: { ...r.hours, [hour]: value === '' ? undefined : Number(value) } } : r));
  }

  function removeRow(rowId) {
    setRaw('hourly-timesheet-rows', rows.filter((r) => r.id !== rowId));
  }

  return (
    <div className="module">
      <div className="module-header"><h2>⏱️ Hourly Production</h2></div>
      <p className="hint" style={{ marginBottom: 14 }}>
        Any hour can be filled in at any time — if the supervisor forgets the 10 o'clock entry,
        it can still be entered later; every hour column stays open all day.
      </p>

      {isAdmin && (
        <div className="module-actions">
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Add Employee Row</button>
          <button
            className="btn btn-outline"
            onClick={() => downloadCSV('hourly-production.csv',
              rows.map((r) => ({ employee: r.employee, process: r.process, ...Object.fromEntries(HOURS.map((h) => [h, r.hours[h] ?? ''])) })),
              [{ name: 'employee', label: 'Employee' }, { name: 'process', label: 'Process' }, ...HOURS.map((h) => ({ name: h, label: `${h}:00` }))]
            )}
          >
            ⬇ Download Report
          </button>
        </div>
      )}

      {showForm && (
        <form className="entry-form" onSubmit={addRow}>
          <FieldInput field={{ name: 'employee', label: 'Employee Name', type: 'employee-select' }} value={newRow.employee} formValues={newRow} onChange={(v) => setNewRow({ ...newRow, employee: v })} />
          <FieldInput field={{ name: 'department', label: 'Department', type: 'department-select' }} value={newRow.department} formValues={newRow} onChange={(v) => setNewRow({ ...newRow, department: v, process: undefined })} />
          <FieldInput field={{ name: 'process', label: 'Process', type: 'process-select', dependsOn: 'department' }} value={newRow.process} formValues={newRow} onChange={(v) => setNewRow({ ...newRow, process: v })} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Add Row</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Process</th>
              <th>Target/hr</th>
              {HOURS.map((h) => <th key={h}>{h}:00</th>)}
              {isAdmin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={HOURS.length + 3 + (isAdmin ? 1 : 0)} className="empty-row">No employee rows yet — add one above.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.employee}</td>
                <td>{r.process}</td>
                <td className="mono-cell">{targetForProcess(r.process)}</td>
                {HOURS.map((h) => (
                  <td key={h}>
                    <input
                      type="number"
                      className="hour-cell-input"
                      value={r.hours[h] ?? ''}
                      onChange={(e) => setHourValue(r.id, h, e.target.value)}
                      disabled={!isAdmin}
                      placeholder="-"
                    />
                  </td>
                ))}
                {isAdmin && <td><button className="btn-icon" onClick={() => removeRow(r.id)}>🗑️</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

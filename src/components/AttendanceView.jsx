import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadCSV } from '../utils/csv';
import { attendanceStatus } from '../utils/calc';
import FieldInput from './FieldInput';

export default function AttendanceView({ category, item }) {
  const { getData, addEntry, deleteEntry } = useData();
  const { isAdmin } = useRole();
  const rows = getData(item.key);
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState({});

  function handleSubmit(e) {
    e.preventDefault();
    addEntry(item.key, formValues);
    setShowForm(false);
    setFormValues({});
  }

  const displayColumns = [...item.fields, { name: 'status', label: 'Status' }, { name: 'minutes_late', label: 'Minutes Late' }];

  return (
    <div className="module">
      <div className="module-header">
        <div className="breadcrumb">{category.icon} {category.label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0 }}>{item.icon} {item.label}</h2>
          {!isAdmin && <span className="badge badge-amber">View Only</span>}
        </div>
      </div>

      <div className="module-actions">
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Add Entry</button>}
        {isAdmin && (
          <button
            className="btn btn-outline"
            onClick={() => downloadCSV(`${item.key}.csv`, rows.map(withStatus), displayColumns)}
          >
            ⬇ Download Report
          </button>
        )}
      </div>

      {showForm && (
        <form className="entry-form" onSubmit={handleSubmit}>
          {item.fields.map((f) => (
            <FieldInput key={f.name} field={f} value={formValues[f.name]} formValues={formValues}
              onChange={(v) => setFormValues({ ...formValues, [f.name]: v })} />
          ))}
          <p className="hint" style={{ gridColumn: '1 / -1' }}>Status and minutes late are calculated automatically from In Time — no need to type them.</p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Add</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>{displayColumns.map((c) => <th key={c.name}>{c.label}</th>)}{isAdmin && <th>Actions</th>}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={displayColumns.length + 1} className="empty-row">No entries yet.</td></tr>}
            {rows.map((row) => {
              const withCalc = withStatus(row);
              return (
                <tr key={row.id}>
                  {item.fields.map((f) => <td key={f.name}>{row[f.name]}</td>)}
                  <td><span className={`badge ${withCalc.status === 'Present' ? 'badge-green' : 'badge-red'}`}>{withCalc.status}</span></td>
                  <td>{withCalc.minutes_late || '-'}</td>
                  {isAdmin && (
                    <td className="row-actions">
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

function withStatus(row) {
  const { status, minutesLate } = attendanceStatus(row.in_time);
  return { ...row, status, minutes_late: minutesLate };
}

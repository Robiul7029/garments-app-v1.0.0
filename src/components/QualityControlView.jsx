import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadCSV } from '../utils/csv';
import FieldInput from './FieldInput';

const DEFECT_RATE_ALERT = 0.08; // flag a process if defect rate exceeds 8%

export default function QualityControlView({ category, item }) {
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

  // Group by process to find repeat offenders
  const byProcess = {};
  rows.forEach((r) => {
    if (!byProcess[r.process]) byProcess[r.process] = { checked: 0, defect: 0, entries: 0 };
    byProcess[r.process].checked += Number(r.checked || 0);
    byProcess[r.process].defect += Number(r.defect_qty || 0);
    byProcess[r.process].entries += 1;
  });
  const flagged = Object.entries(byProcess)
    .map(([process, v]) => ({ process, rate: v.checked ? v.defect / v.checked : 0, ...v }))
    .filter((p) => p.entries >= 2 && p.rate > DEFECT_RATE_ALERT);

  return (
    <div className="module">
      <div className="module-header">
        <div className="breadcrumb">{category.icon} {category.label}</div>
        <h2>{item.icon} {item.label}</h2>
      </div>

      {flagged.length > 0 && (
        <div className="alert-card">
          <strong>⚠ Repeated defects — needs supervisor attention:</strong>
          <ul>
            {flagged.map((f) => (
              <li key={f.process}>{f.process} — {Math.round(f.rate * 100)}% defect rate across {f.entries} entries</li>
            ))}
          </ul>
        </div>
      )}

      <div className="module-actions">
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Add Entry</button>}
        {isAdmin && <button className="btn btn-outline" onClick={() => downloadCSV(`${item.key}.csv`, rows, item.fields)}>⬇ Download Report</button>}
      </div>

      {showForm && (
        <form className="entry-form" onSubmit={handleSubmit}>
          {item.fields.map((f) => (
            <FieldInput key={f.name} field={f} value={formValues[f.name]} formValues={formValues}
              onChange={(v) => setFormValues({ ...formValues, [f.name]: v })} />
          ))}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Add</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>{item.fields.map((f) => <th key={f.name}>{f.label}</th>)}<th>Defect Rate</th>{isAdmin && <th>Actions</th>}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={item.fields.length + 2} className="empty-row">No entries yet.</td></tr>}
            {rows.map((row) => {
              const rate = row.checked ? Math.round((row.defect_qty / row.checked) * 100) : 0;
              return (
                <tr key={row.id}>
                  {item.fields.map((f) => <td key={f.name}>{row[f.name]}</td>)}
                  <td style={{ color: rate > DEFECT_RATE_ALERT * 100 ? '#f87171' : '#34d399' }}>{rate}%</td>
                  {isAdmin && <td className="row-actions"><button className="btn-icon" onClick={() => deleteEntry(item.key, row.id)}>🗑️</button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

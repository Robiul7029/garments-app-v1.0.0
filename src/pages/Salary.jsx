import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { salaryConfig } from '../config/menuConfig';
import { downloadCSV } from '../utils/csv';
import FieldInput from '../components/FieldInput';

export default function Salary() {
  const { getData, addEntry, updateEntry, deleteEntry } = useData();
  const { isAdmin } = useRole();
  const rows = getData('salary');
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [editingId, setEditingId] = useState(null);

  if (!isAdmin) {
    // Regular view: no salary figures shown, just a simple status headline.
    const processingCount = rows.filter((r) => r.status === 'Processing').length;
    return (
      <div className="module">
        <div className="module-header"><h2>{salaryConfig.icon} Salary</h2></div>
        <div className="restricted-card">
          <h3 className="section-sub" style={{ marginTop: 0 }}>Your Salary: Processing</h3>
          <p className="hint">{processingCount} payment(s) currently processing.</p>
        </div>
      </div>
    );
  }

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
    if (editingId) updateEntry('salary', editingId, formValues);
    else addEntry('salary', formValues);
    setShowForm(false);
    setFormValues({});
    setEditingId(null);
  }

  return (
    <div className="module">
      <div className="module-header"><h2>{salaryConfig.icon} Salary — Admin View</h2></div>
      <div className="module-actions">
        <button className="btn btn-primary" onClick={openAddForm}>+ Add Entry</button>
        <button className="btn btn-outline" onClick={() => downloadCSV('salary.csv', rows, salaryConfig.fields)}>⬇ Download Report</button>
      </div>

      {showForm && (
        <form className="entry-form" onSubmit={handleSubmit}>
          {salaryConfig.fields.map((f) => (
            <FieldInput key={f.name} field={f} value={formValues[f.name]} formValues={formValues}
              onChange={(v) => setFormValues({ ...formValues, [f.name]: v })} />
          ))}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">{editingId ? 'Save Changes' : 'Add'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>{salaryConfig.fields.map((f) => <th key={f.name}>{f.label}</th>)}<th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {salaryConfig.fields.map((f) => <td key={f.name}>{row[f.name]}</td>)}
                <td className="row-actions">
                  <button className="btn-icon" onClick={() => openEditForm(row)}>✏️</button>
                  <button className="btn-icon" onClick={() => deleteEntry('salary', row.id)}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import React, { useEffect } from 'react';
import { useData } from '../context/DataContext';
import { PROCESS_MAP, COLOR_LIST } from '../config/menuConfig';

export default function FieldInput({ field, value, formValues, onChange }) {
  const { getData } = useData();

  const label = (
    <span>
      {field.label}
      {field.autoNote && <em className="auto-note"> (auto)</em>}
    </span>
  );

  // Plain select with a fixed option list
  if (field.type === 'select') {
    return (
      <label className="form-field">
        {label}
        <select required value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select…</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <label className="form-field" style={{ gridColumn: '1 / -1' }}>
        {label}
        <textarea rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="Write details here…" />
      </label>
    );
  }

  if (field.type === 'employee-select') {
    const employees = getData('employees');
    return (
      <label className="form-field">
        {label}
        <select required value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select employee…</option>
          {employees.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'style-select') {
    const styles = getData('order-model').map((o) => o.style);
    return (
      <label className="form-field">
        {label}
        <select required value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select style…</option>
          {styles.length === 0 && <option disabled>No styles yet — add one in Order / Model</option>}
          {styles.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'department-select') {
    const departments = Object.keys(PROCESS_MAP);
    return (
      <label className="form-field">
        {label}
        <select required value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select department…</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'locked-department') {
    // Always Finishing here — the field exists so the layout matches
    // the Sewing form, but only Finishing shows, nothing else can be picked.
    useEffect(() => {
      if (value !== 'Finishing') onChange('Finishing');
    }, [value]);
    return (
      <label className="form-field">
        {label}
        <input value="Finishing" disabled />
      </label>
    );
  }

  if (field.type === 'process-select') {
    const dept = formValues[field.dependsOn];
    const options = dept ? PROCESS_MAP[dept] || [] : [];
    return (
      <label className="form-field">
        {label}
        <select required value={value || ''} disabled={!dept} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>{dept ? 'Select process…' : 'Pick a department first'}</option>
          {options.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'process-select-all') {
    const all = Object.values(PROCESS_MAP).flat();
    return (
      <label className="form-field">
        {label}
        <select required value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select process…</option>
          {all.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'color-select') {
    return (
      <label className="form-field">
        {label}
        <select required value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select color…</option>
          {COLOR_LIST.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.code})</option>)}
        </select>
      </label>
    );
  }

  // default: text / number / date / time
  return (
    <label className="form-field">
      {label}
      <input
        required
        type={field.type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

import React, { useEffect } from 'react';
import { useData } from '../context/DataContext';
import { PROCESS_MAP, COLOR_LIST } from '../config/menuConfig';
import { SHIFT_OPTIONS, FLOOR_OPTIONS } from '../config/dailyProductionForm';

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

  // Buyer is free text historically, so the list is built from the orders that
  // already exist and falls back to the same plain input when none do.
  if (field.type === 'buyer-select') {
    const buyers = [...new Set(getData('order-model').map((o) => o.buyer).filter(Boolean))];
    if (buyers.length === 0) {
      return (
        <label className="form-field">
          {label}
          <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="Buyer name" />
        </label>
      );
    }
    return (
      <label className="form-field">
        {label}
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select buyer…</option>
          {buyers.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
    );
  }

  // Order numbers are used verbatim when the master data has none, so the field
  // never becomes unusable on a fresh install.
  if (field.type === 'order-select') {
    const orders = getData('order-model');
    const numbers = [...new Set(orders.map((o) => o.order_no || o.orderNo).filter(Boolean))];
    if (numbers.length === 0) {
      return (
        <label className="form-field">
          {label}
          <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="PO / Order no" />
        </label>
      );
    }
    return (
      <label className="form-field">
        {label}
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select order…</option>
          {numbers.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'shift-select') {
    return (
      <label className="form-field">
        {label}
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select shift…</option>
          {SHIFT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'floor-select') {
    return (
      <label className="form-field">
        {label}
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select floor…</option>
          {FLOOR_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
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
        // A `computed` field is derived from other inputs, so it is neither
        // required nor typed — an empty box is a normal state mid-entry, and
        // marking it required would block the save on a field the user is not
        // meant to fill in. Its value is supplied by the caller.
        required={!field.computed}
        readOnly={field.computed}
        disabled={field.computed}
        type={field.type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { C } from '../../../config/erpSchema';
import { MODULE, ACTION } from '../../../config/erpRoles';
import { usePermissions } from '../../../context/PermissionContext';
import { useErpData } from '../../../context/ErpDataContext';
import { useData } from '../../../context/DataContext';
import {
  EmptyState, ErrorState, LoadingState, Notice, StatCard, StatusBadge, ValidationSummary,
} from '../../../components/erp/Primitives';
import { formatNumber } from '../../../components/erp/Charts';
import { buildLineRecord, lineDepartmentOptions, validateLine } from '../../../config/productionLineMaster';

/**
 * ROBIUL GARMENTS ERP — Production Lines (the line master).
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * `productionLines` is a FOREIGN KEY the rest of the ERP depends on:
 *
 *   - `hourlyProduction.lineId` is REQUIRED, so the hourly mirror skips every row
 *     whose line cannot be resolved;
 *   - Line Shift, Line Input & WIP and the Line Output panels all reference a line;
 *   - the Total Line Output entry offers these lines in its Line dropdown.
 *
 * Until now the collection could only be populated by writing documents by hand, so
 * on a fresh deployment it was empty and the floor's entries silently had nowhere to
 * land. This is the screen that creates and maintains the master, in the same shape
 * the schema declares (`lineNo` unique, `name`, `department`, supervisor, capacity).
 *
 * It reads and writes the SAME Firestore collection the rest of the ERP subscribes
 * to, via `erp.save`/`erp.remove`, so a line added here is on every other screen the
 * moment it is saved — no second list to reconcile.
 */
const BLANK = {
  lineNo: '',
  name: '',
  department: 'Sewing',
  supervisorId: '',
  capacityPerHour: '',
  active: true,
};

export default function ProductionLines() {
  const erp = useErpData();
  const permissions = usePermissions();
  const { getData } = useData();

  const [form, setForm] = useState({ ...BLANK });
  const [editingId, setEditingId] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  // A line is production master data, so the screen is gated the same way the other
  // production screens are: a View-Only role reads the list and sees no form.
  const canView = permissions.canView(MODULE.PRODUCTION);
  const canCreate = permissions.can(MODULE.PRODUCTION, ACTION.CREATE);
  const canEdit = permissions.can(MODULE.PRODUCTION, ACTION.EDIT);
  const canDelete = permissions.can(MODULE.PRODUCTION, ACTION.DELETE);

  // Load the master (and the supervisors the form offers) for the life of the screen.
  useEffect(() => {
    if (!canView) return undefined;
    const offLines = erp.subscribe('lines', { collection: C.PRODUCTION_LINES, pageSize: 200 });
    const offStaff = erp.subscribe('lineSupervisorStaff', { collection: C.EMPLOYEES, pageSize: 300 });
    return () => { offLines?.(); offStaff?.(); };
  }, [canView, erp.subscribe]);

  const lines = erp.rows('lines');
  const staff = erp.rows('lineSupervisorStaff');
  const loading = erp.isLoading('lines');
  const error = erp.errorFor('lines');

  /**
   * The supervisors the Supervisor field offers.
   *
   * The ERP employee master and the Line Deployment roster are both accepted, because
   * a deployment may have populated either. Only people designated Supervisor are
   * offered — the same rule the Total Line Output entry applies.
   */
  const supervisorOptions = useMemo(() => {
    const out = [];
    const seen = new Set();
    const add = (id, name) => {
      const clean = String(name || '').trim();
      if (!id || !clean || seen.has(id)) return;
      seen.add(id);
      out.push({ id, name: clean });
    };
    staff.forEach((e) => {
      const text = `${e.designation || ''} ${e.role || ''}`.toLowerCase();
      if (!/\bsupervisor\b/.test(text)) return;
      add(e.id, e.name);
    });
    // The local roster names people but carries no ERP document id, so those names
    // are offered only when the ERP master has nothing — a supervisor can still be
    // recorded by name rather than being impossible to select.
    if (out.length === 0) {
      const directory = getData('employee-directory') || [];
      directory.forEach((e) => {
        if (!/\bsupervisor\b/i.test(String(e.designation || e.role || ''))) return;
        const name = String(e.name || '').trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        out.push({ id: name, name });
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, getData]);

  const sorted = useMemo(
    () => [...lines].sort((a, b) => String(a.lineNo || a.name || '')
      .localeCompare(String(b.lineNo || b.name || ''), undefined, { numeric: true })),
    [lines],
  );

  const activeCount = lines.filter((l) => l.active !== false).length;
  const capacityTotal = lines.reduce((sum, l) => sum + (Number(l.capacityPerHour) || 0), 0);

  const onChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: '' } : prev));
  };

  function reset() {
    setForm({ ...BLANK });
    setEditingId(null);
    setErrors({});
  }

  function startEdit(line) {
    setEditingId(line.id);
    setErrors({});
    setNotice(null);
    setForm({
      lineNo: line.lineNo || '',
      name: line.name || '',
      department: line.department || 'Sewing',
      supervisorId: line.supervisorId || '',
      capacityPerHour: line.capacityPerHour ?? '',
      active: line.active !== false,
    });
  }

  async function onSubmit(event) {
    event.preventDefault();
    const found = validateLine(form, lines, editingId);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setBusy(true);
    const values = buildLineRecord(form);
    const result = await erp.save(C.PRODUCTION_LINES, values, {
      id: editingId || undefined,
      module: MODULE.PRODUCTION,
    });
    setBusy(false);
    if (!result?.ok) {
      setNotice({ kind: 'error', message: result?.error || 'Could not save this line.' });
      if (result?.errors) setErrors(result.errors);
      return;
    }
    setNotice({
      kind: 'success',
      message: `${values.lineNo} saved. It is now offered wherever a line is chosen.`,
    });
    reset();
  }

  async function confirmDelete() {
    const line = pendingDelete;
    setPendingDelete(null);
    if (!line) return;
    setBusy(true);
    const result = await erp.remove(C.PRODUCTION_LINES, line.id, { module: MODULE.PRODUCTION, label: line.lineNo });
    setBusy(false);
    if (!result?.ok) {
      setNotice({ kind: 'error', message: result?.error || 'Could not delete this line.' });
      return;
    }
    if (editingId === line.id) reset();
    setNotice({ kind: 'success', message: `${line.lineNo || line.name} removed.` });
  }

  if (!canView) {
    return <EmptyState icon="🔒" title="Production lines" message="Your role cannot read production master data." />;
  }
  if (loading && lines.length === 0) return <LoadingState label="Loading the line master…" rows={4} />;
  if (error && lines.length === 0) return <ErrorState message={error} />;

  return (
    <div className="erp-page">
      <header className="erp-page-header">
        <div>
          <h1 className="erp-page-title">🏗️ Production Lines</h1>
          <p className="erp-page-description">
            The line master every other screen selects from. A line recorded here is
            offered by Hourly Production, Total Line Output, Line Input &amp; WIP and
            the hourly mirror — delete or deactivate one and it stops being offered,
            without losing the history already booked to it.
          </p>
        </div>
      </header>

      <div className="erp-stat-grid">
        <StatCard label="Lines" value={formatNumber(lines.length)} icon="🏗️" hint="Registered in the master" />
        <StatCard label="Active Lines" value={formatNumber(activeCount)} icon="✅" level={activeCount > 0 ? 'good' : 'warning'} hint="Offered on every entry form" />
        <StatCard label="Nominal Capacity" value={formatNumber(capacityTotal)} unit="pcs/hr" icon="⚡" hint="Sum of the active lines' capacity" />
        <StatCard label="Supervisors Listed" value={formatNumber(supervisorOptions.length)} icon="👷" hint="Pull from the employee master" />
      </div>

      {lines.length === 0 && (
        <div className="erp-notice erp-notice-info" role="status">
          <span aria-hidden="true">ℹ️</span>
          <span>
            No production lines yet. Add each line (Line-01, Line-02…) below — until
            one exists, floor entries have no line to be mirrored onto.
          </span>
        </div>
      )}

      <Notice kind={notice?.kind} onDismiss={() => setNotice(null)}>{notice?.message}</Notice>

      {(canCreate || (editingId && canEdit)) && (
        <section className="erp-panel">
          <h2 className="erp-panel-title">{editingId ? 'Edit line' : 'Add a line'}</h2>
          <form className="erp-form" onSubmit={onSubmit} noValidate>
            <div className="erp-form-grid">
              <LineField
                label="Line No" name="lineNo" required value={form.lineNo} error={errors.lineNo}
                placeholder="e.g. Line-03" onChange={(v) => onChange('lineNo', v)}
              />
              <LineField
                label="Line Name" name="name" required value={form.name} error={errors.name}
                placeholder="e.g. Sewing Line 03" onChange={(v) => onChange('name', v)}
              />
              <label className={`erp-field${errors.department ? ' erp-field-invalid' : ''}`} htmlFor="line-field-department">
                <span className="erp-field-label">Department<span className="erp-field-required" aria-hidden="true"> *</span></span>
                <select
                  id="line-field-department"
                  className="erp-input"
                  value={form.department}
                  onChange={(e) => onChange('department', e.target.value)}
                >
                  {lineDepartmentOptions().map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                {errors.department && <span className="erp-field-error" role="alert">{errors.department}</span>}
              </label>
              <label className="erp-field" htmlFor="line-field-supervisor">
                <span className="erp-field-label">Supervisor</span>
                <select
                  id="line-field-supervisor"
                  className="erp-input"
                  value={form.supervisorId}
                  onChange={(e) => onChange('supervisorId', e.target.value)}
                >
                  <option value="">— None —</option>
                  {supervisorOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <LineField
                label="Capacity (pcs/hr)" name="capacityPerHour" type="number" min="0" step="1"
                value={form.capacityPerHour} error={errors.capacityPerHour}
                unit="pcs/hr" placeholder="e.g. 240" onChange={(v) => onChange('capacityPerHour', v)}
              />
              <label className="erp-field" htmlFor="line-field-active">
                <span className="erp-field-label">Status</span>
                <select
                  id="line-field-active"
                  className="erp-input"
                  value={form.active ? 'active' : 'inactive'}
                  onChange={(e) => onChange('active', e.target.value === 'active')}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>

            <ValidationSummary errors={errors} />

            <div className="erp-form-actions">
              <button type="button" className="btn btn-outline" onClick={reset} disabled={busy}>Clear</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : (editingId ? 'Save changes' : 'Save line')}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="erp-panel">
        <h2 className="erp-panel-title">
          Line master
          <span className="erp-panel-sub">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
        </h2>
        {sorted.length === 0 ? (
          <p className="erp-panel-sub">No lines recorded yet.</p>
        ) : (
          <div className="erp-table-wrap">
            <table className="erp-table erp-table-compact">
              <thead>
                <tr>
                  <th>Line No</th>
                  <th>Line Name</th>
                  <th>Department</th>
                  <th>Supervisor</th>
                  <th className="dp-num">Capacity (pcs/hr)</th>
                  <th>Status</th>
                  {(canEdit || canDelete) && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map((line) => (
                  <tr key={line.id}>
                    <td>{line.lineNo || '—'}</td>
                    <td>{line.name || '—'}</td>
                    <td>{line.department || '—'}</td>
                    <td>
                      {line.supervisorName
                        || supervisorOptions.find((s) => s.id === line.supervisorId)?.name
                        || line.supervisorId
                        || '—'}
                    </td>
                    <td className="mono-cell dp-num">
                      {Number(line.capacityPerHour) > 0 ? Number(line.capacityPerHour).toLocaleString() : '—'}
                    </td>
                    <td><StatusBadge status={line.active === false ? 'Inactive' : 'Active'} /></td>
                    {(canEdit || canDelete) && (
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {canEdit && (
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => startEdit(line)}>
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => setPendingDelete(line)}
                              disabled={busy}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pendingDelete && (
        <div className="erp-modal-backdrop" role="presentation" onClick={() => setPendingDelete(null)}>
          <div className="erp-modal" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Delete {pendingDelete.lineNo || pendingDelete.name}?</h3>
            <p>
              Entries already booked to this line keep their stored name. New entries
              will no longer offer it. Deactivating instead keeps the line selectable
              history intact.
            </p>
            <div className="erp-modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setPendingDelete(null)}>No</button>
              <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={busy}>
                {busy ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A labelled text / number field. The error sits under its own field. */
function LineField({ label, name, value, error, onChange, type = 'text', placeholder, unit, required, ...rest }) {
  const id = `line-field-${name}`;
  return (
    <label className={`erp-field${error ? ' erp-field-invalid' : ''}`} htmlFor={id}>
      <span className="erp-field-label">
        {label}{required && <span className="erp-field-required" aria-hidden="true"> *</span>}
      </span>
      <span className="erp-field-control">
        <input
          id={id}
          className="erp-input"
          name={name}
          type={type}
          value={value}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        {unit && <span className="erp-field-unit">{unit}</span>}
      </span>
      {error && <span className="erp-field-error" role="alert">{error}</span>}
    </label>
  );
}

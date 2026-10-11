import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import SearchableSelect from '../components/SearchableSelect';
import ProductionGroupTable, { ProductionGroupTableHead } from '../components/ProductionGroupTable';
import {
  COLLECTIONS,
  selectableOrders,
  orderLabel,
  findOrderByStyle,
  processNamesForStyle,
  operationsForStyle,
} from '../config/orderWorkflow';
import {
  CAPACITY_COLLECTION,
  capacityForStyle,
  targetForOperation,
  achievementVsTarget,
} from '../config/smvTargetEngine';
import { buildDailyProductionRecord } from '../config/dailyProductionForm';
import { varianceLabel } from '../config/productionGrouping';

/**
 * ROBIUL GARMENTS ERP — "Worker Production" entry.
 *
 * What one operator produced on one operation, in a single line of work.
 *
 * THE POINT OF THIS SCREEN (the brief's third and fourth requirements)
 * ------------------------------------------------------------------
 * The supervisor does NOT type a target. They pick a Style, an Employee and an
 * Operation, and the target is DERIVED from the uploaded process breakdown: the
 * operation's SMV, converted with the style's saved manpower / hours / efficiency
 * into the pieces one operator should make in a day and in an hour.
 *
 * They then type only two things — the Actual Achievement and the Defects — and
 * every other figure (good output, variance +/−, efficiency %) is computed live.
 *
 * On save the row is written to `daily-production`, the SAME collection the Daily
 * Production screen, the Production Report, Line Status and the Excel export read.
 * A worker entry therefore IS a daily-production record the instant it is saved —
 * there is no second copy to reconcile and no sync job to fall behind.
 *
 * MULTIPLE PROCESSES IN A DAY
 * ---------------------------
 * A worker normally moves between operations. Each save adds one process row for
 * that employee/day; the table below groups them so the name appears once with
 * every process underneath (see ProductionGroupTable).
 */
export default function WorkerProductionPage({ item, category }) {
  const { getData, addEntry, deleteEntry } = useData();
  const { isAdmin } = useRole();

  const rows = getData('daily-production');
  const orders = getData(COLLECTIONS.ORDERS);
  const processSheets = getData(COLLECTIONS.PROCESS_SHEETS);
  const capacityRecords = getData(CAPACITY_COLLECTION);

  const todayKey = new Date().toISOString().slice(0, 10);

  const [entry, setEntry] = useState({
    date: todayKey,
    employee: '',
    style: '',
    process: '',
    quantity: '',
    defect_qty: '',
  });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const employees = getData('employees');

  const orderOptions = useMemo(
    () => selectableOrders(orders).map((o) => ({
      value: o.style || o.order_no,
      label: orderLabel(o),
      hint: [o.buyer, o.color, o.qty ? `${o.qty} pcs` : ''].filter(Boolean).join(' · '),
      order: o,
    })),
    [orders],
  );

  const currentOrder = useMemo(
    () => findOrderByStyle(orders, entry.style) || {},
    [orders, entry.style],
  );

  const currentOperations = useMemo(
    () => operationsForStyle(processSheets, {
      style: entry.style,
      order_no: entry.order_no || currentOrder.order_no,
    }),
    [processSheets, entry.style, entry.order_no, currentOrder.order_no],
  );

  const currentCapacity = useMemo(
    () => capacityForStyle(capacityRecords, {
      style: entry.style,
      order_no: entry.order_no || currentOrder.order_no,
    }),
    [capacityRecords, entry.style, entry.order_no, currentOrder.order_no],
  );

  /** The operations on this style's uploaded sheet, each with its derived target. */
  const processOptions = useMemo(() => processNamesForStyle(processSheets, {
    style: entry.style,
    order_no: entry.order_no || currentOrder.order_no,
  }).map((name) => {
    const derived = targetForOperation({
      operations: currentOperations,
      settings: currentCapacity || {},
      operationName: name,
    });
    return {
      value: name,
      label: name,
      hint: derived.hasSmv
        ? `SMV ${derived.smv} · ${derived.target} pcs/day`
        : 'SMV not on the sheet',
    };
  }), [processSheets, entry.style, entry.order_no, currentOrder.order_no, currentOperations, currentCapacity]);

  /**
   * The derived target for the chosen operation — the whole point of the screen.
   * Read from the same engine the Daily Production page uses, so the two screens
   * measure an operator against an identical number.
   */
  const derived = useMemo(() => targetForOperation({
    operations: currentOperations,
    settings: currentCapacity || {},
    operationName: entry.process,
  }), [currentOperations, currentCapacity, entry.process]);

  // Live variance for what has been typed so far.
  const live = achievementVsTarget(entry.quantity, derived.target);

  function set(field, value) {
    setEntry((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Picking a style prefills the order-owned fields (buyer, order no, line, floor,
   * shift, supervisor, color, size range, PO qty) exactly as Daily Production does,
   * and clears an operation that the new style's sheet does not define.
   */
  function selectStyle(style) {
    const option = orderOptions.find((o) => String(o.value) === String(style));
    const order = option?.order || {};
    const validOps = processNamesForStyle(processSheets, { style, order_no: order.order_no || '' });
    setEntry((prev) => ({
      ...prev,
      style,
      order_no: order.order_no || '',
      buyer: order.buyer || prev.buyer || '',
      item: order.item || prev.item || '',
      color: order.color || prev.color || '',
      size_range: order.size_range || prev.size_range || '',
      po_qty: order.qty ?? prev.po_qty ?? '',
      floor: order.floor || prev.floor || '',
      line_no: order.line_no || prev.line_no || '',
      shift: order.shift || prev.shift || '',
      supervisor: order.supervisor || prev.supervisor || '',
      process: validOps.includes(prev.process) ? prev.process : '',
    }));
  }

  function submit(e) {
    e.preventDefault();
    setError('');

    if (!entry.employee) { setError('Select the employee this entry belongs to.'); return; }
    if (!entry.date) { setError('A production date is required.'); return; }
    if (!entry.process) { setError('Select the operation this operator worked.'); return; }

    // The target is NEVER taken from the form: it is the derived one, so a saved
    // row always carries the figure the engine produced.
    const record = buildDailyProductionRecord({
      ...entry,
      // Only Actual and Defects are typed; the rest is carried from the order and
      // the derived target, so the daily-production row is complete on its own.
      daily_target: derived.target,
      target: derived.target,
      smv: derived.smv,
      department: entry.department || 'Sewing',
      // A worker row is one operator's work, so the header manpower is 1.
      manpower: 1,
    });

    addEntry('daily-production', record);
    setNotice(
      `${entry.employee} · ${entry.process}: ${Number(entry.quantity) || 0} pcs saved`
      + (derived.hasSmv ? ` against a target of ${derived.target}.` : '.')
      + ' It is now in the Daily Production summary.',
    );
    // Reset the figures but keep the day/line context, so a supervisor can log the
    // next process for the same worker without re-picking everything.
    setEntry((prev) => ({ ...prev, process: '', quantity: '', defect_qty: '' }));
  }

  return (
    <div className="module">
      <div className="module-header">
        <div className="breadcrumb">{category?.icon} {category?.label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0 }}>{item?.icon} {item?.label}</h2>
          {!isAdmin && <span className="badge badge-amber">View Only</span>}
        </div>
        <p className="hint" style={{ maxWidth: '78ch' }}>
          Pick the style, employee and operation. The target is filled in from the uploaded process
          sheet automatically — you only enter the actual output and defects, and the variance and
          efficiency are worked out for you.
        </p>
      </div>

      {notice && <div className="erp-notice erp-notice-success dp-notice">{notice}</div>}
      {error && <div className="erp-notice erp-notice-error dp-notice">{error}</div>}

      {isAdmin ? (
        <form className="dp-entry-card wp-form" onSubmit={submit}>
          <div className="dp-detail-grid">
            <label className="form-field">
              <span>Production Date <em className="req-star">*</em></span>
              <input type="date" value={entry.date} onChange={(e) => set('date', e.target.value)} />
            </label>

            <label className="form-field">
              <span>Employee <em className="req-star">*</em></span>
              <SearchableSelect
                value={entry.employee}
                onChange={(v) => set('employee', v)}
                options={employees.map((e) => ({ value: e, label: e }))}
                placeholder="Search employee…"
                ariaLabel="Select the employee"
              />
            </label>

            <label className="form-field">
              <span>Style / Order No <em className="req-star">*</em></span>
              <SearchableSelect
                value={entry.style}
                onChange={selectStyle}
                options={orderOptions}
                placeholder="Search style or order no…"
                emptyMessage="No orders yet — register one in Order Management → Order Input"
                ariaLabel="Select the style or order"
                renderOption={(o) => o.label}
              />
            </label>

            <label className="form-field">
              <span>Operation / Process <em className="req-star">*</em></span>
              {processOptions.length > 0 ? (
                <SearchableSelect
                  value={entry.process}
                  onChange={(v) => set('process', v)}
                  options={processOptions}
                  placeholder="Search operation…"
                  emptyMessage="No operations on this style's uploaded sheet"
                  ariaLabel="Select the operation"
                />
              ) : (
                <input
                  value={entry.process}
                  onChange={(e) => set('process', e.target.value)}
                  placeholder="Type the operation…"
                />
              )}
            </label>
          </div>

          {entry.style && processOptions.length === 0 && (
            <p className="hint">
              No process sheet has been uploaded for this style yet, so no target can be derived.
              Upload one in Order Management → Process Sheet Upload.
            </p>
          )}

          {/* Targets are derived, never typed — shown read-only so the supervisor
              can see what the operator is being measured against. */}
          <div className="dp-compact-figures wp-derived">
            <label className="form-field">
              <span>Daily Target <em className="auto-note">(auto)</em></span>
              <input value={derived.hasSmv ? derived.target : ''} readOnly disabled placeholder="—" />
            </label>
            <label className="form-field">
              <span>Hourly Target <em className="auto-note">(auto)</em></span>
              <input value={derived.hasSmv ? derived.hourlyTarget : ''} readOnly disabled placeholder="—" />
            </label>
            <label className="form-field">
              <span>SMV <em className="auto-note">(from sheet)</em></span>
              <input value={derived.smv || ''} readOnly disabled placeholder="—" />
            </label>
            <label className="form-field">
              <span>Actual Achievement <em className="req-star">*</em></span>
              <input
                type="number"
                value={entry.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="form-field">
              <span>Defects</span>
              <input
                type="number"
                value={entry.defect_qty}
                onChange={(e) => set('defect_qty', e.target.value)}
                placeholder="0"
              />
            </label>
          </div>

          {/* Everything else is computed. Shown live, before saving, so the
              supervisor sees the outcome rather than discovering it in a report. */}
          <div className={`ach-panel ach-${live.tone} wp-live`}>
            <div className="ach-row">
              <div className="ach-figure">
                <span className="ach-label">Target</span>
                <span className="ach-value">{derived.hasSmv ? derived.target.toLocaleString() : '—'}</span>
              </div>
              <div className="ach-figure">
                <span className="ach-label">Good Output</span>
                <span className="ach-value">
                  {Math.max(0, (Number(entry.quantity) || 0) - (Number(entry.defect_qty) || 0)).toLocaleString()}
                </span>
              </div>
              <div className="ach-figure">
                <span className="ach-label">Efficiency</span>
                <span className="ach-value">{live.hasTarget ? `${live.achievementPercent}%` : '—'}</span>
              </div>
              <div className="ach-figure ach-figure-wide">
                <span className="ach-label">Variance (+/-)</span>
                <span className="ach-value ach-variance">
                  {live.isSurplus && '▲ '}{live.isShortfall && '▼ '}
                  {varianceLabel(Math.max(0, (Number(entry.quantity) || 0) - (Number(entry.defect_qty) || 0)) - derived.target)}
                </span>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Save Worker Entry</button>
          </div>
        </form>
      ) : (
        <div className="erp-notice erp-notice-info dp-notice">
          <span aria-hidden="true">🔒</span>
          <span>View only — your role can read worker production but not change it.</span>
        </div>
      )}

      {/* The grouped table: the employee once, every process they worked beneath. */}
      <section className="dp-recent" style={{ marginTop: 22 }}>
        <div className="dp-recent-head">
          <h3 className="dp-recent-title">Worker production ({rows.length})</h3>
        </div>
        <div className="table-wrap">
          <table className="dp-table pg-table">
            <thead>
              <ProductionGroupTableHead actions />
            </thead>
            <tbody>
              <ProductionGroupTable
                rows={rows}
                emptyMessage="No worker production recorded yet."
                actions={(row) => (
                  isAdmin
                    ? <button className="btn-icon" title="Delete this entry" onClick={() => deleteEntry('daily-production', row.id)}>🗑️</button>
                    : null
                )}
              />
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { buildDailyProductionRecord, emptyHourly, computeDailySummary } from '../config/dailyProductionForm';
import { downloadDailyProductionWorkbook } from '../utils/dailyProductionExcel';
import { DailyProductionForm, DailyProductionDetail } from './DailyProductionSheet';
import ProductionGroupTable, { ProductionGroupTableHead } from './ProductionGroupTable';
import {
  COLLECTIONS,
  selectableOrders,
  orderLabel,
  orderPrefill,
  findOrderByStyle,
  processNamesForStyle,
  operationsForStyle,
  splitValues,
  joinValues,
  DEFAULT_WORKING_HOURS,
} from '../config/orderWorkflow';
import {
  CAPACITY_COLLECTION,
  capacityForStyle,
  targetForOperation,
} from '../config/smvTargetEngine';

/**
 * ROBIUL GARMENTS ERP — Daily Production screen.
 *
 * Three things, in the order a supervisor meets them:
 *
 *   1. the summary table  — one dark-themed row per entry, with the key figures
 *   2. "+ Add Entry"      — the full three-section template form (modal)
 *   3. "View Full Sheet"  — the read-only form for one row (modal)
 *
 * The stored shape is unchanged: a row is still a `daily-production` entry keyed
 * by date / employee / style / department / process / quantity, plus the additive
 * header fields and a nested `hourly` object. `quantity` is kept in step with the
 * day's good output, so Production Report, Line Status and Target vs Actual keep
 * working byte-for-byte. Existing rows with no `hourly` render and export fine.
 *
 * ORDER NO DRIVES THE FORM
 * ------------------------
 * The modal reads the saved Order Input records and offers them as a SEARCHABLE
 * Order No dropdown — typing "105" filters straight to PO-105. Picking one fills
 * the whole header from that order (Buyer, Style, Item, PO Qty, Floor, Line,
 * Shift, Supervisor) and seeds Working Hours / Manpower from the capacity agreed
 * for the style, so nothing the order master already knows is retyped on the
 * floor. The wiring is the same one the Daily Production Entry page passes, so
 * the modal and the page cannot drift apart.
 */
export default function DailyProductionModule({ category, item }) {
  const { getData, addEntry, updateEntry, deleteEntry } = useData();
  const { isAdmin } = useRole();
  const rows = getData(item.key);

  // The order master, the uploaded process sheets and the per-style capacity —
  // the same three collections the Daily Production Entry page reads, so the
  // modal's Order No picker and its auto-fill behave identically.
  const orders = getData(COLLECTIONS.ORDERS);
  const processSheets = getData(COLLECTIONS.PROCESS_SHEETS);
  const capacityRecords = getData(CAPACITY_COLLECTION);

  const todayKey = new Date().toISOString().slice(0, 10);

  const [formValues, setFormValues] = useState(null); // non-null => the entry form is open
  const [editingId, setEditingId] = useState(null);
  const [detailRow, setDetailRow] = useState(null);   // non-null => the full sheet is open

  const canEditDelete = isAdmin;

  /**
   * The Order No options, read from the saved Order Input records.
   *
   * The option's value is the STYLE (the key the order's own fields are looked up
   * by), and the label leads with the order number so typing a PO digit filters
   * the list directly. The hint carries the buyer and PO quantity — the two facts
   * a supervisor checks a PO against before they commit to it.
   */
  const orderOptions = useMemo(
    () => selectableOrders(orders).map((o) => ({
      value: o.style || o.order_no,
      label: orderLabel(o),
      hint: [o.buyer, o.qty ? `${o.qty} pcs` : ''].filter(Boolean).join(' · '),
      order: o,
    })),
    [orders],
  );

  const currentCapacity = useMemo(
    () => capacityForStyle(capacityRecords, {
      style: formValues?.style,
      order_no: formValues?.order_no,
    }),
    [capacityRecords, formValues?.style, formValues?.order_no],
  );

  /**
   * The operations the chosen style's uploaded sheet defines, each with the SMV
   * and the piece target that SMV implies — so the process dropdown offers real
   * operations and the supervisor can see what they are measured against.
   */
  const processOptions = useMemo(() => {
    if (!formValues?.style) return [];
    const operations = operationsForStyle(processSheets, {
      style: formValues.style,
      order_no: formValues.order_no,
    });
    return processNamesForStyle(processSheets, {
      style: formValues.style,
      order_no: formValues.order_no,
    }).map((name) => {
      const derived = targetForOperation({
        operations,
        settings: currentCapacity || {},
        operationName: name,
      });
      return {
        value: name,
        label: name,
        hint: derived.hasSmv ? `SMV ${derived.smv} · target ${derived.target} pcs` : 'SMV not on the sheet',
      };
    });
  }, [processSheets, formValues?.style, formValues?.order_no, currentCapacity]);

  function openAddForm() {
    setEditingId(null);
    setFormValues({
      date: todayKey,
      hourly: emptyHourly(),
    });
  }

  function openEditForm(row) {
    setEditingId(row.id);
    // Spread the stored hourly grid over a blank one, so a row saved before the
    // hourly grid existed still opens with all ten slots present.
    setFormValues({ ...row, hourly: { ...emptyHourly(), ...(row.hourly || {}) } });
  }

  /**
   * Applies a picked Order No: fills every header field the order carries and
   * seeds the day's defaults (Working Hours, Manpower) from the agreed capacity.
   * A field the supervisor has already typed is never blanked — `orderPrefill`
   * only returns values the order actually holds.
   */
  function handleSelectOrder(style, option, prefill) {
    const nextOrderNo = prefill.order_no || option?.order?.order_no || '';
    const capacity = capacityForStyle(capacityRecords, { style, order_no: nextOrderNo });
    const validOps = processNamesForStyle(processSheets, { style, order_no: nextOrderNo });

    setFormValues((prev) => {
      const kept = splitValues(prev.processes ?? prev.process).filter((p) => validOps.includes(p));
      return {
        ...prev,
        ...prefill,
        style,
        order_no: nextOrderNo,
        working_hours: prev.working_hours || prefill.working_hours || DEFAULT_WORKING_HOURS,
        manpower: prev.manpower || capacity?.manpower || prefill.manpower || '',
        processes: joinValues(kept),
        process_targets: seedTargets(kept, prev.process_targets || {}, capacity, style, nextOrderNo),
      };
    });
  }

  /** Each chosen process's target, derived from its SMV unless already set. */
  function seedTargets(names, existing, capacity, style, orderNo) {
    const operations = operationsForStyle(processSheets, { style, order_no: orderNo });
    const next = { ...existing };
    names.forEach((name) => {
      if (next[name] !== undefined && next[name] !== '') return;
      const derived = targetForOperation({ operations, settings: capacity || {}, operationName: name });
      if (derived.hasSmv) next[name] = derived.target;
    });
    return next;
  }

  /** Applying an operation seeds its target from the sheet's SMV. */
  function handleSelectProcess(processName) {
    const derived = targetForOperation({
      operations: operationsForStyle(processSheets, { style: formValues?.style, order_no: formValues?.order_no }),
      settings: currentCapacity || {},
      operationName: processName,
    });
    setFormValues((prev) => ({
      ...prev,
      process: processName,
      smv: derived.smv || prev.smv || '',
      daily_target: derived.hasSmv ? derived.target : prev.daily_target || '',
    }));
  }

  function closeForm() {
    setFormValues(null);
    setEditingId(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const record = buildDailyProductionRecord(formValues);
    if (editingId) updateEntry(item.key, editingId, record);
    else addEntry(item.key, record);
    closeForm();
  }

  function handleDownload() {
    if (rows.length === 0) {
      window.alert('No data to download yet.');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadDailyProductionWorkbook(rows, `daily-production-${stamp}.xlsx`);
  }

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
        {isAdmin && <button className="btn btn-primary" onClick={openAddForm}>+ Add Entry</button>}
        {isAdmin && (
          <button className="btn btn-outline" onClick={handleDownload}>⬇ Download Report</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="dp-table pg-table">
          {/* One employee per group with each process they worked underneath — the
              brief's grouped display, from the same rows the flat table listed. */}
          <thead>
            <ProductionGroupTableHead actions />
          </thead>
          <tbody>
            <ProductionGroupTable
              rows={rows}
              emptyMessage="No entries yet."
              actions={(row) => (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => setDetailRow(row)}>View Full Sheet</button>
                  {canEditDelete && (
                    <>
                      <button className="btn-icon" title="Edit entry" onClick={() => openEditForm(row)}>✏️</button>
                      <button className="btn-icon" title="Delete entry" onClick={() => deleteEntry(item.key, row.id)}>🗑️</button>
                    </>
                  )}
                </>
              )}
            />
          </tbody>
        </table>
      </div>

      {formValues && (
        <Modal title={editingId ? 'Edit Daily Production Entry' : 'Add Daily Production Entry'} onClose={closeForm} wide>
          {/* COMPACT: the brief asks for a clean, streamlined entry flow in this
              modal — no numbered multi-step breakdown and no on-screen End-of-Day
              Summary. The hourly template stays available on the Daily Production
              Entry page. */}
          <DailyProductionForm
            formValues={formValues}
            onChange={setFormValues}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            editing={Boolean(editingId)}
            // The Order No picker and its auto-fill, so the modal opens with the
            // same searchable dropdown + prefill the Daily Production Entry page
            // has — one wiring, two screens.
            orderOptions={orderOptions}
            processOptions={processOptions}
            onSelectOrder={handleSelectOrder}
            onSelectProcess={handleSelectProcess}
            capacity={currentCapacity}
            today={todayKey}
            compact
          />
        </Modal>
      )}

      {detailRow && (
        <Modal title="Daily Production — Full Sheet" onClose={() => setDetailRow(null)} wide>
          <DailyProductionDetail row={detailRow} onClose={() => setDetailRow(null)} />
        </Modal>
      )}
    </div>
  );
}

/** A minimal dark-themed modal. Escape and a backdrop click both dismiss. */
function Modal({ title, onClose, wide, children }) {
  return (
    <div
      className="dp-modal-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`dp-modal${wide ? ' dp-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dp-modal-head">
          <h3>{title}</h3>
          <button type="button" className="dp-modal-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="dp-modal-body">{children}</div>
      </div>
    </div>
  );
}

export { computeDailySummary };

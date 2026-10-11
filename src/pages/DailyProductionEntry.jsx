import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { DailyProductionForm, DailyProductionDetail } from '../components/DailyProductionSheet';
import ProductionGroupTable, { ProductionGroupTableHead } from '../components/ProductionGroupTable';
import {
  HOUR_SLOTS,
  computeDailySummary,
  buildDailyProductionRecord,
  emptyHourly,
} from '../config/dailyProductionForm';
import { downloadDailyProductionWorkbook } from '../utils/dailyProductionExcel';
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
} from '../config/smvTargetEngine';

/**
 * ROBIUL GARMENTS ERP — "Daily Production Entry" page.
 *
 * This is the Hourly Production Tracking form as a PAGE, not a modal: the sidebar
 * entry under Hourly Production lands here directly, so a supervisor can tab into
 * the hour boxes and fill the whole day without an overlay in the way.
 *
 * It is the same form the Daily Production screen opens in a modal — literally
 * the same <DailyProductionForm> component — so the three sections, the ten hour
 * slots, the pre-filled Hourly Target / Actual Output / Defect Qty / Remarks and
 * every auto-calculation (Cumulative Output, Variance, Efficiency %, Target
 * Achievement %, Defect Rate %, Output to Finishing) behave identically in both
 * places. There is no second implementation to drift.
 *
 * It writes to the same `daily-production` collection, so a day entered here is
 * the same record the Daily Production table, the Production Report, Line Status
 * and the Excel export already read.
 *
 * Opening it with `?edit=<id>` loads that entry; opening it with
 * `?hour=09:00-10:00` scrolls straight to that slot's row, which is what a
 * "log this hour" deep link from elsewhere in the app uses.
 */
export default function DailyProductionEntry({ item, category }) {
  const { getData, addEntry, updateEntry, deleteEntry } = useData();
  const { isAdmin } = useRole();
  const rows = getData('daily-production');

  // ---- Order Management integration --------------------------------------
  // The order master and the uploaded process sheets are read here and handed to
  // the form, so the order fields stop being retyped and the Operation field
  // offers the operations actually recorded against the style.
  const orders = getData(COLLECTIONS.ORDERS);
  const processSheets = getData(COLLECTIONS.PROCESS_SHEETS);
  // The manpower/efficiency figures saved against each style in the Process Sheet
  // screen. They are what turns an operation's SMV into a piece target.
  const capacityRecords = getData(CAPACITY_COLLECTION);

  const orderOptions = useMemo(
    () => selectableOrders(orders).map((o) => ({
      value: o.style || o.order_no,
      label: orderLabel(o),
      hint: [o.buyer, o.color, o.qty ? `${o.qty} pcs` : ''].filter(Boolean).join(' · '),
      order: o,
    })),
    [orders],
  );

  // The pre-fill target is read once from the URL. Reading it in the initialiser
  // (rather than an effect) means the form mounts already scrolled and focused,
  // instead of jumping a frame later.
  const params = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search);
    } catch {
      return new URLSearchParams();
    }
  }, []);
  const editId = params.get('edit');
  const focusHour = params.get('hour');

  const todayKey = new Date().toISOString().slice(0, 10);

  // A brand-new entry. `hourly` is a full ten-slot grid so every hour box is
  // present and editable from the first render.
  const blankEntry = useMemo(() => ({ date: todayKey, hourly: emptyHourly() }), [todayKey]);

  const [formValues, setFormValues] = useState(() => {
    if (editId) {
      const existing = rows.find((r) => String(r.id) === String(editId));
      if (existing) {
        return { ...existing, hourly: { ...emptyHourly(), ...(existing.hourly || {}) } };
      }
    }
    return blankEntry;
  });
  const [editingId, setEditingId] = useState(() => (editId ? Number(editId) || editId : null));
  const [notice, setNotice] = useState('');
  const [detailRow, setDetailRow] = useState(null);

  /**
   * The order context for the style currently on the form, and the operations its
   * uploaded sheet defines. Both are needed together — the operation list and the
   * capacity record are looked up by the same style/order pair.
   */
  const currentOrder = useMemo(
    () => findOrderByStyle(orders, formValues.style) || {},
    [orders, formValues.style],
  );

  const currentOperations = useMemo(
    () => operationsForStyle(processSheets, {
      style: formValues.style,
      order_no: formValues.order_no || currentOrder.order_no,
    }),
    [processSheets, formValues.style, formValues.order_no, currentOrder.order_no],
  );

  /** The manpower/efficiency agreed for this style, or null when none is saved. */
  const currentCapacity = useMemo(
    () => capacityForStyle(capacityRecords, {
      style: formValues.style,
      order_no: formValues.order_no || currentOrder.order_no,
    }),
    [capacityRecords, formValues.style, formValues.order_no, currentOrder.order_no],
  );

  /**
   * The operations this style's uploaded sheet defines, as SearchableSelect
   * options. Each carries its own SMV and the target that SMV implies for one
   * operator, so the supervisor can see what they are being measured against
   * before they pick rather than after.
   */
  const processOptions = useMemo(() => processNamesForStyle(processSheets, {
    style: formValues.style,
    order_no: formValues.order_no || currentOrder.order_no,
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
        ? `SMV ${derived.smv} · target ${derived.target} pcs`
        : 'SMV not on the sheet',
    };
  }), [processSheets, formValues.style, formValues.order_no, currentOrder.order_no, currentOperations, currentCapacity]);

  /**
   * The target currently in force for the chosen operation.
   *
   * Read back off the form rather than recomputed, so the panel always reflects
   * what will actually be saved — including a target the supervisor has overridden
   * by hand, which must not be silently replaced by the derived one.
   */
  const activeTarget = useMemo(() => {
    const derived = targetForOperation({
      operations: currentOperations,
      settings: currentCapacity || {},
      operationName: formValues.process,
    });
    return {
      target: Number(formValues.daily_target || formValues.target || derived.target) || 0,
      hourly: derived.hourlyTarget,
      smv: Number(formValues.smv || derived.smv) || 0,
    };
  }, [currentOperations, currentCapacity, formValues.process, formValues.daily_target, formValues.target, formValues.smv]);

  /**
   * Applies an operation: the target is DERIVED, never typed.
   *
   * This is the brief's second requirement. Selecting the operation looks its SMV
   * up on the uploaded sheet and converts it, using the style's saved manpower and
   * efficiency, into the number of pieces one operator should make in the day.
   * The daily target on the form is set from that, so the supervisor never has to
   * know the SMV or do the arithmetic.
   */
  function handleSelectProcess(process) {
    const derived = targetForOperation({
      operations: currentOperations,
      settings: currentCapacity || {},
      operationName: process,
      // When the sheet has no SMV for the operation, any target already on the
      // form is left alone rather than wiped — losing a supervisor's own figure
      // would be worse than showing no derived one.
      fallbackTarget: undefined,
    });

    setFormValues((prev) => ({
      ...prev,
      process,
      smv: derived.smv || prev.smv || '',
      target: derived.hasSmv ? derived.target : prev.target || '',
      daily_target: derived.hasSmv ? derived.target : prev.daily_target || '',
      // Spread across the working hours so each hour of the grid starts with the
      // right share, which is what makes the hourly variance meaningful.
      derived_target: derived.hasSmv ? derived.target : undefined,
    }));

    if (!derived.hasSmv) return;
    setNotice(
      `Target for ${process}: ${derived.target} pcs/day `
      + `(${derived.hourlyTarget}/hr) from SMV ${derived.smv}`
      + (currentCapacity ? ` at ${currentCapacity.efficiency}% efficiency, ${currentCapacity.manpower} operators.` : '.')
      + ' You can still adjust it.',
    );
  }

  /**
   * Applies a picked style/order to the form.
   *
   * `prefill` is built by orderPrefill() inside the form component, and only
   * contains values the order actually holds — so choosing a style never blanks
   * a field. Colour and Size Range arrive here as the order's stored strings, so
   * a multi-colour, multi-size order carries all of its values onto the entry.
   */
  function handleSelectOrder(style, option, prefill) {
    const nextOrderNo = prefill.order_no || '';
    // Changing the style invalidates an operation picked against the previous
    // one, and a stale SMV would misprice the day's efficiency — so the process
    // is cleared unless the new style's sheet also lists it.
    const validOps = processNamesForStyle(processSheets, { style, order_no: nextOrderNo });

    setFormValues((prevValues) => {
      const keepProcess = validOps.includes(prevValues.process) ? prevValues.process : '';
      return {
        ...prevValues,
        ...prefill,
        style,
        order_no: nextOrderNo,
        process: keepProcess,
      };
    });
    void option;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!formValues.date) {
      setNotice('A Production Date is required.');
      return;
    }
    const record = buildDailyProductionRecord(formValues);
    if (editingId) {
      updateEntry('daily-production', editingId, record);
      setNotice(`Entry for ${record.date} updated.`);
    } else {
      addEntry('daily-production', record);
      setNotice(`Entry for ${record.date} saved.`);
    }
    // Reset to a fresh grid, ready for the next line's entry, exactly as the
    // paper form is a fresh sheet per line/day.
    setFormValues({ ...blankEntry });
    setEditingId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleCancel() {
    setFormValues({ ...blankEntry });
    setEditingId(null);
    setNotice('');
  }

  function startEdit(row) {
    setFormValues({ ...row, hourly: { ...emptyHourly(), ...(row.hourly || {}) } });
    setEditingId(row.id);
    setNotice(`Editing the entry for ${row.date || 'this row'}.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleDownload() {
    if (rows.length === 0) {
      window.alert('No data to download yet.');
      return;
    }
    downloadDailyProductionWorkbook(rows, `daily-production-${todayKey}.xlsx`);
  }

  const summary = useMemo(() => computeDailySummary(formValues), [formValues]);

  return (
    <div className="module dp-entry-page">
      <div className="module-header">
        <div className="breadcrumb">{category?.icon} {category?.label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{item?.icon} {item?.label}</h2>
          {!isAdmin && <span className="badge badge-amber">View Only</span>}
        </div>
        <p className="hint" style={{ maxWidth: '78ch' }}>
          Fill the hourly grid for one line and day. Cumulative Output and Variance fill themselves as
          you type, and the End-of-Day Summary below recalculates on every keystroke — including
          Efficiency %, Target Achievement % and Defect Rate %.
        </p>
      </div>

      {notice && <div className="erp-notice erp-notice-info dp-notice">{notice}</div>}

      {/* A "log this hour" deep link lands here: say which slot was asked for,
          so the reason the page opened is visible rather than mysterious. */}
      {focusHour && HOUR_SLOTS.includes(focusHour) && (
        <div className="erp-notice erp-notice-info dp-notice">
          Focused on the {focusHour} slot. You can still fill any other hour on the sheet.
        </div>
      )}

      <div className="dp-entry-card">
        <DailyProductionForm
          formValues={formValues}
          onChange={setFormValues}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          editing={Boolean(editingId)}
          readOnly={!isAdmin}
          actionLabel={editingId ? 'Save Changes' : 'Save Entry'}
          focusHour={focusHour}
          // Order Management integration: the picker, the prefill and the
          // per-style operation dropdown.
          orderOptions={orderOptions}
          processOptions={processOptions}
          onSelectOrder={handleSelectOrder}
          onSelectProcess={handleSelectProcess}
          derivedTarget={activeTarget.target}
          derivedHourlyTarget={activeTarget.hourly}
        />
      </div>

      {/* A live read-out of the headline figure, so the supervisor sees the
          number the manager will see without scrolling to Section 3. */}
      <div className="dp-entry-metrics">
        <Metric label="Good Output" value={summary.goodOutput} tone={summary.goodOutput > 0 ? 'good' : ''} />
        <Metric label="Efficiency %" value={`${summary.efficiency}%`} tone={summary.efficiency >= 75 ? 'good' : 'warn'} />
        <Metric label="Target Achievement %" value={`${summary.targetAchievement}%`} tone={summary.targetAchievement >= 90 ? 'good' : 'warn'} />
        <Metric label="Defect Rate %" value={`${summary.defectRate}%`} tone={summary.defectRate <= 5 ? 'good' : 'bad'} />
      </div>

      <section className="dp-recent">
        <div className="dp-recent-head">
          <h3 className="dp-recent-title">Saved entries</h3>
          <div className="dp-recent-actions">
            {isAdmin && rows.length > 0 && (
              <button type="button" className="btn btn-outline btn-sm" onClick={handleDownload}>
                ⬇ Download Report
              </button>
            )}
          </div>
        </div>

        <div className="table-wrap">
          <table className="dp-table pg-table">
            {/* One employee per group, their processes listed underneath — the
                brief's grouped display, produced by ProductionGroupTable from the
                same rows the flat table used to list one-by-one. */}
            <thead>
              <ProductionGroupTableHead actions />
            </thead>
            <tbody>
              <ProductionGroupTable
                rows={rows}
                emptyMessage="No entries yet — fill the sheet above and save."
                actions={(row) => {
                  const isEditing = editingId === row.id;
                  return (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={() => setDetailRow(row)}>View Full Sheet</button>
                      {isAdmin && (
                        <>
                          <button className="btn-icon" title="Edit this entry" onClick={() => startEdit(row)}>✏️</button>
                          <button className="btn-icon" title="Delete this entry" onClick={() => deleteEntry('daily-production', row.id)}>🗑️</button>
                        </>
                      )}
                      {isEditing && <em className="auto-note">editing</em>}
                    </>
                  );
                }}
              />
            </tbody>
          </table>
        </div>
      </section>

      {detailRow && (
        <div
          className="dp-modal-backdrop"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) setDetailRow(null); }}
        >
          <div className="dp-modal dp-modal-wide" role="dialog" aria-modal="true" aria-label="Daily Production — Full Sheet">
            <header className="dp-modal-head">
              <h3>Daily Production — Full Sheet</h3>
              <button type="button" className="dp-modal-close" aria-label="Close" onClick={() => setDetailRow(null)}>×</button>
            </header>
            <div className="dp-modal-body">
              <DailyProductionDetail row={detailRow} onClose={() => setDetailRow(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="dp-metric">
      <span className="dp-metric-label">{label}</span>
      <span className={`dp-metric-value ${tone ? `dp-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useErpData } from '../../../context/ErpDataContext';
import { C } from '../../../config/erpSchema';
import { MODULE } from '../../../config/erpRoles';
import {
  EmptyState, ErrorState, LoadingState, Notice, StatCard, StatusBadge, ValidationSummary,
} from '../../../components/erp/Primitives';
import { formatNumber } from '../../../components/erp/Charts';
import {
  buildCuttingEntry, cuttingDayKey, todayKey, validateCuttingEntry,
} from '../../../config/cuttingProduction';
import { orderValue, splitValues } from '../../../config/orderWorkflow';
import { useCuttingProduction } from '../../../hooks/useCuttingProduction';

/**
 * ROBIUL GARMENTS ERP — Cutting Department → Cutting Entry.
 *
 * The form a cutting supervisor fills in for one LAY/TABLE cut. It is the INPUT
 * side of the cutting balance: everything the Cutting Report shows is the sum of
 * what is recorded here.
 *
 * ORDER SELECTION & AUTO-FILL
 * ---------------------------
 * Choosing an Order No pulls Buyer, Style No, Color, Size Range and PO Qty from
 * the order master and fills them in read-only. They are still WRITTEN onto the
 * entry (see `buildCuttingEntry`) rather than only referenced, because the cutting
 * book has to print and export without a join, and an order amended next week must
 * not silently rewrite what was actually cut against it today.
 *
 * The order field is a datalist rather than a closed dropdown: the order master may
 * not be populated on a fresh deployment, and a supervisor must never be blocked by
 * master data that does not exist. A free-typed order number still saves — it just
 * fills nothing in.
 *
 * ENTRY INPUTS
 * ------------
 * Lay / Table No, Marker Length, Fabric Consumed (with a Yards / Meters unit),
 * Total Cut Quantity and Remarks — the brief's fields, all present.
 *
 * A save goes through ErpDataContext, which checks the permission, validates the
 * document against the schema, writes to Firestore and audits the change, so this
 * screen cannot forget any of those four steps.
 */

const BLANK = {
  date: '',
  order_no: '',
  buyer: '',
  style: '',
  color: '',
  sizeRange: '',
  poQty: '',
  layNo: '',
  markerLength: '',
  fabricConsumed: '',
  fabricUnit: 'Yards',
  cutQty: '',
  issuedQty: '',
  supervisor: '',
  remarks: '',
};

/** The five order fields the form auto-fills, and how to read each off an order. */
const AUTO_FILL = [
  { name: 'buyer', read: (order) => orderValue(order, 'buyer') || order.buyer || '' },
  { name: 'style', read: (order) => orderValue(order, 'style') || order.style || order.styleNo || '' },
  {
    name: 'color',
    // An order may carry several colours; the cutting form records the one this
    // lay is for, so the list is joined into the field and the supervisor trims it.
    read: (order) => splitValues(order.color ?? order.colors).join(', '),
  },
  {
    name: 'sizeRange',
    read: (order) => splitValues(order.size_range ?? order.sizeRange ?? order.sizes).join(', '),
  },
  { name: 'poQty', read: (order) => orderValue(order, 'qty') || order.qty || order.poQty || '' },
];

export default function CuttingEntry() {
  const erp = useErpData();
  const { orders, entries, loading, error, allRows, canWrite } = useCuttingProduction();

  const [form, setForm] = useState(() => ({ ...BLANK, date: todayKey() }));
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  // The order the form is currently keyed on, so the auto-filled fields can be
  // marked as coming from the master rather than typed by hand.
  const [linkedOrderId, setLinkedOrderId] = useState('');

  const orderChoices = useMemo(() => {
    const seen = new Map();
    orders.forEach((o) => {
      const no = String(o.order_no || o.orderNo || '').trim();
      if (no) seen.set(no, o);
    });
    // An order already cut against stays offered even if the master lost it, so a
    // second lay of a known order does not require re-typing the whole record.
    allRows.forEach((r) => {
      if (r.order_no && !seen.has(r.order_no)) seen.set(r.order_no, null);
    });
    return [...seen.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [orders, allRows]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    // Clear the field's own error as soon as it is edited, so the message cannot
    // linger over a field the user has already corrected.
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  }

  /**
   * Selecting an Order No fills Buyer, Style No, Color, Size Range and PO Qty.
   *
   * Everything else the supervisor has already typed is left alone: changing the
   * order mid-entry must not wipe the lay number or the quantities. The five
   * auto-filled fields are overwritten, because that is what "pull the order"
   * means — leaving a stale buyer next to a new order number is worse than
   * replacing it.
   */
  function selectOrder(orderNo) {
    const clean = String(orderNo || '').trim();
    const order = orders.find((o) => String(o.order_no || o.orderNo || '').trim() === clean) || null;
    setForm((f) => {
      const next = { ...f, order_no: orderNo };
      AUTO_FILL.forEach(({ name, read }) => {
        next[name] = order ? String(read(order) ?? '') : (name === 'buyer' ? f.buyer : '');
      });
      return next;
    });
    setLinkedOrderId(order?.id || '');
    setErrors((e) => ({ ...e, order_no: undefined }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!canWrite) return;

    const found = validateCuttingEntry(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setNotice({ kind: 'error', text: 'Please complete the required fields highlighted below.' });
      return;
    }

    setBusy(true);
    setNotice(null);
    // The order the row is linked to, so the entry keeps a real foreign key
    // alongside the copied buyer/style/colour.
    const order = orders.find((o) => String(o.order_no || o.orderNo || '').trim() === String(form.order_no).trim()) || null;
    const record = buildCuttingEntry({ ...form, order });

    // `categorize` files the lay under Daily Production (appData/production/cuttingEntries),
    // so the production area owns its rows instead of sharing the root with orders.
    const result = await erp.save(C.CUTTING_ENTRIES, record, { module: MODULE.PRODUCTION, categorize: true });
    setBusy(false);

    if (!result.ok) {
      setErrors(result.errors || {});
      setNotice({ kind: 'error', text: result.error || 'Could not save this cutting entry.' });
      return;
    }

    setNotice({
      kind: 'success',
      text: `Saved lay ${record.layNo} — ${formatNumber(record.cutQty)} pcs of ${record.style} cut. `
        + 'The quantity is now available in the sewing line input pool.',
    });
    // Keep the order and its auto-filled fields — a supervisor records several lays
    // for the same order — but clear the lay-specific figures, which differ every
    // time. The date stays, so a day's cutting is entered without re-picking it.
    setForm((f) => ({
      ...f,
      layNo: '',
      markerLength: '',
      fabricConsumed: '',
      cutQty: '',
      issuedQty: '',
      remarks: '',
    }));
    setErrors({});
  }

  if (loading && entries.length === 0) {
    return <LoadingState label="Loading the cutting register…" rows={4} />;
  }
  if (error && entries.length === 0) {
    return <ErrorState message={error} />;
  }

  const today = cuttingDayKey(todayKey());
  const todayRows = allRows.filter((r) => r.date === today);
  const todayCut = todayRows.reduce((sum, r) => sum + r.cutQty, 0);
  const todayReady = todayRows.reduce((sum, r) => sum + r.remaining, 0);

  const recent = [...allRows].slice(0, 12);

  return (
    <div className="erp-page">
      <Notice kind={notice?.kind} onDismiss={() => setNotice(null)}>{notice?.text}</Notice>

      {!canWrite && (
        <Notice kind="info">
          View only — your role can read the cutting register but not record an entry. Ask a cutting supervisor or an administrator to enter a lay.
        </Notice>
      )}

      {/* What today's cutting has produced, before the form — so the entry being
          made sits in context rather than in isolation. */}
      <section className="erp-panel">
        <h2 className="erp-panel-title">
          Today at a glance
          <span className="erp-panel-sub">{today}</span>
        </h2>
        <div className="erp-stat-grid">
          <StatCard
            label="Lays cut today"
            value={formatNumber(todayRows.length)}
            icon="✂️"
            hint={`${formatNumber(todayCut)} pcs cut`}
          />
          <StatCard
            label="Available to feed"
            value={formatNumber(todayReady)}
            unit="pcs"
            icon="🧺"
            level={todayReady > 0 ? 'warning' : 'good'}
            hint="Cut but not yet issued to a sewing line"
          />
        </div>
      </section>

      <div className="erp-split">
        {/* The entry form is only built for a role that may write. A View-Only user
            gets the recent-entries table alone. */}
        {canWrite && (
          <CuttingEntryForm
            form={form}
            errors={errors}
            busy={busy}
            orderChoices={orderChoices}
            linked={Boolean(linkedOrderId)}
            onChange={set}
            onOrderChange={selectOrder}
            onSubmit={submit}
            onReset={() => { setForm({ ...BLANK, date: todayKey() }); setErrors({}); setNotice(null); setLinkedOrderId(''); }}
          />
        )}
        <RecentCutting rows={recent} total={allRows.length} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The form itself.
 * ------------------------------------------------------------------ */

function CuttingEntryForm({ form, errors, busy, orderChoices, linked, onChange, onOrderChange, onSubmit, onReset }) {
  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">Record cutting entry</h2>
      <p className="erp-panel-sub">
        One entry per lay / table cut. Selecting an Order No fills in the buyer, style, colour,
        size range and PO quantity from the order master.
      </p>

      <form className="erp-form" onSubmit={onSubmit} noValidate>
        <div className="erp-form-grid">
          <label className={`erp-field${errors.order_no ? ' erp-field-invalid' : ''}`} htmlFor="ct-order">
            <span className="erp-field-label">Order No <span className="erp-field-required" aria-hidden="true">*</span></span>
            <span className="erp-field-control">
              <input
                id="ct-order"
                className="erp-input"
                name="order_no"
                list="ct-order-options"
                value={form.order_no}
                placeholder="e.g. PO-1024"
                aria-invalid={errors.order_no ? 'true' : undefined}
                aria-describedby={errors.order_no ? 'ct-order-error' : undefined}
                onChange={(e) => onOrderChange(e.target.value)}
              />
            </span>
            {errors.order_no && <span className="erp-field-error" id="ct-order-error">{errors.order_no}</span>}
          </label>

          {/* The order master may not be populated on a fresh deployment, so the
              order number stays free text with suggestions. */}
          <datalist id="ct-order-options">
            {orderChoices.map((o) => <option key={o} value={o} />)}
          </datalist>

          <Field label="Buyer" name="buyer" value={form.buyer} auto />
          <Field label="Style No" name="style" value={form.style} auto />
          <Field label="Color" name="color" value={form.color} auto />
          <Field label="Size Range" name="sizeRange" value={form.sizeRange} auto />
          <Field label="PO Qty" name="poQty" value={form.poQty} unit="pcs" auto />

          <Field
            label="Date" name="date" type="date" required value={form.date} error={errors.date}
            onChange={(v) => onChange('date', v)}
          />
          <Field
            label="Lay / Table No" name="layNo" required value={form.layNo} error={errors.layNo}
            placeholder="e.g. Lay-04"
            onChange={(v) => onChange('layNo', v)}
          />
          <Field
            label="Marker Length" name="markerLength" type="number" min="0" step="0.01"
            value={form.markerLength} placeholder="e.g. 8.75"
            onChange={(v) => onChange('markerLength', v)}
          />
          <Field
            label="Fabric Consumed" name="fabricConsumed" type="number" min="0" step="0.01" required
            value={form.fabricConsumed} error={errors.fabricConsumed} placeholder="e.g. 420"
            onChange={(v) => onChange('fabricConsumed', v)}
          />
          <label className="erp-field" htmlFor="ct-fabric-unit">
            <span className="erp-field-label">Fabric Unit</span>
            <select
              id="ct-fabric-unit"
              className="erp-input"
              name="fabricUnit"
              value={form.fabricUnit}
              onChange={(e) => onChange('fabricUnit', e.target.value)}
            >
              <option value="Yards">Yards</option>
              <option value="Meters">Meters</option>
            </select>
          </label>
          <Field
            label="Total Cut Quantity" name="cutQty" type="number" min="1" step="1" required unit="pcs"
            value={form.cutQty} error={errors.cutQty} placeholder="e.g. 480"
            onChange={(v) => onChange('cutQty', v)}
          />
          <Field
            label="Issued to Sewing Line" name="issuedQty" type="number" min="0" step="1" unit="pcs"
            value={form.issuedQty} error={errors.issuedQty}
            placeholder="Optional — leave blank until fed"
            onChange={(v) => onChange('issuedQty', v)}
          />
          <Field
            label="Cutting Supervisor" name="supervisor" value={form.supervisor}
            placeholder="Optional"
            onChange={(v) => onChange('supervisor', v)}
          />
        </div>

        <label className="erp-field erp-field-wide">
          <span className="erp-field-label">Remarks</span>
          <textarea
            className="erp-input"
            name="remarks"
            rows={2}
            value={form.remarks}
            onChange={(e) => onChange('remarks', e.target.value)}
            placeholder="Optional note — fabric shade, short lay, re-cut…"
          />
        </label>

        <ValidationSummary errors={errors} />

        {/* The live balance of the entry being made, so the effect of the save is
            visible before it happens rather than only in the report. */}
        <CuttingEntryPreview form={form} linked={linked} />

        <div className="erp-form-actions">
          <button type="button" className="btn btn-outline" onClick={onReset} disabled={busy}>
            Clear
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save cutting entry'}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * A labelled field. `auto` marks a value that came from the selected order, so a
 * reader can tell master data from something typed on this screen.
 */
function Field({
  label, name, value, error, onChange, type = 'text', list, placeholder, unit, required, auto, ...rest
}) {
  const id = `ct-field-${name}`;
  const errorId = `${id}-error`;
  return (
    <label className={`erp-field${error ? ' erp-field-invalid' : ''}${auto ? ' ct-field-auto' : ''}`} htmlFor={id}>
      <span className="erp-field-label">
        {label}
        {required && <span className="erp-field-required" aria-hidden="true"> *</span>}
        {auto && <span className="ct-field-auto-tag" title="Filled automatically from the selected order">auto</span>}
      </span>
      <span className="erp-field-control">
        <input
          id={id}
          className="erp-input"
          name={name}
          type={type}
          value={value}
          list={list}
          placeholder={placeholder}
          required={required}
          // An auto-filled field is still editable: an order may state a colour
          // range the lay does not use, and the cutting book must record what was
          // actually cut.
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange && onChange(e.target.value)}
          {...rest}
        />
        {unit && <span className="erp-field-unit" aria-hidden="true">{unit}</span>}
      </span>
      {error && <span className="erp-field-error" id={errorId}>{error}</span>}
    </label>
  );
}

/** The cut − issued balance of the entry being typed. */
function CuttingEntryPreview({ form, linked }) {
  const cut = Number(form.cutQty) || 0;
  const issued = Number(form.issuedQty) || 0;
  if (cut <= 0) return null;
  const remaining = Math.max(0, cut - issued);
  const level = remaining <= 0 ? 'good' : issued > 0 ? 'warning' : 'info';
  return (
    <div className="erp-stat-grid" style={{ marginTop: 4 }}>
      <StatCard label="Total Cut Pcs" value={formatNumber(cut)} unit="pcs" icon="✂️" />
      <StatCard label="Issued to Sewing Line Pcs" value={formatNumber(issued)} unit="pcs" icon="🧺" />
      <StatCard
        label="Remaining Balance in Cutting Stock"
        value={formatNumber(remaining)}
        unit="pcs"
        icon="⚖️"
        level={level}
        hint={linked ? 'Order linked from the order master' : 'Order not found in the master — the entry will still be saved'}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The last few cutting entries, so the supervisor can confirm the save
 * landed without leaving the tab.
 * ------------------------------------------------------------------ */

function RecentCutting({ rows, total }) {
  if (total === 0) {
    return (
      <section className="erp-panel">
        <h2 className="erp-panel-title">Recent cutting entries</h2>
        <EmptyState
          icon="✂️"
          title="No cutting entries recorded yet"
          message="The first lay you save will appear here, and its cut quantity becomes available to feed a sewing line."
        />
      </section>
    );
  }

  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Recent cutting entries
        <span className="erp-panel-sub">{formatNumber(total)} recorded</span>
      </h2>
      <div className="erp-table-wrap">
        <table className="erp-table erp-table-compact">
          <thead>
            <tr>
              <th>Date</th>
              <th>Order No</th>
              <th>Style</th>
              <th>Lay No</th>
              <th align="right">Cut Pcs</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id || `${row.order_no}-${row.layNo}-${i}`}>
                <td className="erp-mono">{row.date || '—'}</td>
                <td className="erp-strong">{row.order_no || '—'}</td>
                <td>{row.style || '—'}</td>
                <td>{row.layNo || '—'}</td>
                <td align="right" className="erp-mono">{formatNumber(row.cutQty)}</td>
                <td><StatusBadge status={row.status} tone={row.level === 'info' ? 'neutral' : row.level} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && (
        <p className="erp-panel-foot">
          Showing the {rows.length} most recent of {formatNumber(total)} entries — the full register is on the Cutting Report tab.
        </p>
      )}
    </section>
  );
}

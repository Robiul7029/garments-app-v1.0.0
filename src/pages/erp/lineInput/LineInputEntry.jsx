import { useEffect, useMemo, useState } from 'react';
import { usePermissions } from '../../../context/PermissionContext';
import { C, LINE_INPUT_TYPE, LINE_INPUT_STAGE, INPUT_SHIFT } from '../../../config/erpSchema';
import { MODULE } from '../../../config/erpRoles';import {
  EmptyState, ErrorState, LoadingState, Notice, StatCard, StatusBadge, ValidationSummary,
} from '../../../components/erp/Primitives';
import { formatNumber } from '../../../components/erp/Charts';
import { toNumber } from '../../../utils/erpCalculations';
import { formatShort } from '../../../utils/erpDashboard';
import { useLineInputWipSources } from '../../../hooks/useLineInputWip';
import {
  inputQtyOf, inputLineOf, inputOrderOf, summariseWip, summariseWipTotals, wipDateKey,
} from '../../../config/lineInputWip';

/**
 * ROBIUL GARMENTS ERP — Line Input Entry.
 *
 * The form a supervisor or Cutting clerk fills in when cut material reaches a
 * sewing line. It is the INPUT side of the WIP balance: everything shown on the
 * WIP & Balance and Input vs Output tabs is the sum of what is recorded here.
 *
 * The brief's required fields are all present and all mandatory — Order No,
 * Style, Color, Size Range, Input Quantity, Line No and Timestamp — because an
 * input missing any one of them cannot be attributed to an order/line and so
 * cannot be balanced. The optional fields below them (input type, stage, shift,
 * bundle number, remarks) exist because the schema carries them and a supervisor
 * genuinely needs to distinguish a numbered bundle from loose fabric.
 *
 * A save goes through ErpDataContext, which checks the permission, validates the
 * document against the schema, writes to Firestore and audits the change — so
 * this screen cannot forget any of those four steps. The validation messages it
 * returns are rendered under the form, field by field.
 *
 * The Timestamp is filled from the clock when the form opens and is editable, so
 * a supervisor catching up on a feeding that happened at 10:00 does not have to
 * wait until 10:00 to record it.
 */

/** The local YYYY-MM-DDTHH:mm a `datetime-local` input expects. */
function localDateTimeValue(when = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
    + `T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

const BLANK = {
  order_no: '',
  style: '',
  color: '',
  sizeRange: '',
  inputQty: '',
  line_no: '',
  timestamp: '',
  inputType: LINE_INPUT_TYPE.BUNDLE,
  stage: LINE_INPUT_STAGE.CUTTING_TO_SEWING,
  shift: INPUT_SHIFT.MORNING,
  bundleNo: '',
  receivedBy: '',
  remarks: '',
};

export default function LineInputEntry() {
  const { permissions, erp, loading, error } = useLineInputWipSources();
  const [form, setForm] = useState(() => ({ ...BLANK, timestamp: localDateTimeValue() }));
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const inputs = erp.rows('lineInputs');
  const orders = erp.rows('orders');
  const lines = erp.rows('productionLines');

  // Role-based UI trigger. The record form is a CREATE control, so it is offered
  // only to a role that holds the create action on Line Input & WIP. A View-Only
  // general user sees the KPI cards and the recent-inputs table — the same data,
  // without the entry form — instead of a full-page refusal.
  const canWrite = permissions.canCreate(MODULE.LINE_INPUT);

  /**
   * The Order No dropdown is fed from two places: the ERP order master, and the
   * order numbers already present on recorded inputs. The second matters because
   * this screen must work on a deployment where the order master is not yet
   * populated — a supervisor cannot be blocked by master data that does not
   * exist. The input is still a free-text field with suggestions, not a closed
   * list, for the same reason.
   */
  const orderChoices = useMemo(() => {
    const seen = new Set();
    orders.forEach((o) => { if (o.orderNo) seen.add(String(o.orderNo).trim()); });
    inputs.forEach((r) => { const v = inputOrderOf(r); if (v) seen.add(v); });
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [orders, inputs]);

  const styleChoices = useMemo(() => {
    const seen = new Set();
    inputs.forEach((r) => { const v = String(r.style || '').trim(); if (v) seen.add(v); });
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [inputs]);

  const colorChoices = useMemo(() => {
    const seen = new Set();
    inputs.forEach((r) => { const v = String(r.color || '').trim(); if (v) seen.add(v); });
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [inputs]);

  const lineChoices = useMemo(() => {
    const seen = new Set();
    lines.forEach((l) => { const v = l.lineNo || l.name; if (v) seen.add(String(v).trim()); });
    inputs.forEach((r) => { const v = inputLineOf(r); if (v) seen.add(v); });
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [lines, inputs]);

  /**
   * What has been fed TODAY, and the WIP it leaves behind — shown beside the form
   * so a supervisor can see the effect of the entry they are about to save. It is
   * the same arithmetic the WIP tab renders, over the same collection.
   */
  const today = useMemo(() => wipDateKey(new Date()), []);
  const todaySummary = useMemo(() => {
    const rows = summariseWip(inputs, [], { date: today });
    return { rows, totals: summariseWipTotals(rows) };
  }, [inputs, today]);

  // Re-stamp the timestamp when the tab is opened, so the form is never showing
  // the time from a previous visit.
  useEffect(() => {
    setForm((f) => (f.timestamp ? f : { ...f, timestamp: localDateTimeValue() }));
  }, []);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    // Clear the field's own error as soon as it is edited, so the message cannot
    // linger over a field the user has already corrected.
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  }

  /** Client-side check mirroring the schema's required fields, for instant feedback. */
  function validate(values) {
    const next = {};
    if (!String(values.order_no || '').trim()) next.order_no = 'Order No is required.';
    if (!String(values.style || '').trim()) next.style = 'Style is required.';
    if (!String(values.color || '').trim()) next.color = 'Color is required.';
    if (!String(values.sizeRange || '').trim()) next.sizeRange = 'Size Range is required.';
    if (toNumber(values.inputQty) <= 0) next.inputQty = 'Input Quantity must be greater than zero.';
    if (!String(values.line_no || '').trim()) next.line_no = 'Line No is required.';
    if (!values.timestamp) next.timestamp = 'Timestamp is required.';
    return next;
  }

  async function submit(event) {
    event.preventDefault();
    if (!canWrite) return;

    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setNotice({ kind: 'error', text: 'Please complete the required fields highlighted below.' });
      return;
    }

    setBusy(true);
    setNotice(null);
    // The schema's own validator runs as well, so a rule the form does not know
    // about (a unique key, a range) is still enforced — the client check is only
    // there to answer faster.
    // Filed under Daily Production (appData/production/lineInputs) with the rest of the
    // line's records — see config/dataCategories.js.
    const result = await erp.save(C.LINE_INPUTS, {
      ...form,
      inputQty: toNumber(form.inputQty),
    }, { module: MODULE.LINE_INPUT, categorize: true });
    setBusy(false);

    if (!result.ok) {
      setErrors(result.errors || {});
      setNotice({ kind: 'error', text: result.error || 'Could not save this input.' });
      return;
    }

    setNotice({
      kind: 'success',
      text: `Saved ${formatNumber(form.inputQty)} pcs of ${form.style} (${form.color}) into ${form.line_no}.`,
    });
    // Keep order/style/color/line and the shift — a supervisor records several
    // feedings for the same order — but clear the quantity and bundle number,
    // which differ every time. The timestamp is re-stamped to now.
    setForm((f) => ({
      ...f,
      inputQty: '',
      bundleNo: '',
      remarks: '',
      timestamp: localDateTimeValue(),
    }));
    setErrors({});
  }

  if (loading && inputs.length === 0) {
    return <LoadingState label="Loading the line input register…" rows={4} />;
  }
  if (error && inputs.length === 0) {
    return <ErrorState message={error} />;
  }

  const recent = [...inputs]
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, 12);

  return (
    <div className="erp-lineinput-entry">
      <Notice kind={notice?.kind} onDismiss={() => setNotice(null)}>{notice?.text}</Notice>

      {!canWrite && (
        <Notice kind="info">
          View only — your role can read line input but not record it. Ask a supervisor or an administrator to enter feeding events.
        </Notice>
      )}

      {/* What today's feeding has added, before the form — so the entry being
          made sits in context rather than in isolation. */}
      <section className="erp-panel">
        <h2 className="erp-panel-title">
          Today at a glance
          <span className="erp-panel-sub">{formatShort(today)}</span>
        </h2>
        <div className="erp-stat-grid">
          <StatCard
            label="Fed into lines today"
            value={formatNumber(todaySummary.totals.totalInput)}
            unit="pcs"
            icon="🧺"
            hint={`${formatNumber(todaySummary.totals.orders)} order(s) · ${formatNumber(todaySummary.totals.lines)} line(s)`}
          />
          <StatCard
            label="Completed today"
            value={formatNumber(todaySummary.totals.totalCompletedOutput)}
            unit="pcs"
            icon="✅"
            hint="Packed and end-line passed"
          />
          <StatCard
            label="WIP from today's feeding"
            value={formatNumber(todaySummary.totals.wip)}
            unit="pcs"
            icon="⚖️"
            level={todaySummary.totals.wip > 0 ? 'warning' : 'good'}
            hint={`${todaySummary.totals.wipPercent}% of what was fed`}
          />
        </div>
      </section>

      <div className="erp-split">
        {/* The entry form is only built for a role that may create. A View-Only
            user gets the recent-inputs table alone, so the grid is full width
            rather than sitting beside a form that is not theirs. */}
        {canWrite && (
          <LineInputForm
            form={form}
            errors={errors}
            busy={busy}
            canWrite={canWrite}
            orderChoices={orderChoices}
            styleChoices={styleChoices}
            colorChoices={colorChoices}
            lineChoices={lineChoices}
            onChange={set}
            onSubmit={submit}
            onReset={() => { setForm({ ...BLANK, timestamp: localDateTimeValue() }); setErrors({}); setNotice(null); }}
          />
        )}
        <RecentInputs rows={recent} total={inputs.length} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The form itself.
 * ------------------------------------------------------------------ */

function LineInputForm({
  form, errors, busy, canWrite, orderChoices, styleChoices, colorChoices, lineChoices, onChange, onSubmit, onReset,
}) {
  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">Record line input</h2>
      <p className="erp-panel-sub">
        Fabric or bundle fed from Cutting into a Sewing line. Every field marked required must be filled —
        an input with no order or line cannot be balanced against output.
      </p>

      <form className="erp-form" onSubmit={onSubmit} noValidate>
        <div className="erp-form-grid">
          <Field
            label="Order No" name="order_no" required value={form.order_no} error={errors.order_no}
            list="li-order-options" placeholder="e.g. PO-1024"
            onChange={(v) => onChange('order_no', v)}
          />
          <Field
            label="Style" name="style" required value={form.style} error={errors.style}
            list="li-style-options" placeholder="e.g. KIDS-TEE-01"
            onChange={(v) => onChange('style', v)}
          />
          <Field
            label="Color" name="color" required value={form.color} error={errors.color}
            list="li-color-options" placeholder="e.g. Navy"
            onChange={(v) => onChange('color', v)}
          />
          <Field
            label="Size Range" name="sizeRange" required value={form.sizeRange} error={errors.sizeRange}
            placeholder="e.g. S–XL"
            onChange={(v) => onChange('sizeRange', v)}
          />
          <Field
            label="Input Quantity" name="inputQty" required type="number" min="1" step="1"
            value={form.inputQty} error={errors.inputQty} unit="pcs" placeholder="e.g. 480"
            onChange={(v) => onChange('inputQty', v)}
          />
          <Field
            label="Line No" name="line_no" required value={form.line_no} error={errors.line_no}
            list="li-line-options" placeholder="e.g. Line-3"
            onChange={(v) => onChange('line_no', v)}
          />
          <Field
            label="Timestamp" name="timestamp" required type="datetime-local"
            value={form.timestamp} error={errors.timestamp}
            onChange={(v) => onChange('timestamp', v)}
          />
          <SelectField
            label="Input Type" name="inputType" value={form.inputType}
            options={Object.values(LINE_INPUT_TYPE)}
            onChange={(v) => onChange('inputType', v)}
          />
          <SelectField
            label="Stage" name="stage" value={form.stage}
            options={Object.values(LINE_INPUT_STAGE)}
            onChange={(v) => onChange('stage', v)}
          />
          <SelectField
            label="Shift" name="shift" value={form.shift}
            options={Object.values(INPUT_SHIFT)}
            onChange={(v) => onChange('shift', v)}
          />
          <Field
            label="Bundle / Lot No" name="bundleNo" value={form.bundleNo}
            placeholder="Optional — for traced bundles"
            onChange={(v) => onChange('bundleNo', v)}
          />
          <Field
            label="Received By" name="receivedBy" value={form.receivedBy}
            placeholder="Optional — who took the bundle"
            onChange={(v) => onChange('receivedBy', v)}
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
            placeholder="Optional note — short shipment, re-feed, fabric defect…"
          />
        </label>

        {/* Suggestions only. The fields stay free text so the form works before
            the order / line master is populated. */}
        <datalist id="li-order-options">
          {orderChoices.map((o) => <option key={o} value={o} />)}
        </datalist>
        <datalist id="li-style-options">
          {styleChoices.map((s) => <option key={s} value={s} />)}
        </datalist>
        <datalist id="li-color-options">
          {colorChoices.map((c) => <option key={c} value={c} />)}
        </datalist>
        <datalist id="li-line-options">
          {lineChoices.map((l) => <option key={l} value={l} />)}
        </datalist>

        <ValidationSummary errors={errors} />

        <div className="erp-form-actions">
          <button type="button" className="btn btn-outline" onClick={onReset} disabled={busy}>
            Clear
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !canWrite}>
            {busy ? 'Saving…' : 'Save input'}
          </button>
        </div>
      </form>
    </section>
  );
}

/** A labelled text / number / datetime field. The error sits under its own field. */
function Field({ label, name, value, error, onChange, type = 'text', list, placeholder, unit, required, ...rest }) {
  const id = `li-field-${name}`;
  const errorId = `${id}-error`;
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
          list={list}
          placeholder={placeholder}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        {unit && <span className="erp-field-unit" aria-hidden="true">{unit}</span>}
      </span>
      {error && <span className="erp-field-error" id={errorId}>{error}</span>}
    </label>
  );
}

/** A labelled dropdown whose options are plain strings. */
function SelectField({ label, name, value, options, onChange }) {
  const id = `li-field-${name}`;
  return (
    <label className="erp-field" htmlFor={id}>
      <span className="erp-field-label">{label}</span>
      <select id={id} className="erp-input" name={name} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * The last few feedings recorded, so the supervisor can confirm the
 * entry landed without leaving the tab.
 * ------------------------------------------------------------------ */

function RecentInputs({ rows, total }) {
  if (total === 0) {
    return (
      <section className="erp-panel">
        <h2 className="erp-panel-title">Recent inputs</h2>
        <EmptyState
          icon="🧺"
          title="No line input recorded yet"
          message="The first feeding you save will appear here, and the WIP & Balance tab will start tracking it."
        />
      </section>
    );
  }

  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Recent inputs
        <span className="erp-panel-sub">{formatNumber(total)} recorded</span>
      </h2>
      <div className="erp-table-wrap">
        <table className="erp-table erp-table-compact">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Order No</th>
              <th>Style</th>
              <th>Color</th>
              <th>Size Range</th>
              <th>Line No</th>
              <th align="right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id || `${inputOrderOf(row)}-${i}`}>
                <td className="erp-mono">{row.timestamp ? formatShort(row.timestamp) : '—'}</td>
                <td className="erp-strong">{inputOrderOf(row) || '—'}</td>
                <td>{row.style || '—'}</td>
                <td>{row.color || '—'}</td>
                <td>{row.sizeRange || '—'}</td>
                <td>
                  <StatusBadge status={inputLineOf(row)} tone="info" />
                </td>
                <td align="right" className="erp-mono">{formatNumber(inputQtyOf(row))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && (
        <p className="erp-panel-foot">
          Showing the {rows.length} most recent of {formatNumber(total)} feedings — the full register is on the WIP &amp; Balance tab.
        </p>
      )}
    </section>
  );
}

import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import SearchableSelect from './SearchableSelect';
import LineOutputOverrideModal from './LineOutputOverrideModal';
import {
  COLLECTIONS,
  latestSheetForStyle,
  lineOutputProcessFor,
} from '../config/orderWorkflow';
import {
  aggregateLineOutput,
  lineOutputByOperator,
  findLineOutputOverride,
  buildLineOutputOverride,
  LINE_OUTPUT_OVERRIDE_COLLECTION,
} from '../config/productionAggregation';
import { effTone } from './DailyEmployeeSheet';

/**
 * ROBIUL GARMENTS ERP — the Line Output panel.
 *
 * Shows the day's LINE OUTPUT — the sum of every operator's output logged under
 * the operation the style's process sheet designated as the line-output process
 * (Option A: the file's own "Line Output" column; Option B: the in-app dropdown).
 * Which operation that is comes from `lineOutputProcessFor`, the one reader every
 * screen shares, so the panel cannot disagree with the process sheet behind it.
 *
 * AUTO-AGGREGATION
 * ----------------
 * The figure is computed, not typed: `aggregateLineOutput` sums the day's rows for
 * the designated process, and the per-operator breakdown beside it shows WHO made
 * it. Nothing here has to be kept in step with the floor — it is derived from the
 * same hourly rows the rest of the dashboard reads.
 *
 * MANUAL OVERRIDE
 * ---------------
 * The figure CAN be corrected by hand, but a manual value never replaces the
 * aggregate silently: pressing Save opens the confirmation dialog (see
 * `LineOutputOverrideModal`), which states the auto-aggregated figure and the new
 * one and asks YES / NO. YES saves the value for the day and marks it an override;
 * NO cancels and leaves the aggregate in place. The stored override lives in its
 * own collection keyed by style + date, so a correction belongs to the day it was
 * made for.
 */
export default function LineOutputPanel({ date }) {
  const { getData, setRaw } = useData();
  const { isAdmin } = useRole();

  const rows = getData('hourly-timesheet-rows');
  const orders = getData(COLLECTIONS.ORDERS);
  const sheets = getData(COLLECTIONS.PROCESS_SHEETS);
  const overrides = getData(LINE_OUTPUT_OVERRIDE_COLLECTION);

  // The style/order the panel is showing. Defaults to the first order that has
  // production today, so the panel opens on something useful rather than blank.
  const [style, setStyle] = useState('');
  // The figure being typed, before it is confirmed.
  const [draftValue, setDraftValue] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const orderOptions = useMemo(
    () => orders
      .filter((o) => o && (o.style || o.order_no))
      .map((o) => ({ value: o.style || o.order_no, label: o.style || o.order_no, hint: o.buyer || '' })),
    [orders],
  );

  // The order the panel is working on — the chosen one, or the first with output
  // today so the panel is never empty on a day that has production.
  const activeStyle = useMemo(() => {
    if (style) return style;
    const today = String(date || '').slice(0, 10);
    const row = rows.find((r) => String(r.date || '').slice(0, 10) === today && (r.style || r.order_no));
    return row ? (row.style || row.order_no) : '';
  }, [style, rows, date]);

  const activeOrder = useMemo(
    () => orders.find((o) => String(o.style || o.order_no) === String(activeStyle)) || null,
    [orders, activeStyle],
  );

  const sheet = useMemo(
    () => latestSheetForStyle(sheets, { style: activeStyle, order_no: activeOrder?.order_no }),
    [sheets, activeStyle, activeOrder],
  );

  // The designated line-output process, read through the one shared reader.
  const process = useMemo(
    () => lineOutputProcessFor(sheets, { style: activeStyle, order_no: activeOrder?.order_no }),
    [sheets, activeStyle, activeOrder],
  );

  const autoOutput = useMemo(
    () => aggregateLineOutput(rows, process, date),
    [rows, process, date],
  );

  const byOperator = useMemo(
    () => lineOutputByOperator(rows, process, date),
    [rows, process, date],
  );

  const override = useMemo(
    () => findLineOutputOverride(overrides, { style: activeStyle, date }),
    [overrides, activeStyle, date],
  );

  const manual = Boolean(override?.manual);
  const displayed = manual ? (Number(override?.value) || 0) : autoOutput;

  /** Writes the override record for this style/day. */
  function persistOverride({ value, isManual }) {
    const record = buildLineOutputOverride({
      style: activeStyle,
      order_no: activeOrder?.order_no || '',
      date,
      process,
      value,
      manual: isManual,
    });
    const others = (overrides || []).filter((o) => o && o.id !== record.id);
    setRaw(LINE_OUTPUT_OVERRIDE_COLLECTION, [...others, record]);
  }

  /** The Save button: opens the confirmation, it does not write. */
  function requestOverride() {
    const typed = String(draftValue ?? '').trim();
    if (typed === '') return;
    setConfirmOpen(true);
  }

  /** YES — save the manual value. */
  function confirmOverride() {
    persistOverride({ value: draftValue, isManual: true });
    setConfirmOpen(false);
    setDraftValue('');
  }

  /** NO — cancel, leaving the aggregate untouched. */
  function cancelOverride() {
    setConfirmOpen(false);
  }

  /** Restores the auto-aggregated figure, clearing the override. */
  function clearOverride() {
    persistOverride({ value: 0, isManual: false });
    setDraftValue('');
  }

  return (
    <section className="dp-card dp-line-output">
      <div className="dp-line-output-head">
        <h3 className="dp-card-title">
          Line Output
          <span className="dp-card-sub">summed operator output for the designated process</span>
        </h3>
        <label className="form-field dp-line-output-style">
          <span>Style / Order</span>
          <SearchableSelect
            value={activeStyle}
            onChange={setStyle}
            options={orderOptions}
            placeholder="Search style or order no…"
            emptyMessage="No orders yet"
            ariaLabel="Select the style whose line output to show"
          />
        </label>
      </div>

      {!process ? (
        <p className="dp-empty">
          No line output process is set for {activeStyle || 'this style'}. Open the style's process
          sheet and designate one in the <strong>Line Output</strong> column, or mark it in the
          uploaded file.
        </p>
      ) : (
        <>
          <div className="dp-line-output-figures">
            <div className="dp-line-figure">
              <span className="dp-line-figure-label">Line Output</span>
              <span className="dp-line-figure-value">{displayed.toLocaleString()}<em> pcs</em></span>
              <span className={`dp-line-figure-tag${manual ? ' dp-line-tag-manual' : ' dp-line-tag-auto'}`}>
                {manual ? 'Manual override' : 'Auto-aggregated'}
              </span>
            </div>
            <div className="dp-line-figure">
              <span className="dp-line-figure-label">Auto-aggregated</span>
              <span className="dp-line-figure-value dp-line-figure-muted">{autoOutput.toLocaleString()}<em> pcs</em></span>
              <span className="dp-line-figure-sub">{byOperator.length} operator{byOperator.length === 1 ? '' : 's'}</span>
            </div>
            <div className="dp-line-figure">
              <span className="dp-line-figure-label">Process</span>
              <span className="dp-line-figure-value dp-line-figure-process">{process}</span>
              <span className="dp-line-figure-sub">{date}</span>
            </div>
            {manual && (
              <div className="dp-line-figure">
                <span className="dp-line-figure-label">Difference</span>
                <span className={`dp-line-figure-value ${displayed - autoOutput >= 0 ? 'dp-good' : 'dp-bad'}`}>
                  {displayed - autoOutput >= 0 ? '+' : ''}{(displayed - autoOutput).toLocaleString()}<em> pcs</em>
                </span>
                <span className="dp-line-figure-sub">vs operators' total</span>
              </div>
            )}
          </div>

          {/* Per-operator breakdown: the itemised sum behind the line total. */}
          {byOperator.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="dp-table dp-line-operators">
                <thead>
                  <tr>
                    <th>Operator</th>
                    <th className="dp-num">Output</th>
                    <th className="dp-num">Defects</th>
                    <th className="dp-num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {byOperator.map((o) => {
                    const share = autoOutput > 0 ? Math.round((o.output / autoOutput) * 1000) / 10 : 0;
                    return (
                      <tr key={o.employee}>
                        <td>{o.employee}</td>
                        <td className="mono-cell dp-num">{o.output.toLocaleString()}</td>
                        <td className="mono-cell dp-num">{o.defects.toLocaleString()}</td>
                        <td className="mono-cell dp-num">
                          <span className={`dp-eff-badge ${effTone(share)}`}>{share}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="dp-line-total">
                    <td>Total</td>
                    <td className="mono-cell dp-num">{autoOutput.toLocaleString()}</td>
                    <td className="mono-cell dp-num">
                      {byOperator.reduce((s, o) => s + o.defects, 0).toLocaleString()}
                    </td>
                    <td className="mono-cell dp-num">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* ---- Manual override entry ---- */}
          {isAdmin && (
            <div className="dp-line-override">
              <label className="form-field dp-line-override-field">
                <span>Manual Line Output <em className="auto-note">(confirmation required)</em></span>
                <input
                  type="number"
                  min="0"
                  value={draftValue}
                  onChange={(e) => setDraftValue(e.target.value)}
                  placeholder={String(displayed)}
                  aria-label="Manual line output value"
                />
              </label>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={requestOverride}
                disabled={String(draftValue ?? '').trim() === ''}
              >
                Save Manual Value
              </button>
              {manual && (
                <button type="button" className="btn btn-outline btn-sm" onClick={clearOverride}>
                  Restore Auto Value
                </button>
              )}
              <span className="dp-line-override-hint">
                {manual
                  ? `Overridden by ${override?.updatedBy || 'a supervisor'} — the operators' total of ${autoOutput.toLocaleString()} pcs is kept beside it.`
                  : 'Saving a manual value asks for confirmation before it replaces the aggregated figure.'}
              </span>
            </div>
          )}
        </>
      )}

      <LineOutputOverrideModal
        open={confirmOpen}
        processName={process}
        autoValue={autoOutput}
        newValue={Number(draftValue) || 0}
        date={date}
        onConfirm={confirmOverride}
        onCancel={cancelOverride}
      />
    </section>
  );
}
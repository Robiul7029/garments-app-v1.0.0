import React, { useMemo } from 'react';
import FieldInput from './FieldInput';
import SearchableSelect from './SearchableSelect';
import {
  HOUR_SLOTS,
  ORDER_DETAIL_FIELDS,
  FORM_TITLE,
  PRODUCTION_DETAILS_TITLE,
  computeDailySummary,
  emptyHourly,
} from '../config/dailyProductionForm';
import { orderLabel, orderPrefill, splitValues } from '../config/orderWorkflow';
import { achievementVsTarget } from '../config/smvTargetEngine';

/**
 * Live achievement against the derived target.
 *
 * This is the brief's third requirement: the moment an actual output is typed, the
 * surplus or shortfall is shown rather than left for the end-of-day summary. It is
 * stated in the same words everywhere — "+8 Extra", "12 Due" — because a
 * supervisor reading it off a phone and a manager reading it in a report must be
 * looking at the same sentence.
 *
 * Placement matters: it sits directly under the fields that feed it, so the cause
 * (target, actual) and the effect (variance) are visible in one glance without
 * scrolling to Section 3.
 */
export function AchievementPanel({ target, achieved, smv, perHourTarget }) {
  const result = achievementVsTarget(achieved, target);
  if (!result.hasTarget && !result.achieved) return null;

  return (
    <div className={`ach-panel ach-${result.tone}`}>
      <div className="ach-row">
        <div className="ach-figure">
          <span className="ach-label">Target</span>
          <span className="ach-value">{result.hasTarget ? result.target.toLocaleString() : '—'}</span>
          {perHourTarget > 0 && <span className="ach-sub">{perHourTarget}/hr</span>}
        </div>
        <div className="ach-figure">
          <span className="ach-label">Achieved</span>
          <span className="ach-value">{result.achieved.toLocaleString()}</span>
          {smv > 0 && <span className="ach-sub">SMV {smv}</span>}
        </div>
        <div className="ach-figure ach-figure-wide">
          <span className="ach-label">Variance</span>
          <span className="ach-value ach-variance">
            {result.isSurplus && '▲ '}
            {result.isShortfall && '▼ '}
            {result.label}
          </span>
          {result.hasTarget && <span className="ach-sub">{result.achievementPercent}% of target</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * A stored multi-value cell (colour, size range) rendered as chips.
 *
 * Exported because three screens show the same field — Order Input, Daily
 * Production and the read-only Full Sheet — and a cell that renders "Navy,
 * Black, Red" as prose in one place and as chips in another would look like two
 * different values. A single plain value renders un-chipped, so a record entered
 * before multi-value support looks exactly as it always did.
 */
export function MultiValueCell({ value, tone, inline = false }) {
  const parts = splitValues(value);
  if (parts.length === 0) return <span>—</span>;
  if (parts.length === 1) return <span>{parts[0]}</span>;
  return (
    <span className={inline ? 'mv-cell mv-inline' : 'mv-cell'}>
      {parts.map((part) => (
        <span className={`mv-chip${tone === 'size' ? ' mv-chip-size' : ''}`} key={part}>{part}</span>
      ))}
    </span>
  );
}

/**
 * ROBIUL GARMENTS ERP — the Daily Production form, in two modes.
 *
 *   <DailyProductionForm ... />  the "+ Add Entry" / edit form, in three sections
 *   <DailyProductionDetail .../> the read-only "Full Sheet" shown by the table
 *
 * Both render the same three sections from one field list, so the paper template
 * and the screen can never drift apart. The component is deliberately a plain
 * HTML <table> for the hourly grid (not the shared .entry-form grid): the hour
 * rows must line up under their column headings, which a CSS grid cannot do
 * across a header + ten body rows without hard-coded column widths.
 */

// ---- Shared pieces ---------------------------------------------------------

function FormSection({ number, title, hint, children }) {
  return (
    <section className="dp-section">
      <h4 className="dp-section-title">
        <span className="dp-section-num">{number}</span>
        {title}
        {hint && <span className="dp-section-hint">{hint}</span>}
      </h4>
      {children}
    </section>
  );
}

function HourlyGrid({ formValues, onChange, readOnly, focusHour }) {
  function setCell(slot, key, value) {
    const hourly = { ...(formValues.hourly || {}) };
    hourly[slot] = { ...(hourly[slot] || {}), [key]: value };
    onChange({ ...formValues, hourly });
  }

  return (
    <div className="dp-hourly-wrap">
      <table className="dp-hourly-table">
        <thead>
          <tr>
            <th>Time Slot</th>
            <th>Hourly Target</th>
            <th>Actual Output</th>
            <th>Cumulative Output</th>
            <th>Variance (+/-)</th>
            <th>Defect Qty</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {HOUR_SLOTS.map((slot) => {
            const cell = (formValues.hourly && formValues.hourly[slot]) || {};
            const focused = focusHour === slot;
            return (
              <tr key={slot} className={focused ? 'dp-hour-row-focused' : undefined}>
                <td className="dp-slot">{slot}</td>
                <td>
                  <input type="number" className="dp-hour-input" value={cell.target ?? ''} disabled={readOnly}
                    autoFocus={focused}
                    onChange={(e) => setCell(slot, 'target', e.target.value)} placeholder="-" />
                </td>
                <td>
                  <input type="number" className="dp-hour-input" value={cell.actual ?? ''} disabled={readOnly}
                    onChange={(e) => setCell(slot, 'actual', e.target.value)} placeholder="-" />
                </td>
                <td className="dp-computed" data-label="Cumulative">
                  {cellCumulative(formValues, slot)}
                </td>
                <td className="dp-computed" data-label="Variance">
                  {cellVariance(formValues, slot)}
                </td>
                <td>
                  <input type="number" className="dp-hour-input" value={cell.defect ?? ''} disabled={readOnly}
                    onChange={(e) => setCell(slot, 'defect', e.target.value)} placeholder="-" />
                </td>
                <td>
                  <input type="text" className="dp-remark-input" value={cell.remarks ?? ''} disabled={readOnly}
                    onChange={(e) => setCell(slot, 'remarks', e.target.value)} placeholder="—" />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="dp-hourly-total">
            <td>TOTAL</td>
            <td>{summaryOf(formValues).hourlyTargetTotal}</td>
            <td>{summaryOf(formValues).actualOutput}</td>
            <td>{summaryOf(formValues).cumulativeOutput}</td>
            <td className={signClass(summaryOf(formValues).variance)}>{withSign(summaryOf(formValues).variance)}</td>
            <td>{summaryOf(formValues).defectQty}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// The cumulative / variance values are read off the same summary every other
// screen uses, so the grid can never disagree with the totals row.
function summaryOf(formValues) {
  return computeDailySummary(formValues);
}

function cellCumulative(formValues, slot) {
  const index = HOUR_SLOTS.indexOf(slot);
  return summaryOf(formValues).cumulative[index] ?? 0;
}

function cellVariance(formValues, slot) {
  const index = HOUR_SLOTS.indexOf(slot);
  const value = summaryOf(formValues).perHour[index]?.variance ?? 0;
  return withSign(value);
}

function withSign(value) {
  const n = Number(value) || 0;
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : String(n);
}

function signClass(value) {
  const n = Number(value) || 0;
  if (n > 0) return 'dp-good';
  if (n < 0) return 'dp-bad';
  return '';
}

function SummaryBlock({ summary }) {
  const rows = [
    ['Daily Target vs Actual', `Target ${summary.dailyTarget} / Actual ${summary.actualOutput}`],
    ['Good Output', summary.goodOutput],
    ['Efficiency %', `${summary.efficiency}%`, summary.efficiency >= 75 ? 'good' : 'bad'],
    ['Target Achievement %', `${summary.targetAchievement}%`, summary.targetAchievement >= 90 ? 'good' : 'bad'],
    ['Defect Rate %', `${summary.defectRate}%`, summary.defectRate <= 5 ? 'good' : 'bad'],
    ['Output to Finishing', summary.outputToFinishing],
  ];
  return (
    <table className="dp-summary-table">
      <tbody>
        {rows.map(([label, value, tone]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td className={tone ? `dp-${tone}` : undefined}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Editable form (Add / Edit) -------------------------------------------

export function DailyProductionForm({
  formValues,
  onChange,
  onSubmit,
  onCancel,
  editing,
  // The page view passes these; the modal omits them and keeps its old behaviour.
  readOnly = false,
  actionLabel,
  focusHour,
  // Order Management integration. Both are supplied by the page; the modal passes
  // neither and simply keeps the plain field inputs.
  orderOptions = [],
  processOptions = [],
  onSelectOrder,
  onSelectProcess,
  // The target derived from the process sheet, and its per-hour share, for the
  // live achievement read-out. Supplied by the page; the modal omits them.
  derivedTarget = 0,
  derivedHourlyTarget = 0,
  // COMPACT mode (the "Daily Production Entry" modal): the brief asks for a clean,
  // streamlined entry flow there — no numbered multi-step breakdown and no on-screen
  // End-of-Day Summary. The full three-section template stays available to the page
  // view, which passes `compact={false}` (the default).
  compact = false,
}) {
  // When the caller wires up Order Management, the order-owned fields are shown
  // read-only and a searchable picker takes over filling them. Without the wiring
  // the fields stay editable, so this component still works standalone.
  const orderDriven = typeof onSelectOrder === 'function';
  const orderFieldNames = useMemo(
    () => new Set(ORDER_DETAIL_FIELDS.filter((f) => f.readOnlyFromOrder).map((f) => f.name)),
    [],
  );

  return (
    <form className={`dp-form${compact ? ' dp-form-compact' : ''}`} onSubmit={onSubmit}>
      {compact ? (
        /* COMPACT (the entry modal): one flat block. No numbered multi-step
           breakdown, no hourly grid and no End-of-Day Summary — just the order
           details, the operation, and the figures the supervisor types. */
        <section className="dp-section dp-section-compact">
          <DetailsFields
            formValues={formValues}
            onChange={onChange}
            readOnly={readOnly}
            orderDriven={orderDriven}
            orderFieldNames={orderFieldNames}
            orderOptions={orderOptions}
            processOptions={processOptions}
            onSelectOrder={onSelectOrder}
            onSelectProcess={onSelectProcess}
          />

          {orderDriven && !formValues.style && (
            <p className="hint">
              Pick a style above and the order's Buyer, Color, PO Qty, Floor, Line and Shift fill in
              automatically from Order Management.
            </p>
          )}
          {orderDriven && formValues.style && processOptions.length === 0 && (
            <p className="hint">
              No process sheet has been uploaded for this style yet — upload one in Order Management
              → Process Sheet Upload to derive the target automatically.
            </p>
          )}

          {/* Only Actual and Defects are typed; the variance and efficiency are
              derived as they are entered. */}
          <div className="dp-compact-figures">
            <label className="form-field">
              <span>Actual Output</span>
              <input
                type="number"
                value={formValues.quantity ?? ''}
                disabled={readOnly}
                onChange={(e) => onChange({ ...formValues, quantity: e.target.value })}
                placeholder="0"
              />
            </label>
            <label className="form-field">
              <span>Defects</span>
              <input
                type="number"
                value={formValues.defect_qty ?? ''}
                disabled={readOnly}
                onChange={(e) => onChange({ ...formValues, defect_qty: e.target.value })}
                placeholder="0"
              />
            </label>
            <label className="form-field">
              <span>Daily Target <em className="auto-note">(auto)</em></span>
              <input value={derivedTarget || formValues.daily_target || ''} readOnly disabled placeholder="—" />
            </label>
            <label className="form-field">
              <span>Hourly Target <em className="auto-note">(auto)</em></span>
              <input value={derivedHourlyTarget || ''} readOnly disabled placeholder="—" />
            </label>
          </div>

          <AchievementPanel
            target={derivedTarget || formValues.daily_target}
            achieved={formValues.quantity}
            smv={formValues.smv}
            perHourTarget={derivedHourlyTarget}
          />
        </section>
      ) : (
        <>
          <FormSection number="1" title={PRODUCTION_DETAILS_TITLE}>
            <DetailsFields
              formValues={formValues}
              onChange={onChange}
              readOnly={readOnly}
              orderDriven={orderDriven}
              orderFieldNames={orderFieldNames}
              orderOptions={orderOptions}
              processOptions={processOptions}
              onSelectOrder={onSelectOrder}
              onSelectProcess={onSelectProcess}
            />

            {orderDriven && !formValues.style && (
              <p className="hint">
                Pick a style above and the order's Buyer, Color, PO Qty, Floor, Line and Shift fill in
                automatically from Order Management.
              </p>
            )}
            {orderDriven && formValues.style && processOptions.length === 0 && (
              <p className="hint">
                No process sheet has been uploaded for this style yet — the Operation field is free text and
                no target can be derived. Upload one in Order Management → Process Sheet Upload.
              </p>
            )}

            {/* Live achievement against the derived target. Shown as soon as there is
                a target or an actual to compare, so the supervisor sees the surplus or
                shortfall while they are still typing rather than at the end of the day. */}
            {!readOnly && (derivedTarget > 0 || Number(formValues.quantity) > 0) && (
              <AchievementPanel
                target={derivedTarget || formValues.daily_target}
                achieved={formValues.quantity}
                smv={formValues.smv}
                perHourTarget={derivedHourlyTarget}
              />
            )}
          </FormSection>

          <FormSection number="2" title="Hourly Production Tracking" hint="Cumulative and Variance fill themselves">
            {/* `focusHour` only scrolls an already-rendered grid into view; it never
                changes a value, so a deep link cannot silently alter the sheet. */}
            <div id="dp-hourly-grid" className="dp-hourly-anchor">
              <HourlyGrid formValues={formValues} onChange={onChange} readOnly={readOnly} focusHour={focusHour} />
            </div>
          </FormSection>

          <FormSection number="3" title="End-of-Day Summary" hint="Calculated automatically">
            <SummaryBlock summary={computeDailySummary(formValues)} />
          </FormSection>
        </>
      )}

      {!readOnly && (
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            {actionLabel || (editing ? 'Save Changes' : 'Add Entry')}
          </button>
          <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
        </div>
      )}
    </form>
  );
}

/**
 * The order/operation fields, shared by the full form and the compact modal so
 * the two modes cannot drift apart about which fields exist or how the pickers
 * behave.
 */
function DetailsFields({
  formValues,
  onChange,
  readOnly,
  orderDriven,
  orderFieldNames,
  orderOptions,
  processOptions,
  onSelectOrder,
  onSelectProcess,
}) {
  return (
    <>
      {orderDriven && !readOnly && (
        <label className="form-field" style={{ marginBottom: 14, maxWidth: 520 }}>
          <span>Select Style / Order No <em className="req-star">*</em></span>
          <SearchableSelect
            value={formValues.style || ''}
            onChange={(style) => {
              const order = orderOptions.find((o) => String(o.value) === String(style));
              // `orderPrefill` only returns values the order actually holds, so
              // picking a second style never blanks a field left from the first
              // that the new order does not carry.
              onSelectOrder(style, order, orderPrefill(order?.order) || {});
            }}
            options={orderOptions}
            placeholder="Search style, order no or buyer…"
            emptyMessage="No orders yet — register one in Order Management → Order Input"
            ariaLabel="Select the style or order this production entry belongs to"
            renderOption={(o) => o.label}
          />
        </label>
      )}

      <div className="dp-detail-grid">
        {ORDER_DETAIL_FIELDS.map((field) => {
          // The process dropdown replaces the plain input when a sheet has been
          // uploaded for the selected style.
          if (field.name === 'process' && !readOnly && processOptions.length > 0) {
            return (
              <label className="form-field" key={field.name}>
                <span>{field.label}</span>
                <SearchableSelect
                  value={formValues.process || ''}
                  onChange={(value) => (onSelectProcess ? onSelectProcess(value) : onChange({ ...formValues, process: value }))}
                  options={processOptions}
                  placeholder="Search operation…"
                  emptyMessage="No operations on this style's uploaded sheet"
                  ariaLabel="Select the operation this entry records"
                />
              </label>
            );
          }

          if (orderDriven && orderFieldNames.has(field.name)) {
            const value = formValues[field.name];
            const filled = value !== undefined && value !== null && value !== '';
            return (
              <label className="form-field" key={field.name}>
                <span>{field.label} <em className="auto-note">(from order)</em></span>
                <input value={filled ? value : ''} placeholder="—" disabled readOnly />
              </label>
            );
          }

          return (
            <FieldInput
              key={field.name}
              field={field}
              value={formValues[field.name]}
              formValues={formValues}
              onChange={(v) => onChange({ ...formValues, [field.name]: v })}
            />
          );
        })}
      </div>
    </>
  );
}

// ---- Read-only full sheet --------------------------------------------------

export function DailyProductionDetail({ row, onClose }) {
  const summary = useMemo(() => computeDailySummary(row), [row]);
  const headerFields = ORDER_DETAIL_FIELDS.filter((f) => (row[f.name] ?? '') !== '');

  return (
    <div className="dp-sheet">
      <header className="dp-sheet-head">
        <h3>{FORM_TITLE}</h3>
        <p className="dp-sheet-sub">Daily Production Report — {row.date || 'no date'}</p>
      </header>

      <FormSection number="1" title="Order & Production Details">
        {headerFields.length === 0 ? (
          <p className="hint">No order details recorded for this entry.</p>
        ) : (
          <dl className="dp-detail-list">
            {headerFields.map((field) => (
              <div key={field.name} className="dp-detail-item">
                <dt>{field.label}</dt>
                <dd>
                  {/* Colour and Size Range hold several values on a multi-colour
                      order, so they render as chips here too rather than as one
                      run-on string. Every other field is plain text. */}
                  {field.name === 'color' || field.name === 'size_range'
                    ? <MultiValueCell value={row[field.name]} tone={field.name === 'size_range' ? 'size' : undefined} inline />
                    : String(row[field.name])}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </FormSection>

      <FormSection number="2" title="Hourly Production Tracking">
        <HourlyGrid formValues={row} onChange={() => { }} readOnly />
      </FormSection>

      <FormSection number="3" title="End-of-Day Summary">
        <SummaryBlock summary={summary} />
      </FormSection>

      {onClose && (
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      )}
    </div>
  );
}

export { emptyHourly };

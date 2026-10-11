/**
 * ROBIUL GARMENTS ERP — Daily Production Form definition.
 *
 * This file is the single description of the paper form the factory fills in every
 * day ("Robiul Garments ERP Daily Production Form"). The entry modal, the
 * read-only full-sheet modal and the Excel export are all generated from it, so a
 * time slot can never appear on screen but be missing from the downloaded sheet.
 *
 * The three sections mirror the template exactly:
 *   1. Order & Production Details  — one header block
 *   2. Hourly Production Tracking  — one row per hour slot
 *   3. End-of-Day Summary          — derived totals and percentages
 *
 * IMPORTANT — nothing here changes the stored shape of a `daily-production`
 * record: section 1 keeps the original field names (date, employee, style,
 * department, process, quantity), the new header fields are simply additive keys,
 * and section 2 lives on the same document under `hourly`. An existing Firestore /
 * localStorage row that knows nothing about hours still reads and writes fine.
 */

// ---- Section 2: the hourly grid -------------------------------------------
// Ten one-hour slots, 08:00 → 18:00, exactly as the template prints them.
export const HOUR_SLOTS = [
  '08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00',
  '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00',
];

/** Columns of the hourly grid, in the template's order. */
export const HOURLY_COLUMNS = [
  { key: 'target', label: 'Hourly Target', type: 'number' },
  { key: 'actual', label: 'Actual Output', type: 'number' },
  { key: 'good', label: 'Good Output', type: 'number', computed: true },
  { key: 'defect', label: 'Defect Qty', type: 'number' },
  { key: 'total', label: 'Total Quantity', type: 'number', computed: true },
  { key: 'cumulative', label: 'Cumulative Output', type: 'number', computed: true },
  { key: 'variance', label: 'Variance (+/-)', type: 'number', computed: true },
  { key: 'remarks', label: 'Remarks', type: 'text' },
];

// ---- Section 1: header / order details ------------------------------------
export const SHIFT_OPTIONS = ['Morning', 'Evening', 'Night', 'General'];
export const FLOOR_OPTIONS = ['Floor-1', 'Floor-2', 'Floor-3', 'Floor-4'];

/**
 * Section 1: PRODUCTION DETAILS.
 *
 * The order's own attributes (Buyer, Order No, Style, Item, Color, Size Range,
 * PO Qty, Floor, Line, Shift, Supervisor) are NOT re-typed here any more. They
 * are registered once in Order Management and pulled in by the style picker, so
 * the floor never retypes what merchandising already entered — and the two can
 * never disagree about a PO quantity.
 *
 * What remains is the field set that genuinely belongs to a day's production:
 * the order reference (`style`, `order_no`, `buyer` — read-only once picked),
 * and the day's own facts (date, department, operation, employee, hours,
 * manpower, target).
 *
 * `readOnlyFromOrder: true` marks a field that is filled by the picker and
 * displayed but not typed. The value is still written to the row, so every
 * existing reader of `row.buyer` / `row.po_qty` / `row.line_no` is unaffected.
 *
 * `legacy: true` marks the keys the original form already wrote, so the export
 * and the read-only sheet can group them as "the fields we always had".
 */
export const ORDER_DETAIL_FIELDS = [
  // The picker fills these. Kept in the list so they render in the sheet and
  // export; marked read-only so they cannot drift from the order master.
  { name: 'buyer', label: 'Buyer', type: 'text', readOnlyFromOrder: true, legacy: true },
  { name: 'order_no', label: 'Order No', type: 'text', readOnlyFromOrder: true, legacy: true },
  { name: 'style', label: 'Style No', type: 'text', required: true, legacy: true },
  { name: 'item', label: 'Product / Item', type: 'text', readOnlyFromOrder: true },
  { name: 'color', label: 'Color', type: 'text', readOnlyFromOrder: true },
  { name: 'size_range', label: 'Size Range', type: 'text', readOnlyFromOrder: true },
  { name: 'po_qty', label: 'PO Qty', type: 'number', readOnlyFromOrder: true, autoNote: true },
  { name: 'floor', label: 'Floor', type: 'text', readOnlyFromOrder: true },
  { name: 'line_no', label: 'Line No', type: 'text', readOnlyFromOrder: true },
  { name: 'shift', label: 'Shift', type: 'text', readOnlyFromOrder: true },
  { name: 'supervisor', label: 'Supervisor', type: 'text', readOnlyFromOrder: true },

  // The day's own production facts — still typed on the floor.
  { name: 'date', label: 'Production Date', type: 'date', required: true, legacy: true, autoNote: true },
  { name: 'department', label: 'Department', type: 'department-select', legacy: true },
  { name: 'process', label: 'Operation / Process', type: 'text', legacy: true },
  { name: 'employee', label: 'Line / Employee', type: 'employee-select', legacy: true },
  { name: 'working_hours', label: 'Working Hours', type: 'number', autoNote: true },
  { name: 'manpower', label: 'Manpower', type: 'number' },
  { name: 'daily_target', label: 'Daily Target', type: 'number', autoNote: true },
];

/** Section 1's heading on the form and in the export. */
export const PRODUCTION_DETAILS_TITLE = 'Production Details';

/** Smooth-computing labels for the modal legend and the export header. */
export const FORM_TITLE = 'Robiul Garments ERP Daily Production Form';
export const FORM_SUBTITLE = 'Daily Production';

// ---- Helper accessors ------------------------------------------------------

/** The stored hourly object for a row, always an object (never undefined). */
export function hoursOf(row) {
  return (row && typeof row === 'object' && typeof row.hourly === 'object' && row.hourly) || {};
}

/** The values recorded for one slot, coerced to a plain object. */
export function slotOf(row, slot) {
  const value = hoursOf(row)[slot];
  return (value && typeof value === 'object' && value) || {};
}

export function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Section 3: End-of-Day Summary.
 *
 * Everything is derived from section 1 + section 2 — the only figures typed by
 * hand are the hourly ones. Percentages are clamped to 0 when their base is 0 so
 * a half-filled form never shows "NaN%".
 *
 * - Cumulative Output    running total of Actual Output across the slots
 * - Variance (+/-)       cumulative actual minus cumulative target
 * - Daily Target vs Actual  target and good output side by side
 * - Good Output          total actual minus total defects (never negative)
 * - Efficiency %         good output against the day's standard target
 * - Target Achievement %  good output against the daily target
 * - Defect Rate %        defects against total actual (DHU-style)
 * - Output to Finishing  the good pieces handed on
 */
export function computeDailySummary(row) {
  const hours = hoursOf(row);

  let totalTarget = 0;
  let totalActual = 0;
  let totalDefect = 0;
  const perHour = [];
  const cumulative = [];

  HOUR_SLOTS.forEach((slot) => {
    const cell = hours[slot] || {};
    const target = numeric(cell.target);
    const actual = numeric(cell.actual);
    const defect = numeric(cell.defect);
    totalTarget += target;
    totalActual += actual;
    totalDefect += defect;
    cumulative.push(totalActual);
    perHour.push({
      slot,
      target,
      actual,
      defect,
      cumulative: totalActual,
      variance: totalActual - totalTarget,
      remarks: cell.remarks || '',
    });
  });

  // `quantity` is the historical "pieces produced" key; when a row predates the
  // hourly grid (or a supervisor only fills the header) it is the good output.
  const headerQuantity = numeric(row && row.quantity);
  const dailyTarget = numeric(row && row.daily_target) || numeric(row && row.target);
  const actual = totalActual || headerQuantity;
  const goodOutput = Math.max(0, actual - totalDefect);

  // Efficiency is measured against the plan the day was given: the daily target
  // when one is set, otherwise the standard target for the operation.
  const efficiencyBase = dailyTarget || totalTarget;
  const efficiency = efficiencyBase > 0 ? (goodOutput / efficiencyBase) * 100 : 0;
  const targetAchievement = dailyTarget > 0 ? (goodOutput / dailyTarget) * 100 : 0;
  const defectRate = actual > 0 ? (totalDefect / actual) * 100 : 0;

  return {
    dailyTarget,
    hourlyTargetTotal: totalTarget,
    actualOutput: actual,
    targetVsActual: { target: dailyTarget, actual: goodOutput },
    cumulativeOutput: totalActual,
    variance: totalActual - totalTarget,
    goodOutput,
    defectQty: totalDefect,
    efficiency: round1(efficiency),
    targetAchievement: round1(targetAchievement),
    defectRate: round1(defectRate),
    outputToFinishing: goodOutput,
    perHour,
    cumulative,
  };
}

/** One decimal, matching how the paper form prints its percentages. */
function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/**
 * The full stored row for a form submission: section 1 values as typed, plus the
 * hourly grid and a small derived summary. `quantity` is deliberately kept in
 * step with the good output so every existing screen (Production Report, Line
 * Status, Target vs Actual) keeps working without a single change.
 */
export function buildDailyProductionRecord(form) {
  const summary = computeDailySummary(form);
  // `quantity` is mirrored from the good output (total actual minus defects) so
  // every screen that reads the legacy field reports the same figure the new
  // summary shows. When the hourly grid is empty the header quantity is kept.
  const quantity = summary.actualOutput
    ? summary.goodOutput
    : numeric(form && form.quantity);
  return {
    ...form,
    quantity,
    hourly: form.hourly || {},
    summary: {
      efficiency: summary.efficiency,
      targetAchievement: summary.targetAchievement,
      defectRate: summary.defectRate,
      goodOutput: summary.goodOutput,
      outputToFinishing: summary.outputToFinishing,
      variance: summary.variance,
      dailyTarget: summary.dailyTarget,
      actual: summary.actualOutput,
    },
  };
}

/** A blank hourly grid for a new entry. */
export function emptyHourly() {
  const hourly = {};
  HOUR_SLOTS.forEach((slot) => {
    hourly[slot] = { target: '', actual: '', defect: '', remarks: '' };
  });
  return hourly;
}

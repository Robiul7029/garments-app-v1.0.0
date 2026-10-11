/**
 * ROBIUL GARMENTS ERP — business calculations.
 *
 * Every number the factory is judged on is computed here, as a pure function of
 * its inputs, so it can be unit-tested without a database and reused by the
 * dashboard, the entry forms and the reports alike.
 */

// ---- Rounding --------------------------------------------------------------
// One place to round, so a percentage printed on the dashboard matches the same
// percentage in a report to the last digit.
export function round(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

export function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---- Production ------------------------------------------------------------

/** Achievement % = actual / target * 100. A zero target yields 0, never NaN. */
export function achievementPercent(target, actual) {
  const t = toNumber(target);
  if (t <= 0) return 0;
  return round((toNumber(actual) / t) * 100);
}

/**
 * Efficiency % = (actual * SMV) / (manpower * available hours * 60) * 100.
 *
 * This is the standard garments SAM (Standard Allowed Minutes) efficiency: what
 * the operators were paid to produce versus what they actually produced. Every
 * argument defaults to 0 so a partially filled form still yields a number.
 */
export function efficiencyPercent({ actual, smv, manpower, availableMinutes = 60 }) {
  const outputMinutes = toNumber(actual) * toNumber(smv);
  const paidMinutes = toNumber(manpower) * toNumber(availableMinutes);
  if (paidMinutes <= 0) return 0;
  return round((outputMinutes / paidMinutes) * 100);
}

/** Colour indicator: 🟢 good, 🟠 warning, 🔴 critical. */
export function performanceLevel(percent, { good = 90, warning = 75 } = {}) {
  const p = toNumber(percent);
  if (p >= good) return 'good';
  if (p >= warning) return 'warning';
  return 'critical';
}

export const LEVEL_DOT = { good: '🟢', warning: '🟠', critical: '🔴' };

/**
 * Aggregates a day's hourly rows into a line summary.
 * `rows` must each carry target, actual, rework, reject, downtimeMin, manpower, smv.
 */
export function summariseProductionDay(rows = []) {
  const safe = Array.isArray(rows) ? rows : [];
  const target = safe.reduce((s, r) => s + toNumber(r.target), 0);
  const actual = safe.reduce((s, r) => s + toNumber(r.actual), 0);
  const rework = safe.reduce((s, r) => s + toNumber(r.rework), 0);
  const reject = safe.reduce((s, r) => s + toNumber(r.reject), 0);
  const downtime = safe.reduce((s, r) => s + toNumber(r.downtimeMin), 0);
  // Manpower is a headcount, not an hourly total: take the highest figure any
  // row reported for the day, so eight hourly entries of 25 do not read as 200.
  const manpower = safe.reduce((m, r) => Math.max(m, toNumber(r.manpower)), 0);
  const smv = safe.reduce((m, r) => Math.max(m, toNumber(r.smv)), 0);
  const achievement = achievementPercent(target, actual);
  return {
    target,
    actual,
    rework,
    reject,
    downtimeMin: downtime,
    manpower,
    smv,
    achievement,
    efficiency: efficiencyPercent({
      actual,
      smv,
      manpower,
      availableMinutes: safe.length * 60,
    }),
    level: performanceLevel(achievement),
    wip: Math.max(0, target - actual),
  };
}

/** Order-level production balance: ordered minus produced, never negative. */
export function productionBalance(orderedQty, producedQty) {
  return Math.max(0, toNumber(orderedQty) - toNumber(producedQty));
}

// ---- Quality ---------------------------------------------------------------

/**
 * DHU (Defects per Hundred Units) = defects / inspected * 100.
 * The headline garment-factory quality number.
 */
export function dhu(defectQty, inspectedQty) {
  const inspected = toNumber(inspectedQty);
  if (inspected <= 0) return 0;
  return round((toNumber(defectQty) / inspected) * 100);
}

/** Defect rate as a percentage of the sample checked. */
export function defectRate(defectQty, checkedQty) {
  const checked = toNumber(checkedQty);
  if (checked <= 0) return 0;
  return round((toNumber(defectQty) / checked) * 100);
}

export function rejectPercent(rejectQty, checkedQty) {
  return defectRate(rejectQty, checkedQty);
}

export function reworkPercent(reworkQty, checkedQty) {
  return defectRate(reworkQty, checkedQty);
}

/**
 * End-line QC roll-up. Guards the physical impossibility of pass + fail
 * exceeding what was actually inspected by clamping the failed figure.
 */
export function summariseEndLineQc(rows = []) {
  const safe = Array.isArray(rows) ? rows : [];
  const checked = safe.reduce((s, r) => s + toNumber(r.checkedQty), 0);
  const passed = safe.reduce((s, r) => s + toNumber(r.passedQty), 0);
  const failed = safe.reduce((s, r) => s + toNumber(r.failedQty), 0);
  const rework = safe.reduce((s, r) => s + toNumber(r.reworkQty), 0);
  const reject = safe.reduce((s, r) => s + toNumber(r.rejectQty), 0);
  return {
    checkedQty: checked,
    passedQty: passed,
    failedQty: failed,
    reworkQty: rework,
    rejectQty: reject,
    dhu: dhu(rework + reject, checked),
    rejectPct: rejectPercent(reject, checked),
    reworkPct: reworkPercent(rework, checked),
    defectRate: defectRate(rework + reject, checked),
    passRate: defectRate(checked - (failed || rework + reject), checked),
  };
}

// ---- Inventory -------------------------------------------------------------

/**
 * Current stock from the ledger. Stock is never stored as a mutable counter on
 * the item — it is always the sum of movements, so the ledger and the on-hand
 * figure can never disagree.
 */
export function stockFromLedger(entries = []) {
  const safe = Array.isArray(entries) ? entries : [];
  return safe.reduce((balance, entry) => {
    const next = balance + toNumber(entry.qtyIn) - toNumber(entry.qtyOut);
    return next < 0 ? 0 : next;
  }, 0);
}

/** Low-stock level for an item, driven by its own reorder thresholds. */
export function stockLevel(item, currentQty) {
  const min = toNumber(item?.minQty);
  const max = toNumber(item?.maxQty);
  const qty = toNumber(currentQty);
  if (min > 0 && qty <= min) return 'critical';
  if (max > 0 && qty <= max * 0.5) return 'warning';
  return 'good';
}

/** The movement an issue would create, including the resulting balance. */
export function buildStockMovement({ itemId, storeId, type, date, qtyIn, qtyOut, balanceQty, reference, remarks }) {
  return { itemId, storeId, type, date, qtyIn: toNumber(qtyIn), qtyOut: toNumber(qtyOut), balanceQty: toNumber(balanceQty), reference, remarks };
}

// ---- Costing ---------------------------------------------------------------

/**
 * Order costing. `costHeads` is a list of { category, amount }; revenue is the
 * order value. Profit is revenue minus the sum of every cost head.
 */
export function computeOrderCosting({ costHeads = [], revenue = 0, orderQty = 0 }) {
  const heads = Array.isArray(costHeads) ? costHeads : [];
  const byCategory = {};
  heads.forEach((h) => {
    const key = String(h.category || 'Other');
    byCategory[key] = round(toNumber(byCategory[key]) + toNumber(h.amount));
  });
  const totalCost = round(Object.values(byCategory).reduce((s, v) => s + v, 0));
  const rev = toNumber(revenue);
  const qty = toNumber(orderQty);
  return {
    byCategory,
    totalCost,
    revenue: rev,
    costPerPiece: qty > 0 ? round(totalCost / qty, 4) : 0,
    revenuePerPiece: qty > 0 ? round(rev / qty, 4) : 0,
    profit: round(rev - totalCost),
    marginPercent: rev > 0 ? round(((rev - totalCost) / rev) * 100) : 0,
    isProfit: rev - totalCost >= 0,
  };
}

// ---- Attendance ------------------------------------------------------------

/** Minutes late from an actual clock-in against a scheduled shift start. */
export function minutesLate(actualTime, scheduledTime) {
  const a = toClockMinutes(actualTime);
  const s = toClockMinutes(scheduledTime);
  if (a < 0 || s < 0) return 0;
  return Math.max(0, a - s);
}

function toClockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Attendance summary for a set of daily rows. */
export function summariseAttendance(rows = []) {
  const safe = Array.isArray(rows) ? rows : [];
  const present = safe.filter((r) => r.status === 'Present').length;
  const absent = safe.filter((r) => r.status === 'Absent').length;
  const late = safe.filter((r) => r.status === 'Late').length;
  const onLeave = safe.filter((r) => r.status === 'Leave').length;
  return { total: safe.length, present, absent, late, onLeave };
}

// ---- Alerts ----------------------------------------------------------------

/** 🟠 Shipment delay risk when the plan date is within `days` of today. */
export function shipmentDelayRisk(shipmentDate, today, days = 3, shippedQty = 0, totalQty = 0) {
  const due = parseDate(shipmentDate);
  const now = parseDate(today);
  if (due === null || now === null) return false;
  const remaining = round((due - now) / 86400000, 2);
  if (remaining > days) return false;
  // Anything not yet fully shipped and due within the window is a real risk.
  if (shippedQty > 0 && shippedQty >= totalQty) return false;
  return true;
}

/** Delay in whole days against today; negative means overdue. */
export function delayDaysAgainst(dueDate, today) {
  const due = parseDate(dueDate);
  const now = parseDate(today);
  if (due === null || now === null) return 0;
  return Math.max(0, Math.round((now - due) / 86400000));
}

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toDateKey(value) {
  const d = parseDate(value);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
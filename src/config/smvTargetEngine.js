/**
 * ROBIUL GARMENTS ERP — SMV & Manpower target engine.
 *
 * Every production target in a garments factory comes from one formula. This file
 * is that formula, in one place, so the Process Sheet's capacity panel, the Daily
 * Production auto-target and the variance read-out cannot disagree about what a
 * line is supposed to produce.
 *
 * THE FORMULA
 * -----------
 *   Minutes available = manpower × working hours × 60 × efficiency%
 *
 *   Line daily capacity = minutes available ÷ total SMV
 *                       = manpower × hours × 60 × eff ÷ Σ(SMV)
 *
 *   Per-operation daily = minutes available ÷ that operation's SMV
 *                       = manpower × hours × 60 × eff ÷ SMV(op)
 *
 * Why the same numerator gives both: SMV is "Standard Minute Value" — the minutes
 * one operator should take to complete one piece. So the minutes the line has
 * divided by the minutes one piece needs IS the pieces it can make.
 *
 * The per-operation figure assumes the WHOLE line works that one operation. That
 * is what a production manager checks when planning a balance ("if I put everyone
 * on sleeve-join, how many could we push?"), so it is the more useful of the two
 * — but it is NOT a sum that adds up, because the same operators cannot work two
 * operations at once. The panel labels it accordingly rather than implying the
 * per-process rows total the line figure.
 *
 * A worked example, because this is the number the factory argues about:
 *   25 operators, 8 hours, 70% efficiency, total SMV 6.5
 *   minutes available = 25 × 8 × 60 × 0.70 = 8400
 *   line daily capacity = 8400 ÷ 6.5 = 1292 pieces
 *   hourly              = 1292 ÷ 8  = 161 pieces
 */

// ---- Defaults ---------------------------------------------------------------
// These are the figures the brief specifies, and sensible factory starting
// points: an 8-hour shift and a 70% efficiency allowance.
export const DEFAULT_WORKING_HOURS = 8;
export const DEFAULT_EFFICIENCY = 70;

/** Guards against a divide-by-zero and against absurd inputs. */
function positive(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** E.g. 1292.3 → 1292. Output is whole pieces; half a piece is not a thing. */
function floorToPieces(value) {
  return Math.max(0, Math.floor(toNumber(value)));
}

/** Two decimals, for SMV sums where the tail is real minutes. */
function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

// ---- Normalising the settings -----------------------------------------------

/**
 * Reads the four inputs into one shape, with defaults applied.
 *
 * Accepts either the panel's own field names or a stored record, so the same
 * function normalises a live form and a saved capacity without translation.
 */
export function capacitySettings(input = {}) {
  return {
    manpower: Math.max(0, Math.floor(toNumber(input.manpower ?? input.totalManpower))),
    workingHours: positive(
      input.workingHours ?? input.hours,
      DEFAULT_WORKING_HOURS,
    ),
    // A percentage in the UI: 70 means 70%. Stored as a number, never a fraction,
    // because that is what a supervisor types and what the panel displays.
    efficiency: (() => {
      const raw = input.efficiency ?? input.efficiencyPercent;
      if (raw === undefined || raw === null || raw === '') return DEFAULT_EFFICIENCY;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return DEFAULT_EFFICIENCY;
      return Math.min(100, n);
    })(),
  };
}

/** Minutes the line has to spend, after the efficiency allowance. */
export function availableMinutes(settings = {}) {
  const { manpower, workingHours, efficiency } = capacitySettings(settings);
  return manpower * workingHours * 60 * (efficiency / 100);
}

// ---- The engine -------------------------------------------------------------

/**
 * Per-operation capacity.
 *
 * `smv` of 0 means the sheet never recorded a value for that operation, so no
 * target can be derived from it. It is reported as 0 with `hasSmv: false` rather
 * than defaulting to some plausible number — an invented target is worse than a
 * blank one, because the floor would be measured against it.
 */
export function processCapacity(operation, minutes, settings) {
  const smv = toNumber(operation?.smv);
  const hours = capacitySettings(settings).workingHours;
  if (smv <= 0 || minutes <= 0) {
    return {
      name: String(operation?.operation || operation?.name || '').trim(),
      machine: operation?.machine || '',
      section: operation?.section || '',
      smv,
      hasSmv: false,
      dailyTarget: 0,
      hourlyTarget: 0,
      piecesPerOperatorPerHour: 0,
    };
  }
  const daily = minutes / smv;
  return {
    name: String(operation?.operation || operation?.name || '').trim(),
    machine: operation?.machine || '',
    section: operation?.section || '',
    smv,
    hasSmv: true,
    dailyTarget: floorToPieces(daily),
    hourlyTarget: floorToPieces(daily / hours),
    // What ONE operator achieves on this operation in an hour — the figure used
    // when balancing a line, since the daily figure above assumes the whole line.
    piecesPerOperatorPerHour: floorToPieces(60 / smv),
  };
}

/**
 * The whole calculation for one style: line figures plus every operation's own
 * target.
 *
 * @param {Array}  operations  from the uploaded process sheet: {operation, smv, …}
 * @param {object} settings    {manpower, workingHours, efficiency}
 */
export function calculateCapacity(operations = [], settings = {}) {
  const resolved = capacitySettings(settings);
  const minutes = availableMinutes(resolved);
  const ops = Array.isArray(operations) ? operations : [];

  const totalSmv = round2(ops.reduce((sum, o) => sum + toNumber(o?.smv), 0));
  const withSmv = ops.filter((o) => toNumber(o?.smv) > 0);

  // The line figure uses the SUM of SMVs, because one piece passes through every
  // operation. Nothing can be produced until all of them are done.
  const lineDaily = totalSmv > 0 && minutes > 0 ? minutes / totalSmv : 0;

  const perProcess = ops.map((op) => processCapacity(op, minutes, resolved));

  return {
    settings: resolved,
    minutes: Math.floor(minutes),
    totalSmv,
    operationCount: ops.length,
    // Operations with no SMV are called out: the line total understates capacity
    // when they are included, and silently ignoring them would hide a bad sheet.
    missingSmv: ops
      .filter((o) => toNumber(o?.smv) <= 0)
      .map((o) => String(o?.operation || '').trim())
      .filter(Boolean),
    usable: withSmv.length > 0 && resolved.manpower > 0,
    line: {
      dailyTarget: floorToPieces(lineDaily),
      hourlyTarget: floorToPieces(lineDaily / resolved.workingHours),
      // The same figure stated per operator, which is what a line balance is
      // built from.
      perOperatorDaily: resolved.manpower > 0 ? floorToPieces(lineDaily / resolved.manpower) : 0,
    },
    perProcess,
  };
}

// ---- Auto-target for a production entry --------------------------------------

/**
 * The target for one operation on one style, from the uploaded sheet.
 *
 * This is what removes the manual target box from Daily Production: the
 * supervisor picks a style and an operation, and the piece target is derived from
 * the sheet's SMV and the capacity settings saved against that style.
 *
 * A SINGLE operator's target is returned, not the whole line's. A production row
 * records what ONE person produced, so measuring them against a line-wide figure
 * would make every entry look like a 25× overachievement. The line figure is still
 * available from `calculateCapacity` for the planning panel.
 *
 * @returns {{target:number, hourlyTarget:number, smv:number, hasSmv:boolean, source:string}}
 */
export function targetForOperation({
  operations = [],
  settings = {},
  operationName,
  // Falls back to a per-operator default when the sheet has no SMV, so the form
  // still offers a number instead of blocking the entry.
  fallbackTarget = 0,
} = {}) {
  const resolved = capacitySettings(settings);
  const wanted = String(operationName || '').trim();
  const found = (Array.isArray(operations) ? operations : [])
    .find((o) => String(o?.operation || '').trim().toLowerCase() === wanted.toLowerCase());

  if (!found) {
    return { target: toNumber(fallbackTarget), hourlyTarget: 0, smv: 0, hasSmv: false, source: 'manual' };
  }

  const smv = toNumber(found.smv);
  if (smv <= 0) {
    return { target: toNumber(fallbackTarget), hourlyTarget: 0, smv: 0, hasSmv: false, source: 'no-smv' };
  }

  const hours = resolved.workingHours;
  // One operator, for the full working day, at the allowed efficiency.
  const daily = (hours * 60 * (resolved.efficiency / 100)) / smv;
  return {
    target: floorToPieces(daily),
    hourlyTarget: floorToPieces(daily / hours),
    smv,
    hasSmv: true,
    source: 'smv',
  };
}

// ---- Achievement and variance -------------------------------------------------

/**
 * How far an operator is above or below target.
 *
 * The brief's wording is kept: a surplus is "extra" pieces, a shortfall is "due".
 * Both are reported as positive numbers with the direction named, because
 * "-12 due" and "12 due" mean the same thing to a reader and only one of them is
 * easy to scan down a column.
 *
 * `achieved` defaults to 0, so a blank entry reads as a full shortfall rather than
 * as an error — the form shows 0 of a target, which is true.
 */
export function achievementVsTarget(achieved, target) {
  const done = toNumber(achieved);
  const goal = toNumber(target);
  const variance = done - goal;

  // A target of 0 has no meaningful percentage: anything achieved against no
  // target is infinite achievement, which would print as a nonsense number. It is
  // reported as 0 with `hasTarget: false` so the UI can show a dash.
  const hasTarget = goal > 0;

  return {
    achieved: done,
    target: goal,
    // Signed, for a figure that wants to show +/−.
    variance,
    // Absolute, for the sentence "12 pieces due".
    surplus: variance > 0 ? variance : 0,
    shortfall: variance < 0 ? Math.abs(variance) : 0,
    isOnTarget: variance === 0 && hasTarget,
    isSurplus: variance > 0,
    isShortfall: variance < 0,
    achievementPercent: hasTarget ? Math.round((done / goal) * 1000) / 10 : 0,
    hasTarget,
    // The exact phrasing the brief asks for, kept here so every screen words it
    // identically.
    label: !hasTarget
      ? 'No target set'
      : variance === 0
        ? 'On target'
        : variance > 0
          ? `+${variance} Extra`
          : `${Math.abs(variance)} Due`,
    tone: !hasTarget ? 'info' : variance > 0 ? 'good' : variance === 0 ? 'good' : 'bad',
  };
}

/**
 * The variance for every hour of a production row, given that hour's target.
 *
 * The hourly grid already computes a cumulative variance; this is the per-hour
 * figure, so a supervisor can see WHICH hour was lost rather than only that the
 * day ended short.
 */
export function hourlyVariance(hours = {}, targetPerHour = 0) {
  const goal = toNumber(targetPerHour);
  return Object.entries(hours || {}).map(([slot, value]) => {
    const actual = toNumber(value?.actual ?? value);
    return {
      slot,
      actual,
      target: goal,
      ...achievementVsTarget(actual, goal),
    };
  });
}

// ---- Storage shape ------------------------------------------------------------

/** The collection the per-style capacity settings are saved under. */
export const CAPACITY_COLLECTION = 'process-capacity';

/**
 * The capacity record saved for a style.
 *
 * One document per style, so re-opening the process sheet shows the manpower and
 * efficiency that were last agreed rather than resetting to the defaults. Daily
 * Production reads this same record when it derives a target.
 */
export function buildCapacityRecord({ style, order_no, settings, capacity, savedAt }) {
  return {
    id: `${style || 'unassigned'}`,
    style: style || '',
    order_no: order_no || '',
    ...capacitySettings(settings),
    totalSmv: toNumber(capacity?.totalSmv),
    lineDailyTarget: toNumber(capacity?.line?.dailyTarget),
    lineHourlyTarget: toNumber(capacity?.line?.hourlyTarget),
    perProcess: (capacity?.perProcess || []).map((p) => ({
      name: p.name,
      smv: p.smv,
      dailyTarget: p.dailyTarget,
      hourlyTarget: p.hourlyTarget,
    })),
    savedAt: savedAt || new Date().toISOString().slice(0, 10),
  };
}

/**
 * The capacity saved for a style, newest first.
 * Falls back to the order number so a record saved before the style was set is
 * still found, mirroring how the process sheet itself is looked up.
 */
export function capacityForStyle(records = [], { style, order_no } = {}) {
  const list = Array.isArray(records) ? records : [];
  const match = list.find((r) => style && String(r.style || '') === String(style))
    || list.find((r) => order_no && String(r.order_no || '') === String(order_no));
  return match || null;
}

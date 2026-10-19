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

/**
 * The standard productive day the auto-target is built around.
 *
 * The brief is explicit: 10 hours of work, being the 08:00 → 18:30 clock shift
 * less the unpaid 13:00 → 13:30 lunch break. This is the SAME ten hours
 * `config/workingHours` derives, stated here as the plain number the auto-target
 * formula multiplies by, so `60 / SMV × (1 + buffer) × 10` is one readable line.
 */
export const STANDARD_DAY_HOURS = 10;

/**
 * The default percentage buffer added to an auto-derived target.
 *
 * Zero on purpose: a target is what the line is measured against, so it should be
 * the honest SMV figure unless somebody deliberately allows a margin. A factory
 * that wants a 5% or 10% cushion sets it on the process sheet.
 */
export const DEFAULT_TARGET_BUFFER = 0;

/**
 * The allowance the brief's auto-target applies when a sheet does not set its own.
 *
 *   Auto Hourly Target = (60 / Process SMV) × 1.05
 *
 * The brief states the 5% explicitly, so it is the default the distribution and
 * the process-sheet preview use. It is a separate constant from
 * `DEFAULT_TARGET_BUFFER` because the two answer different questions: this one is
 * the blanket cushion applied to a freshly distributed sheet, while
 * `DEFAULT_TARGET_BUFFER` is the agreed style-level margin a factory saves against
 * a style. Both end up as the same percentage in the target formula.
 */
export const AUTO_TARGET_ALLOWANCE = 5;

/** Guards against a divide-by-zero and against absurd inputs. */
function positive(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * One operation's SMV in MINUTES, whatever unit the record carries.
 *
 * Rows are stored with `smv` already normalised to minutes, so this is usually a
 * straight read. It still guards the two ways a seconds value can reach the
 * engine — a row that carries `seconds` instead of `smv`, and a legacy record
 * whose `smv` is a raw seconds figure — because a target that is 60× wrong is far
 * worse than one that is missing.
 */
export function smvMinutes(operation = {}, fallbackUnit) {
  const secs = toNumber(operation?.seconds ?? operation?.smv_seconds);
  if (secs > 0) return secs / 60;
  const raw = toNumber(operation?.smv);
  if (raw <= 0) return 0;
  // 60 or more standard minutes on ONE operation is not a real figure — an hour
  // and a half for a single operation would make the line target nonsense. Such a
  // value is seconds whatever the sheet's declared unit says, so it is converted
  // here rather than trusted. This is the guard that stops a sheet whose SMV
  // column is in seconds from dividing 15,000 available minutes by 4,320 and
  // reporting a 2-piece day.
  if (raw >= 60) return raw / 60;
  // NOTE: `fallbackUnit === 'seconds'` deliberately does NOT divide a small value.
  // Rows reach this engine already normalised to minutes by `parseOperations`, so
  // honouring a 'seconds' label here would divide them a second time and make every
  // target 60× too low — the very fault this function exists to prevent. A row
  // whose seconds are genuinely small must carry them in `seconds`, which is read
  // first above.
  return raw;
}

/**
 * The unit a whole sheet's rows are in, for the guard above.
 *
 * Decided from the collection rather than from one row: a single large operation
 * in an otherwise minute-based sheet is a real (if odd) operation, not proof that
 * the sheet switched units halfway down.
 */
export function detectSmvUnit(operations = [], declaredUnit) {
  if (declaredUnit === 'seconds' || declaredUnit === 'minutes') return declaredUnit;
  const ops = Array.isArray(operations) ? operations : [];
  if (ops.some((o) => toNumber(o?.seconds ?? o?.smv_seconds) > 0)) return 'seconds';
  const values = ops.map((o) => toNumber(o?.smv)).filter((v) => v > 0);
  if (values.length === 0) return 'minutes';
  // All-large is a seconds sheet; a mix is minutes with one heavy operation.
  return values.every((v) => v >= 60) ? 'seconds' : 'minutes';
}

/**
 * A whole sheet's total SMV in MINUTES.
 *
 * A sheet whose standard times are in seconds has to be divided by 60 before it is
 * used as SMV — otherwise every daily and hourly target comes out 60× too low,
 * which is the single most expensive way this can go wrong.
 *
 * `totalInSeconds` defaults to FALSE on purpose. The stored `totalSmv` is already
 * in minutes, so treating a minutes total as seconds would divide it a second time
 * — 72 minutes would become 1.2 and the line would look almost incapable.
 *
 * Division is NOT inferred from the `unit` label either. `unit` describes the
 * OPERATION rows, and those rows are already normalised to minutes by
 * `parseOperations`, so a sheet labelled 'seconds' hands over a total that is
 * ALREADY minutes. Dividing on that label is the same fault from the other side.
 *
 * @param {number} total             the total to convert
 * @param {string} unit              'seconds' | 'minutes', when the caller knows it
 * @param {Array}  operations        used to infer the unit when it is not declared
 * @param {boolean} totalInSeconds   true only when `total` is itself in seconds
 */
export function evaluateSmvTotal(total, unit, operations = [], totalInSeconds = false) {
  const raw = toNumber(total);
  if (raw <= 0) return 0;
  // An explicit flag is the only reliable signal, and the only way to express
  // "this really is a seconds figure".
  if (totalInSeconds) return round2(raw / 60);

  // With rows to hand, they are already in minutes, so the total simply must not
  // exceed what they add up to. A total impossibly LARGER than its own rows (4320
  // against rows summing to 72) is the signature of a seconds figure and is
  // converted; anything in the same range is left exactly as it is.
  if (operations.length > 0) {
    const fromRows = round2(operations.reduce((sum, o) => sum + smvMinutes(o), 0));
    if (fromRows > 0 && raw > fromRows * 10) return round2(raw / 60);
    return round2(raw);
  }

  // No rows to check against: a number this large cannot be the standard minutes of
  // a whole breakdown, so it is seconds. An ordinary minutes total passes through.
  if (raw >= 600) return round2(raw / 60);
  return round2(raw);
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
    // The percentage buffer added on top of an auto-derived target. Read from any
    // of the names a stored sheet, the upload grid or the capacity panel may use,
    // so the figure survives a round-trip through storage without translation.
    // Never negative: a buffer that SUBTRACTS would silently tighten every target.
    targetBuffer: (() => {
      const raw = input.targetBuffer ?? input.buffer ?? input.bufferPercent ?? input.percentage;
      if (raw === undefined || raw === null || raw === '') return DEFAULT_TARGET_BUFFER;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return DEFAULT_TARGET_BUFFER;
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
  const smv = smvMinutes(operation, settings?.smvUnit);
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

  const totalSmv = round2(ops.reduce((sum, o) => sum + smvMinutes(o, settings?.smvUnit), 0));
  const withSmv = ops.filter((o) => smvMinutes(o, settings?.smvUnit) > 0);

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
        .filter((o) => smvMinutes(o, settings?.smvUnit) <= 0)
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
    // The percentage-adjusted Complete Body Target, so the panel can state the
    // same goal every other screen shows. Computed from the same operations and
    // the same buffer, so it cannot drift from the per-process rows above.
    bodyTarget: completeBodyTarget(ops, resolved),
    targetBuffer: resolved.targetBuffer,
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

  const smv = smvMinutes(found, settings?.smvUnit);
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

/**
 * The AUTO target for one process, from its SMV and the percentage buffer.
 *
 * This is the brief's auto-target rule, stated exactly as asked:
 *
 *   Base Hourly Capacity = 60 / Process SMV
 *   Auto Hourly Target   = Base Hourly Capacity × (1 + Buffer% / 100)
 *   Auto Daily Target    = Auto Hourly Target × 10
 *
 * The ×10 is the standard working day (08:00 → 18:30 less the 30-minute lunch
 * break), which is why it is a named constant rather than a literal.
 *
 * It is deliberately INDEPENDENT of the line's manpower and efficiency: it answers
 * "what should ONE operator make on this operation", which is the number the floor
 * fills the Hourly and Daily forms in with. The whole-line capacity remains the
 * business of `calculateCapacity`, which does use manpower and efficiency.
 *
 * Both figures are returned unrounded where they are rates, and rounded where they
 * are piece counts, so a caller can display either without re-deriving them.
 *
 * @param {number|object} smvOrOperation  the SMV in minutes, or an operation row
 * @param {number}        bufferPercent   the % cushion (5 for 5%), default 0
 * @returns {{baseHourlyCapacity:number, hourlyTarget:number, dailyTarget:number,
 *            smv:number, buffer:number, hasSmv:boolean}}
 */
export function autoTargetForProcess(smvOrOperation, bufferPercent = DEFAULT_TARGET_BUFFER, settings = {}) {
  const smv = typeof smvOrOperation === 'object'
    ? smvMinutes(smvOrOperation)
    : toNumber(smvOrOperation);
  const buffer = Math.max(0, toNumber(bufferPercent));

  if (smv <= 0) {
    return { baseHourlyCapacity: 0, hourlyTarget: 0, dailyTarget: 0, smv: 0, buffer, hasSmv: false };
  }

  const hasCapacityInputs = ['manpower', 'workingHours', 'hours', 'efficiency'].some((key) => Number(settings?.[key]) > 0);
  const hours = positive(settings?.workingHours ?? settings?.hours, STANDARD_DAY_HOURS);
  const efficiencyFactor = !hasCapacityInputs || settings?.efficiency === undefined || settings?.efficiency === ''
    ? 1
    : Math.min(100, positive(settings?.efficiency, 100)) / 100;
  const manpowerFactor = settings?.manpower === undefined || settings?.manpower === ''
    ? 1
    : Math.max(0, toNumber(settings.manpower));
  const baseHourlyCapacity = (60 / smv) * efficiencyFactor * manpowerFactor;
  const hourlyTarget = baseHourlyCapacity * (1 + buffer / 100);
  return {
    baseHourlyCapacity: round2(baseHourlyCapacity),
    hourlyTarget: floorToPieces(hourlyTarget),
    dailyTarget: floorToPieces(hourlyTarget * hours),
    monthlyTarget: floorToPieces(hourlyTarget * hours * 26),
    smv,
    buffer,
    hasSmv: true,
  };
}

/**
 * The auto target for one named operation on a style's uploaded sheet.
 *
 * The lookup half of `autoTargetForProcess`: it finds the operation's SMV on the
 * sheet, then applies the formula. A sheet with no SMV for the operation reports
 * `hasSmv: false` rather than a made-up figure — the form then leaves the target
 * box blank for a manual entry, which is honest.
 *
 * The buffer is read from the capacity settings (falling back to a per-call
 * override) so a style's agreed cushion is applied consistently wherever a target
 * is derived.
 */
export function autoTargetForOperation({
  operations = [],
  settings = {},
  operationName,
  bufferPercent,
} = {}) {
  const resolved = capacitySettings(settings);
  const buffer = bufferPercent === undefined || bufferPercent === null || bufferPercent === ''
    ? resolved.targetBuffer
    : Math.max(0, toNumber(bufferPercent));
  const wanted = String(operationName || '').trim().toLowerCase();
  const found = (Array.isArray(operations) ? operations : [])
    .find((o) => String(o?.operation || o?.name || '').trim().toLowerCase() === wanted);
  return autoTargetForProcess(found || 0, buffer);
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
    // The percentage-adjusted Complete Body Target: the line's daily output with
    // the agreed buffer applied. Stored alongside the raw line target so every
    // screen (Hourly Production, Daily Production, Operator Performance) shows the
    // SAME adjusted figure without each one re-applying the percentage.
    bodyTarget: toNumber(capacity?.bodyTarget),
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

/**
 * The percentage-adjusted Complete Body Target for a style.
 *
 * The brief asks for one figure — the whole garment's daily target with the
 * buffer applied — to travel alongside the individual process targets, so the
 * Hourly Production, Daily Production and Operator Performance screens all state
 * the same goal.
 *
 * It is the sum of the per-process auto targets (Base Hourly × (1 + buffer) × 10),
 * because one complete garment passes through every operation: the line can only
 * finish as many garments as its slowest operation allows, but the sum is what the
 * paper sheet calls the "complete body" figure and what the floor is asked for.
 *
 * Returns 0 with `hasTarget: false` when no operation on the sheet carries an SMV,
 * so a caller shows a dash rather than an invented target.
 *
 * @param {Array}  operations  the style's uploaded sheet operations
 * @param {object} settings    { manpower, workingHours, efficiency, targetBuffer }
 */
export function completeBodyTarget(operations = [], settings = {}) {
  const resolved = capacitySettings(settings);
  const ops = Array.isArray(operations) ? operations : [];
  const withSmv = ops.filter((o) => smvMinutes(o) > 0);

  if (withSmv.length === 0) {
    return { dailyTarget: 0, hourlyTarget: 0, buffer: resolved.targetBuffer, hasTarget: false, processCount: 0 };
  }

  let daily = 0;
  let hourly = 0;
  withSmv.forEach((op) => {
    const auto = autoTargetForProcess(op, resolved.targetBuffer);
    daily += auto.dailyTarget;
    hourly += auto.hourlyTarget;
  });

  return {
    dailyTarget: Math.round(daily),
    hourlyTarget: Math.round(hourly),
    buffer: resolved.targetBuffer,
    hasTarget: true,
    processCount: withSmv.length,
  };
}

// ---- Dynamic SMV distribution from the Total Garment SMV ----------------------

/**
 * Predefined process complexity weights.
 *
 * These are the fallback when a process sheet states the garment's total SMV but
 * leaves the individual operation times blank AND carries no Weight % column. The
 * split is by complexity: a collar attach takes longer than a label attach, so it
 * gets a larger share of the total.
 *
 * The weights are RELATIVE, not absolute — only the ratio between them matters,
 * because the distribution normalises them to 100% (see `distributeSmvByWeight`).
 * That means adding a weight here does not change any other process's share, and a
 * factory whose balance differs can override per-row without touching this table.
 *
 * Matching is by keyword against the operation name, longest key first, so
 * "collar band" beats "collar". A name matching nothing falls back to
 * `DEFAULT_PROCESS_WEIGHT`, which keeps an unrecognised operation in the split
 * instead of silently dropping it.
 */
export const PROCESS_WEIGHTS = {
  // The heavily-worked construction points.
  'collar band': 12,
  'collar attach': 10,
  collar: 9,
  'sleeve attach': 9,
  'sleeve join': 8,
  sleeve: 8,
  cuff: 7,
  'placket': 7,
  'front placket': 8,
  'side seam': 7,
  'shoulder join': 6,
  shoulder: 6,
  'armhole': 7,
  'yoke': 6,
  'pocket': 6,
  'waist band': 8,
  waistband: 8,
  waist: 6,
  'fly': 7,
  'zipper': 7,
  'zip': 7,
  'button attach': 5,
  'buttonhole': 6,
  'button hole': 6,
  button: 5,
  'hem': 6,
  'bottom hem': 6,
  'side vent': 5,
  'label': 3,
  'tag': 2,
  'bartack': 3,
  'bar tack': 3,
  'top stitch': 5,
  'topstitch': 5,
  'stitch': 4,
  'join': 5,
  'attach': 5,
  'finish': 4,
  'iron': 4,
  'press': 4,
  'check': 2,
  'trim': 2,
  'pack': 3,
  'inspect': 2,
};

/** The share an operation gets when its name matches no known complexity weight. */
export const DEFAULT_PROCESS_WEIGHT = 5;

/**
 * The predefined complexity weight for one operation name.
 *
 * Longest keyword first, so the more specific name wins. The match is on the
 * operation text as written, lowercased and trimmed, which is how the sheet
 * arrives from the parser.
 */
export function predefinedWeightFor(operationName = '') {
  const name = String(operationName || '').trim().toLowerCase();
  if (!name) return DEFAULT_PROCESS_WEIGHT;
  const keys = Object.keys(PROCESS_WEIGHTS).sort((a, b) => b.length - a.length);
  const hit = keys.find((k) => name.includes(k));
  return hit ? PROCESS_WEIGHTS[hit] : DEFAULT_PROCESS_WEIGHT;
}

/**
 * Distribute a garment's Total SMV across its operations by weight.
 *
 *   Process SMV = Total Garment SMV × (Process Weight % ÷ 100)
 *
 * The brief's rule, applied in one place so the parser, the preview table and the
 * saved record cannot disagree about what an operation's SMV is.
 *
 * THE WEIGHT SOURCE, in order of precedence:
 *   1. the row's own `weight` — from the sheet's optional Weight % column, or a
 *      figure the user typed in the preview table;
 *   2. `predefinedWeightFor(operation)` — the complexity table above.
 *
 * THE ROUNDING PROBLEM, and why this does not simply multiply each row.
 * A 72-minute pant with three operations at 33.33% each gives 24.00, 24.00, 24.00
 * and the total is right. But 72 minutes at 10/20/70 gives 7.20, 14.40, 50.40 —
 * still right — while 100 minutes at 1/3, 1/3, 1/3 gives 33.333… each, and three
 * rounded copies sum to 99.99, not 100. The last row therefore absorbs the
 * residual so the distributed SMVs always sum EXACTLY to the garment total. The
 * residual is at most a rounding crumb, but a sheet whose SMVs do not add up to
 * the garment total is a sheet a production manager cannot trust, so the invariant
 * is kept rather than the neatness of every row.
 *
 * A row whose weight resolves to 0 (a sheet with an explicit 0% weight) is left at
 * 0 SMV and excluded from the residual — a zero-weight operation genuinely takes
 * no time. When EVERY row is zero-weighted the split falls back to the complexity
 * table rather than returning a sheet of zeros.
 *
 * @param {Array}  operations      parsed operation rows: {operation, smv, weight}
 * @param {number} totalGarmentSmv the garment's total standard time, in minutes
 * @returns {Array} the same rows, each with `smv`, `weightPercent`, `smvSource`
 */
export function distributeSmvByWeight(operations = [], totalGarmentSmv) {
  const ops = Array.isArray(operations) ? operations : [];
  const total = toNumber(totalGarmentSmv);
  if (ops.length === 0 || total <= 0) return ops.map((op) => ({ ...op }));

  // Resolve each row's weight first: the row's own figure if it has a usable one,
  // otherwise the predefined complexity weight. A row that carries a REAL SMV is
  // never overwritten — the sheet stated it, so it is used as-is.
  const resolved = ops.map((op) => {
    const ownSmv = smvMinutes(op);
    const declared = op?.weight === undefined || op?.weight === null || op?.weight === ''
      ? null
      : toNumber(op.weight);
    return { op, ownSmv, declared };
  });

  const withOwnSmv = resolved.filter((r) => r.ownSmv > 0);
  // Every row states its own SMV: nothing to distribute. The stated figure wins and
  // the weight column is reported for the preview, but no time is reallocated.
  if (withOwnSmv.length === resolved.length) {
    const sum = withOwnSmv.reduce((s, r) => s + r.ownSmv, 0);
    return resolved.map((r) => ({
      ...r.op,
      smv: r.ownSmv,
      weightPercent: sum > 0 ? round2((r.ownSmv / sum) * 100) : round2(predefinedWeightFor(r.op?.operation)),
      smvSource: 'sheet',
      autoSmv: r.ownSmv,
      autoHourlyTarget: autoTargetForProcess(r.ownSmv).hourlyTarget,
      autoDailyTarget: autoTargetForProcess(r.ownSmv).dailyTarget,
    }));
  }

  // The weight of every row that needs one distributed to it. A row that states its
  // own SMV is excluded from the split: its time is already accounted for, so
  // including it would hand out more than the garment total.
  const needsWeight = resolved.filter((r) => r.ownSmv <= 0);
  const rawWeights = needsWeight.map((r) => {
    if (r.declared !== null && r.declared >= 0) return r.declared;
    return predefinedWeightFor(r.op?.operation);
  });
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);

  // No usable weights anywhere: fall back to the complexity table so the split
  // still happens rather than producing a sheet of zero-SMV operations.
  const useFallback = weightSum <= 0;
  const finalWeights = useFallback
    ? needsWeight.map((r) => predefinedWeightFor(r.op?.operation))
    : rawWeights;
  const finalWeightSum = finalWeights.reduce((s, w) => s + w, 0);

  // The minutes left for the rows that did not state their own SMV.
  const ownSmvSum = withOwnSmv.reduce((s, r) => s + r.ownSmv, 0);
  const minutesToDistribute = Math.max(0, total - ownSmvSum);

  const distributed = needsWeight.map((r, i) => {
    const percent = finalWeightSum > 0 ? (finalWeights[i] / finalWeightSum) * 100 : 0;
    const smv = minutesToDistribute * (percent / 100);
    return { row: r.op, percent, smv, weight: finalWeights[i], isLast: i === needsWeight.length - 1 };
  });

  // The residual lands on the last NON-ZERO row, so a 0-weight row stays 0 and the
  // sum still lands exactly on the garment total.
  let assigned = 0;
  distributed.forEach((d) => { assigned += d.smv; });
  const residual = minutesToDistribute - assigned;
  const lastNonZero = [...distributed].reverse().find((d) => d.smv > 0);
  if (lastNonZero && residual !== 0) lastNonZero.smv += residual;

  let cursor = 0;
  return resolved.map((r) => {
    if (r.ownSmv > 0) {
      return {
        ...r.op,
        smv: r.ownSmv,
        weightPercent: r.declared !== null ? round2(r.declared) : round2(predefinedWeightFor(r.op?.operation)),
        smvSource: 'sheet',
        ...autoTargetFields(r.ownSmv),
      };
    }
    const d = distributed[cursor];
    cursor += 1;
    const smv = roundSmv4(d.smv);
    return {
      ...r.op,
      smv,
      weightPercent: round2(d.percent),
      smvSource: 'distributed',
      ...autoTargetFields(smv),
    };
  });
}

/** The brief's per-process auto targets, in one place so every row states them alike. */
function autoTargetFields(smv) {
  const auto = autoTargetForProcess(smv, AUTO_TARGET_ALLOWANCE);
  return {
    autoSmv: roundSmv4(smv),
    baseHourlyCapacity: auto.baseHourlyCapacity,
    autoHourlyTarget: auto.hourlyTarget,
    autoDailyTarget: auto.dailyTarget,
  };
}

/** Four decimals — enough for a distributed SMV whose percent does not divide evenly. */
function roundSmv4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

/**
 * A whole garment's total SMV, as the brief asks for it to be entered.
 *
 * Reads whatever the user typed — "72", "72 min", "1:12" is NOT supported on
 * purpose, because a colon figure is ambiguous between h:mm and m:ss and guessing
 * wrong is a 60× error. A number in minutes, optionally with the unit, is what the
 * field asks for.
 */
export function readTotalGarmentSmv(input) {
  if (input === undefined || input === null || input === '') return 0;
  // The longer word must be tried FIRST: `mins?` matches the "min" inside "minutes"
  // and leaves a trailing "utes" behind, so "72 minutes" would parse as NaN. Ordering
  // the alternation longest-first is what makes every spelling of the unit work.
  const raw = String(input).trim().toLowerCase().replace(/minutes?|mins?|min\b/g, '').trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? roundSmv4(n) : 0;
}

/**
 * The default per-operation weight for a sheet whose rows carry no weights at all.
 * Exposed so the preview table can show the fallback percentages before the user
 * has typed anything, rather than showing blanks.
 */
export function defaultWeightsFor(operations = []) {
  const ops = Array.isArray(operations) ? operations : [];
  const raw = ops.map((op) => predefinedWeightFor(op?.operation));
  const sum = raw.reduce((s, w) => s + w, 0);
  return ops.map((op, i) => ({
    operation: String(op?.operation || '').trim(),
    weight: raw[i],
    percent: sum > 0 ? round2((raw[i] / sum) * 100) : 0,
  }));
}

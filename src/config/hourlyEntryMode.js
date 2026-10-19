/**
 * ROBIUL GARMENTS ERP — Hourly Production entry: the slot model.
 *
 * The entry form logs the same day two ways:
 *
 *   HOURLY  the clock slots that ran are ticked, and each gets its own output box
 *   DAY     the whole shift is logged once, in a single Full Day Output box
 *
 * Both modes are stored in the SAME shape — `{ selectedHours: [...], qty: { [process]: { [slot]: qty } } }`
 * — with the Day mode standing in a sentinel slot. Keeping one shape is what lets
 * the day total, the stored row, the CSV export and the Daily/Monthly aggregators
 * read a whole-day entry without a single branch.
 *
 * This module is that model, as pure functions, so the mode rules (Day is
 * exclusive, switching clears the other mode's figures) are unit-tested directly
 * rather than through a rendered form that a static render cannot drive.
 */

/** The sentinel slot meaning "the whole day, logged as one figure". */
export const DAY_MODE = '__DAY__';

/**
 * The slot list a mode selection resolves to.
 *
 * The two modes are ALTERNATIVES, never additions: a whole-day figure sitting
 * beside an hourly figure for the same process would be counted twice, so picking
 * one drops the other. The most recent choice wins, which is what a toggle is
 * expected to do.
 *
 * @param {string[]} picked  the slots the control reported
 * @returns {{ slots: string[], mode: 'day'|'hourly' }}
 */
export function resolveSlots(picked = []) {
  const list = Array.isArray(picked) ? picked : [];
  const pickedDay = list.includes(DAY_MODE);
  if (pickedDay) return { slots: [DAY_MODE], mode: 'day' };
  const clockHours = list.filter((h) => h !== DAY_MODE);
  return { slots: clockHours, mode: 'hourly' };
}

/**
 * One slot toggled on or off, with the mode rules applied.
 *
 * Ticking Day clears the clock hours; ticking a clock hour while Day is selected
 * switches to hourly and keeps only that hour. Unticking the last slot leaves the
 * list empty, which is the form's "nothing recorded yet" state.
 */
export function toggleSlot(current = [], slot) {
  const list = Array.isArray(current) ? current : [];
  const has = list.includes(slot);

  if (slot === DAY_MODE) return has ? [] : [DAY_MODE];

  if (list.includes(DAY_MODE)) return [slot];

  return has ? list.filter((h) => h !== slot) : [...list, slot];
}

/** The mode a slot list represents. */
export function modeOf(slots = []) {
  return (Array.isArray(slots) ? slots : []).includes(DAY_MODE) ? 'day' : 'hourly';
}

/**
 * Rebuilds the per-process quantity map so it holds a box for exactly the slots
 * that are selected.
 *
 * A figure typed in the mode being left is DROPPED rather than carried over: an
 * hourly figure is not a day total, and silently reinterpreting it as one would
 * put a number on the floor nobody entered.
 */
export function pruneQty(qty = {}, processes = [], slots = []) {
  const next = {};
  (Array.isArray(processes) ? processes : []).forEach((p) => {
    const kept = { ...((qty || {})[p] || {}) };
    Object.keys(kept).forEach((slot) => {
      if (!slots.includes(slot)) delete kept[slot];
    });
    next[p] = kept;
  });
  return next;
}

/**
 * The day's productive hours for a slot selection.
 *
 * Day mode is the standard productive shift (the ten hours the clock slots add up
 * to, lunch excluded), so both modes produce the same daily target. Overtime is
 * added on top in either mode.
 *
 * @param {string[]} slots          the selected slots
 * @param {number}   shiftHours      the standard productive shift length
 * @param {number}   overtimeHours   OT committed for the day
 * @param {number}   hourlyHours     the productive hours the clock slots give
 */
export function productiveHoursFor({ slots = [], shiftHours, overtimeHours = 0, hourlyHours = 0 } = {}) {
  const day = modeOf(slots) === 'day';
  const base = day ? shiftHours : hourlyHours;
  return Math.round((base + overtimeHours) * 100) / 100;
}

/** The hour label for a slot: a clock key reads '08:00', anything else as typed. */
export function slotLabel(slot) {
  if (slot === DAY_MODE) return 'Day';
  return /^\d{1,2}$/.test(String(slot)) ? `${slot}:00` : String(slot);
}

/** True when a stored row was logged as a whole day. */
export function isDayRow(row = {}) {
  if (row.mode === 'day') return true;
  return Object.keys(row.hours || {}).includes(DAY_MODE);
}// =============================================================================
// THE UNIFIED ENTRY MODES
// =============================================================================
//
// The one entry form logs four different kinds of production fact. Rather than
// four forms — which is how a floor ends up recording the same day twice, in two
// places, and the reports disagree — there is ONE form whose fields change with
// the mode the supervisor picks at the top:
//
//   hourly  Hourly Production   employee + order + process + a box per clock hour
//   daily   Daily Production    employee + order + process + one Full Day Output
//   line    Total Line Output   employee OPTIONAL — the line's total body output
//   qc      QC Product Check    OK / Alter / Defect pcs (+ defect type), no output
//
// THREE OF THE FOUR ARE OUTPUT
// ----------------------------
// `hourly`, `daily` and `line` all record PIECES PRODUCED, and they share one
// storage shape — `{ qty: { [process]: { [slot]: qty } } }` — so the existing
// aggregators (Daily sheet, Monthly matrix, Overall Summary, Operator Performance)
// read them without a single branch. They differ only in how much of the day the
// figure covers and whether an employee is required:
//
//   hourly  a box per chosen clock slot        employee REQUIRED
//   daily   one box under the DAY sentinel     employee REQUIRED
//   line    one box under the DAY sentinel     employee OPTIONAL (whole line)
//
// A LINE entry with no employee is stored with the employee name the brief's
// reports expect ("Total Line Output"), so a line total lands in the daily sheet
// and the summary as one identifiable row rather than a blank name.
//
// `qc` IS NOT OUTPUT
// ------------------
// A QC Product Check records INSPECTION, not production: pieces checked and how
// they were classified. Counting it as output would inflate every figure the
// factory reads, so it is kept out of the output aggregators entirely and written
// to its own collection. Its one derived figure is:
//
//   Total Checked = OK Pcs + Alter Pcs + Defect Pcs
//
// which is the brief's auto-calculation, stated here once so the form, the stored
// row and the QC report cannot compute it three different ways.

/** The four entry modes, in the order the selector offers them. */
export const ENTRY_MODES = [
  { key: 'hourly', label: 'Hourly Production', icon: '⏱️', hint: 'One box per hour worked' },
  { key: 'daily', label: 'Daily Production', icon: '📅', hint: 'One Full Day Output box' },
  { key: 'line', label: 'Total Line Output', icon: '🏭', hint: 'Whole line / body output' },
  { key: 'qc', label: 'QC Product Check', icon: '🔍', hint: 'OK / Alter / Defect pieces' },
];

/** The default mode a fresh form opens on — Hourly Production, as the brief says. */
export const DEFAULT_ENTRY_MODE = 'hourly';

/** True when the mode records pieces produced (as opposed to an inspection). */
export function isOutputMode(mode) {
  return mode === 'hourly' || mode === 'daily' || mode === 'line';
}

/** True when the mode requires an employee to be chosen. */
export function modeNeedsEmployee(mode) {
  // The brief makes the employee OPTIONAL for a Total Line Output entry — the
  // figure belongs to the line, not to one operator — and QC is checked by line.
  return mode === 'hourly' || mode === 'daily';
}

/** True when the mode requires a process/operation. */
export function modeNeedsProcess(mode) {
  return mode === 'hourly' || mode === 'daily';
}

/**
 * True when the mode needs an active-hours selection.
 *
 * Only HOURLY asks the supervisor which clock slots ran; Daily and Line log the
 * whole day as one figure (the DAY sentinel), so their hours are the standard
 * shift and the slot control is hidden.
 */
export function modeNeedsHours(mode) {
  return mode === 'hourly';
}

/** The slot list a mode logs against: the clock slots for hourly, else the sentinel. */
export function slotsForMode(mode) {
  return mode === 'hourly' ? [] : [DAY_MODE];
}

/**
 * The config flag that keeps the "Overtime Start Time" section on screen.
 *
 * Set to `false` to hide the section on every mode at once — the switch the
 * brief asks for — without touching the component that renders it. Flipping it
 * back to `true` brings the section straight back: the input, its state handler
 * (`entry.overtimeStart`) and the Add-OT handler are never removed, so nothing
 * has to be rebuilt.
 */
export const SHOW_OVERTIME_SECTION = true;

/**
 * True when the "Overtime Start Time" section belongs on the form.
 *
 * The brief: the section is shown ONLY for Hourly Production. Daily, Total Line
 * Output and QC Product Check hide it, because those modes log the whole day as
 * one figure and an overtime START time would only restate the shift they already
 * assume — the section is dead weight in those three modes.
 *
 * This is a pure predicate rather than an inline `entryMode === 'hourly'` so the
 * visibility rule is stated once and unit-tested directly, exactly like the other
 * mode rules above. When `SHOW_OVERTIME_SECTION` is false the section is hidden
 * everywhere, which is the future-proof toggle: a single flag, no code removed.
 */
export function showsOvertimeSection(mode) {
  if (!SHOW_OVERTIME_SECTION) return false;
  return mode === 'hourly';
}

/** The employee name stored for a line entry logged with no operator. */
export const LINE_EMPLOYEE_LABEL = 'Total Line Output';

/**
 * The employee a row is stored under, resolved from the mode and what was typed.
 *
 * A line entry with nobody named is NOT stored blank: the brief wants the total
 * to appear in the reports, and a blank employee would be an unlabelled row. It
 * is stored under the recognisable "Total Line Output" label instead.
 */
export function resolveEmployee(mode, employee) {
  const name = String(employee || '').trim();
  if (name) return name;
  return mode === 'line' ? LINE_EMPLOYEE_LABEL : '';
}

// ---- QC Product Check ------------------------------------------------------

/** The defect types a QC check can be tagged with. Free text is also accepted. */
export const DEFECT_TYPES = [
  'Skip Stitch', 'Broken Stitch', 'Open Seam', 'Uneven Hem', 'Measurement Out',
  'Fabric Fault', 'Needle Mark', 'Oil Spot', 'Wrong Label', 'Button Defect',
];

/**
 * The defect types the dropdown OFFERS, including any added by hand before.
 *
 * The preset list is extended with the custom values already in use, in the order they
 * were first seen, de-duplicated case-insensitively — the same shape as the employee
 * directory's designation list, so a reason recorded once is selectable for the next
 * check rather than having to be retyped and mis-spelled.
 *
 * Kept as a thin wrapper over `defectTypeOptions`, which is what the dropdown actually
 * consumes: a caller that needs the plain list of NAMES (a test, an export) gets one
 * from here without having to unwrap `{ value, label, hint }` objects.
 *
 * @param {Array} inUse defect types already recorded on earlier checks
 * @returns {string[]} the presets followed by the custom ones in use
 */
export function defectTypesInUse(inUse = []) {
  return defectTypeOptions(inUse, []).map((o) => o.value);
}


/**
 * The QC check's own collection of designations, kept in step with the multi-selects.
 *
 * A QC check may name SEVERAL processes, colours and defect types in one entry — a
 * line running three colours can produce a skip stitch on two of them at once — so
 * each of those fields is a LIST. They are stored as the comma-separated string every
 * existing reader already prints (`row.process`, a CSV cell, a dropdown label), which
 * is the same contract the order form's colour and size fields keep: widening the
 * INPUT must not widen the column's TYPE.
 *
 * `splitValues`/`joinValues` are reused rather than reimplemented, so a value typed
 * with any separator the rest of the app accepts reads back here identically.
 */
export function asList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (value === undefined || value === null) return [];
  return String(value)
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Joins a list back into the stored string, de-duplicated case-insensitively.
 *
 * The FIRST spelling wins, so a value that matches an existing option keeps that
 * option's casing rather than the casing it happened to be typed in.
 *
 * A plain STRING is accepted as well as an array, and is split on the same separators
 * `asList` accepts before being re-joined. That matters because the single-value key on
 * a stored row (`defect_type`, `process`, `color`) is a string, and a caller that passes
 * one straight through — the record builder, or a re-opened row — must not have its
 * value dropped. `asList` and `joinList` are therefore symmetric: anything one accepts,
 * the other reads.
 */
export function joinList(values) {
  const seen = new Set();
  const out = [];
  asList(values).forEach((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out.join(', ');
}

/**
 * The QC form's multi-select values, resolved from a stored record.
 *
 * A row written before these fields were multi-value carries a plain string, which
 * reads back as a one-item list — so an old check re-opens with its single process or
 * defect type still selected instead of coming up blank.
 */
export function qcMultiValues(form = {}) {
  return {
    processes: asList(form.processes ?? form.process),
    colors: asList(form.colors ?? form.color),
    defectTypes: asList(form.defect_types ?? form.defect_type),
  };
}

/**
 * The process options a QC check offers: the order's uploaded sheet, plus anything
 * already chosen so a chip is never orphaned by switching orders mid-entry.
 *
 * Unlike the output modes the sheet is a CONVENIENCE here, not a requirement: a QC
 * check is recorded by line, and the process that caused a defect may not be on the
 * sheet at all. A check with no process is therefore valid.
 */
export function qcProcessOptions(sheetProcesses = [], chosen = []) {
  const seen = new Set();
  const out = [];
  const add = (name, hint) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value: clean, label: clean, hint });
  };
  (Array.isArray(sheetProcesses) ? sheetProcesses : []).forEach((p) => add(p, 'On this sheet'));
  (Array.isArray(chosen) ? chosen : []).forEach((p) => add(p, 'Selected'));
  return out;
}

/**
 * The operations a QC check may name as the FAULTY process, for one order.
 *
 * The brief is specific: the Process dropdown is populated with the order's
 * INPUT and OUTPUT processes from its Process Sheet — not the whole operation list.
 * Those two are the operations the sheet itself designates as the line's boundaries
 * (`lineInputProcess` / `lineOutputProcess`, with the older `inputProcess` /
 * `outputProcess` spellings still read), and they are the ones a defect is reported
 * against: a fault is found at the point the line takes work in or hands it out.
 *
 * Falls back to the sheet's whole operation list when the sheet designates NEITHER —
 * a sheet uploaded before those fields existed, or one whose columns were never set.
 * Offering the full list is better than offering nothing, because a QC check must not
 * be blocked by a gap in the sheet's own metadata.
 *
 * @param {object} sheet  the order's latest process sheet, or null
 * @param {Array}  chosen anything already selected, so a chip is never orphaned
 * @returns {Array<{ value, label, hint }>}
 */
export function qcFaultProcessOptions(sheet, chosen = []) {
  const designated = [
    { name: sheet?.lineInputProcess ?? sheet?.inputProcess, hint: 'Input process' },
    { name: sheet?.lineOutputProcess ?? sheet?.outputProcess, hint: 'Output process' },
  ];

  const seen = new Set();
  const out = [];
  const add = (name, hint) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value: clean, label: clean, hint });
  };

  designated.forEach(({ name, hint }) => add(name, hint));

  // Neither designated: fall back to every operation the sheet carries, so the field
  // is still usable rather than empty through no fault of the supervisor's.
  if (out.length === 0) {
    (Array.isArray(sheet?.operations) ? sheet.operations : [])
      .forEach((op) => add(op?.operation, 'On this sheet'));
  }

  (Array.isArray(chosen) ? chosen : []).forEach((p) => add(p, 'Selected'));
  return out;
}

/**
 * The colour options a QC check offers for one order.
 *
 * Strictly the colours ASSIGNED to that order in Order Management, per the brief —
 * `colorsOf` reads the order's own `color` field. Anything already chosen rides along
 * so switching orders mid-check cannot orphan a chip.
 *
 * Unlike the Total Line Output field there is NO standard suggestion list here: the
 * brief asks for the order's colours, and padding the list with colours the order does
 * not carry is what made a check name a colour the garment was never made in. A colour
 * the order lacks is added by hand through the dropdown's own "+ Add" row.
 */
export function qcOrderColorOptions(order, chosen = []) {
  const seen = new Set();
  const out = [];
  const add = (name, hint) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value: clean, label: clean, hint });
  };
  asList(order?.color ?? order?.colors).forEach((c) => add(c, 'On this order'));
  (Array.isArray(chosen) ? chosen : []).forEach((c) => add(c, 'Selected'));
  return out;
}

/**
 * The defect-type options a QC check offers, plus any added by hand.
 *
 * `added` carries the types a supervisor created on an earlier check, so a fault the
 * standard list does not name is selectable next time rather than retyped.
 */
export function defectTypeOptions(added = [], chosen = []) {
  const seen = new Set();
  const out = [];
  const add = (name, hint) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value: clean, label: clean, hint });
  };
  DEFECT_TYPES.forEach((d) => add(d, ''));
  (Array.isArray(added) ? added : []).forEach((d) => add(d, 'Added by you'));
  (Array.isArray(chosen) ? chosen : []).forEach((d) => add(d, 'Selected'));
  return out;
}

/**
 * A list with `value` added, or `null` when there is nothing to add.
 *
 * `null` — rather than an unchanged array — for a blank value or one already carried
 * in any casing, so the caller can tell "this was new" from "this was already there"
 * and skip a redundant write.
 */
export function addToList(list = [], value) {
  const clean = String(value || '').trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  const key = clean.toLowerCase();
  if (asList(list).some((v) => v.toLowerCase() === key)) return null;
  return [...asList(list), clean];
}

/**
 * The spelling to SELECT for a typed value: the list's own casing when the value is
 * already carried, otherwise the cleaned value as typed.
 *
 * Keeps a multi-select on one canonical spelling, so adding "skip stitch" selects the
 * existing "Skip Stitch" instead of creating a second, differently-cased chip.
 */
export function matchingInList(options = [], value) {
  const clean = String(value || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const key = clean.toLowerCase();
  const hit = (Array.isArray(options) ? options : []).find(
    (o) => String(typeof o === 'string' ? o : o?.value || '').trim().toLowerCase() === key,
  );
  return hit ? String(typeof hit === 'string' ? hit : hit.value) : clean;
}

/** A number from anything a QC box may hold. */
function qcNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The QC figures, with the brief's auto-calculation applied.
 *
 *   totalChecked = okPcs + alterPcs + defectPcs
 *
 * `passRate` is the OK share of everything checked — the figure a QC report
 * ranks lines by — and `defectRate` is the reject share, both zero-safe so a
 * half-filled check never shows "NaN%".
 */
export function computeQcTotals({ okPcs = 0, alterPcs = 0, defectPcs = 0 } = {}) {
  const ok = qcNum(okPcs);
  const alter = qcNum(alterPcs);
  const defect = qcNum(defectPcs);
  const totalChecked = ok + alter + defect;
  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    okPcs: ok,
    alterPcs: alter,
    defectPcs: defect,
    totalChecked,
    passRate: totalChecked > 0 ? round1((ok / totalChecked) * 100) : 0,
    alterRate: totalChecked > 0 ? round1((alter / totalChecked) * 100) : 0,
    defectRate: totalChecked > 0 ? round1((defect / totalChecked) * 100) : 0,
  };
}

/**
 * The collection a QC Product Check is written to.
 *
 * It is the SAME `quality-control` collection the Quality Control screen already
 * reads, in that screen's own shape (`checked`, `defect_qty`, `process`, `line`),
 * so a check logged here appears in the existing QC report immediately and the
 * defect-rate flagging keeps working — no second QC list to reconcile.
 */
export const QC_COLLECTION = 'quality-control';

/**
 * Builds the QC record from a form's values, in the Quality Control screen's
 * stored shape.
 *
 * `checked` is the brief's Total Checked, `defect_qty` is the rejects, and the
 * OK / Alter split rides along on additive keys so the fuller picture is not lost
 * while every existing reader still finds the fields it knows.
 */
export function buildQcRecord(form = {}) {
  const totals = computeQcTotals({
    okPcs: form.ok_pcs,
    alterPcs: form.alter_pcs,
    defectPcs: form.defect_pcs,
  });
  // Each of the three multi-value fields is stored as the comma-separated string every
  // existing reader prints. A plain string is accepted too (an older caller, or a
  // re-opened row), which is what `joinList` normalises.
  const processes = joinList(form.processes ?? form.process);
  const colors = joinList(form.colors ?? form.color);
  const defectTypes = joinList(form.defect_types ?? form.defect_type);
  return {
    date: form.date,
    order_no: form.order_no || '',
    style: form.style || '',
    line: form.line_no || form.line || '',
    // `process` keeps its single-string shape for the QC screen's own readers; the
    // list rides alongside so nothing that already reads `process` has to change.
    process: processes,
    processes: asList(processes),
    color: colors,
    colors: asList(colors),
    // A QC check is recorded BY LINE, so the employee field was removed from the form.
    // The key is still written (empty) so a reader expecting it finds a value rather
    // than undefined — and the supervisor, who does run the check, is carried instead.
    employee: '',
    supervisor: form.supervisor || '',
    // The Quality Control screen's own field names.
    checked: totals.totalChecked,
    defect_qty: totals.defectPcs,
    // The full QC breakdown, additively.
    ok_pcs: totals.okPcs,
    alter_pcs: totals.alterPcs,
    defect_pcs: totals.defectPcs,
    total_checked: totals.totalChecked,
    pass_rate: totals.passRate,
    alter_rate: totals.alterRate,
    defect_rate: totals.defectRate,
    // The single field keeps the string (as the existing QC report reads it) and the
    // list rides alongside for the multi-select to re-open from.
    defect_type: defectTypes,
    defect_types: asList(defectTypes),
    remarks: form.remarks || '',
    entry_type: 'qc',
  };
}
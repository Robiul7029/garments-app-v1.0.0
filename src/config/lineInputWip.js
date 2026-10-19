/**
 * ROBIUL GARMENTS ERP — Line Input & WIP tracking.
 *
 * The sewing line's material balance, computed as pure functions of its inputs so
 * the arithmetic can be unit-tested without a database and reused by the entry
 * form, the WIP dashboard and the Overall Summary alike.
 *
 * THE MODEL
 * ---------
 * A line is fed cut material from the Cutting section. That feeding is recorded in
 * the `lineInputs` collection — one document per feeding event, carrying the order,
 * style, colour, size range, quantity, line and the timestamp it happened at.
 *
 * The line's COMPLETED OUTPUT is what the floor actually finished and packed. That
 * figure already exists in this app in two places and this module reads both:
 *
 *   * the packing collection (`packingPlans.packedQty` / `cartons.qty`) — the
 *     pieces that were packed and are therefore genuinely complete; and
 *   * the end-line QC collection (`endLineQc.passedQty`) — the pieces that passed
 *     final inspection at the end of the line.
 *
 * The brief defines the balance as:
 *
 *      WIP = Total Line Input − Total Completed Line Output
 *
 * so this file computes exactly that, grouped by order and by line, and never
 * reports a negative balance: more output than input means the two records
 * disagree (an input was not logged, or a figure was mis-keyed), which is a data
 * problem, not negative work in progress. That case is surfaced separately as
 * `overReported` so the discrepancy is visible rather than hidden by a floor of 0.
 *
 * No React, no storage, no Firestore — pure functions only.
 */

import { toNumber } from '../utils/erpCalculations';

/** A YYYY-MM-DD key from anything a stored row may hold. */
function dayKeyOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/** The month (YYYY-MM) a date belongs to. */
function monthKeyOf(value) {
  return dayKeyOf(value).slice(0, 7);
}

/**
 * The quantity one line-input document fed into the line.
 *
 * The field is `inputQty` on an ERP document, but a row saved from the local form
 * may carry `quantity` or `qty` instead. Reading all three means one figure is
 * never silently dropped for being named differently.
 */
export function inputQtyOf(row = {}) {
  return toNumber(row.inputQty)
    || toNumber(row.quantity)
    || toNumber(row.qty);
}

/** The line an input row was fed into, tolerating the two spellings in use. */
export function inputLineOf(row = {}) {
  return String(row.line_no || row.line || row.lineNo || '').trim();
}

/** The order an input row belongs to. */
export function inputOrderOf(row = {}) {
  return String(row.order_no || row.orderNo || '').trim();
}

/**
 * The pieces a completed-output row represents.
 *
 * Completed output is read from packing or end-line QC records, whose quantity
 * field is named differently in each. This reads whichever is present so the
 * caller does not have to know which collection a row came from.
 */
export function outputQtyOf(row = {}) {
  return toNumber(row.packedQty)
    || toNumber(row.passedQty)
    || toNumber(row.qty)
    || toNumber(row.quantity)
    || toNumber(row.actual);
}

/** The line a completed-output row belongs to. */
export function outputLineOf(row = {}) {
  return String(row.line_no || row.line || row.lineNo || '').trim();
}

/** The order a completed-output row belongs to. */
export function outputOrderOf(row = {}) {
  return String(row.order_no || row.orderNo || '').trim();
}

/**
 * The grouping key shared by inputs and outputs: order + style + line.
 *
 * An order is the brief's unit of tracking ("the real-time WIP for every order /
 * line"), and a line is the second axis. Style is carried through so two orders
 * that reuse a style name do not merge.
 */
export function balanceKey({ order_no, style, line_no } = {}) {
  return [
    String(order_no || '').trim().toLowerCase(),
    String(style || '').trim().toLowerCase(),
    String(line_no || '').trim().toLowerCase(),
  ].join('||');
}

/**
 * The WIP balance for one order/line group.
 *
 *   wip = totalInput − totalCompletedOutput
 *
 * `overReported` is the amount by which output exceeds input — reported as a
 * positive number so a screen can flag "output exceeds input" without the reader
 * having to interpret a minus sign. When there is no discrepancy it is 0.
 */
export function computeWip(totalInput, totalCompletedOutput) {
  const input = toNumber(totalInput);
  const output = toNumber(totalCompletedOutput);
  const difference = input - output;
  return {
    totalInput: input,
    totalCompletedOutput: output,
    // The brief's formula. Never negative — see the note at the top of the file.
    wip: Math.max(0, difference),
    // How much output exceeds input, when it does. Zero when the two agree.
    overReported: difference < 0 ? Math.abs(difference) : 0,
    // Completion percentage: how much of what was fed has been finished.
    completedPercent: input > 0 ? Math.round((Math.min(output, input) / input) * 1000) / 10 : 0,
    // The balance as a share of what was fed — "how much is still sitting on the line".
    wipPercent: input > 0 ? Math.round((Math.max(0, difference) / input) * 1000) / 10 : 0,
    // Tone for the 🟢🟠🔴 indicator the rest of the app uses. A line still holding
    // most of what it was fed is healthy; one holding almost all of it is not.
    level: input === 0
      ? 'warning'
      : difference < 0
        ? 'critical'
        : Math.max(0, difference) / input > 0.5
          ? 'warning'
          : 'good',
  };
}

/**
 * Rolls the raw collections up into one row per order + style + line, with the
 * WIP balance computed.
 *
 * @param {Array} inputs   line-input rows (the feeding events)
 * @param {Array} outputs  completed-output rows (packing and/or end-line QC)
 * @param {object} opts    { date, from, to, order_no, line_no } — all optional
 *
 * Filtering happens here rather than in the screen so the table, the totals and
 * the comparison chart all read the SAME filtered set and cannot disagree about
 * which day they are describing.
 */
export function summariseWip(inputs = [], outputs = [], opts = {}) {
  const { date = '', from = '', to = '', order_no = '', line_no = '' } = opts;
  const day = dayKeyOf(date);
  const fromKey = dayKeyOf(from);
  const toKey = dayKeyOf(to);
  const wantedOrder = String(order_no || '').trim().toLowerCase();
  const wantedLine = String(line_no || '').trim().toLowerCase();

  /** One place the date window is applied, so inputs and outputs are filtered alike. */
  function inWindow(value) {
    const key = dayKeyOf(value);
    if (!key) return false;
    if (day && key !== day) return false;
    if (fromKey && key < fromKey) return false;
    if (toKey && key > toKey) return false;
    return true;
  }

  const groups = new Map();

  function ensureGroup({ order, style, line }) {
    const key = balanceKey({ order_no: order, style, line_no: line });
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        order_no: order,
        style: style || '',
        line_no: line || '',
        totalInput: 0,
        totalCompletedOutput: 0,
        inputCount: 0,
        outputCount: 0,
        // The distinct colours and size ranges fed, so the row can describe the
        // order without a second lookup.
        colors: new Set(),
        sizeRanges: new Set(),
        // The window the row's figures cover, so the table can show it.
        firstTimestamp: '',
        lastTimestamp: '',
      });
    }
    return groups.get(key);
  }

  (Array.isArray(inputs) ? inputs : []).forEach((row) => {
    if (!row) return;
    const stamp = row.timestamp || row.date || row.createdAt;
    if (!inWindow(stamp)) return;
    const order = inputOrderOf(row);
    const line = inputLineOf(row);
    if (wantedOrder && order.toLowerCase() !== wantedOrder) return;
    if (wantedLine && line.toLowerCase() !== wantedLine) return;
    const group = ensureGroup({ order, style: row.style, line });
    const qty = inputQtyOf(row);
    group.totalInput += qty;
    group.inputCount += 1;
    if (row.color) group.colors.add(String(row.color).trim());
    if (row.sizeRange) group.sizeRanges.add(String(row.sizeRange).trim());
    const iso = dayKeyOf(stamp);
    if (iso && (!group.firstTimestamp || stamp < group.firstTimestamp)) group.firstTimestamp = stamp;
    if (iso && (!group.lastTimestamp || stamp > group.lastTimestamp)) group.lastTimestamp = stamp;
  });

  (Array.isArray(outputs) ? outputs : []).forEach((row) => {
    if (!row) return;
    const stamp = row.packDate || row.date || row.timestamp || row.createdAt;
    if (!inWindow(stamp)) return;
    const order = outputOrderOf(row);
    const line = outputLineOf(row);
    if (wantedOrder && order.toLowerCase() !== wantedOrder) return;
    if (wantedLine && line.toLowerCase() !== wantedLine) return;
    // An output row with neither order nor style cannot be attributed to an order,
    // so it would create a phantom group. It is dropped rather than shown as its
    // own order-less line.
    if (!order && !row.style) return;
    const group = ensureGroup({ order, style: row.style, line });
    group.totalCompletedOutput += outputQtyOf(row);
    group.outputCount += 1;
  });

  return [...groups.values()]
    .map((group) => {
      const wip = computeWip(group.totalInput, group.totalCompletedOutput);
      return {
        ...group,
        colors: [...group.colors],
        sizeRanges: [...group.sizeRanges],
        ...wip,
      };
    })
    .sort((a, b) => (
      String(a.order_no).localeCompare(String(b.order_no))
      || String(a.style).localeCompare(String(b.style))
      || String(a.line_no).localeCompare(String(b.line_no), undefined, { numeric: true })
    ));
}

/**
 * The factory-wide WIP totals — the headline figures the summary and the
 * dashboard cards show. Summed from the same rows the table renders, so a filter
 * on the screen moves the totals with it.
 */
export function summariseWipTotals(wipRows = []) {
  const list = Array.isArray(wipRows) ? wipRows : [];
  const totals = list.reduce((acc, r) => ({
    totalInput: acc.totalInput + toNumber(r.totalInput),
    totalCompletedOutput: acc.totalCompletedOutput + toNumber(r.totalCompletedOutput),
    wip: acc.wip + toNumber(r.wip),
    overReported: acc.overReported + toNumber(r.overReported),
    orders: acc.orders + (r.order_no ? 1 : 0),
    lines: acc.lines + (r.line_no ? 1 : 0),
  }), { totalInput: 0, totalCompletedOutput: 0, wip: 0, overReported: 0, orders: 0, lines: 0 });

  const wip = computeWip(totals.totalInput, totals.totalCompletedOutput);
  return {
    ...totals,
    ...wip,
    // The two totals a comparison view needs, named as the brief names them.
    input: totals.totalInput,
    output: totals.totalCompletedOutput,
  };
}

/**
 * The "Input vs Output" comparison rows — one row per order, with how much was fed
 * in against how much was finished and packed.
 *
 * This is deliberately a DIFFERENT aggregation from `summariseWip`: the WIP table
 * answers "what is sitting on each line", while the comparison answers "for this
 * order, how far did the material get". So the comparison groups on the ORDER
 * alone (its natural unit) and merges every line feeding it.
 */
export function inputVsOutputByOrder(wipRows = []) {
  const groups = new Map();

  (Array.isArray(wipRows) ? wipRows : []).forEach((row) => {
    if (!row) return;
    const key = String(row.order_no || row.style || '').trim().toLowerCase();
    if (!key) return;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        order_no: row.order_no || '',
        style: row.style || '',
        input: 0,
        output: 0,
        wip: 0,
        lines: new Set(),
      });
    }
    const group = groups.get(key);
    group.input += toNumber(row.totalInput);
    group.output += toNumber(row.totalCompletedOutput);
    group.wip += toNumber(row.wip);
    if (row.line_no) group.lines.add(row.line_no);
  });

  return [...groups.values()]
    .map((group) => {
      const balance = computeWip(group.input, group.output);
      return {
        ...group,
        lines: [...group.lines],
        // The balance from the SAME helper the WIP table uses, so a row here and a
        // row there describe one order's balance identically.
        ...balance,
      };
    })
    .sort((a, b) => b.input - a.input);
}

/**
 * One row per line, for the line-wise comparison view.
 *
 * A line's "input" is everything fed into it, whatever order it was for; its
 * "output" is everything finished from it. That is the question a line supervisor
 * actually asks at the end of a shift.
 */
export function inputVsOutputByLine(wipRows = []) {
  const groups = new Map();

  (Array.isArray(wipRows) ? wipRows : []).forEach((row) => {
    if (!row) return;
    const key = String(row.line_no || 'unassigned').trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        line_no: row.line_no || 'Unassigned',
        input: 0,
        output: 0,
        wip: 0,
        orders: new Set(),
      });
    }
    const group = groups.get(key);
    group.input += toNumber(row.totalInput);
    group.output += toNumber(row.totalCompletedOutput);
    group.wip += toNumber(row.wip);
    if (row.order_no) group.orders.add(row.order_no);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      orders: [...group.orders],
      ...computeWip(group.input, group.output),
    }))
    .sort((a, b) => b.input - a.input);
}

/**
 * Every distinct value of a field across a set of WIP rows — used to populate the
 * Line and Order dropdowns without a second collection read.
 */
export function distinctValues(wipRows = [], field) {
  const seen = new Set();
  (Array.isArray(wipRows) ? wipRows : []).forEach((row) => {
    const value = String(row?.[field] || '').trim();
    if (value) seen.add(value);
  });
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * The comparison row's tone for the 🟢🟠🔴 indicator: a row that has completed most
 * of what it was fed is good, one that has completed little is at risk.
 */
export function comparisonLevel(row = {}) {
  const input = toNumber(row.input ?? row.totalInput);
  const output = toNumber(row.output ?? row.totalCompletedOutput);
  if (input <= 0) return 'warning';
  if (output > input) return 'critical';
  const percent = (output / input) * 100;
  if (percent >= 80) return 'good';
  if (percent >= 40) return 'warning';
  return 'critical';
}

/** The comparison row's progress percentage, clamped to 0–100 for a progress bar. */
export function comparisonPercent(row = {}) {
  const input = toNumber(row.input ?? row.totalInput);
  const output = toNumber(row.output ?? row.totalCompletedOutput);
  if (input <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((output / input) * 1000) / 10));
}

export { dayKeyOf as wipDateKey, monthKeyOf as wipMonthKey };

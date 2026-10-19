/**
 * ROBIUL GARMENTS ERP — grouping and per-process figures for production rows.
 *
 * The Daily Production and Worker Production screens show the same thing: what one
 * employee produced across the operations they worked in a day. A worker routinely
 * moves between processes (collar in the morning, sleeve join after lunch), so a
 * flat list repeats their name once per process and hides the day's shape.
 *
 * This module is the single description of that grouping, so both tables and the
 * Worker Production page render it identically and a figure can never be computed
 * two slightly different ways:
 *
 *   groupedByEmployee(rows) → [{ key, employee, date, line, processes:[...], totals }]
 *
 * `processes[]` carries, per operation: process, target, actual, defect, good,
 * efficiency %, variance (+/-). Everything except target/actual/defect is derived,
 * so a row saved by any screen shows the same numbers here.
 *
 * No React and no storage — pure functions, so the grouping is unit-tested directly.
 */

/** A number from anything a stored row may hold. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** One decimal, matching how the paper form prints its percentages. */
function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/**
 * The figures for ONE row's process.
 *
 * A production row records a single process for a single employee, so the day's
 * totals and the process figures are the same numbers — the grouping simply
 * presents one row per process under the employee.
 *
 * `target` prefers the stored daily target (which the form derives from the
 * process sheet's SMV) and falls back to the legacy `target` key, so a row entered
 * before auto-targeting still reports the target it was judged against.
 */
export function processFigures(row = {}) {
  const target = num(row.daily_target) || num(row.target);
  // `quantity` is the good pieces; a row that predates it may hold `output`.
  const actual = num(row.quantity) || num(row.output) || num(row.actual);
  const defect = num(row.defect_qty) || num(row.defect) || num(row.defects);
  // Good output is what passed QC: actual minus defects, never negative.
  const good = Math.max(0, actual - defect);
  // Efficiency is measured against the target when there is one, otherwise on its
  // own (a row with no target has no meaningful percentage — reported as 0).
  const efficiency = target > 0 ? round1((good / target) * 100) : 0;
  const variance = good - target;

  return {
    process: String(row.process || row.operation || '').trim() || '—',
    // Every process the row covers. A multi-process entry is stored as ONE row
    // carrying `processes`, so listing all of them is what stops a two-process day
    // being shown as a single "Collar Attach" line with the whole target on it.
    processes: processesOf(row),
    style: row.style || '',
    target,
    actual,
    good,
    defect,
    efficiency,
    variance,
    isSurplus: variance > 0,
    isShortfall: variance < 0,
  };
}

/**
 * The operations a stored row covers, as a list.
 *
 * Reads `processes` when present and falls back to the singular `process`, so a
 * row entered before multi-process support reads exactly as it always did.
 */
export function processesOf(row = {}) {
  const list = Array.isArray(row.processes)
    ? row.processes
    : (typeof row.processes === 'string' && row.processes !== ''
      ? row.processes.split(',')
      : []);
  const cleaned = list.map((p) => String(p || '').trim()).filter(Boolean);
  if (cleaned.length > 0) return cleaned;
  const single = String(row.process || row.operation || '').trim();
  return single ? [single] : [];
}

/**
 * The label the brief asks for: a surplus is "+8 Extra", a shortfall is "12 Due".
 * Kept in one place so a supervisor reading the table sees one wording throughout.
 */
export function varianceLabel(variance) {
  const n = num(variance);
  if (n === 0) return 'On target';
  return n > 0 ? `+${n} Extra` : `${Math.abs(n)} Due`;
}

/** The reason a worker's rows belong together: same employee, same day, same line. */
function groupKey(row) {
  const employee = String(row.employee || row.worker || row.name || '').trim();
  const date = String(row.date || '').trim();
  const line = String(row.line_no || row.line || '').trim();
  // An unnamed employee still groups by date+line, so a row is never dropped.
  return `${employee}||${date}||${line}`;
}

/**
 * Groups production rows by employee + day, with each row's process underneath.
 *
 * The employee name is stated ONCE per group; every process they worked is a row
 * of `processes`. `totals` sums the processes so the group can show a day figure
 * without the reader adding up the column by eye.
 *
 * Order is preserved by first appearance, so the table reads in the order the
 * rows were entered rather than jumbled by a sort the user did not ask for.
 */
export function groupedByEmployee(rows = []) {
  const groups = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    const key = groupKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        employee: String(row.employee || row.worker || row.name || '').trim() || '—',
        date: row.date || '',
        line: row.line_no || row.line || '',
        style: row.style || '',
        supervisor: row.supervisor || '',
        processes: [],
      });
    }
    const group = groups.get(key);
    const figures = processFigures(row);
    // A row covering SEVERAL processes is shown as one line per process, each with
    // its own target, rather than as a single line carrying the whole day's target.
    // The row's own actual/defect belong to the entry as a whole, so they are
    // stated on the FIRST line only and left off the rest — repeating them would
    // multiply the day's output by the number of processes.
    figures.processes.forEach((name, i) => {
      group.processes.push({
        ...figures,
        process: name,
        target: num((row.process_targets || {})[name]) || (i === 0 ? figures.target : 0),
        actual: i === 0 ? figures.actual : 0,
        good: i === 0 ? figures.good : 0,
        defect: i === 0 ? figures.defect : 0,
        id: row.id,
        row,
      });
    });
    // A later row may carry a style/line the first one lacked.
    if (!group.style && row.style) group.style = row.style;
    if (!group.line && (row.line_no || row.line)) group.line = row.line_no || row.line;
  });

  return [...groups.values()].map((group) => {
    const totals = group.processes.reduce((acc, p) => ({
      target: acc.target + p.target,
      actual: acc.actual + p.actual,
      good: acc.good + p.good,
      defect: acc.defect + p.defect,
    }), { target: 0, actual: 0, good: 0, defect: 0 });

    // Day efficiency is good pieces against the summed targets; a group whose
    // processes carry no target at all reports 0 rather than a bogus figure.
    const efficiency = totals.target > 0 ? round1((totals.good / totals.target) * 100) : 0;
    return {
      ...group,
      totals: {
        ...totals,
        variance: totals.good - totals.target,
        efficiency,
        processCount: group.processes.length,
      },
    };
  });
}

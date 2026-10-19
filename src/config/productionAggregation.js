/**
 * ROBIUL GARMENTS ERP — production aggregation.
 *
 * ONE source of truth, three views.
 *
 * The Hourly Production sheet is where the floor actually records work: one row
 * per employee, process, style and day, carrying an output figure per hour. Every
 * other production screen in the app is a VIEW of that same data, aggregated a
 * different way:
 *
 *   1. the Hourly table itself            — the raw rows
 *   2. the Daily all-employee sheet       — one line per employee/process/day
 *   3. the Monthly all-employee matrix    — one row per employee, one column per day
 *   4. the overall summary dashboard      — factory-wide totals and KPIs
 *
 * Recomputing those four from the raw rows, in one pure module, is what makes the
 * sync automatic: a saved hourly entry is not copied anywhere, so there is nothing
 * that can fall out of step. The screens read the same rows through these
 * functions and are therefore always consistent by construction.
 *
 * AGGREGATION KEY: Employee + Process + Style + Date
 * --------------------------------------------------
 * A supervisor may record the same process at 10:00 and again at 15:00 (a machine
 * came back up, a second batch ran). Those are two hourly rows but ONE day's work,
 * so the daily sheet adds them together rather than showing the process twice. The
 * key below is exactly the brief's combination, and everything downstream reads it.
 *
 * No React and no storage — pure functions, so the arithmetic is unit-tested
 * directly rather than through a rendered screen.
 */

import { SHIFT_HOURS } from './workingHours';
import { DAY_MODE } from './hourlyEntryMode';

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
 * How a variance reads, in the brief's wording.
 *
 * A surplus is "+8 Achieved" and a shortfall is "12 Due" — the same two words the
 * rest of the app uses, stated here so the table, the totals row and the exports
 * all describe a figure identically. Zero is reported as "On target" rather than
 * "0" so a reader is not left wondering whether it means "no data".
 */
export function varianceText(variance) {
  const n = Number(variance) || 0;
  if (n === 0) return 'On target';
  return n > 0 ? `+${n.toLocaleString()} Achieved` : `${Math.abs(n).toLocaleString()} Due`;
}

/**
 * The tone a variance is coloured with: `good` when the target was met or beaten,
 * `bad` when it was missed. Returned as a word, not a class, so a caller maps it to
 * whichever styling system it uses (the dark table, the light Excel export).
 */
export function varianceTone(variance) {
  return (Number(variance) || 0) >= 0 ? 'good' : 'bad';
}

/** The YYYY-MM-DD part of a stored date, whatever form it arrived in. */
export function dateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/**
 * The pieces one hourly row recorded.
 *
 * `hours` is the per-hour map the Hourly sheet writes (`{ '08': 12, '09': 9 }`).
 * A row that predates the hourly grid may instead carry a flat `dailyTotal` or
 * `quantity`, so those are honoured as a fallback rather than reporting a day of
 * zero for work that was in fact recorded.
 */
export function rowOutput(row = {}) {
  const hours = row.hours || {};
  const fromHours = Object.values(hours).reduce((sum, v) => sum + num(v), 0);
  if (fromHours > 0) return fromHours;
  return num(row.dailyTotal) || num(row.quantity) || num(row.output) || num(row.actual);
}

/** The defects one hourly row recorded (an additive key on the same document). */
export function rowDefects(row = {}) {
  return num(row.defect_qty) || num(row.defects) || num(row.defect);
}

/** The hourly target one row was measured against. */
export function rowHourlyTarget(row = {}) {
  return num(row.hourlyTarget) || num(row.hourly_target) || num(row.target);
}

/** The day's productive hours one row was worked, for the monthly hours column. */
export function rowWorkingHours(row = {}) {
  return num(row.workingHours) || num(row.working_hours);
}

/** The aggregation key the brief specifies: employee + process + style + date. */
export function aggregationKey(row = {}) {
  return [
    String(row.employee || '').trim().toLowerCase(),
    String(row.process || row.operation || '').trim().toLowerCase(),
    String(row.style || '').trim().toLowerCase(),
    dateKey(row.date),
  ].join('||');
}

/**
 * Daily aggregated rows: one line per Employee + Process + Style + Date.
 *
 * Rows sharing that key are added together — output and defects summed, target
 * taken as the largest single figure recorded (a target is a rate, not a quantity,
 * so adding two hours' worth of it would double the day's goal). Every row keeps
 * the ids of the hourly entries it came from, which is what lets the sheet offer
 * Edit and Delete against the underlying records.
 *
 * @param {Array} rows   hourly-timesheet rows
 * @param {string} date  optional YYYY-MM-DD filter
 */
export function aggregateDaily(rows = [], date) {
  const wanted = date ? dateKey(date) : '';
  const groups = new Map();
  // A Total Line Output row is ONE line's day, not one worker's. Keying it on
  // employee + process + style collapses every line entry of the same order into a
  // single row — and, worse, merges it into an operator's row when the supervisor
  // happens to be logged as an operator too — so it is keyed on the line instead.
  const lineGroupKey = (row) => [
    'line-output',
    String(row.line_no || row.line || '').trim().toLowerCase(),
    String(row.order_no || '').trim().toLowerCase(),
    dateKey(row.date),
  ].join('||');

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    const day = dateKey(row.date);
    if (wanted && day !== wanted) return;

    const isLineEntry = row.entry_type === 'line' || row.source === 'line-output';
    const key = isLineEntry ? lineGroupKey(row) : aggregationKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        date: day,
        employee: String(row.employee || '').trim() || '—',
        process: String(row.process || row.operation || '').trim() || '—',
        style: row.style || '',
        order_no: row.order_no || '',
        line: row.line_no || row.line || '',
        // Which kind of entry the row was logged as ('hourly' | 'daily' | 'line').
        // Carried through so the synced daily-production row can say where it came
        // from; a group that mixes kinds keeps the FIRST one seen, which is the
        // entry the row was opened from.
        entry_type: row.entry_type || '',
        // The supervisor who ran the line, for a line entry. Read by the line
        // output panels; empty on every operator row.
        supervisor: row.supervisor || '',
        output: 0,
        defects: 0,
        target: 0,
        workingHours: 0,
        // The per-hour output map, summed across every entry that shares this
        // key. This is what the daily sheet renders as its 08:00→18:00 breakdown
        // columns, so the sheet shows HOW the day was built, not just its total.
        hours: {},
        entryIds: [],
        entries: [],
      });
    }
    const group = groups.get(key);
    group.output += rowOutput(row);
    group.defects += rowDefects(row);
    // A target is a per-hour rate: the highest one recorded is the day's goal,
    // not the sum of several hours' worth of the same rate. A whole-day row states
    // its DAY target instead, spread back over the row's own hours, so the same
    // `target × workingHours` arithmetic below still produces the stated figure.
    const hours = rowWorkingHours(row);
    const dayTarget = num(row.dailyTarget) || num(row.daily_target);
    const rate = dayTarget > 0 && hours > 0
      ? dayTarget / hours
      : (dayTarget > 0 ? dayTarget : rowHourlyTarget(row));
    group.target = Math.max(group.target, rate);
    group.workingHours = Math.max(group.workingHours, hours);
    // A line entry states its target for the DAY already. Remembering it lets the
    // map below use it verbatim instead of `rate × hours`, which for a line that
    // logged no working hours would otherwise report a target of 0.
    const statedDay = dayTarget > 0 && (hours <= 0 || isLineEntry) ? dayTarget : 0;
    group.statedDailyTarget = Math.max(group.statedDailyTarget || 0, statedDay);
    // Fold this entry's hours into the group's map. A process recorded at 10:00
    // and again at 15:00 lands in two different columns rather than one summed
    // figure, which is what makes the breakdown readable.
    Object.entries(row.hours || {}).forEach(([slot, value]) => {
      const qty = Number(value) || 0;
      if (qty === 0) return;
      // The DAY sentinel is the whole-day total, not a column of the grid, so it
      // is never drawn as an hour cell.
      if (slot === DAY_MODE) return;
      group.hours[slot] = (group.hours[slot] || 0) + qty;
    });
    if (row.id !== undefined && row.id !== null) group.entryIds.push(row.id);
    group.entries.push(row);
    if (!group.entry_type && row.entry_type) group.entry_type = row.entry_type;
    if (!group.line && (row.line_no || row.line)) group.line = row.line_no || row.line;
    if (!group.supervisor && row.supervisor) group.supervisor = row.supervisor;
  });

  return [...groups.values()]
    .map((group) => {
      const dailyTarget = group.target * (group.workingHours || 0);
      const good = Math.max(0, group.output - group.defects);
      const resolvedTarget = group.statedDailyTarget > 0
        ? Math.round(group.statedDailyTarget)
        : (dailyTarget > 0 ? Math.round(dailyTarget) : Math.round(group.target));
      const variance = group.output - resolvedTarget;
      return {
        ...group,
        good,
        // The day's target for this employee/process: the hourly rate over the
        // hours actually worked. Falls back to the summed target when the row
        // carries a daily figure instead of an hourly one.
        dailyTarget: resolvedTarget,
        variance,
        efficiency: resolvedTarget > 0 ? round1((group.output / resolvedTarget) * 100) : 0,
        // The brief's "Variance / Due" wording, decided ONCE here so the table and
        // the export cannot describe the same figure two different ways.
        varianceLabel: varianceText(variance),
        varianceTone: varianceTone(variance),
      };
    })
    .sort((a, b) => (
      a.employee.localeCompare(b.employee)
      || a.process.localeCompare(b.process)
    ));
}

/**
 * The daily sheet, grouped by employee so the name is written once.
 *
 * The brief asks for repeating employee names to be MERGED with a `rowspan`: an
 * operator who ran three processes has three process rows but one name cell. This
 * returns the shape the table renders from — `[{ employee, rows: [...], totals }]`
 * — so the component only has to emit a `rowSpan` and needs no grouping logic of
 * its own.
 */
export function groupDailyByEmployee(dailyRows = []) {
  const groups = [];
  const index = new Map();

  (Array.isArray(dailyRows) ? dailyRows : []).forEach((row) => {
    const key = `${String(row.employee || '').toLowerCase()}||${row.date || ''}`;
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ employee: row.employee, date: row.date, rows: [], totals: { output: 0, defects: 0, good: 0, target: 0 } });
    }
    const group = groups[index.get(key)];
    group.rows.push(row);
    group.totals.output += row.output;
    group.totals.defects += row.defects;
    group.totals.good += row.good;
    group.totals.target += row.dailyTarget;
  });

  return groups.map((group) => ({
    ...group,
    totals: {
      ...group.totals,
      variance: group.totals.output - group.totals.target,
      efficiency: group.totals.target > 0 ? round1((group.totals.output / group.totals.target) * 100) : 0,
      processCount: group.rows.length,
    },
  }));
}

/** Every distinct employee on a set of daily rows, alphabetically. */
export function employeesOf(dailyRows = []) {
  const seen = new Set();
  (Array.isArray(dailyRows) ? dailyRows : []).forEach((r) => {
    const name = String(r.employee || '').trim();
    if (name) seen.add(name);
  });
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** The number of days in the month a YYYY-MM key names (28–31). */
export function daysInMonth(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

/** The month (YYYY-MM) a date belongs to. */
export function monthKeyOf(value) {
  return dateKey(value).slice(0, 7);
}

/**
 * The monthly matrix: one row per employee, one cell per day of the month.
 *
 * Each cell carries that day's total output for the employee (summed across the
 * processes they ran), and the row carries the month-end summary the brief asks
 * for:
 *
 *   totalOutput      the month's pieces ("achieved")
 *   activeDays       days with any output — the "present days"
 *   workingHours     the month's productive hours ("active hours")
 *   totalTarget      the month's target (the day targets added up)
 *   totalDefects     the month's defects
 *   efficiency       achieved against target, as a percentage
 *
 * A month is chosen by `monthKey` ('2026-10'); every day 1–31 is a column whether
 * or not it has data, so the grid is the same shape every month.
 *
 * A DATE RANGE may be given as well, which narrows every figure to `from`..`to`
 * (inclusive). The grid keeps all 31 columns — a partial month is still a month
 * grid — but a day outside the range contributes nothing, so the row totals answer
 * "what did this person do between these two dates" without the caller having to
 * pre-filter the rows and risk the grid and the totals disagreeing.
 *
 * @param {Array}  rows      hourly-timesheet rows
 * @param {string} monthKey  'YYYY-MM'
 * @param {object} range     { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }
 */
export function aggregateMonthly(rows = [], monthKey, range = {}) {
  const month = monthKey || monthKeyOf(new Date().toISOString());
  const dayCount = daysInMonth(month);
  const from = range?.from ? dateKey(range.from) : '';
  const to = range?.to ? dateKey(range.to) : '';
  const byEmployee = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    const day = dateKey(row.date);
    if (!day || monthKeyOf(day) !== month) return;
    // The range filter is applied to the DATE, so a row outside it never reaches
    // the grid or the totals — one place, so the two cannot disagree.
    if (from && day < from) return;
    if (to && day > to) return;
    const dayNumber = Number(day.slice(8, 10));
    if (!dayNumber || dayNumber > dayCount) return;

    const employee = String(row.employee || '').trim() || '—';
    if (!byEmployee.has(employee)) {
      byEmployee.set(employee, {
        employee,
        days: Array.from({ length: dayCount }, () => 0),
        dayTargets: Array.from({ length: dayCount }, () => 0),
        dayHours: Array.from({ length: dayCount }, () => 0),
        dayDefects: Array.from({ length: dayCount }, () => 0),
        // The per-day, per-process targets already counted, so a process recorded
        // at two hours does not add its target twice — while two DIFFERENT
        // processes on the same day each contribute their own, which is what makes
        // the day's target the sum the daily sheet shows.
        countedTargets: Array.from({ length: dayCount }, () => new Set()),
        // The per-day DETAIL behind the flat `days` figure — the department the
        // person worked in, their attendance, and the process-by-process
        // itemisation. `days` stays the single source for the cell's number; this
        // is the same work described in full, for the cell's rich content and the
        // day-breakdown modal. Built in the same pass so the two cannot disagree.
        dayDetails: Array.from({ length: dayCount }, () => null),
        totalOutput: 0,
        totalDefects: 0,
        totalTarget: 0,
        workingHours: 0,
        activeDays: 0,
        processCount: 0,
      });
    }
    const entry = byEmployee.get(employee);
    const i = dayNumber - 1;
    const output = rowOutput(row);
    const defects = rowDefects(row);
    entry.days[i] += output;
    entry.dayDefects[i] += defects;
    const hours = rowWorkingHours(row);
    entry.dayHours[i] = Math.max(entry.dayHours[i], hours);
    // One contribution per process per day: the day's target is the sum of the
    // processes worked, each at its own rate over the hours worked.
    const process = String(row.process || row.operation || '').trim().toLowerCase();
    let processTarget = 0;
    if (process && !entry.countedTargets[i].has(process)) {
      entry.countedTargets[i].add(process);
      processTarget = rowHourlyTarget(row) * (hours || 0);
      entry.dayTargets[i] += processTarget;
    } else if (!process) {
      processTarget = rowHourlyTarget(row) * (hours || 0);
      entry.dayTargets[i] += processTarget;
    }

    // ---- The same work, described in full for this day ----
    if (!entry.dayDetails[i]) {
      entry.dayDetails[i] = {
        date: day,
        dayNumber,
        // Department / section and attendance are read from the row, tolerating
        // the several spellings a stored entry may use. They describe the PERSON
        // on that day, so the first non-empty value wins rather than the last.
        department: '',
        attendance: '',
        line: '',
        order_no: '',
        style: '',
        processes: [],
        processIndex: new Map(),
        hours: 0,
        defects: 0,
      };
    }
    const detail = entry.dayDetails[i];
    detail.hours = Math.max(detail.hours, hours);
    detail.defects += defects;
    if (!detail.department) {
      detail.department = String(
        row.department || row.section || row.dept || '',
      ).trim();
    }
    if (!detail.attendance) {
      detail.attendance = String(
        row.attendance || row.attendanceStatus || row.status || row.presence || '',
      ).trim();
    }
    if (!detail.line) detail.line = String(row.line_no || row.line || '').trim();
    if (!detail.order_no) detail.order_no = String(row.order_no || '').trim();
    if (!detail.style) detail.style = String(row.style || '').trim();

    // One itemised entry per process, so a process recorded at 10:00 and again at
    // 15:00 reads as ONE process with a combined output — matching how the daily
    // sheet groups the same work.
    const processName = String(row.process || row.operation || '').trim() || 'Unspecified process';
    const processKey = processName.toLowerCase();
    let item = detail.processIndex.get(processKey);
    if (!item) {
      item = {
        process: processName,
        output: 0,
        defects: 0,
        target: 0,
        hours: 0,
        style: String(row.style || '').trim(),
      };
      detail.processIndex.set(processKey, item);
      detail.processes.push(item);
    }
    item.output += output;
    item.defects += defects;
    item.target += processTarget;
    item.hours = Math.max(item.hours, hours);
    if (!item.style && row.style) item.style = String(row.style).trim();

    entry.totalOutput += output;
    entry.totalDefects += defects;
    entry.processCount += 1;
  });

  return [...byEmployee.values()]
    .map((entry) => {
      entry.activeDays = entry.days.filter((v) => v > 0).length;
      entry.totalTarget = entry.dayTargets.reduce((s, v) => s + v, 0);
      entry.workingHours = entry.dayHours.reduce((s, v) => s + v, 0);
      entry.efficiency = entry.totalTarget > 0
        ? round1((entry.totalOutput / entry.totalTarget) * 100)
        : 0;
      // The month-end variance, in the same words the daily sheet uses, so a
      // reader is not translating between two vocabularies for one figure.
      entry.variance = entry.totalOutput - entry.totalTarget;
      entry.varianceLabel = varianceText(entry.variance);
      entry.varianceTone = varianceTone(entry.variance);
      // "Present days" is the brief's name for the days that carry output; the two
      // keys are the same number so a caller can read whichever it was written for.
      entry.presentDays = entry.activeDays;
      // The tracking set is an implementation detail of the loop above; it is not
      // part of the row a screen renders, so it is dropped here.
      delete entry.countedTargets;
      // The per-day detail becomes one finished object per day, each carrying its
      // own totals, computed from the SAME numbers `days`/`dayTargets` hold so a
      // cell and its modal can never describe the day differently.
      entry.dayDetails = entry.dayDetails.map((detail, idx) => (
        detail ? finishDayDetail(detail, entry.days[idx], entry.dayTargets[idx], entry.dayHours[idx]) : null
      ));
      return entry;
    })
    .sort((a, b) => b.totalOutput - a.totalOutput);
}

/**
 * Finishes one day's detail: the per-process itemisation plus the day's own
 * cumulative totals, in the exact wording the matrix cell and its modal show.
 *
 * Kept here rather than in the component so the modal, the cell and any export
 * all read one shape. The day totals are passed IN from the flat arrays rather
 * than re-summed from the process items, which is what guarantees the cell's
 * number and the modal's "Total Daily Output" are the same figure.
 */
function finishDayDetail(detail, dayOutput, dayTarget, dayHours) {
  const processes = detail.processes
    .map((p) => {
      const target = Math.round(p.target);
      return {
        process: p.process,
        style: p.style,
        output: p.output,
        defects: p.defects,
        target,
        hours: p.hours,
        // The process's own achievement — output against its own target, which is
        // the figure the brief asks each process row to carry.
        achievement: target > 0 ? round1((p.output / target) * 100) : 0,
      };
    })
    .sort((a, b) => b.output - a.output);

  const output = num(dayOutput);
  const target = Math.round(num(dayTarget));
  const variance = output - target;
  const efficiency = target > 0 ? round1((output / target) * 100) : 0;

  return {
    date: detail.date,
    dayNumber: detail.dayNumber,
    department: detail.department,
    attendance: detail.attendance,
    line: detail.line,
    order_no: detail.order_no,
    style: detail.style,
    processes,
    processCount: processes.length,
    hours: num(dayHours),
    defects: detail.defects,
    // ---- The day's cumulative totals ----
    totalOutput: output,
    totalTarget: target,
    // The shortfall, stated as a positive "Due" figure — and never negative, so a
    // day that beat its target reads 0 Due with the surplus shown separately.
    due: Math.max(0, -variance),
    surplus: Math.max(0, variance),
    variance,
    varianceLabel: varianceText(variance),
    varianceTone: varianceTone(variance),
    efficiency,
    // The colour band the brief specifies: green ≥100%, yellow 80–99%, red <80%.
    tone: efficiencyTone(efficiency),
  };
}

/**
 * The brief's day-efficiency colour bands: 🟢 ≥100%, 🟡 80–99%, 🔴 <80%.
 *
 * Returned as a word so the screen maps it to its own classes and an export can
 * map it to its own colours without re-deciding the thresholds.
 */
export function efficiencyTone(efficiency) {
  const n = num(efficiency);
  if (n >= 100) return 'good';
  if (n >= 80) return 'warning';
  return 'critical';
}

/**
 * The month's own totals, summed from the per-employee rows.
 *
 * Kept beside `aggregateMonthly` so the footer, the KPI strip and the export all
 * read one function rather than three copies of the same reduce.
 */
export function summariseMonth(monthRows = []) {
  const list = Array.isArray(monthRows) ? monthRows : [];
  const totals = list.reduce((acc, r) => ({
    output: acc.output + (Number(r.totalOutput) || 0),
    target: acc.target + (Number(r.totalTarget) || 0),
    defects: acc.defects + (Number(r.totalDefects) || 0),
    hours: acc.hours + (Number(r.workingHours) || 0),
    presentDays: acc.presentDays + (Number(r.activeDays) || 0),
    employees: acc.employees + 1,
  }), { output: 0, target: 0, defects: 0, hours: 0, presentDays: 0, employees: 0 });

  const sharedOrderTarget = Number(monthRows?.orderTargetTotal);
  const target = Number.isFinite(sharedOrderTarget) ? sharedOrderTarget : totals.target;
  return {
    ...totals,
    target,
    efficiency: target > 0 ? round1((totals.output / target) * 100) : 0,
    variance: totals.output - target,
  };
}

/**
 * Replaces the matrix's legacy per-process target totals with the shared
 * order-schedule Monthly Target used by Master Buyer & Order Summary.
 *
 * An order target is split across its employees in proportion to each employee's
 * output for that order during the selected month. Consequently the employee-row
 * targets sum exactly to the same monthly target shown for that order in the
 * Master Buyer table. A partial date range scales the target by its calendar-day
 * share of the month; the full-month view uses the exact order target unchanged.
 * The returned array also carries `orderTargetTotal` and `orderTargets` metadata,
 * which the matrix summary card and footer use for the same exact total.
 */
export function applyOrderMonthlyTargets(monthRows = [], hourlyRows = [], orders = [], monthKey, range = {}, processSheets = []) {
  const employees = Array.isArray(monthRows) ? monthRows : [];
  const productionRows = Array.isArray(hourlyRows) ? hourlyRows : [];
  const orderMaster = Array.isArray(orders) ? orders : [];
  const selectedMonth = String(monthKey || '');
  const monthDays = daysInMonth(selectedMonth);
  if (!monthDays) return employees;

  const from = range?.from ? dateKey(range.from) : `${selectedMonth}-01`;
  const to = range?.to ? dateKey(range.to) : `${selectedMonth}-${String(monthDays).padStart(2, '0')}`;
  const safeFrom = from < `${selectedMonth}-01` ? `${selectedMonth}-01` : from;
  const monthEnd = `${selectedMonth}-${String(monthDays).padStart(2, '0')}`;
  const safeTo = to > monthEnd ? monthEnd : to;
  const selectedDays = safeFrom <= safeTo
    ? Math.floor((Date.parse(`${safeTo}T00:00:00Z`) - Date.parse(`${safeFrom}T00:00:00Z`)) / 86400000) + 1
    : 0;
  const monthWorkingDays = workingDaysInMonth(`${selectedMonth}-01`);
  // Prorate a partial date range using the same standardized workday calendar as
  // the order's daily target. (The range control is calendar-date based; without
  // an individual holiday calendar its share is the corresponding month fraction.)
  const selectedWorkingDays = monthDays > 0
    ? selectedDays * monthWorkingDays / monthDays
    : 0;
  const rangeFactor = monthWorkingDays > 0
    ? Math.min(1, selectedWorkingDays / monthWorkingDays)
    : 0;

  // The same summariseOrders path owns PO duration/quantity math. The first day
  // of the chosen month selects that month for its target calendar, but target
  // calculation itself depends only on master dates and PO quantity.
  const orderSummaries = summariseOrders(productionRows, orderMaster, `${selectedMonth}-01`, processSheets);
  const orderTargets = orderSummaries
    .reduce((map, order) => map.set(order.key, order.monthTarget * rangeFactor), new Map());
  // Keep historical hourly-rate targets for datasets with no resolvable order
  // records; once order master records exist, the shared PO target is authoritative.
  if (orderTargets.size === 0) return employees;

  const masterKeys = new Map();
  orderMaster.forEach((order) => {
    const key = String(order.order_no || order.orderNo || order.style || '').trim();
    const alias = String(order.style || '').trim();
    if (key) masterKeys.set(key, key);
    if (alias) masterKeys.set(alias, key || alias);
  });

  const outputByOrderEmployee = new Map();
  productionRows.forEach((row) => {
    const rowDate = dateKey(row?.date);
    if (!rowDate || monthKeyOf(rowDate) !== selectedMonth || rowDate < safeFrom || rowDate > safeTo) return;
    const rawKey = String(row.order_no || row.style || '').trim();
    const key = masterKeys.get(rawKey) || rawKey;
    const employee = String(row.employee || '').trim() || '—';
    if (!key) return;
    if (!outputByOrderEmployee.has(key)) outputByOrderEmployee.set(key, new Map());
    const byEmployee = outputByOrderEmployee.get(key);
    byEmployee.set(employee, (byEmployee.get(employee) || 0) + rowOutput(row));
  });

  const shareByEmployee = new Map();
  orderTargets.forEach((target, key) => {
    const canonicalKey = masterKeys.get(String(key)) || String(key);
    const shares = outputByOrderEmployee.get(canonicalKey) || new Map();
    const outputTotal = [...shares.values()].reduce((sum, value) => sum + value, 0);
    const participantCount = shares.size;
    shares.forEach((output, employee) => {
      const share = outputTotal > 0 ? output / outputTotal : 1 / (participantCount || 1);
      shareByEmployee.set(employee, (shareByEmployee.get(employee) || 0) + target * share);
    });
  });

  const adjustedEmployees = employees.map((employeeRow) => {
    const target = shareByEmployee.get(employeeRow.employee) || 0;
    const output = Number(employeeRow.totalOutput) || 0;
    const legacyTarget = Number(employeeRow.totalTarget) || 0;
    const dayOutputs = employeeRow.days || [];
    const dayOutputTotal = dayOutputs.reduce((sum, dayOutput) => sum + (Number(dayOutput) || 0), 0);
    const activeDayCount = dayOutputs.filter((dayOutput) => Number(dayOutput) > 0).length;
    const dayTargets = legacyTarget > 0
      ? (employeeRow.dayTargets || []).map((dayTarget) => dayTarget * (target / legacyTarget))
      : dayOutputs.map((dayOutput) => (dayOutputTotal > 0
        ? target * (Number(dayOutput) || 0) / dayOutputTotal
        : (Number(dayOutput) > 0 ? target / (activeDayCount || 1) : 0)));
    const dayDetails = (employeeRow.dayDetails || []).map((detail, index) => {
      if (!detail) return detail;
      const detailTarget = dayTargets[index] || 0;
      const legacyDetailTarget = Number(detail.totalTarget) || 0;
      const processOutputTotal = (detail.processes || []).reduce((sum, process) => sum + (Number(process.output) || 0), 0);
      const processes = (detail.processes || []).map((process) => {
        const processShare = processOutputTotal > 0
          ? (Number(process.output) || 0) / processOutputTotal
          : 1 / Math.max(1, detail.processes?.length || 0);
        const processTarget = legacyDetailTarget > 0
          ? Number(process.target) * (detailTarget / legacyDetailTarget)
          : detailTarget * processShare;
        return {
          ...process,
          target: processTarget,
          achievement: processTarget > 0 ? round1((Number(process.output) / processTarget) * 100) : 0,
        };
      });
      const detailOutput = Number(detail.totalOutput) || 0;
      const variance = detailOutput - detailTarget;
      return {
        ...detail,
        processes,
        totalTarget: detailTarget,
        due: Math.max(0, -variance),
        surplus: Math.max(0, variance),
        variance,
        varianceLabel: varianceText(variance),
        varianceTone: varianceTone(variance),
        efficiency: detailTarget > 0 ? round1((detailOutput / detailTarget) * 100) : 0,
        tone: efficiencyTone(detailTarget > 0 ? (detailOutput / detailTarget) * 100 : 0),
      };
    });
    const variance = output - target;
    return {
      ...employeeRow,
      dayTargets,
      dayDetails,
      totalTarget: target,
      efficiency: target > 0 ? round1((output / target) * 100) : 0,
      variance,
      varianceLabel: varianceText(variance),
      varianceTone: varianceTone(variance),
    };
  });
  const orderTargetTotal = [...orderTargets.values()].reduce((sum, target) => sum + target, 0);
  return Object.assign(adjustedEmployees, { orderTargetTotal, orderTargets });
}

/**
 * A shared order schedule target lookup for consumers that need one order's exact
 * monthly target. Delegates to the Master Buyer & Order Summary calculation.
 */
export function monthlyTargetForOrder(rows, orders, date, orderKey, processSheets = []) {
  return summariseOrders(rows, orders, date, processSheets)
    .find((order) => String(order.key) === String(orderKey))?.monthTarget || 0;
}

/**
 * The overall summary dashboard figures.
 *
 * This is the third tab of the Daily Production page: the factory-wide picture for
 * one day, read straight from the same hourly rows.
 *
 *   completedPieces   total output across every employee and process
 *   defects           total defects recorded
 *   target            the day's total target (process rates over hours worked)
 *   achievement       completed pieces against target, as a percentage
 *   byProcess         completed pieces and target per process, for the breakdown
 *   byEmployee        output per employee, ranked
 *   activeEmployees   how many people recorded work
 *   qc                the day's inspection figures, from `quality-control`
 *
 * `qcRows` is passed in separately rather than folded into `rows`, because a QC
 * check is an inspection and not output — see `summariseQcDay`. The summary screen
 * therefore reads BOTH collections the unified entry form writes to, so a check
 * saved on the entry tab shows up here without a reload, while the production
 * totals stay honest.
 */
export function summariseDay(rows = [], date, qcRows = []) {
  const daily = aggregateDaily(rows, date);
  const completedPieces = daily.reduce((s, r) => s + r.output, 0);
  const defects = daily.reduce((s, r) => s + r.defects, 0);
  const target = daily.reduce((s, r) => s + r.dailyTarget, 0);
  const good = Math.max(0, completedPieces - defects);

  const processMap = new Map();
  const employeeMap = new Map();
  daily.forEach((row) => {
    const p = processMap.get(row.process) || { process: row.process, output: 0, defects: 0, target: 0 };
    p.output += row.output;
    p.defects += row.defects;
    p.target += row.dailyTarget;
    processMap.set(row.process, p);

    const e = employeeMap.get(row.employee) || { employee: row.employee, output: 0, defects: 0 };
    e.output += row.output;
    e.defects += row.defects;
    employeeMap.set(row.employee, e);
  });

  const byProcess = [...processMap.values()]
    .map((p) => ({ ...p, achievement: p.target > 0 ? round1((p.output / p.target) * 100) : 0 }))
    .sort((a, b) => b.output - a.output);

  const byEmployee = [...employeeMap.values()]
    .map((e) => ({ ...e, good: Math.max(0, e.output - e.defects) }))
    .sort((a, b) => b.output - a.output);

  return {
    date: dateKey(date),
    completedPieces,
    defects,
    good,
    target,
    achievement: target > 0 ? round1((completedPieces / target) * 100) : 0,
    activeEmployees: byEmployee.length,
    activeProcesses: byProcess.length,
    byProcess,
    byEmployee,
    topPerformer: byEmployee[0] || null,
    daily,
    // The day's inspection picture, kept apart from the production totals.
    qc: summariseQcDay(qcRows, date),
  };
}

/**
 * The QC inspection figures for one day.
 *
 * A QC Product Check is recorded through the SAME unified entry form as production
 * (see `config/hourlyEntryMode`), but it is written to its own `quality-control`
 * collection and deliberately kept OUT of the output aggregators — an inspection
 * counts pieces CHECKED, not pieces MADE, so folding it into output would inflate
 * every production figure the factory reads.
 *
 * That separation is right for the output figures and wrong for the Overall
 * Summary, which the brief wants to show the day's QC picture on as well. So the
 * QC side is summarised here, from its own collection, and surfaced as its own
 * card rather than being mixed into the production totals.
 *
 * Reads the fields the Quality Control screen already stores (`checked`,
 * `defect_qty`) and the fuller breakdown the unified form adds (`ok_pcs`,
 * `alter_pcs`, `defect_pcs`), so a check logged by either screen is counted.
 */
export function summariseQcDay(qcRows = [], date) {
  const day = dateKey(date);
  const rows = (Array.isArray(qcRows) ? qcRows : [])
    .filter((row) => row && dateKey(row.date) === day);

  const totals = rows.reduce((acc, row) => {
    const ok = num(row.ok_pcs);
    const alter = num(row.alter_pcs);
    const defect = num(row.defect_pcs) || num(row.defect_qty);
    // `checked` is the stored total from the Quality Control screen. When the
    // breakdown is present it is authoritative; when it is not, the stored total
    // is used so an older row is still counted.
    const checked = num(row.total_checked) || num(row.checked) || (ok + alter + defect);
    return {
      checks: acc.checks + 1,
      checked: acc.checked + checked,
      ok: acc.ok + ok,
      alter: acc.alter + alter,
      defect: acc.defect + defect,
    };
  }, { checks: 0, checked: 0, ok: 0, alter: 0, defect: 0 });

  return {
    ...totals,
    // Pass rate is the OK share of everything checked — the figure a QC report
    // ranks by. Zero-safe, so a half-filled check never shows "NaN%".
    passRate: totals.checked > 0 ? round1((totals.ok / totals.checked) * 100) : 0,
    alterRate: totals.checked > 0 ? round1((totals.alter / totals.checked) * 100) : 0,
    defectRate: totals.checked > 0 ? round1((totals.defect / totals.checked) * 100) : 0,
  };
}

/**
 * The headline figures the Daily Production page shows above its tabs.
 *
 * Deliberately the same numbers `summariseDay` computes, so the header of the page
 * and its third tab can never disagree.
 */
export function dayHeadline(rows = [], date) {
  const summary = summariseDay(rows, date);
  return {
    pieces: summary.completedPieces,
    defects: summary.defects,
    target: summary.target,
    achievement: summary.achievement,
    employees: summary.activeEmployees,
  };
}

/** The standard shift slots, re-exported so a screen never re-imports two modules. */
export { SHIFT_HOURS };// =============================================================================
// OPERATOR PERFORMANCE
// =============================================================================
//
// The Operator Performance screen is a THIRD view of the same hourly rows: where
// the Daily sheet answers "what did the floor make today", this answers "who made
// it, and how efficiently". Because it reads the same rows through the same
// helpers, the two screens can never disagree about an operator's output.

/**
 * One operator's figures for a day.
 *
 * Output is the pieces they recorded, target is the process rate over the hours
 * they worked, and efficiency is output against that target — the same arithmetic
 * the Daily sheet uses, so an operator's efficiency is the same number on both
 * screens.
 */
export function operatorDayRows(rows = [], date) {
  const daily = aggregateDaily(rows, date);
  const byEmployee = new Map();

  daily.forEach((row) => {
    const employee = row.employee;
    if (!byEmployee.has(employee)) {
      byEmployee.set(employee, {
        employee,
        date: row.date,
        line: row.line || '',
        processes: [],
        output: 0,
        defects: 0,
        good: 0,
        target: 0,
        workingHours: 0,
      });
    }
    const entry = byEmployee.get(employee);
    entry.processes.push({
      process: row.process,
      style: row.style,
      output: row.output,
      defects: row.defects,
      good: row.good,
      target: row.dailyTarget,
      variance: row.variance,
      efficiency: row.efficiency,
    });
    entry.output += row.output;
    entry.defects += row.defects;
    entry.good += row.good;
    entry.target += row.dailyTarget;
    entry.workingHours = Math.max(entry.workingHours, row.workingHours);
    if (!entry.line && row.line) entry.line = row.line;
  });

  return [...byEmployee.values()]
    .map((entry) => ({
      ...entry,
      variance: entry.output - entry.target,
      efficiency: entry.target > 0 ? round1((entry.output / entry.target) * 100) : 0,
    }))
    .sort((a, b) => b.output - a.output);
}

/**
 * Operator efficiency as the brief defines it:
 *
 *   (Produced Pieces × SMV) / Active Working Minutes
 *
 * This is the standard garments efficiency formula and it differs from the
 * target-based percentage above in one important way: it needs no agreed target at
 * all, only the operation's SMV and the minutes the operator actually worked. That
 * makes it the fairer measure when a target has not been set, and the one the
 * industry quotes.
 *
 * `smvMinutes` is the operation's SMV in minutes; `activeMinutes` is the operator's
 * productive time (the day's hours × 60). A zero denominator reports 0 rather than
 * an infinite percentage.
 *
 * The result is a fraction of 1 (0.85 = 85%), matching the formula as written;
 * `operatorEfficiencyPercent` states the same figure as a percentage.
 */
export function operatorEfficiency({ producedPieces = 0, smvMinutes = 0, activeMinutes = 0 } = {}) {
  const pieces = num(producedPieces);
  const smv = num(smvMinutes);
  const minutes = num(activeMinutes);
  if (minutes <= 0 || smv <= 0) return 0;
  return Math.round(((pieces * smv) / minutes) * 10000) / 10000;
}

/** The same efficiency, stated as a percentage (0.85 → 85). */
export function operatorEfficiencyPercent(input) {
  return round1(operatorEfficiency(input) * 100);
}

/**
 * Per-operator efficiency rows, using the SMV-based formula.
 *
 * `smvByProcess` maps a process name to its SMV in minutes, which the caller reads
 * from the style's uploaded process sheet. An operator who worked several processes
 * gets the SUM of (pieces × SMV) across them, over their total active minutes —
 * which is the correct way to combine operations: the minutes allowed add up, and
 * so does the work done.
 */
export function operatorEfficiencyRows(rows = [], date, smvByProcess = {}) {
  const daily = aggregateDaily(rows, date);
  const byEmployee = new Map();

  daily.forEach((row) => {
    const employee = row.employee;
    if (!byEmployee.has(employee)) {
      byEmployee.set(employee, {
        employee,
        line: row.line || '',
        processes: [],
        producedPieces: 0,
        allowedMinutes: 0,
        // The operator's DAY, not a per-process figure. Two process lines for the
        // same person are the same working day, so this is the maximum of their
        // hours — summing them would count the same minutes twice and halve the
        // efficiency of anyone who ran more than one operation.
        activeMinutes: 0,
        defects: 0,
      });
    }
    const entry = byEmployee.get(employee);
    const smv = num(smvByProcess[row.process]) || 0;
    const minutes = (row.workingHours || 0) * 60;
    entry.producedPieces += row.output;
    entry.defects += row.defects;
    entry.allowedMinutes += row.output * smv;
    entry.activeMinutes = Math.max(entry.activeMinutes, minutes);
    entry.processes.push({
      process: row.process,
      output: row.output,
      smv,
      allowedMinutes: Math.round(row.output * smv),
      minutes,
    });
    if (!entry.line && row.line) entry.line = row.line;
  });

  return [...byEmployee.values()]
    .map((entry) => ({
      ...entry,
      allowedMinutes: Math.round(entry.allowedMinutes),
      activeMinutes: Math.round(entry.activeMinutes),
      efficiency: operatorEfficiencyPercent({
        producedPieces: entry.producedPieces,
        smvMinutes: entry.allowedMinutes / (entry.producedPieces || 1),
        activeMinutes: entry.activeMinutes,
      }),
    }))
    .sort((a, b) => b.efficiency - a.efficiency);
}

/** The average efficiency across a set of operator rows (0 when there are none). */
export function averageEfficiency(operatorRows = []) {
  const list = (Array.isArray(operatorRows) ? operatorRows : []).filter((r) => r.efficiency > 0);
  if (list.length === 0) return 0;
  return round1(list.reduce((s, r) => s + r.efficiency, 0) / list.length);
}// =============================================================================
// MASTER BUYER & ORDER SUMMARY
// =============================================================================
//
// The Overall Summary tab's second half. Where `summariseDay` answers "what did
// the floor make today", this answers "how is each ORDER tracking" — the master
// table a merchandiser reads against the buyers' POs.
//
// ORDER NO DRIVES EVERYTHING
// --------------------------
// The selected Order No on an hourly entry is the thread that ties a row of
// production back to its order. So the summary is keyed on the ORDER, and every
// figure on a line is derived from two places and never typed twice:
//
//   * the ORDER MASTER (`order-model`) supplies the static facts — Buyer, Style
//     No, PO Qty, Floor, Line, Supervisor;
//   * the HOURLY ROWS supply the movement — output, defects, manpower.
//
// Because both the daily and the monthly figures are computed from the SAME
// hourly rows the rest of the page reads, the master table can never disagree
// with the KPI cards above it or the detail sheets behind them.
//
// WHAT EACH LINE SHOWS (the brief's list)
// ---------------------------------------
//   Active Employees / Manpower on that order for the selected date
//   PO Qty vs Cumulative Output progress
//   Daily Target vs Daily Output & Daily Achievement %
//   Monthly Target vs Monthly Output & Monthly Achievement %
//   Variance / Remaining Balance (Due)
//
// Two time windows are in play, and they are deliberately different:
//   * DAILY figures are for the SELECTED date (the day the user is looking at);
//   * MONTHLY figures are for the whole month that date falls in, so a line
//     shows where the order stands within the month as well as today.

/** The pieces one row contributed, summed across every hour it recorded. */
function orderRowOutput(row) {
  return rowOutput(row);
}

/**
 * Calendar months in the inclusive schedule interval from start through delivery.
 *
 * Counts complete anniversary-to-anniversary months, then prorates the remaining
 * days against the length of the next calendar month. Invalid or reversed dates
 * have no duration and therefore produce no derived target.
 */
export function orderDurationMonths(startDate, deliveryDate) {
  const start = dateKey(startDate);
  const end = dateKey(deliveryDate);
  if (!start || !end || end < start) return 0;

  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  let wholeMonths = (endYear - startYear) * 12 + (endMonth - startMonth);
  const addMonths = (count) => {
    const monthIndex = startYear * 12 + (startMonth - 1) + count;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Date.UTC(year, month - 1, Math.min(startDay, lastDay));
  };
  const endMs = Date.UTC(endYear, endMonth - 1, endDay);
  let anniversary = addMonths(wholeMonths);
  if (anniversary > endMs) {
    wholeMonths -= 1;
    anniversary = addMonths(wholeMonths);
  }
  const nextAnniversary = addMonths(wholeMonths + 1);
  const remainder = Math.max(0, Math.min(1, (endMs - anniversary) / (nextAnniversary - anniversary)));
  // A schedule shorter than a calendar month still has one monthly target period.
  return Math.max(1, wholeMonths + remainder);
}

/** Working days for the calendar month, using the factory's standard holiday rule. */
export function workingDaysInMonth(date) {
  const key = dateKey(date);
  if (!key) return 0;
  const days = daysInCalendarMonth(key);
  return ({ 31: 25, 30: 24, 29: 23, 28: 22 })[days] || 0;
}

/** Number of days in the Gregorian calendar month containing a YYYY-MM-DD date. */
function daysInCalendarMonth(date) {
  const [year, month] = String(date || '').slice(0, 7).split('-').map(Number);
  if (!year || !month) return 0;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Every order that has any production on the given rows, with its master record
 * attached and its daily / monthly / cumulative figures rolled up.
 *
 * An order is included when it has production in the selected MONTH — the table
 * is a month-to-date master view, so an order that ran earlier in the month but
 * not today still appears (with a zero daily figure), rather than vanishing the
 * moment it pauses. `dailyOutput` is what tells the reader whether it ran today.
 *
 * @param {Array}  rows    hourly-timesheet rows
 * @param {Array}  orders  order-model records (the master)
 * @param {string} date    the selected day (YYYY-MM-DD); its month sets the window
 */
export function summariseOrders(rows = [], orders = [], date, processSheets = []) {
  const day = dateKey(date);
  const month = monthKeyOf(day);
  const list = Array.isArray(rows) ? rows : [];
  const sheets = Array.isArray(processSheets) ? processSheets : [];

  // Index the order master by both keys a production row may carry, so a row
  // saved against a style OR an order number resolves to the same order.
  const byStyle = new Map();
  const byOrderNo = new Map();
  (Array.isArray(orders) ? orders : []).forEach((o) => {
    if (!o) return;
    const style = String(o.style || '').trim();
    const orderNo = String(o.order_no || o.orderNo || '').trim();
    if (style) byStyle.set(style, o);
    if (orderNo) byOrderNo.set(orderNo, o);
  });

  const groups = new Map();

  list.forEach((row) => {
    if (!row) return;
    const rowDay = dateKey(row.date);
    if (!rowDay || monthKeyOf(rowDay) !== month) return;

    const orderNo = String(row.order_no || '').trim();
    const style = String(row.style || '').trim();
    // The grouping key prefers the order number (the brief's "selected Order No")
    // and falls back to the style, so a row missing one still lands on its order.
    const key = orderNo || style;
    if (!key) return;

    if (!groups.has(key)) {
      const master = byOrderNo.get(orderNo) || byStyle.get(style) || null;
      groups.set(key, {
        key,
        order_no: orderNo || (master ? (master.order_no || master.orderNo || '') : ''),
        style: style || (master ? master.style : '') || '',
        buyer: (master && master.buyer) || '',
        item: (master && master.item) || '',
        floor: (master && master.floor) || '',
        line: (master && (master.line_no || master.line)) || '',
        supervisor: (master && master.supervisor) || '',
        poQty: master ? num(master.qty) : 0,
        // Order-level designation wins; otherwise use the process sheet's explicit
        // output designation, then its final operation in sequence. If no process
        // sheet exists, the order's last observed process (by latest production date)
        // is used below as a fallback.
        outputProcess: (() => {
          const sheet = [...sheets].filter((s) => (
            (style && String(s.style || '') === style)
            || (orderNo && String(s.order_no || '') === orderNo)
          )).sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))[0];
          const operations = Array.isArray(sheet?.operations) ? sheet.operations : [];
          const markedOperation = operations.find((op) => op?.lineOutput && String(op.operation || '').trim())?.operation;
          return String(
            master?.outputProcess || master?.output_process || master?.lineOutputProcess || master?.line_output_process
            || master?.output_process_name || master?.outputProcessName
            || sheet?.lineOutputProcess || sheet?.line_output_process || markedOperation
            || '',
          ).trim();
        })(),
        processSequence: (() => {
          const sheet = [...sheets].filter((s) => (
            (style && String(s.style || '') === style)
            || (orderNo && String(s.order_no || '') === orderNo)
          )).sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))[0];
          return (Array.isArray(sheet?.operations) ? sheet.operations : [])
            .map((op) => String(op?.operation || '').trim())
            .filter(Boolean);
        })(),
        outputProcessIsDesignated: (() => {
          const sheet = [...sheets].filter((s) => (
            (style && String(s.style || '') === style)
            || (orderNo && String(s.order_no || '') === orderNo)
          )).sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))[0];
          return Boolean(
            master?.outputProcess || master?.output_process || master?.lineOutputProcess || master?.line_output_process
            || master?.output_process_name || master?.outputProcessName
            || sheet?.lineOutputProcess || sheet?.line_output_process
            || (Array.isArray(sheet?.operations) && sheet.operations.some((op) => op?.lineOutput && String(op.operation || '').trim())),
          );
        })(),
        // Schedule dates from Order Input. `order_date` is the saved Start Date,
        // and `ship_date` is its Delivery Date. Keep both on the row so exports and
        // downstream views can explain the calendar-derived targets.
        startDate: master?.start_date || master?.order_date || '',
        deliveryDate: master?.ship_date || master?.delivery_date || '',
        // Daily window (the selected date).
        dailyOutput: 0,
        dailyDefects: 0,
        dailyTarget: 0,
        // Monthly window (the month the date falls in).
        monthOutput: 0,
        monthDefects: 0,
        monthTarget: 0,
        // Every employee who touched the order in the month.
        employees: new Set(),
        // Employees active on the SELECTED day, for the manpower figure.
        dayEmployees: new Set(),
        // Guards against a target being counted twice for one process/day.
        countedTargets: new Set(),
      });
    }

    const g = groups.get(key);
    const output = orderRowOutput(row);
    const defects = rowDefects(row);
    const hours = rowWorkingHours(row);
    const employee = String(row.employee || '').trim();
    const process = String(row.process || row.operation || '').trim().toLowerCase();

    // ---- Monthly roll-up ----
    g.monthOutput += output;
    g.monthDefects += defects;
    // A target is a per-hour RATE, so the day's contribution is rate × hours —
    // counted once per process/day, so two hours of the same operation do not
    // double the goal (the same rule `aggregateMonthly` follows).
    const targetKey = `${rowDay}||${process}`;
    if (process && !g.countedTargets.has(targetKey)) {
      g.countedTargets.add(targetKey);
      g.monthTarget += rowHourlyTarget(row) * (hours || 0);
    } else if (!process) {
      g.monthTarget += rowHourlyTarget(row) * (hours || 0);
    }
    if (employee) g.employees.add(employee);

    // ---- Daily roll-up (the selected date only) ----
    if (rowDay === day) {
      // Keep the daily candidate totals by process; once all rows are read, the
      // designated or final process can be selected without losing rows that were
      // encountered before the designation was known.
      g.dailyOutput += output;
      g.dailyDefects += defects;
      g._dailyByProcess = g._dailyByProcess || new Map();
      g._dailyByProcess.set(process, (g._dailyByProcess.get(process) || 0) + output);
      // The day's target reuses the same once-per-process rule, scoped to the day.
      const dayTargetKey = `d||${process}`;
      if (process && !g[`_day_${dayTargetKey}`]) {
        g[`_day_${dayTargetKey}`] = true;
        g.dailyTarget += rowHourlyTarget(row) * (hours || 0);
      } else if (!process) {
        g.dailyTarget += rowHourlyTarget(row) * (hours || 0);
      }
      if (employee) g.dayEmployees.add(employee);
    }
  });

  return [...groups.values()]
    .map((g) => {
      // The master record, so a caller can reach any field the table does not
      // itself surface (delivery date, shift) without a second lookup.
      const master = byOrderNo.get(g.order_no) || byStyle.get(g.style) || null;
      const startDate = master?.start_date || master?.order_date || g.startDate || '';
      const deliveryDate = master?.ship_date || master?.delivery_date || g.deliveryDate || '';
      const durationMonths = orderDurationMonths(startDate, deliveryDate);
      const processAmounts = g._dailyByProcess || new Map();
      const processSequence = g.processSequence || [];
      const fallbackProcessName = processSequence.slice().reverse().find(Boolean)
        || [...processAmounts.keys()].reverse().find(Boolean) || '';
      const outputProcess = g.outputProcessIsDesignated
        ? g.outputProcess
        : fallbackProcessName;
      // Match process labels case-insensitively. A designated process always wins;
      // otherwise the final process-sheet operation is the default daily output.
      const dailyOutput = outputProcess
        ? (processAmounts.get(String(outputProcess).trim().toLowerCase()) || 0)
        : g.dailyOutput;
      const hasSchedule = durationMonths > 0;
      // Older orders may predate saved schedule dates; retain their stored hourly
      // target roll-up until dates are available, rather than replacing it with zero.
      const monthTarget = hasSchedule ? g.poQty / durationMonths : g.monthTarget;
      const dailyTarget = hasSchedule && workingDaysInMonth(day) > 0
        ? monthTarget / workingDaysInMonth(day)
        : g.dailyTarget;
      const remaining = g.poQty > 0 ? Math.max(0, g.poQty - g.monthOutput) : 0;
      const poProgress = g.poQty > 0 ? round1((g.monthOutput / g.poQty) * 100) : 0;
      return {
        ...g,
        master,
        startDate,
        deliveryDate,
        durationMonths: round1(durationMonths),
        hasScheduleTarget: hasSchedule,
        outputProcess,
        dailyOutput,
        // The order's own line/floor win when the production rows did not carry
        // one, so the column is filled from the master rather than left blank.
        line: g.line || (master && (master.line_no || master.line)) || '',
        floor: g.floor || (master && master.floor) || '',
        supervisor: g.supervisor || (master && master.supervisor) || '',
        activeEmployees: g.dayEmployees.size,
        monthActiveEmployees: g.employees.size,
        // Schedule-derived targets replace the old rate × hours target for this
        // master-order view. Output and achievement are still measured from the
        // rows belonging to the order and selected calendar month/day.
        dailyTarget,
        monthTarget,
        dailyAchievement: dailyTarget > 0 ? round1((dailyOutput / dailyTarget) * 100) : 0,
        monthAchievement: monthTarget > 0 ? round1((g.monthOutput / monthTarget) * 100) : 0,
        poProgress,
        remaining,
        // "Variance / Due" against the PO, in the brief's two words: a surplus is
        // "Achieved", a shortfall is "Due". Stated once so the table and the
        // exports cannot describe the same figure two different ways.
        dueLabel: g.poQty > 0
          ? (remaining > 0 ? `${remaining.toLocaleString()} Due` : `${Math.abs(g.poQty - g.monthOutput).toLocaleString()} Achieved`)
          : '—',
      };
    })
    .sort((a, b) => (
      String(a.buyer).localeCompare(String(b.buyer))
      || String(a.order_no).localeCompare(String(b.order_no))
      || String(a.style).localeCompare(String(b.style))
    ));
}

/** Every distinct Line named on a set of order-summary rows, alphabetically. */
export function linesOf(orderRows = []) {
  const seen = new Set();
  (Array.isArray(orderRows) ? orderRows : []).forEach((r) => {
    const line = String(r.line || '').trim();
    if (line) seen.add(line);
  });
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Applies the table's two filters — a free-text search over Buyer / Order No and
 * a Line dropdown — to the order-summary rows.
 *
 * Kept here, as a pure function, so the on-screen table and the Excel / PDF
 * export filter the SAME list the SAME way: an export that quietly ignored the
 * search box would ship figures the user was not looking at.
 *
 * @param {Array}  orderRows  rows from `summariseOrders`
 * @param {object} filters    { search?: string, line?: string }
 */
export function filterOrderSummary(orderRows = [], { search = '', line = '' } = {}) {
  const q = String(search || '').trim().toLowerCase();
  const wantedLine = String(line || '').trim().toLowerCase();
  return (Array.isArray(orderRows) ? orderRows : []).filter((r) => {
    if (wantedLine && String(r.line || '').trim().toLowerCase() !== wantedLine) return false;
    if (!q) return true;
    const haystack = [r.buyer, r.order_no, r.style, r.item, r.floor, r.supervisor]
      .map((v) => String(v || '').toLowerCase())
      .join(' ');
    return haystack.includes(q);
  });
}

/**
 * The totals line under the master table, summed from the rows on screen so the
 * footer always matches whatever the filters left visible.
 */
export function summariseOrderTotals(orderRows = []) {
  const list = Array.isArray(orderRows) ? orderRows : [];
  const t = list.reduce((acc, r) => ({
    orders: acc.orders,
    poQty: acc.poQty + (Number(r.poQty) || 0),
    dailyOutput: acc.dailyOutput + (Number(r.dailyOutput) || 0),
    dailyTarget: acc.dailyTarget + (Number(r.dailyTarget) || 0),
    monthOutput: acc.monthOutput + (Number(r.monthOutput) || 0),
    monthTarget: acc.monthTarget + (Number(r.monthTarget) || 0),
    remaining: acc.remaining + (Number(r.remaining) || 0),
    activeEmployees: acc.activeEmployees + (Number(r.activeEmployees) || 0),
  }), {
    orders: list.length,
    poQty: 0, dailyOutput: 0, dailyTarget: 0,
    monthOutput: 0, monthTarget: 0, remaining: 0, activeEmployees: 0,
  });

  return {
    ...t,
    dailyAchievement: t.dailyTarget > 0 ? round1((t.dailyOutput / t.dailyTarget) * 100) : 0,
    monthAchievement: t.monthTarget > 0 ? round1((t.monthOutput / t.monthTarget) * 100) : 0,
    poProgress: t.poQty > 0 ? round1((t.monthOutput / t.poQty) * 100) : 0,
  };
}// =============================================================================
// LINE OUTPUT
// =============================================================================
//
// The "Line Output" is the one operation whose summed operator output IS the
// line's output for the day. Which operation that is can be defined two ways:
//
//   Option A  the uploaded process sheet carries a "Line Output" column, and the
//             operation it marks is recorded on the sheet (see orderWorkflow's
//             `detectLineOutputProcess`).
//   Option B  the process view/edit table's "Line Output" dropdown designates an
//             operation in the app, with no change to the file.
//
// Either way the designation lands on the sheet as `lineOutputProcess`, and the
// aggregation below is what turns it into a number: every operator's output logged
// under that process, for the day, summed.
//
// A MANUAL OVERRIDE can replace the aggregate with a typed figure. When one is in
// force the row carries `lineOutputManual: true` and the typed value, and the
// aggregate is reported alongside it rather than thrown away — so the screen can
// show both "auto 1,240" and "manual 1,300" and a reader can see what was
// overridden, not merely that it was.

/** A number from anything a stored row may hold. */
function lineNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The operators' output logged under one process on one day, summed.
 *
 * This is the auto-aggregate the brief asks for: every hourly row for the day
 * whose process matches the designated line-output process, added up. The match is
 * case- and whitespace-insensitive, because the sheet's operation name and the
 * one typed on the floor are the same operation however they were cased.
 *
 * @param {Array}  rows      hourly-timesheet rows
 * @param {string} process   the designated line-output process
 * @param {string} date      YYYY-MM-DD; omitted sums every day present
 */
export function aggregateLineOutput(rows = [], process, date) {
  const wanted = String(process || '').trim().toLowerCase();
  if (!wanted) return 0;
  const day = date ? dateKey(date) : '';
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
    if (!row) return sum;
    if (day && dateKey(row.date) !== day) return sum;
    const name = String(row.process || row.operation || '').trim().toLowerCase();
    if (name !== wanted) return sum;
    return sum + rowOutput(row);
  }, 0);
}

/**
 * The per-operator breakdown behind the line output, ranked by output.
 *
 * The brief's "automatically sum all individual operator outputs logged under
 * that process" — this is that sum, kept itemised so a manager can see WHO
 * produced the line total rather than only its figure.
 */
export function lineOutputByOperator(rows = [], process, date) {
  const wanted = String(process || '').trim().toLowerCase();
  if (!wanted) return [];
  const day = date ? dateKey(date) : '';
  const byEmployee = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    if (day && dateKey(row.date) !== day) return;
    const name = String(row.process || row.operation || '').trim().toLowerCase();
    if (name !== wanted) return;
    const employee = String(row.employee || '').trim() || '—';
    const entry = byEmployee.get(employee) || { employee, output: 0, defects: 0 };
    entry.output += rowOutput(row);
    entry.defects += rowDefects(row);
    byEmployee.set(employee, entry);
  });
  return [...byEmployee.values()].sort((a, b) => b.output - a.output);
}

/**
 * The line-output figure for a day, with any manual override applied.
 *
 * The shape every screen reads:
 *
 *   process     the designated operation, or '' when none is set
 *   autoOutput  the summed operator output (the aggregate)
 *   manual      true when a typed override is in force
 *   manualValue the typed figure, when there is one
 *   output      what to DISPLAY: the manual value when overridden, else the auto
 *
 * `hasProcess` says whether a process was designated at all, so a caller shows
 * "No line output process set" rather than a misleading zero.
 *
 * @param {Array}  rows     hourly-timesheet rows
 * @param {object} sheet    the style's latest process sheet (for the designation)
 * @param {string} date     YYYY-MM-DD
 * @param {object} override { process?, value?, manual? } — the day's stored override
 */
export function lineOutputSummary(rows = [], sheet, date, override = {}) {
  const process = String(override?.process || sheet?.lineOutputProcess || '').trim();
  const autoOutput = aggregateLineOutput(rows, process, date);
  const manual = Boolean(override?.manual) && override?.value !== undefined && override?.value !== null && override?.value !== '';
  const manualValue = manual ? lineNum(override.value) : 0;
  return {
    process,
    hasProcess: Boolean(process),
    autoOutput,
    manual,
    manualValue,
    output: manual ? manualValue : autoOutput,
    // The difference a manual override makes, so a screen can flag it.
    variance: manual ? manualValue - autoOutput : 0,
    byOperator: lineOutputByOperator(rows, process, date),
  };
}

/**
 * The stored override record for one style/day, from a collection of overrides.
 *
 * Overrides are kept in their own collection (`line-output-overrides`), keyed by
 * style + date, so a manual figure belongs to the day it was entered for rather
 * than silently applying to every future day.
 */
export function findLineOutputOverride(overrides = [], { style, date } = {}) {
  const wantedStyle = String(style || '').trim();
  const wantedDay = dateKey(date);
  return (Array.isArray(overrides) ? overrides : []).find((o) => (
    o && String(o.style || '').trim() === wantedStyle && dateKey(o.date) === wantedDay
  )) || null;
}

/** The collection manual line-output overrides are saved under. */
export const LINE_OUTPUT_OVERRIDE_COLLECTION = 'line-output-overrides';

/**
 * Builds the override record to save.
 *
 * A record with `manual: false` (a cleared override) is written too, rather than
 * deleted, so "the auto figure was restored on this day" is itself a fact the log
 * keeps — and the row the screen reads is always present.
 */
export function buildLineOutputOverride({ style, order_no, date, process, value, manual, actor, at }) {
  return {
    id: `${style || 'unassigned'}__${dateKey(date)}`,
    style: style || '',
    order_no: order_no || '',
    date: dateKey(date),
    process: String(process || '').trim(),
    value: manual ? lineNum(value) : 0,
    manual: Boolean(manual),
    updatedBy: actor || '',
    updatedAt: at || new Date().toISOString(),
  };
}
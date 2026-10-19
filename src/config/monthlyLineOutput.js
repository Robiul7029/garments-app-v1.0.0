/**
 * ROBIUL GARMENTS ERP — Total Line Output, stored month by month.
 *
 * A line entry is a DAILY fact ("this line made 1,284 pieces today") that is read
 * MONTHLY ("what did the line make this month"). Keeping one flat, ever-growing
 * collection and filtering it by date on every screen makes the month the expensive
 * question, so the brief scopes the storage: one collection per calendar month.
 *
 *     line-output-2026-10      October 2026
 *     line-output-2026-11      November 2026
 *
 * A new month is therefore a new collection with no migration, no purge job and no
 * write ever touching last month's documents — last month stays exactly as it was
 * closed. The screen reads the collection of the MONTH BEING VIEWED, so stepping
 * back through the calendar opens the right book rather than filtering one big one.
 *
 * THE RECORD
 * ----------
 * A line entry stores the ACHIEVEMENT the supervisor typed and the TARGETS that were
 * derived for it — never a typed target. `buildLineOutputRecord` is the one place
 * that shape is produced, so the form, the monthly sheet and the summary read the
 * same fields.
 *
 * THE SHARED DAILY ROW
 * --------------------
 * The same entry is ALSO written to the day-level `daily-production` collection in
 * the shape the Overall Summary and the KPI cards already aggregate (see
 * `lineOutputDailyRow`). That is what makes a line entry show up on those figures
 * immediately, without either of them learning about the monthly collections.
 * A line entry is production like any other; the only thing that makes it special
 * is that nobody was in charge of logging it per operator.
 */

import { DAY_MODE } from './hourlyEntryMode';
import { dateKey, monthKeyOf } from './productionAggregation';
import { splitValues } from './orderWorkflow';

/** The collection prefix; the calendar month is appended. */
export const LINE_OUTPUT_MONTHLY_PREFIX = 'line-output-';

/** The employee label a line entry is aggregated under when no supervisor is named. */
export const LINE_OUTPUT_LABEL = 'Total Line Output';

/**
 * The collection for one month.
 *
 * `monthKey` may be a `YYYY-MM` key, a full date, a Date or a Firestore timestamp —
 * anything `monthKeyOf` reads — so a caller never has to format the key itself.
 * An unreadable value returns '' and the caller must not write: guessing the month
 * would file a permanent record in the wrong ledger.
 */
export function monthlyCollectionFor(value) {
  const key = value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}` : monthKeyOf(value);
  if (!/^\d{4}-\d{2}$/.test(key)) return '';
  return `${LINE_OUTPUT_MONTHLY_PREFIX}${key}`;
}

/** The month key a stored monthly collection name belongs to, or ''. */
export function monthKeyOfCollection(collection) {
  const match = new RegExp(`^${LINE_OUTPUT_MONTHLY_PREFIX}(\\d{4}-\\d{2})$`).exec(String(collection || ''));
  return match ? match[1] : '';
}

/** A number from anything a box may hold. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The record saved for one line entry.
 *
 * @param {object} entry {
 *   date, order_no, style, line_no, supervisor,
 *   achievement,              the pieces the supervisor typed — the only figure
 *   hourlyTarget, dailyTarget the targets derived from the order's Process Sheet
 *   process,                  the line-output operation, when the sheet names one
 *   targetSource,             where those targets came from (see lineOutputSheet)
 *   remarks, actor
 * }
 * @returns {object} the stored row, carrying `month` so a row read back from a
 *   monthly collection still states which month it belongs to
 *
 * `achievement` is required: a line entry with no figure is not a record of
 * anything, and returning one would put a zero on the month's total.
 */
export function buildLineOutputRecord(entry = {}) {
  const date = dateKey(entry.date);
  const achievement = num(entry.achievement);
  return {
    date,
    month: monthKeyOf(date),
    // Which month's collection this row belongs in. Stored on the row as well as in
    // the collection name, so a row is still self-describing if it is ever exported.
    entry_type: 'line',
    order_no: String(entry.order_no || '').trim(),
    style: String(entry.style || '').trim(),
    line_no: String(entry.line_no || entry.line || '').trim(),
    // The supervisor who ran the line — the "Employee" field in this mode.
    supervisor: String(entry.supervisor || '').trim(),
    employee: String(entry.supervisor || '').trim() || LINE_OUTPUT_LABEL,
    process: String(entry.process || '').trim() || LINE_OUTPUT_LABEL,
    // The colours the day's output covered, as the comma-separated string the rest of
    // the app prints. Empty when none was chosen — the field is OPTIONAL, so a blank
    // is a valid record rather than a gap to be filled in later.
    color: String(entry.color || '').trim(),
    colors: splitValues(entry.color),
    // What was made. Kept under both names so a reader expecting either finds it.
    achievement,
    quantity: achievement,
    output: achievement,
    // What it was measured against — copied at save time, so a later edit to the
    // sheet cannot retroactively change a month that has already been closed.
    hourlyTarget: num(entry.hourlyTarget),
    dailyTarget: num(entry.dailyTarget),
    targetSource: String(entry.targetSource || ''),
    achievementPercent: num(entry.dailyTarget) > 0
      ? Math.round((achievement / num(entry.dailyTarget)) * 1000) / 10
      : 0,
    remarks: String(entry.remarks || '').trim(),
    createdBy: String(entry.actor || '').trim(),
    savedAt: new Date().toISOString(),
  };
}

/**
 * The same entry as a `daily-production` row, for the Overall Summary and KPIs.
 *
 * Shaped exactly like the rows `syncDailyFromHourly` derives, so every aggregator
 * reads it with no branch. The figure sits under the DAY sentinel in `hours`, which
 * is how the whole-day modes already store a day's total — and the shape
 * `rowOutput` and `aggregateDaily` already understand.
 *
 * The id is keyed on order + line + date, so re-saving a day's line entry UPDATES
 * that day's row rather than appending a second one and doubling the output.
 */
export function lineOutputDailyRow(record = {}) {
  const day = dateKey(record.date);
  const orderNo = String(record.order_no || '').trim() || 'unassigned';
  const lineNo = String(record.line_no || '').trim() || 'noline';
  const achievement = num(record.achievement ?? record.output ?? record.quantity);
  return {
    id: `line-output__${orderNo}__${lineNo}__${day}`,
    source: 'line-output',
    date: day,
    entry_type: 'line',
    employee: String(record.supervisor || '').trim() || LINE_OUTPUT_LABEL,
    supervisor: String(record.supervisor || '').trim(),
    // The line label, so the line can be recognised on the summary.
    employeeId: '',
    process: String(record.process || '').trim() || LINE_OUTPUT_LABEL,
    processes: [String(record.process || '').trim() || LINE_OUTPUT_LABEL],
    style: String(record.style || '').trim(),
    order_no: orderNo === 'unassigned' ? '' : orderNo,
    line_no: String(record.line_no || '').trim(),
    line: String(record.line_no || '').trim(),
    quantity: achievement,
    output: achievement,
    hours: { [DAY_MODE]: achievement },
    defect_qty: 0,
    hourlyTarget: num(record.hourlyTarget),
    daily_target: num(record.dailyTarget),
    dailyTarget: num(record.dailyTarget),
    working_hours: 0,
    entryIds: [],
  };
}

/**
 * The month's line entries, summed for the month's own summary card.
 *
 * @returns {{ entries, achievement, dailyTarget, achievementPercent, lines, orders }}
 */
export function summariseLineOutputMonth(records = []) {
  const rows = Array.isArray(records) ? records.filter(Boolean) : [];
  const achievement = rows.reduce((sum, r) => sum + num(r.achievement ?? r.output ?? r.quantity), 0);
  const dailyTarget = rows.reduce((sum, r) => sum + num(r.dailyTarget), 0);
  const lines = new Set(rows.map((r) => String(r.line_no || '').trim()).filter(Boolean));
  const orders = new Set(rows.map((r) => String(r.order_no || '').trim()).filter(Boolean));
  return {
    entries: rows.length,
    achievement,
    dailyTarget,
    achievementPercent: dailyTarget > 0 ? Math.round((achievement / dailyTarget) * 1000) / 10 : 0,
    lines: lines.size,
    orders: orders.size,
  };
}

/** The month's line entries for ONE day, newest first. */
export function lineOutputRowsForDate(records = [], date) {
  const day = dateKey(date);
  return (Array.isArray(records) ? records : [])
    .filter((r) => r && dateKey(r.date) === day)
    .sort((a, b) => String(a.line_no || '').localeCompare(String(b.line_no || '')));
}
/**
 * The production lines a Total Line Output entry can be booked to.
 *
 * A line is a NAME on the floor ("Line-03") but a DOCUMENT in the ERP
 * (`productionLines`, whose `lineNo` is the unique key). The form has to offer the
 * names a supervisor recognises, while the ERP needs to be able to resolve that
 * name to a document — so this helper merges every source that names a line, in
 * descending order of authority, and de-duplicates case-insensitively:
 *
 *   1. the ERP `productionLines` master   the canonical list (lineNo, then name)
 *   2. Manpower → Line Deployment         `line_no` / `line` on a directory record
 *   3. lines already booked on the floor   `line_no` on hourly rows or line entries
 *
 * The third source is what makes the screen usable on a deployment whose masters
 * are not populated yet: a line the plant actually runs is still offered, because
 * a supervisor must not be blocked by missing master data. It never overrides the
 * master — the same name is one option, not two.
 *
 * `erpId` rides along when a source knows it, so a caller that needs the foreign key
 * (the mirror, the dashboard) does not have to look the line up a second time.
 *
 * @param {object} sources {
 *   erpLines,        rows from `productionLines`
 *   directory,       Manpower → Line Deployment records
 *   productionRows   hourly rows / line entries already recorded
 * }
 * @returns {Array<{ value: string, label: string, erpId: string }>}
 */
export function lineOptionsOf({ erpLines = [], directory = [], productionRows = [] } = {}) {
  const byKey = new Map();

  const add = (name, erpId = '') => {
    const clean = String(name || '').trim();
    if (!clean) return;
    // The same key the line master uses for uniqueness, so "Line-03" and "Line 3"
    // are one option here too rather than two that both resolve to nothing.
    const key = clean.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^([a-z]+)0+(\d)/, '$1$2');
    const existing = byKey.get(key);
    if (existing) {
      // A later source never renames a line, but it may supply the id an earlier
      // one lacked.
      if (!existing.erpId && erpId) existing.erpId = erpId;
      return;
    }
    byKey.set(key, { value: clean, label: clean, erpId: erpId || '' });
  };

  // The ERP master first, so its spelling wins the de-duplication.
  (Array.isArray(erpLines) ? erpLines : []).forEach((line) => {
    if (!line) return;
    add(line.lineNo || line.name || line.line_no, line.id || '');
  });

  (Array.isArray(directory) ? directory : []).forEach((record) => {
    if (!record || typeof record !== 'object') return;
    add(record.line_no || record.line || record.lineNo);
  });

  (Array.isArray(productionRows) ? productionRows : []).forEach((row) => {
    add(row?.line_no || row?.line);
  });

  return [...byKey.values()].sort(
    (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }),
  );
}

// ============================================================
// ORDER DETAILS — joining a line row to its Master Order.
//
// A line-output row stores the ORDER NO it was booked to, and
// nothing else about the order: the buyer, the style, the product
// and the PO quantity live on the `order-model` record the Order
// Management screen maintains. Copying them onto the line row
// would be a second copy that drifts the moment somebody corrects
// the order, so they are JOINED at read time instead — the table
// always shows what the order currently says.
//
// THE JOIN IS BY ORDER NO FIRST, then by style. Both are in use
// across the app (`findOrderByStyle` matches either), and a row
// written before the order was registered may carry only a style,
// so matching on one alone would leave those rows blank.
// ============================================================

/** The label shown in a cell that has no value, so a blank never reads as "nothing exists". */
export const EMPTY_CELL = '—';

/**
 * The order a line row belongs to, or null.
 *
 * Matched on ORDER NO first — that is the key a line entry is booked to, and it is
 * unique — then on style, which is what a row recorded before the order existed will
 * carry. Comparison is case-insensitive and trims, because a hand-typed order number
 * routinely differs in case from the master record.
 */
export function findOrderForRow(row = {}, orders = []) {
  const list = Array.isArray(orders) ? orders.filter(Boolean) : [];
  if (list.length === 0) return null;

  const norm = (value) => String(value ?? '').trim().toLowerCase();
  const orderNo = norm(row.order_no ?? row.orderNo);
  const style = norm(row.style);

  if (orderNo) {
    const byOrderNo = list.find((o) => norm(o.order_no ?? o.orderNo) === orderNo);
    if (byOrderNo) return byOrderNo;
  }
  if (style) {
    const byStyle = list.find((o) => norm(o.style) === style);
    if (byStyle) return byStyle;
  }
  return null;
}

/**
 * The order detail columns for one line row, resolved from the Master Order records.
 *
 * Returns the five display values the table shows beside the order number. Every one
 * falls back to the row's OWN value before giving up: a line record may carry a style
 * (the auto rows copy it from the employee entries), and showing that is better than
 * a dash when the order itself has since been deleted or renamed.
 *
 * @returns {{ buyer, style, item, po_qty, color, order, found }}
 *   `found` says whether the join succeeded, so a caller can distinguish "the order
 *   has no buyer" from "there is no order" — the two want different tooltips.
 */
export function orderDetailsFor(row = {}, orders = []) {
  const order = findOrderForRow(row, orders);
  const pick = (key, ...aliases) => {
    if (!order) return '';
    const candidates = [key, ...aliases];
    for (let i = 0; i < candidates.length; i += 1) {
      const value = order[candidates[i]];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return '';
  };

  const poQty = pick('qty', 'po_qty', 'poQty', 'quantity');
  return {
    buyer: String(pick('buyer') || '').trim(),
    // The order form calls it "Style No"; the stored key has always been `style`.
    style: String(pick('style') || row.style || '').trim(),
    item: String(pick('item', 'product', 'product_item') || '').trim(),
    po_qty: poQty === '' ? '' : Number(poQty) || 0,
    color: String(pick('color', 'colors') || row.color || '').trim(),
    order,
    found: Boolean(order),
  };
}

/**
 * What is due on a line, in pieces.
 *
 * Two figures, because a factory asks two different questions of the same row:
 *
 *   DAILY DUE    how far short of TODAY'S target the line finished. A positive
 *                number is a shortfall (the brief's "Due"); zero or less means the
 *                target was met, and it is reported as 0 rather than a negative, so
 *                a surplus never reads as a negative due.
 *   MONTHLY DUE  the same figure accumulated over the month's rows for that line —
 *                the question a line-in-charge asks near month end. It is the sum of
 *                the daily shortfalls and surpluses, so a good day offsets a bad one,
 *                which is what "due for the month" means on a factory floor.
 *
 * Both are derived, never stored: a corrected target or output must move them without
 * a migration.
 */
export function dueOf(row = {}) {
  const target = num(row.dailyTarget ?? row.daily_target);
  const output = num(row.achievement ?? row.output ?? row.quantity);
  return Math.max(0, target - output);
}

/**
 * The monthly due for each line, from the month's rows.
 *
 * @param {Array} monthlyRecords every row in the month's collection, not just the day's
 * @returns {Map<string, number>} line key (lower-cased) -> pieces still due this month
 *
 * The month's SHORTFALL is the sum of each day's difference, NOT the month's target
 * minus the month's output. The two differ when a line over-produced one day and fell
 * short another, and the per-day reading is the honest one for a floor: a line cannot
 * bank yesterday's surplus against tomorrow's plan without somebody agreeing it.
 */
export function monthlyDueByLine(monthlyRecords = []) {
  const byLine = new Map();
  (Array.isArray(monthlyRecords) ? monthlyRecords : []).forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const line = String(row.line_no || '').trim();
    if (!line) return;
    const key = line.toLowerCase();
    byLine.set(key, (byLine.get(key) || 0) + dueOf(row));
  });
  return byLine;
}

/**
 * The order-detail column definitions, in the order the table shows them.
 *
 * Declared here rather than inline in the view so the table and the CSV export build
 * from ONE list: a column added here appears in both, and the export can never fall
 * behind the screen.
 */
export const ORDER_DETAIL_COLUMNS = [
  { key: 'buyer', label: 'Buyer' },
  { key: 'style', label: 'Style No' },
  { key: 'item', label: 'Product / Item' },
  { key: 'po_qty', label: 'PO Qty' },
  { key: 'color', label: 'Color' },
];

// ============================================================
// FALLBACK LINE OUTPUT — aggregating the floor when nobody
// submitted a line total.
//
// A Total Line Output entry is the supervisor's OWN figure for a
// line's day, and it is the preferred record: they were there and
// they signed it off. But the form is easy to forget, and when it
// is forgotten the line reads ZERO on the summary even though
// every operator on it recorded their hours — which is the worst
// possible outcome, because a line that looks idle is a line
// somebody gets asked about.
//
// So the day's line figures are DERIVED when no entry exists: the
// individual employee rows for that line and day are summed into
// one line total, and the result is written back into the same
// monthly records a hand entry goes into, marked `source: 'auto'`.
//
// THE RULES, and why each one is what it is
// -----------------------------------------
//   · A hand entry ALWAYS wins. An auto row never overwrites, and
//     never sits beside, a line that a supervisor submitted — the
//     derived figure is a fallback, not a second opinion. If a
//     supervisor later submits the real number, the auto row is
//     replaced by it.
//   · Only lines with employee output are derived. A line nobody
//     recorded anything against stays absent rather than becoming a
//     row of zeroes, which would be inventing a record of work that
//     did not happen.
//   · The auto rows are IDEMPOTENT: re-deriving the same day
//     produces the same rows, so running the sync on every render,
//     save or tab switch cannot inflate a total by adding a line's
//     output twice. Each row is keyed on date + line, so a second
//     pass replaces the first rather than appending to it.
// ============================================================

/** The source marker on a derived row. A hand entry carries no `source`. */
export const AUTO_LINE_SOURCE = 'auto';

/** The `targetSource` a derived row states, so a reader can see where it came from. */
export const AUTO_LINE_TARGET_SOURCE = 'auto-from-employee-entries';

/**
 * The line a row belongs to, however it was recorded.
 *
 * Hourly rows carry `line_no` when the supervisor picked one and `line` on the older
 * shape. A row with NEITHER cannot be attributed to a line, so it is excluded from
 * every line total rather than being pooled into a "no line" bucket — that bucket
 * would show up as a line in the table and be read as one.
 */
export function lineOfRow(row = {}) {
  return String(row.line_no || row.line || '').trim();
}

/**
 * The output a row represents, whichever key it was stored under.
 *
 * A day-mode row keeps its whole-day figure under the DAY sentinel in `hours`; an
 * hourly row keeps one figure per clock hour. Both are summed here, so a line total
 * counts work recorded either way.
 */
function rowOutput(row = {}) {
  const direct = num(row.output ?? row.quantity ?? row.dailyTotal);
  if (direct > 0) return direct;
  const hours = row.hours || {};
  return Object.values(hours).reduce((sum, v) => sum + num(v), 0);
}

/**
 * Every line's employee-recorded output for one day, summed.
 *
 * @param {Array} hourlyRows the `hourly-timesheet-rows` collection
 * @param {string} date      the day to aggregate (YYYY-MM-DD)
 * @returns {Array<{ line_no, output, employees, entries, order_no, style, process, hourlyTarget, dailyTarget }>}
 *   one entry per line that has employee output, biggest first
 *
 * Rows that are THEMSELVES line totals are excluded: a `entry_type: 'line'` row is a
 * supervisor's own figure, not an employee's work, and counting it here would make the
 * fallback a copy of the entry it is meant to stand in for.
 */
export function employeeOutputByLine(hourlyRows = [], date = '') {
  const day = dateKey(date);
  if (!day) return [];
  const byLine = new Map();

  (Array.isArray(hourlyRows) ? hourlyRows : []).forEach((row) => {
    if (!row || typeof row !== 'object') return;
    if (dateKey(row.date) !== day) return;
    // A line total is not an employee's output — see the note above.
    if (String(row.entry_type || '') === 'line') return;
    const line = lineOfRow(row);
    if (!line) return;
    const output = rowOutput(row);
    if (output <= 0) return;

    const key = line.toLowerCase();
    const prev = byLine.get(key) || {
      line_no: line,
      output: 0,
      employees: new Set(),
      entries: 0,
      order_no: '',
      style: '',
      process: '',
      hourlyTarget: 0,
      dailyTarget: 0,
    };
    prev.output += output;
    prev.entries += 1;
    const employee = String(row.employee || '').trim();
    if (employee) prev.employees.add(employee);
    // The order/style ride along from the first row that states one, so the derived
    // line record is attributable to a garment rather than being anonymous.
    if (!prev.order_no && row.order_no) prev.order_no = String(row.order_no).trim();
    if (!prev.style && row.style) prev.style = String(row.style).trim();
    if (!prev.process && row.process) prev.process = String(row.process).trim();
    // The targets are summed per employee row, because each employee's row states the
    // target for the work THEY did; the line's target is the whole line's.
    prev.hourlyTarget += num(row.hourlyTarget);
    prev.dailyTarget += num(row.dailyTarget ?? row.daily_target);
    byLine.set(key, prev);
  });

  return [...byLine.values()]
    .map((entry) => ({ ...entry, employees: [...entry.employees].sort() }))
    .sort((a, b) => b.output - a.output);
}

/**
 * The monthly records after the fallback has filled in every line that has employee
 * output but no supervisor entry for that day.
 *
 * Pure: it returns the NEXT list rather than writing anything, so the caller performs
 * the write and a test can assert the result directly.
 *
 * @param {Array}  monthlyRecords the month's existing `line-output-YYYY-MM` rows
 * @param {Array}  hourlyRows     the `hourly-timesheet-rows` collection
 * @param {string} date           the day to derive (YYYY-MM-DD)
 * @returns {{ records: Array, added: Array, replaced: Array }}
 *   records  — the next month's rows: hand entries untouched, auto rows refreshed
 *   added    — the lines the fallback filled in
 *   replaced — auto rows that were re-derived (same day re-run), so a caller can tell
 *              a first fill from a refresh
 */
export function applyAutoLineOutput(monthlyRecords = [], hourlyRows = [], date = '') {
  const day = dateKey(date);
  const records = Array.isArray(monthlyRecords) ? monthlyRecords.filter(Boolean) : [];
  if (!day) return { records, added: [], replaced: [] };

  const derived = employeeOutputByLine(hourlyRows, day);

  // The auto rows for this day are rebuilt from scratch: a line whose employees were
  // all corrected or deleted must LOSE its derived row, not keep a stale figure. So
  // this runs BEFORE the "nothing derived" exit below — otherwise a day whose
  // employee entries had all gone would keep its old calculated rows forever.
  const stale = records.filter(
    (r) => String(r.source || '') === AUTO_LINE_SOURCE && dateKey(r.date) === day,
  );

  if (derived.length === 0) {
    return { records: records.filter((r) => !stale.includes(r)), added: [], replaced: [] };
  }

  // A line a supervisor submitted for this day is theirs to state: the fallback must
  // not overwrite it, or a hand-entered 1,200 would be replaced by the 980 the
  // operators happened to log.
  const handLines = new Set(
    records
      .filter((r) => dateKey(r.date) === day && String(r.source || '') !== AUTO_LINE_SOURCE)
      .map((r) => String(r.line_no || '').trim().toLowerCase())
      .filter(Boolean),
  );

  const added = [];
  const replaced = [];

  derived.forEach((line) => {
    if (handLines.has(line.line_no.toLowerCase())) return;
    const record = buildAutoLineRecord(line, day);
    if (records.some((r) => autoRecordKey(r) === autoRecordKey(record))) replaced.push(record);
    else added.push(record);
  });

  // A stale auto row is replaced by the fresh one of the same key, so dropping every
  // auto row for the day and appending the rebuilt set cannot lose or duplicate one.
  const kept = records.filter((r) => !stale.includes(r));

  return { records: [...kept, ...added, ...replaced], added, replaced };
}

/** The identity of a monthly row: one per date + line. */
export function autoRecordKey(record = {}) {
  return `${dateKey(record.date)}||${String(record.line_no || '').trim().toLowerCase()}`;
}

/**
 * The stored record for one derived line total.
 *
 * Shaped exactly like a hand entry (see `buildLineOutputRecord`) so every reader —
 * the monthly sheet, the daily row, the summary cards — treats it identically. The
 * two differences are deliberate:
 *
 *   `source: 'auto'`            so the table can say the figure was derived and the
 *                               fallback can tell its own rows from a hand entry
 *   `employee: 'All employees'` because nobody signed for it; naming a supervisor
 *                               would credit somebody who did not make the claim
 */
export function buildAutoLineRecord(line = {}, date = '') {
  const day = dateKey(date);
  const output = num(line.output);
  return {
    id: `auto-line__${String(line.line_no || '').trim().toLowerCase().replace(/\s+/g, '-')}__${day}`,
    date: day,
    month: monthKeyOf(day),
    entry_type: 'line',
    source: AUTO_LINE_SOURCE,
    order_no: String(line.order_no || '').trim(),
    style: String(line.style || '').trim(),
    line_no: String(line.line_no || '').trim(),
    // Nobody submitted this, so no supervisor is named — the record says who it
    // covers instead, which is the honest description of a derived figure.
    supervisor: '',
    employee: 'All employees',
    process: String(line.process || '').trim() || LINE_OUTPUT_LABEL,
    achievement: output,
    quantity: output,
    output,
    hourlyTarget: num(line.hourlyTarget),
    dailyTarget: num(line.dailyTarget),
    targetSource: AUTO_LINE_TARGET_SOURCE,
    achievementPercent: num(line.dailyTarget) > 0
      ? Math.round((output / num(line.dailyTarget)) * 1000) / 10
      : 0,
    // How many employee rows and people the figure was summed from, so the table can
    // state the basis of the calculation rather than showing an unexplained number.
    autoEntries: num(line.entries),
    autoEmployees: Array.isArray(line.employees) ? line.employees.length : 0,
    employeeNames: Array.isArray(line.employees) ? line.employees : [],
    remarks: '',
    createdBy: '',
    savedAt: new Date().toISOString(),
  };
}

/** True when a monthly row was derived by the fallback rather than submitted. */
export function isAutoLineRecord(record = {}) {
  return String(record?.source || '') === AUTO_LINE_SOURCE;
}

/**
 * The one-line explanation of a derived figure, shown as the row's tooltip.
 *
 * Kept here rather than in the view so the wording is testable and cannot drift
 * between the table and any export that states the same thing.
 */
export function autoLineTooltip(record = {}) {
  if (!isAutoLineRecord(record)) return '';
  const entries = num(record.autoEntries);
  const people = num(record.autoEmployees);
  if (entries <= 0) return 'Calculated automatically from employee entries.';
  return `Calculated automatically: ${entries} employee entr${entries === 1 ? 'y' : 'ies'}`
    + `${people > 0 ? ` from ${people} ${people === 1 ? 'person' : 'people'}` : ''}`
    + ' summed, because no Total Line Output entry was submitted for this line.';
}

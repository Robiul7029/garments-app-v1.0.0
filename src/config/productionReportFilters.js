/**
 * ROBIUL GARMENTS ERP — Production Report filtering.
 *
 * The filter logic behind the Production Report, written as pure functions so it
 * can be unit-tested without a database and reused by the table, the per-style
 * summary and the export alike. No React, no storage, no Firestore — pure
 * functions only.
 *
 * THE THREE WAYS TO NARROW THE REPORT
 * -----------------------------------
 *   1. ORDER ONLY        — pick an Order No and nothing else. Shows that order's
 *                          complete production history, with no date required.
 *   2. DATE RANGE        — a custom window, e.g. 1st to 30th of a month.
 *   3. SINGLE MONTH      — one month picker, which expands to that month's first
 *                          and last day.
 *
 * Any of the three combines with any other, which is the brief's "specific Order
 * No + Date Range / Month". The three are resolved into ONE date window plus ONE
 * order key in `resolveReportFilters`, so the table, the summary and the export
 * cannot disagree about which rows they describe.
 *
 * WHY DATES ARE COMPARED AS STRINGS
 * ---------------------------------
 * Every comparison is on a `YYYY-MM-DD` string, never on a `Date`. A bare
 * `YYYY-MM-DD` parsed as a `Date` is UTC midnight, so reading its local day parts
 * on a machine behind UTC yields the day before — an entry on the 1st would drop
 * out of a "this month" report. Lexicographic order on `YYYY-MM-DD` IS calendar
 * order, so comparing strings removes the time zone from the question entirely.
 * This is the same rule `utils/orderStatus.js` uses, deliberately.
 */

/**
 * A `YYYY-MM-DD` key from anything a stored row may hold.
 *
 * Accepts a Firestore Timestamp (`toDate()`), a `Date`, or a string. A bare
 * `YYYY-MM-DD` string is taken at face value rather than re-parsed, so it cannot
 * be shifted by a UTC round-trip. Returns `''` for a missing/unreadable value,
 * which every caller treats as "no date".
 */
export function reportDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  let d = null;
  if (value instanceof Date) d = value;
  else if (typeof value?.toDate === 'function') {
    try {
      d = value.toDate();
    } catch {
      return '';
    }
  } else d = new Date(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The month (YYYY-MM) a date belongs to, or '' when there is no date. */
export function reportMonthKey(value) {
  return reportDateKey(value).slice(0, 7);
}

/**
 * The first day of a `YYYY-MM` month, as a `YYYY-MM-DD` key.
 *
 * Computed arithmetically rather than through `new Date`, so no time zone can
 * shift the month boundary. Returns '' for anything that is not a `YYYY-MM`.
 */
export function monthStart(month) {
  const key = String(month || '').trim();
  return /^\d{4}-\d{2}$/.test(key) ? `${key}-01` : '';
}

/**
 * The LAST day of a `YYYY-MM` month, as a `YYYY-MM-DD` key.
 *
 * Day 0 of the following month is the last day of this one, which is how the
 * 28/29/30/31 case is handled without a lookup table. The month is rolled by hand
 * (December → January of the next year) so the result is a plain string and no
 * `Date` is involved.
 */
export function monthEnd(month) {
  const key = String(month || '').trim();
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return '';
  const year = Number(match[1]);
  const monthNo = Number(match[2]);
  if (!year || monthNo < 1 || monthNo > 12) return '';
  // The last day of a month is the day count before the next month starts.
  const daysInMonth = new Date(year, monthNo, 0).getDate();
  return `${match[1]}-${match[2]}-${String(daysInMonth).padStart(2, '0')}`;
}

/** Today's `YYYY-MM-DD`, in the factory's own local calendar. */
export function reportToday(now = new Date()) {
  return reportDateKey(now);
}

/** The current month as `YYYY-MM`. */
export function reportCurrentMonth(now = new Date()) {
  return reportToday(now).slice(0, 7);
}

/**
 * Resolves the filter controls into ONE date window and ONE order key.
 *
 * `month` is expanded to its first and last day and takes precedence over the
 * custom `from` / `to` bounds when both are present, because the month picker is
 * the more deliberate choice and leaving the two to fight would make the visible
 * control and the applied window disagree.
 *
 * Returns `{ from, to, orderNo, hasDateFilter, hasOrderFilter, isFiltered }`.
 * An empty `from` / `to` means "no bound", never "reject everything" — so an
 * order-only filter reports that order's complete history.
 */
export function resolveReportFilters(filters = {}) {
  const { from = '', to = '', month = '', orderNo = '', order_no = '' } = filters;
  const wantedOrder = String(orderNo || order_no || '').trim();

  const monthKey = /^\d{4}-\d{2}$/.test(String(month || '').trim()) ? String(month).trim() : '';
  const fromKey = monthKey ? monthStart(monthKey) : reportDateKey(from);
  const toKey = monthKey ? monthEnd(monthKey) : reportDateKey(to);

  return {
    from: fromKey,
    to: toKey,
    orderNo: wantedOrder,
    hasDateFilter: Boolean(fromKey || toKey),
    hasOrderFilter: Boolean(wantedOrder),
    isFiltered: Boolean(fromKey || toKey || wantedOrder),
  };
}

/**
 * Does one production row match the resolved filters?
 *
 * The two axes are independent and combine with AND, which is what makes
 * "Order No + Date Range" work: the row must be that order AND inside the window.
 *
 * A row with NO date is excluded once a date filter is applied — it cannot be
 * shown to fall inside a window it has no value for — but is kept when no date
 * filter is set, so an order-only report still shows a row whose date is missing.
 */
export function matchesReportFilters(row = {}, resolved = {}) {
  const { from = '', to = '', orderNo = '' } = resolved;
  const date = reportDateKey(row.date);

  if (orderNo) {
    const rowOrder = String(row.order_no || row.orderNo || '').trim();
    if (rowOrder.toLowerCase() !== orderNo.toLowerCase()) return false;
  }

  if (from || to) {
    if (!date) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
  }

  return true;
}

/** Applies the resolved filters to a list of rows. */
export function filterReportRows(rows = [], resolved = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => matchesReportFilters(row, resolved));
}

/**
 * Every order number the report can be filtered by, ACTIVE AND ARCHIVED ALIKE.
 *
 * The brief asks for the dropdown to carry archived orders as well as active
 * ones, and that matters for a report: an order that has shipped is exactly the
 * one whose production history somebody wants to look up. So this deliberately
 * does NOT call `isActiveOrder` or any other "hide the finished ones" helper — it
 * offers every order the master holds, plus every order number that actually
 * appears in the production rows, which is the only way a historical entry whose
 * order master record was deleted stays reachable.
 *
 * Each option carries the labels the dropdown shows, so the UI never has to look
 * the order up a second time.
 */
export function reportOrderOptions(orders = [], rows = []) {
  const byNumber = new Map();

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    if (!order) return;
    const no = String(order.order_no || order.orderNo || order.poNo || '').trim();
    if (!no) return;
    byNumber.set(no, {
      value: no,
      label: buildOrderLabel(no, order.style || order.styleNo || '', order.buyer || ''),
      style: String(order.style || order.styleNo || '').trim(),
      buyer: String(order.buyer || '').trim(),
      status: String(order.status || '').trim(),
      archived: isArchivedOrder(order),
    });
  });

  // Order numbers that exist only on production rows — a historical entry whose
  // order master record is gone must still be filterable, or its report becomes
  // unreachable exactly when somebody needs it.
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    const no = String(row.order_no || row.orderNo || '').trim();
    if (!no || byNumber.has(no)) return;
    byNumber.set(no, {
      value: no,
      label: buildOrderLabel(no, row.style || '', row.buyer || ''),
      style: String(row.style || '').trim(),
      buyer: String(row.buyer || '').trim(),
      status: '',
      archived: false,
    });
  });

  return [...byNumber.values()].sort(
    (a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }),
  );
}

/**
 * Is this order finished with — completed, closed, cancelled, inactive or
 * archived?
 *
 * Used only to LABEL an option in the dropdown ("PO-104 · Archived"), never to
 * hide one. The report is a historical record, so a closed order belongs in it.
 */
export function isArchivedOrder(order = {}) {
  if (!order) return false;
  if (order.archived === true) return true;
  const status = String(order.status || '').trim().toLowerCase();
  return ['completed', 'closed', 'archived', 'inactive', 'cancelled', 'shipped'].includes(status);
}

/** "PO-104 — STY-1001 · H&M", or just the order number when nothing else is known. */
export function buildOrderLabel(orderNo, style, buyer) {
  const parts = [style, buyer].map((p) => String(p || '').trim()).filter(Boolean);
  return parts.length ? `${orderNo} — ${parts.join(' · ')}` : String(orderNo || '').trim();
}

/**
 * The distinct months that actually contain production, newest first.
 *
 * Offered alongside the month picker so a reader can see at a glance which months
 * have data rather than clicking through empty ones.
 */
export function reportMonthOptions(rows = []) {
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = reportMonthKey(row?.date);
    if (key) seen.add(key);
  });
  return [...seen].sort().reverse();
}

/** "2026-10" → "October 2026", for a filter summary line. */
export function monthLabel(month) {
  const key = String(month || '').trim();
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const name = names[Number(match[2]) - 1];
  return name ? `${name} ${match[1]}` : key;
}

/**
 * A plain-English summary of the filters in force, for the panel heading.
 *
 * Strict English, and stated so the reader never has to re-read four controls to
 * know what they are looking at.
 */
export function describeReportFilters(filters = {}) {
  const resolved = resolveReportFilters(filters);
  const parts = [];
  if (resolved.orderNo) parts.push(`Order ${resolved.orderNo}`);
  if (filters.month) parts.push(monthLabel(filters.month));
  else if (resolved.from && resolved.to) parts.push(`${resolved.from} to ${resolved.to}`);
  else if (resolved.from) parts.push(`From ${resolved.from}`);
  else if (resolved.to) parts.push(`Up to ${resolved.to}`);
  return parts.length ? parts.join(' · ') : 'All production records';
}

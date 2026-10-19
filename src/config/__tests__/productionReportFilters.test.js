import { describe, it, expect } from 'vitest';
import {
  reportDateKey,
  reportMonthKey,
  monthStart,
  monthEnd,
  reportToday,
  reportCurrentMonth,
  resolveReportFilters,
  matchesReportFilters,
  filterReportRows,
  reportOrderOptions,
  isArchivedOrder,
  buildOrderLabel,
  reportMonthOptions,
  monthLabel,
  describeReportFilters,
} from '../productionReportFilters';

/**
 * The Production Report's filter logic.
 *
 * The rule these pin down:
 *
 *   - ORDER ALONE is a complete filter. Choosing an Order No and no dates shows
 *     that order's whole history.
 *   - A DATE RANGE and a SINGLE MONTH are two ways to state the same window, and
 *     either combines with the order filter (the brief's "Order No + Date Range").
 *   - The ORDER list carries ACTIVE AND ARCHIVED orders, because a shipped order
 *     is exactly the one whose history somebody opens this report to look up.
 *
 * The date comparisons are asserted as string boundaries (2026-10-01 … 2026-10-30)
 * because that is the whole point of not using `Date` here: no time zone can shift
 * an entry across a month boundary.
 */

const ROW = (overrides = {}) => ({
  id: 1,
  date: '2026-10-15',
  order_no: 'PO-104',
  style: 'STY-1001',
  employee: 'Rahima',
  process: 'Collar Attach',
  quantity: 480,
  ...overrides,
});

describe('date keys', () => {
  it('reads a YYYY-MM-DD key from a string, a Date and a Firestore timestamp', () => {
    expect(reportDateKey('2026-10-15')).toBe('2026-10-15');
    expect(reportDateKey('2026-10-15T08:00:00Z')).toBe('2026-10-15');
    expect(reportDateKey({ toDate: () => new Date(2026, 9, 15) })).toBe('2026-10-15');
  });

  it('returns an empty key for a missing or unreadable value', () => {
    expect(reportDateKey('')).toBe('');
    expect(reportDateKey(null)).toBe('');
    expect(reportDateKey(undefined)).toBe('');
  });

  it('takes a bare calendar string at face value rather than round-tripping it', () => {
    // The time-zone trap: new Date('2026-10-01') is UTC midnight, whose LOCAL day
    // parts on a machine behind UTC are the 30th of September.
    expect(reportDateKey('2026-10-01')).toBe('2026-10-01');
  });

  it('derives the month key', () => {
    expect(reportMonthKey('2026-10-15')).toBe('2026-10');
    expect(reportMonthKey('')).toBe('');
  });

  it('reports today and the current month from a supplied clock', () => {
    const now = new Date(2026, 9, 17);
    expect(reportToday(now)).toBe('2026-10-17');
    expect(reportCurrentMonth(now)).toBe('2026-10');
  });
});

describe('month boundaries', () => {
  it('expands a month to its first and last day', () => {
    expect(monthStart('2026-10')).toBe('2026-10-01');
    expect(monthEnd('2026-10')).toBe('2026-10-31');
  });

  it('handles a 30-day month', () => {
    expect(monthEnd('2026-11')).toBe('2026-11-30');
    expect(monthEnd('2026-09')).toBe('2026-09-30');
  });

  it('handles February in a common year and a leap year', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
  });

  it('handles December without rolling into the wrong year', () => {
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });

  it('returns an empty key for anything that is not a YYYY-MM month', () => {
    expect(monthStart('')).toBe('');
    expect(monthEnd('2026')).toBe('');
    expect(monthEnd('not-a-month')).toBe('');
  });
});

describe('resolving the filters into one window and one order', () => {
  it('expands a single month into its first and last day', () => {
    const resolved = resolveReportFilters({ month: '2026-10' });
    expect(resolved.from).toBe('2026-10-01');
    expect(resolved.to).toBe('2026-10-31');
    expect(resolved.hasDateFilter).toBe(true);
  });

  it('keeps a custom date range as given', () => {
    const resolved = resolveReportFilters({ from: '2026-10-01', to: '2026-10-30' });
    expect(resolved.from).toBe('2026-10-01');
    expect(resolved.to).toBe('2026-10-30');
  });

  it('lets the month picker win over a stale custom range', () => {
    // Both controls cannot be the source of truth; the month is the more
    // deliberate choice, so the applied window follows the visible control.
    const resolved = resolveReportFilters({ month: '2026-10', from: '2026-01-01', to: '2026-01-31' });
    expect(resolved.from).toBe('2026-10-01');
    expect(resolved.to).toBe('2026-10-31');
  });

  it('applies no date bound when no date filter is set', () => {
    const resolved = resolveReportFilters({ orderNo: 'PO-104' });
    expect(resolved.from).toBe('');
    expect(resolved.to).toBe('');
    expect(resolved.hasDateFilter).toBe(false);
    expect(resolved.hasOrderFilter).toBe(true);
  });

  it('treats no filters at all as unfiltered', () => {
    const resolved = resolveReportFilters({});
    expect(resolved.isFiltered).toBe(false);
  });
});

describe('matching rows', () => {
  it('filters by Order No ALONE, with no dates required', () => {
    const rows = [
      ROW({ id: 1, order_no: 'PO-104', date: '2026-01-05' }),
      ROW({ id: 2, order_no: 'PO-104', date: '2026-10-15' }),
      ROW({ id: 3, order_no: 'PO-999', date: '2026-10-15' }),
    ];
    const resolved = resolveReportFilters({ orderNo: 'PO-104' });
    const out = filterReportRows(rows, resolved);
    // Both of PO-104's entries, across months — the complete history.
    expect(out.map((r) => r.id)).toEqual([1, 2]);
  });

  it('filters a custom date range across two months', () => {
    const rows = [
      ROW({ id: 1, date: '2026-09-30' }),
      ROW({ id: 2, date: '2026-10-01' }),
      ROW({ id: 3, date: '2026-10-30' }),
      ROW({ id: 4, date: '2026-10-31' }),
    ];
    const out = filterReportRows(rows, resolveReportFilters({ from: '2026-10-01', to: '2026-10-30' }));
    // Both bounds are inclusive; the 31st is outside.
    expect(out.map((r) => r.id)).toEqual([2, 3]);
  });

  it('filters a single month', () => {
    const rows = [
      ROW({ id: 1, date: '2026-09-30' }),
      ROW({ id: 2, date: '2026-10-01' }),
      ROW({ id: 3, date: '2026-10-31' }),
      ROW({ id: 4, date: '2026-11-01' }),
    ];
    const out = filterReportRows(rows, resolveReportFilters({ month: '2026-10' }));
    expect(out.map((r) => r.id)).toEqual([2, 3]);
  });

  it('combines an Order No with a date range', () => {
    const rows = [
      ROW({ id: 1, order_no: 'PO-104', date: '2026-10-05' }),
      ROW({ id: 2, order_no: 'PO-104', date: '2026-10-25' }),
      ROW({ id: 3, order_no: 'PO-999', date: '2026-10-05' }),
    ];
    const out = filterReportRows(rows, resolveReportFilters({
      orderNo: 'PO-104', from: '2026-10-01', to: '2026-10-10',
    }));
    // Must be that order AND inside the window — both axes apply.
    expect(out.map((r) => r.id)).toEqual([1]);
  });

  it('combines an Order No with a single month', () => {
    const rows = [
      ROW({ id: 1, order_no: 'PO-104', date: '2026-09-15' }),
      ROW({ id: 2, order_no: 'PO-104', date: '2026-10-15' }),
      ROW({ id: 3, order_no: 'PO-999', date: '2026-10-15' }),
    ];
    const out = filterReportRows(rows, resolveReportFilters({ orderNo: 'PO-104', month: '2026-10' }));
    expect(out.map((r) => r.id)).toEqual([2]);
  });

  it('matches the order number case-insensitively', () => {
    const rows = [ROW({ id: 1, order_no: 'po-104' })];
    expect(filterReportRows(rows, resolveReportFilters({ orderNo: 'PO-104' }))).toHaveLength(1);
  });

  it('keeps a row with no date when no date filter is set', () => {
    // An order-only report must still show a row whose date was never recorded.
    const rows = [ROW({ id: 1, date: '' })];
    expect(filterReportRows(rows, resolveReportFilters({ orderNo: 'PO-104' }))).toHaveLength(1);
  });

  it('drops a row with no date once a date filter is applied', () => {
    const rows = [ROW({ id: 1, date: '' })];
    expect(filterReportRows(rows, resolveReportFilters({ month: '2026-10' }))).toHaveLength(0);
  });

  it('keeps everything when nothing is filtered', () => {
    const rows = [ROW({ id: 1 }), ROW({ id: 2, date: '2020-01-01' })];
    expect(filterReportRows(rows, resolveReportFilters({}))).toHaveLength(2);
  });

  it('exposes the same decision as matchesReportFilters for one row', () => {
    const resolved = resolveReportFilters({ month: '2026-10' });
    expect(matchesReportFilters(ROW({ date: '2026-10-15' }), resolved)).toBe(true);
    expect(matchesReportFilters(ROW({ date: '2026-09-15' }), resolved)).toBe(false);
  });
});

describe('the Order dropdown options', () => {
  it('carries ACTIVE and ARCHIVED orders alike', () => {
    const options = reportOrderOptions([
      { order_no: 'PO-1', style: 'STY-1', buyer: 'H&M', status: 'Production' },
      { order_no: 'PO-2', style: 'STY-2', buyer: 'Zara', status: 'Shipped' },
      { order_no: 'PO-3', style: 'STY-3', buyer: 'Gap', status: 'Completed' },
      { order_no: 'PO-4', style: 'STY-4', buyer: 'M&S', status: 'Archived' },
    ], []);
    // The brief's requirement: archived orders are still selectable.
    expect(options.map((o) => o.value)).toEqual(['PO-1', 'PO-2', 'PO-3', 'PO-4']);
    expect(options.find((o) => o.value === 'PO-2').archived).toBe(true);
    expect(options.find((o) => o.value === 'PO-4').archived).toBe(true);
    expect(options.find((o) => o.value === 'PO-1').archived).toBe(false);
  });

  it('keeps an order number that survives only on a production row', () => {
    // The order master record was deleted, but the production entry remains — the
    // report must still be able to filter to it.
    const options = reportOrderOptions(
      [{ order_no: 'PO-1', style: 'STY-1' }],
      [ROW({ order_no: 'PO-OLD', style: 'STY-OLD' })],
    );
    expect(options.map((o) => o.value)).toEqual(['PO-1', 'PO-OLD']);
  });

  it('does not duplicate an order present in both sources', () => {
    const options = reportOrderOptions(
      [{ order_no: 'PO-1', style: 'STY-1' }],
      [ROW({ order_no: 'PO-1' })],
    );
    expect(options).toHaveLength(1);
  });

  it('labels an option with the order number, style and buyer', () => {
    const [option] = reportOrderOptions([{ order_no: 'PO-104', style: 'STY-1001', buyer: 'H&M' }], []);
    expect(option.label).toContain('PO-104');
    expect(option.label).toContain('STY-1001');
    expect(option.label).toContain('H&M');
  });

  it('falls back to the bare order number when nothing else is known', () => {
    expect(buildOrderLabel('PO-104', '', '')).toBe('PO-104');
  });

  it('sorts numerically so PO-9 precedes PO-10', () => {
    const options = reportOrderOptions([
      { order_no: 'PO-10' }, { order_no: 'PO-9' }, { order_no: 'PO-100' },
    ], []);
    expect(options.map((o) => o.value)).toEqual(['PO-9', 'PO-10', 'PO-100']);
  });

  it('skips a master row with no order number', () => {
    expect(reportOrderOptions([{ style: 'STY-1' }], [])).toEqual([]);
  });
});

describe('archived detection', () => {
  it('recognises the finished statuses', () => {
    ['Completed', 'Closed', 'Archived', 'Inactive', 'Cancelled', 'Shipped']
      .forEach((status) => expect(isArchivedOrder({ status }), status).toBe(true));
  });

  it('treats a working order as active', () => {
    ['New', 'Confirmed', 'Production', 'Ready to Ship']
      .forEach((status) => expect(isArchivedOrder({ status }), status).toBe(false));
  });

  it('honours an explicit archived flag', () => {
    expect(isArchivedOrder({ archived: true, status: 'Production' })).toBe(true);
  });
});

describe('the month picker options', () => {
  it('lists the months that actually contain production, newest first', () => {
    const months = reportMonthOptions([
      ROW({ date: '2026-08-01' }),
      ROW({ date: '2026-10-15' }),
      ROW({ date: '2026-10-20' }),
      ROW({ date: '2026-09-05' }),
    ]);
    expect(months).toEqual(['2026-10', '2026-09', '2026-08']);
  });

  it('ignores rows with no date', () => {
    expect(reportMonthOptions([ROW({ date: '' })])).toEqual([]);
  });

  it('names a month in English', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2026-01')).toBe('January 2026');
  });
});

describe('the filter summary line', () => {
  it('names the order alone when only an order is chosen', () => {
    expect(describeReportFilters({ orderNo: 'PO-104' })).toBe('Order PO-104');
  });

  it('names the month in English', () => {
    expect(describeReportFilters({ month: '2026-10' })).toBe('October 2026');
  });

  it('names a custom date range', () => {
    expect(describeReportFilters({ from: '2026-10-01', to: '2026-10-30' }))
      .toBe('2026-10-01 to 2026-10-30');
  });

  it('combines the order and the window', () => {
    expect(describeReportFilters({ orderNo: 'PO-104', month: '2026-10' }))
      .toBe('Order PO-104 · October 2026');
  });

  it('says so when nothing is filtered', () => {
    expect(describeReportFilters({})).toBe('All production records');
  });
});

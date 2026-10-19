import { describe, it, expect } from 'vitest';
import {
  cuttingReportRows,
  filterCuttingRows,
  cuttingKpis,
  cuttingWipFeed,
  cuttingByOrder,
  issuedByOrderFromLineInputs,
  buildCuttingEntry,
  validateCuttingEntry,
  cuttingDayKey,
  todayKey,
  cuttingFabricUnitOf,
  cuttingDistinct,
} from '../cuttingProduction';

/**
 * The Cutting Department's arithmetic.
 *
 * The rule these pin down:
 *
 *   remaining = total cut − issued to sewing
 *
 * and that the remaining figure is exactly what the sewing line may be fed — the
 * brief's "link the saved Total Cut Quantity to the Sewing Line Input pool as
 * available WIP". The issued side is read from BOTH the cutting entry and the
 * Line Input collection, and the larger is taken rather than the two being added,
 * so a lay logged in either place is never counted twice.
 */

const ENTRY = (overrides = {}) => ({
  id: 1,
  date: '2026-10-17',
  order_no: 'PO-104',
  buyer: 'H&M',
  style: 'STY-1001',
  color: 'Navy',
  sizeRange: 'S–XL',
  poQty: 2000,
  layNo: 'Lay-01',
  markerLength: 8.5,
  fabricConsumed: 420,
  fabricUnit: 'Yards',
  cutQty: 480,
  issuedQty: 0,
  ...overrides,
});

describe('the cutting report rows', () => {
  it('computes the remaining balance as cut − issued', () => {
    const [row] = cuttingReportRows([ENTRY({ cutQty: 480, issuedQty: 300 })]);
    expect(row.cutQty).toBe(480);
    expect(row.issuedQty).toBe(300);
    expect(row.remaining).toBe(180);
  });

  it('carries every column the brief names', () => {
    const [row] = cuttingReportRows([ENTRY()]);
    // Buyer, Order No, Style, Lay No, Total Cut Pcs, Fabric Used.
    expect(row.buyer).toBe('H&M');
    expect(row.order_no).toBe('PO-104');
    expect(row.style).toBe('STY-1001');
    expect(row.layNo).toBe('Lay-01');
    expect(row.cutQty).toBe(480);
    expect(row.fabricConsumed).toBe(420);
    // …plus the issued and remaining figures.
    expect(row.issuedQty).toBe(0);
    expect(row.remaining).toBe(480);
  });

  it('derives the status badge from the two quantities', () => {
    const rows = cuttingReportRows([
      ENTRY({ id: 1, issuedQty: 0 }),
      ENTRY({ id: 2, issuedQty: 200 }),
      ENTRY({ id: 3, issuedQty: 480 }),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId[1]).toBe('Ready');
    expect(byId[2]).toBe('Partially Issued');
    expect(byId[3]).toBe('Issued to Sewing');
  });

  it('never reports a negative remaining balance', () => {
    // A feeding logged beyond the cut quantity is a data problem, not negative stock.
    const [row] = cuttingReportRows([ENTRY({ cutQty: 100, issuedQty: 150 })]);
    expect(row.remaining).toBe(0);
  });

  it('counts a feeding logged on the Line Input screen', () => {
    const issuedByOrder = issuedByOrderFromLineInputs([
      { order_no: 'PO-104', inputQty: 250 },
      { order_no: 'PO-104', inputQty: 50 },
    ]);
    const [row] = cuttingReportRows([ENTRY({ cutQty: 480, issuedQty: 0 })], { issuedByOrder });
    expect(row.issuedQty).toBe(300);
    expect(row.remaining).toBe(180);
  });

  it('takes the larger of the two issued records instead of adding them', () => {
    // The same 300 pieces recorded on the entry AND on a line input must not read
    // as 600 issued.
    const issuedByOrder = issuedByOrderFromLineInputs([{ order_no: 'PO-104', inputQty: 300 }]);
    const [row] = cuttingReportRows([ENTRY({ cutQty: 480, issuedQty: 300 })], { issuedByOrder });
    expect(row.issuedQty).toBe(300);
    expect(row.remaining).toBe(180);
  });

  it('sorts newest first, then by order and lay', () => {
    const rows = cuttingReportRows([
      ENTRY({ id: 1, date: '2026-10-16', order_no: 'PO-102' }),
      ENTRY({ id: 2, date: '2026-10-17', order_no: 'PO-105' }),
      ENTRY({ id: 3, date: '2026-10-17', order_no: 'PO-103' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
  });
});

describe('the cutting filters', () => {
  const rows = cuttingReportRows([
    ENTRY({ id: 1, date: '2026-10-16', order_no: 'PO-102', style: 'STY-1' }),
    ENTRY({ id: 2, date: '2026-10-17', order_no: 'PO-105', style: 'STY-2' }),
  ]);

  it('filters to one day', () => {
    expect(filterCuttingRows(rows, { date: '2026-10-17' }).map((r) => r.id)).toEqual([2]);
  });

  it('filters to a date range', () => {
    expect(filterCuttingRows(rows, { from: '2026-10-16', to: '2026-10-16' }).map((r) => r.id)).toEqual([1]);
  });

  it('filters by order and by style', () => {
    expect(filterCuttingRows(rows, { order_no: 'PO-102' }).map((r) => r.id)).toEqual([1]);
    expect(filterCuttingRows(rows, { style: 'STY-2' }).map((r) => r.id)).toEqual([2]);
  });

  it('returns everything when no filter is given', () => {
    expect(filterCuttingRows(rows, {})).toHaveLength(2);
  });
});

describe('the KPI cards', () => {
  const today = todayKey();
  const rows = cuttingReportRows([
    // Today: 480 + 300 = 780 cut, 200 issued, so 580 ready.
    ENTRY({ id: 1, date: today, cutQty: 480, issuedQty: 200, fabricConsumed: 420, poQty: 400 }),
    ENTRY({ id: 2, date: today, cutQty: 300, issuedQty: 0, fabricConsumed: 260, poQty: 300 }),
    // Yesterday: must not appear in today's cards.
    ENTRY({ id: 3, date: '2026-01-01', cutQty: 999, fabricConsumed: 999 }),
  ]);

  it("totals today's cut pieces", () => {
    expect(cuttingKpis(rows).totalCut).toBe(780);
  });

  it("totals today's fabric, per unit", () => {
    const kpis = cuttingKpis(rows);
    expect(kpis.fabricByUnit.Yards).toBe(680);
    expect(kpis.fabricUnit).toBe('Yards');
  });

  it('reports the ready stock available to feed a sewing line', () => {
    // 480−200 = 280, plus 300−0 = 300.
    expect(cuttingKpis(rows).readyStock).toBe(580);
  });

  it('computes the achievement percentage against an explicit target', () => {
    const kpis = cuttingKpis(rows, { target: 1000 });
    expect(kpis.target).toBe(1000);
    expect(kpis.achievement).toBe(78);
    expect(kpis.achievementLevel).toBe('critical');
  });

  it('falls back to the PO quantity when no target is set', () => {
    const kpis = cuttingKpis(rows);
    // 400 + 300 from the two today rows.
    expect(kpis.target).toBe(700);
    expect(kpis.achievement).toBeCloseTo(111.4, 1);
  });

  it('reports no percentage rather than a misleading 100% when it cannot', () => {
    const kpis = cuttingKpis(cuttingReportRows([ENTRY({ date: today, poQty: 0 })]));
    expect(kpis.target).toBe(0);
    expect(kpis.achievement).toBeNull();
    expect(kpis.achievementLevel).toBe('info');
  });

  it('never mixes yards and meters into one figure', () => {
    const kpis = cuttingKpis(cuttingReportRows([
      ENTRY({ id: 1, date: today, fabricConsumed: 100, fabricUnit: 'Yards' }),
      ENTRY({ id: 2, date: today, fabricConsumed: 50, fabricUnit: 'Meters' }),
    ]));
    expect(kpis.fabricByUnit).toEqual({ Yards: 100, Meters: 50 });
  });
});

describe('the sewing line WIP feed', () => {
  it('offers only what has not been issued', () => {
    const feed = cuttingWipFeed(cuttingReportRows([
      ENTRY({ id: 1, cutQty: 480, issuedQty: 480 }),
      ENTRY({ id: 2, cutQty: 300, issuedQty: 0 }),
    ]));
    expect(feed).toHaveLength(1);
    expect(feed[0].availableQty).toBe(300);
  });

  it('groups by order + style + colour so a feeding names one colour', () => {
    const feed = cuttingWipFeed(cuttingReportRows([
      ENTRY({ id: 1, color: 'Navy', layNo: 'Lay-01', cutQty: 100 }),
      ENTRY({ id: 2, color: 'Navy', layNo: 'Lay-02', cutQty: 50 }),
      ENTRY({ id: 3, color: 'Black', layNo: 'Lay-03', cutQty: 70 }),
    ]));
    expect(feed).toHaveLength(2);
    const navy = feed.find((r) => r.color === 'Navy');
    expect(navy.availableQty).toBe(150);
    expect(navy.lays).toEqual(['Lay-01', 'Lay-02']);
  });

  it('links the cut quantity to the sewing pool as available WIP', () => {
    // The brief's integration: a saved Total Cut Quantity with nothing issued is
    // available to a sewing line, in full.
    const feed = cuttingWipFeed(cuttingReportRows([ENTRY({ cutQty: 480, issuedQty: 0 })]));
    expect(feed[0].availableQty).toBe(480);
    expect(feed[0].order_no).toBe('PO-104');
    expect(feed[0].style).toBe('STY-1001');
  });
});

describe('the per-order summary', () => {
  it('merges every lay of one order and reports progress against the PO qty', () => {
    const [row] = cuttingByOrder(cuttingReportRows([
      ENTRY({ id: 1, cutQty: 480 }),
      ENTRY({ id: 2, cutQty: 520 }),
    ]));
    expect(row.cutQty).toBe(1000);
    expect(row.poQty).toBe(2000);
    expect(row.cutPercent).toBe(50);
    expect(row.lays).toBe(2);
  });
});

describe('the saved record', () => {
  it('copies the order fields onto the entry so the book reads without a join', () => {
    const record = buildCuttingEntry({
      order_no: 'PO-200',
      layNo: 'Lay-07',
      fabricConsumed: '310',
      cutQty: '240',
      date: '2026-10-17',
      order: { id: 'o1', buyer: 'Zara', style: 'STY-9', color: 'Black', size_range: 'M', qty: 1200 },
    });
    expect(record).toMatchObject({
      order_no: 'PO-200',
      buyer: 'Zara',
      style: 'STY-9',
      color: 'Black',
      sizeRange: 'M',
      poQty: 1200,
      layNo: 'Lay-07',
      fabricConsumed: 310,
      cutQty: 240,
      orderId: 'o1',
    });
  });

  it('normalises the fabric unit to one of the two the brief names', () => {
    expect(buildCuttingEntry({ fabricUnit: 'Meters' }).fabricUnit).toBe('Meters');
    expect(buildCuttingEntry({ fabricUnit: 'kg' }).fabricUnit).toBe('Yards');
    expect(cuttingFabricUnitOf({ fabricUnit: 'mtr' })).toBe('Meters');
  });

  it('defaults the date to today when none is given', () => {
    expect(buildCuttingEntry({}).date).toBe(todayKey());
  });
});

describe('the entry validation', () => {
  it('requires the brief\'s fields', () => {
    const errors = validateCuttingEntry({});
    expect(errors.order_no).toBeTruthy();
    expect(errors.layNo).toBeTruthy();
    expect(errors.fabricConsumed).toBeTruthy();
    expect(errors.cutQty).toBeTruthy();
  });

  it('accepts a complete entry', () => {
    expect(validateCuttingEntry({
      order_no: 'PO-1', layNo: 'Lay-1', fabricConsumed: 100, cutQty: 200, date: '2026-10-17',
    })).toEqual({});
  });

  it('refuses more issued than cut, rather than clamping it', () => {
    const errors = validateCuttingEntry({
      order_no: 'PO-1', layNo: 'Lay-1', fabricConsumed: 100, cutQty: 200, issuedQty: 250, date: '2026-10-17',
    });
    expect(errors.issuedQty).toContain('cannot be more than');
  });
});

describe('helpers', () => {
  it('reads a day key from a Firestore timestamp and from a string', () => {
    expect(cuttingDayKey('2026-10-17T08:00:00Z')).toBe('2026-10-17');
    expect(cuttingDayKey({ toDate: () => new Date('2026-10-17T08:00:00Z') })).toBe('2026-10-17');
  });

  it('lists distinct values for a filter dropdown', () => {
    const rows = cuttingReportRows([
      ENTRY({ id: 1, order_no: 'PO-2' }),
      ENTRY({ id: 2, order_no: 'PO-1' }),
      ENTRY({ id: 3, order_no: 'PO-2' }),
    ]);
    expect(cuttingDistinct(rows, 'order_no')).toEqual(['PO-1', 'PO-2']);
  });
});

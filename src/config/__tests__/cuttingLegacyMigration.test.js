import { describe, it, expect } from 'vitest';
import {
  normaliseLegacyCuttingRows,
  mergeCuttingEntries,
  cuttingReportRows,
  cuttingWipFeed,
} from '../cuttingProduction';

/**
 * Migrating the old `cutting-production` rows into the new report.
 *
 * Before this module existed, cutting was recorded through the generic DataModule
 * table into a local `cutting-production` collection:
 *
 *     { id, date, employee, style, color, lay_qty, quantity, shortfall_reason }
 *
 * The rule these tests pin down:
 *
 *   - the mapping is HONEST. A field the old row never captured is left blank
 *     rather than invented, because a fabricated fabric figure would corrupt the
 *     "Total Fabric Consumed" card.
 *   - a migrated row is marked `legacy: true`, so it can be badged as read-only.
 *   - a migrated row is DROPPED when a real entry already covers the same lay, so
 *     a site entering on both screens does not see every lay twice.
 *   - the real entry always wins over its historical echo.
 */

const LEGACY = (overrides = {}) => ({
  id: 1,
  date: '2026-08-19',
  employee: 'Rahima',
  style: 'STY-1001',
  color: 'Navy',
  lay_qty: 3,
  quantity: 480,
  ...overrides,
});

const ORDER = { id: 'o1', order_no: 'PO-104', style: 'STY-1001', buyer: 'H&M', size_range: 'S–XL', qty: 2000 };

describe('mapping one legacy row', () => {
  it('reads the old Cut Quantity as the cut quantity', () => {
    const [row] = normaliseLegacyCuttingRows([LEGACY()], [ORDER]);
    expect(row.cutQty).toBe(480);
  });

  it('resolves the order number and buyer from the order master BY STYLE', () => {
    // Style is the only link a legacy row carries, so it is the join key.
    const [row] = normaliseLegacyCuttingRows([LEGACY()], [ORDER]);
    expect(row.order_no).toBe('PO-104');
    expect(row.buyer).toBe('H&M');
    expect(row.sizeRange).toBe('S–XL');
    expect(row.poQty).toBe(2000);
  });

  it('turns the old lay count into a lay label', () => {
    const [row] = normaliseLegacyCuttingRows([LEGACY({ lay_qty: 3 })], [ORDER]);
    expect(row.layNo).toBe('Lay 3');
  });

  it('keeps a lay label that was already text', () => {
    const [row] = normaliseLegacyCuttingRows([LEGACY({ lay_qty: 'Lay-A', quantity: 100 })], [ORDER]);
    expect(row.layNo).toBe('Lay-A');
  });

  it('leaves the fabric figure at 0 rather than inventing one', () => {
    // The old row never recorded fabric consumption. A made-up number would put a
    // figure in front of a reader that no cutting table ever produced.
    const [row] = normaliseLegacyCuttingRows([LEGACY()], [ORDER]);
    expect(row.fabricConsumed).toBe(0);
    expect(row.fabricUnit).toBe('Yards');
  });

  it('carries the employee across as the supervisor', () => {
    const [row] = normaliseLegacyCuttingRows([LEGACY()], [ORDER]);
    expect(row.supervisor).toBe('Rahima');
  });

  it('carries the shortfall reason into remarks', () => {
    const [row] = normaliseLegacyCuttingRows([LEGACY({ shortfall_reason: 'Fabric shortage' })], [ORDER]);
    expect(row.remarks).toBe('Fabric shortage');
  });

  it('marks every migrated row as legacy', () => {
    const [row] = normaliseLegacyCuttingRows([LEGACY()], [ORDER]);
    expect(row.legacy).toBe(true);
  });

  it('namespaces the id so it can never collide with a real entry', () => {
    const [row] = normaliseLegacyCuttingRows([LEGACY({ id: 42 })], [ORDER]);
    expect(row.id).toBe('legacy-42');
  });

  it('assumes nothing was issued, since the old row had no issue tracking', () => {
    const [row] = normaliseLegacyCuttingRows([LEGACY()], [ORDER]);
    expect(row.issuedQty).toBe(0);
  });

  it('still works when the order master has no matching style', () => {
    // The order was deleted, or never existed. The row is still reported, with a
    // blank order number rather than being dropped.
    const [row] = normaliseLegacyCuttingRows([LEGACY()], []);
    expect(row.style).toBe('STY-1001');
    expect(row.order_no).toBe('');
    expect(row.buyer).toBe('');
    expect(row.cutQty).toBe(480);
  });

  it('drops a row with no quantity', () => {
    // A zero-quantity row would drag every average down and cannot be reported on.
    expect(normaliseLegacyCuttingRows([LEGACY({ quantity: 0 })], [ORDER])).toHaveLength(0);
  });

  it('drops a row with no date', () => {
    // A row with no date cannot be placed in any window.
    expect(normaliseLegacyCuttingRows([LEGACY({ date: '' })], [ORDER])).toHaveLength(0);
  });

  it('returns an empty list for no rows', () => {
    expect(normaliseLegacyCuttingRows([], [ORDER])).toEqual([]);
    expect(normaliseLegacyCuttingRows(undefined, [ORDER])).toEqual([]);
  });
});

describe('merging legacy rows with real entries', () => {
  const REAL = {
    id: 'c1', date: '2026-08-19', order_no: 'PO-104', buyer: 'H&M',
    style: 'STY-1001', color: 'Navy', layNo: 'Lay 3', cutQty: 480,
    fabricConsumed: 420, issuedQty: 100,
  };

  it('appends the migrated rows after the real ones', () => {
    const merged = mergeCuttingEntries([REAL], [LEGACY({ id: 9, quantity: 200, lay_qty: 7 })], [ORDER]);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe('c1');
    expect(merged[1].legacy).toBe(true);
  });

  it('drops a legacy row the real entries already cover', () => {
    // Same date + style + lay + quantity is the same lay, so showing it twice
    // would double the day's cut figure.
    const merged = mergeCuttingEntries([REAL], [LEGACY()], [ORDER]);
    expect(merged).toHaveLength(1);
    expect(merged[0].legacy).toBeUndefined();
  });

  it('keeps a legacy row that differs in quantity from the real entry', () => {
    // A genuinely different lay on the same day must not be swallowed.
    const merged = mergeCuttingEntries([REAL], [LEGACY({ quantity: 300 })], [ORDER]);
    expect(merged).toHaveLength(2);
  });

  it('lets the real entry win, so the row stays editable', () => {
    const merged = mergeCuttingEntries([REAL], [LEGACY()], [ORDER]);
    expect(merged.find((r) => r.legacy)).toBeUndefined();
  });

  it('returns the real entries untouched when there are no legacy rows', () => {
    expect(mergeCuttingEntries([REAL], [], [ORDER])).toEqual([REAL]);
  });
});

describe('migrated rows in the report', () => {
  it('carries the legacy flag through to the rendered row', () => {
    const entries = mergeCuttingEntries([], [LEGACY()], [ORDER]);
    const [row] = cuttingReportRows(entries);
    expect(row.legacy).toBe(true);
    expect(row.cutQty).toBe(480);
    expect(row.order_no).toBe('PO-104');
  });

  it('does not flag a real entry as legacy', () => {
    const [row] = cuttingReportRows([{
      id: 'c1', date: '2026-08-19', order_no: 'PO-104', style: 'STY-1001',
      layNo: 'Lay-01', cutQty: 100,
    }]);
    expect(row.legacy).toBe(false);
  });

  it('shows a migrated row as available WIP', () => {
    // The brief's integration still applies to imported history: 480 cut and
    // nothing issued is 480 pcs a sewing line may be fed.
    const entries = mergeCuttingEntries([], [LEGACY()], [ORDER]);
    const feed = cuttingWipFeed(cuttingReportRows(entries));
    expect(feed).toHaveLength(1);
    expect(feed[0].availableQty).toBe(480);
  });

  it('counts a feeding logged on the Line Input screen against a migrated row', () => {
    // The legacy row has no issue tracking, but the real feeding is still in the
    // `lineInputs` collection — so a migrated row is not stranded at "nothing
    // issued".
    const entries = mergeCuttingEntries([], [LEGACY()], [ORDER]);
    const issuedByOrder = new Map([['po-104', 300]]);
    const [row] = cuttingReportRows(entries, { issuedByOrder });
    expect(row.issuedQty).toBe(300);
    expect(row.remaining).toBe(180);
  });
});

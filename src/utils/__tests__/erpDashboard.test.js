import { describe, it, expect } from 'vitest';
import { daysUntil, formatShort, summariseStock } from '../erpDashboard';

/**
 * The dashboard helpers are the only place the overview screens get their dates
 * and stock balances from, so they are tested directly. The cases that matter
 * are the awkward ones: a missing date, a zero total, an item with no movements.
 */
describe('daysUntil', () => {
  it('counts forward to a future date', () => {
    expect(daysUntil('2026-10-15', '2026-10-10')).toBe(5);
  });

  it('returns 0 for a date that is today', () => {
    expect(daysUntil('2026-10-10', '2026-10-10')).toBe(0);
  });

  it('goes negative once the date has passed', () => {
    expect(daysUntil('2026-10-07', '2026-10-10')).toBe(-3);
  });

  it('returns null — not 0 — when there is no usable date', () => {
    // A PO with no delivery date must never be reported as "due today".
    expect(daysUntil('', '2026-10-10')).toBeNull();
    expect(daysUntil(null, '2026-10-10')).toBeNull();
    expect(daysUntil('not-a-date', '2026-10-10')).toBeNull();
  });

  it('compares whole days regardless of the time of day', () => {
    expect(daysUntil('2026-10-11T18:00:00', '2026-10-10T01:00:00')).toBe(1);
  });
});

describe('formatShort', () => {
  it('formats as day and short month', () => {
    expect(formatShort('2026-10-05')).toBe('5 Oct');
  });

  it('returns a dash rather than "Invalid Date"', () => {
    expect(formatShort('nope')).toBe('—');
    expect(formatShort(null)).toBe('—');
  });
});

describe('summariseStock', () => {
  const items = [
    { id: 'a', name: 'Navy Fabric', minQty: 100, maxQty: 500, unit: 'kg', unitCost: 3.5 },
    { id: 'b', name: 'Buttons', minQty: 0, maxQty: 0, unit: 'pcs' },
  ];
  const ledger = [
    { itemId: 'a', qtyIn: 80, qtyOut: 0 },
    { itemId: 'a', qtyIn: 0, qtyOut: 30 },
    { itemId: 'b', qtyIn: 5000, qtyOut: 0 },
  ];

  it('derives the balance from the movement ledger', () => {
    const { byItem } = summariseStock(items, ledger);
    expect(byItem.find((r) => r.id === 'a').value).toBe(50);
  });

  it('flags an item at or below its minimum as critical', () => {
    const { byItem } = summariseStock(items, ledger);
    expect(byItem.find((r) => r.id === 'a').level).toBe('critical');
  });

  it('lists only the items below minimum in `low`', () => {
    const { low } = summariseStock(items, ledger);
    expect(low.map((r) => r.label)).toEqual(['Navy Fabric']);
  });

  it('still lists an item that has never moved, at zero', () => {
    const { byItem } = summariseStock([{ id: 'c', name: 'Never Used', minQty: 5 }], []);
    expect(byItem).toHaveLength(1);
    expect(byItem[0].value).toBe(0);
    expect(byItem[0].level).toBe('critical');
  });

  it('values stock at unit cost and totals it', () => {
    const { totalValue, totalQty } = summariseStock(items, ledger);
    expect(totalValue).toBe(175); // 50 x 3.50
    expect(totalQty).toBe(5050);
  });

  it('survives empty input without throwing', () => {
    expect(summariseStock()).toEqual({ byItem: [], low: [], totalQty: 0, totalValue: 0 });
    expect(summariseStock(null, null).byItem).toEqual([]);
  });

  it('never reports a negative balance', () => {
    const { byItem } = summariseStock(
      [{ id: 'a', name: 'Over-issued', minQty: 0 }],
      [{ itemId: 'a', qtyIn: 10, qtyOut: 40 }]
    );
    expect(byItem[0].value).toBe(0);
  });
});

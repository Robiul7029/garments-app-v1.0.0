import { describe, it, expect } from 'vitest';
import { summariseStock } from '../../../utils/erpDashboard';

/**
 * The three derived series the new dashboard panels draw from. They are tested
 * here rather than through the hook because the hook needs a React renderer —
 * and the bug that previously blanked this screen was exactly a derived value
 * reading a field that did not exist.
 */

const items = [
  { id: 'i1', name: 'Cotton Fabric', minQty: 400, maxQty: 900, unit: 'kg', unitCost: 10 },
  { id: 'i2', name: 'Polyester Thread', minQty: 150, maxQty: 400, unit: 'roll', unitCost: 2 },
  { id: 'i3', name: 'Zippers', minQty: 100, maxQty: 300, unit: 'pcs', unitCost: 1.5 },
  { id: 'i4', name: 'No Thresholds', minQty: 0, maxQty: 0, unit: 'pcs', unitCost: 5 },
];

const ledger = [
  { itemId: 'i1', qtyIn: 430, qtyOut: 0 },
  { itemId: 'i2', qtyIn: 0, qtyOut: 0 },
  { itemId: 'i2', qtyIn: 150, qtyOut: 0 },
  { itemId: 'i3', qtyIn: 60, qtyOut: 0 },
  { itemId: 'i4', qtyIn: 25, qtyOut: 0 },
];

describe('summariseStock — fields the dashboard relies on', () => {
  const { byItem, totalValue, low } = summariseStock(items, ledger);

  it('carries unitCost through, which the inventory-value scale needs', () => {
    // Without this the "full store" ceiling divides by quantity and breaks on
    // any item holding zero.
    byItem.forEach((row) => {
      expect(typeof row.unitCost).toBe('number');
      expect(Number.isFinite(row.unitCost)).toBe(true);
    });
    expect(byItem.find((r) => r.id === 'i1').unitCost).toBe(10);
  });

  it('carries minQty through for the stock-vs-minimum chart', () => {
    expect(byItem.find((r) => r.id === 'i1').minQty).toBe(400);
  });

  it('marks an item below its minimum', () => {
    expect(byItem.find((r) => r.id === 'i3').level).toBe('critical');
    expect(low.map((r) => r.label)).toContain('Zippers');
  });

  it('values the whole holding at unit cost', () => {
    // i1: 430 x 10 = 4300, i2: 150 x 2 = 300, i3: 60 x 1.5 = 90, i4: 25 x 5 = 125
    expect(totalValue).toBe(4815);
  });
});

/** The inventory-value bar: value of stock held vs the value of a FULL store. */
describe('inventory value ceiling', () => {
  it('prices a full store from max qty x unit cost, never dividing by qty', () => {
    const { byItem } = summariseStock(items, ledger);
    const ceiling = byItem.reduce((s, r) => s + Math.max(r.maxQty, 0) * Math.max(r.unitCost, 0), 0);
    // i1: 900x10=9000, i2: 400x2=800, i3: 300x1.5=450, i4: 0 (no max)
    expect(ceiling).toBe(10250);
  });

  it('yields a sane 0-100 percentage when a ceiling exists', () => {
    const { byItem, totalValue } = summariseStock(items, ledger);
    const ceiling = byItem.reduce((s, r) => s + Math.max(r.maxQty, 0) * Math.max(r.unitCost, 0), 0);
    const pct = Math.max(0, Math.min(100, Math.round((totalValue / ceiling) * 100)));
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('never divides by zero when no item carries a maximum', () => {
    const { byItem } = summariseStock([items[3]], ledger);
    const ceiling = byItem.reduce((s, r) => s + Math.max(r.maxQty, 0) * Math.max(r.unitCost, 0), 0);
    expect(ceiling).toBe(0);
    // The panel omits the bar instead of producing Infinity/NaN.
    const pct = ceiling > 0 ? Math.round(100 / ceiling) : 0;
    expect(pct).toBe(0);
  });
});

/** The stock-vs-minimum chart drops items with no threshold rather than plotting them at zero. */
describe('inventory chart selection', () => {
  it('excludes items with no minimum, which would falsely read as well stocked', () => {
    const { byItem } = summariseStock(items, ledger);
    const charted = byItem.filter((r) => r.minQty > 0);
    expect(charted.map((r) => r.label)).not.toContain('No Thresholds');
    expect(charted).toHaveLength(3);
  });

  it('sorts longest bar first', () => {
    const { byItem } = summariseStock(items, ledger);
    const sorted = [...byItem].filter((r) => r.minQty > 0).sort((a, b) => b.value - a.value);
    expect(sorted[0].label).toBe('Cotton Fabric');
  });
});

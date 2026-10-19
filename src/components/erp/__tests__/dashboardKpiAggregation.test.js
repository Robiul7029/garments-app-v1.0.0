import { describe, expect, it } from 'vitest';
import { summariseProductionDay } from '../../../utils/erpCalculations';
import { summariseStock } from '../../../utils/erpDashboard';

const TODAY = '2026-10-17';

describe('dashboard live KPI source aggregation', () => {
  it('uses active hourly production rows to calculate output, target and SMV efficiency', () => {
    const rows = [
      { date: TODAY, target: 20, actual: 80, smv: 1.5, manpower: 2 },
      { date: TODAY, target: 20, actual: 90, smv: 1.5, manpower: 2 },
    ];
    expect(summariseProductionDay(rows)).toMatchObject({
      target: 40,
      actual: 170,
      efficiency: 106.25,
    });
  });

  it('derives current inventory quantity and value from item balances and costs', () => {
    const stock = summariseStock(
      [{ id: 'fabric-1', name: 'Cotton', minQty: 10, maxQty: 100, unitCost: 2.5 }],
      [{ itemId: 'fabric-1', qtyIn: 40, qtyOut: 8 }],
    );
    expect(stock.totalQty).toBe(32);
    expect(stock.totalValue).toBe(80);
  });
});

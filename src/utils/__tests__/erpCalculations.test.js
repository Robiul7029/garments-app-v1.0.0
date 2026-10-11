import { describe, it, expect } from 'vitest';
import {
  achievementPercent, efficiencyPercent, performanceLevel, summariseProductionDay,
  productionBalance, dhu, defectRate, summariseEndLineQc, stockFromLedger, stockLevel,
  computeOrderCosting, minutesLate, summariseAttendance, shipmentDelayRisk,
  delayDaysAgainst, toDateKey, round, toNumber,
} from '../erpCalculations';

/**
 * Tests for the numbers the factory is judged on.
 *
 * These are the calculations a garments manager argues about at the end of the
 * day, so they are pinned down here with worked numbers from a real line:
 * target 500 pcs/hour, 470 produced.
 */
describe('production calculations', () => {
  it('computes achievement from the real Line 03 example', () => {
    // 470 produced against a target of 500.
    expect(achievementPercent(500, 470)).toBe(94);
  });

  it('returns 0 rather than NaN when the target is zero', () => {
    // A line with no target set must not show "NaN%" on a management dashboard.
    expect(achievementPercent(0, 470)).toBe(0);
    expect(achievementPercent(0, 0)).toBe(0);
  });

  it('treats a non-numeric input as zero instead of propagating NaN', () => {
    expect(achievementPercent('abc', 'xyz')).toBe(0);
    expect(toNumber(undefined, 7)).toBe(7);
    expect(toNumber('12')).toBe(12);
  });

  it('computes efficiency from SMV against paid minutes', () => {
    // 20 operators, 60 minutes, SMV 1.5, 470 pieces produced.
    // Output minutes = 470 * 1.5 = 705. Paid minutes = 20 * 60 = 1200.
    // 705 / 1200 = 58.75%.
    expect(efficiencyPercent({ actual: 470, smv: 1.5, manpower: 20, availableMinutes: 60 })).toBe(58.75);
  });

  it('returns 0 efficiency when no manpower or minutes are recorded', () => {
    expect(efficiencyPercent({ actual: 470, smv: 1.5, manpower: 0 })).toBe(0);
    expect(efficiencyPercent({ actual: 470, smv: 1.5, manpower: 20, availableMinutes: 0 })).toBe(0);
  });

  it('classifies performance into good, warning and critical', () => {
    expect(performanceLevel(94)).toBe('good');   // the 470/500 line is green
    expect(performanceLevel(80)).toBe('warning');
    expect(performanceLevel(60)).toBe('critical');
  });

  it('honours custom thresholds', () => {
    expect(performanceLevel(80, { good: 85, warning: 75 })).toBe('warning');
  });

  it('summarises a day of hourly rows', () => {
    // Two hours on one line: 500 target / 470 actual, then 500 / 530.
    const summary = summariseProductionDay([
      { target: 500, actual: 470, rework: 5, reject: 2, downtimeMin: 10, manpower: 25, smv: 1.5 },
      { target: 500, actual: 530, rework: 0, reject: 0, downtimeMin: 0, manpower: 25, smv: 1.5 },
    ]);
    expect(summary.target).toBe(1000);
    expect(summary.actual).toBe(1000);
    expect(summary.achievement).toBe(100);
    expect(summary.rework).toBe(5);
    expect(summary.reject).toBe(2);
    expect(summary.downtimeMin).toBe(10);
    // Manpower is a headcount, not an hourly total: it must be 25, not 50.
    expect(summary.manpower).toBe(25);
    expect(summary.wip).toBe(0);
    expect(summary.level).toBe('good');
  });

  it('reports the WIP balance as the shortfall', () => {
    const summary = summariseProductionDay([{ target: 500, actual: 470 }]);
    expect(summary.wip).toBe(30);
    expect(summary.level).toBe('good'); // 94% is still green
  });

  it('flags a badly missed day as critical', () => {
    const summary = summariseProductionDay([{ target: 1000, actual: 300 }]);
    expect(summary.achievement).toBe(30);
    expect(summary.level).toBe('critical');
  });

  it('never returns a negative production balance', () => {
    expect(productionBalance(1000, 1200)).toBe(0);
    expect(productionBalance(1000, 700)).toBe(300);
  });

  it('handles an empty day without crashing', () => {
    const summary = summariseProductionDay([]);
    expect(summary.target).toBe(0);
    expect(summary.actual).toBe(0);
    expect(summary.achievement).toBe(0);
  });
});

describe('quality calculations', () => {
  it('computes DHU, the headline quality figure', () => {
    // 7 defects in 500 inspected = 1.4 defects per hundred units.
    expect(dhu(7, 500)).toBe(1.4);
  });

  it('returns 0 DHU when nothing was inspected', () => {
    // A shift with no inspection must not display a divide-by-zero.
    expect(dhu(0, 0)).toBe(0);
    expect(dhu(5, 0)).toBe(0);
  });

  it('computes defect rate as a percentage', () => {
    expect(defectRate(14, 300)).toBe(4.67);
  });

  it('summarises end-line QC and derives every rate', () => {
    const summary = summariseEndLineQc([
      { checkedQty: 300, passedQty: 280, failedQty: 20, reworkQty: 12, rejectQty: 8 },
      { checkedQty: 200, passedQty: 190, failedQty: 10, reworkQty: 6, rejectQty: 4 },
    ]);
    expect(summary.checkedQty).toBe(500);
    expect(summary.passedQty).toBe(470);
    expect(summary.failedQty).toBe(30);
    expect(summary.reworkQty).toBe(18);
    expect(summary.rejectQty).toBe(12);
    // (18 + 12) defects in 500 inspected = 6 DHU.
    expect(summary.dhu).toBe(6);
    expect(summary.rejectPct).toBe(2.4);
    expect(summary.reworkPct).toBe(3.6);
  });

  it('handles an empty QC day', () => {
    const summary = summariseEndLineQc([]);
    expect(summary.checkedQty).toBe(0);
    expect(summary.dhu).toBe(0);
  });
});

describe('inventory calculations', () => {
  it('derives stock from the ledger, never from a stored counter', () => {
    const entries = [
      { qtyIn: 1000, qtyOut: 0 },   // opening
      { qtyIn: 500, qtyOut: 0 },    // GRN
      { qtyIn: 0, qtyOut: 300 },    // issue
      { qtyIn: 50, qtyOut: 0 },     // return
    ];
    expect(stockFromLedger(entries)).toBe(1250);
  });

  it('never lets the running balance go negative', () => {
    // An over-issue must clamp at zero rather than reporting negative stock.
    expect(stockFromLedger([{ qtyIn: 10, qtyOut: 50 }])).toBe(0);
  });

  it('returns zero for an item with no movements', () => {
    expect(stockFromLedger([])).toBe(0);
  });

  it('raises a critical level at or below the minimum', () => {
    expect(stockLevel({ minQty: 100, maxQty: 500 }, 100)).toBe('critical');
    expect(stockLevel({ minQty: 100, maxQty: 500 }, 99)).toBe('critical');
  });

  it('warns when stock is within half of the maximum', () => {
    expect(stockLevel({ minQty: 100, maxQty: 500 }, 240)).toBe('warning');
  });

  it('is good above the warning threshold', () => {
    expect(stockLevel({ minQty: 100, maxQty: 500 }, 400)).toBe('good');
  });

  it('ignores items that have no reorder level configured', () => {
    // An item tracked only as a quantity must not generate endless false alerts.
    expect(stockLevel({ minQty: 0, maxQty: 0 }, 0)).toBe('good');
  });
});

describe('costing calculations', () => {
  it('totals cost heads by category and derives profit', () => {
    const result = computeOrderCosting({
      costHeads: [
        { category: 'Fabric', amount: 40000 },
        { category: 'Accessories', amount: 8000 },
        { category: 'Sewing', amount: 30000 },
        { category: 'Overhead', amount: 12000 },
      ],
      revenue: 120000,
      orderQty: 6000,
    });
    expect(result.totalCost).toBe(90000);
    expect(result.profit).toBe(30000);
    expect(result.isProfit).toBe(true);
    // 90000 / 6000 = 15 per piece.
    expect(result.costPerPiece).toBe(15);
    // 120000 / 6000 = 20 per piece.
    expect(result.revenuePerPiece).toBe(20);
    // 30000 / 120000 = 25%.
    expect(result.marginPercent).toBe(25);
  });

  it('sums repeated categories into one bucket', () => {
    const result = computeOrderCosting({
      costHeads: [{ category: 'Fabric', amount: 100 }, { category: 'Fabric', amount: 250 }],
      revenue: 0,
      orderQty: 0,
    });
    expect(result.byCategory.Fabric).toBe(350);
    expect(result.totalCost).toBe(350);
  });

  it('reports a loss rather than a profit when costs exceed revenue', () => {
    const result = computeOrderCosting({
      costHeads: [{ category: 'Fabric', amount: 20000 }],
      revenue: 15000,
      orderQty: 100,
    });
    expect(result.profit).toBe(-5000);
    expect(result.isProfit).toBe(false);
  });

  it('avoids dividing by zero when the order quantity is unknown', () => {
    const result = computeOrderCosting({ costHeads: [{ category: 'Fabric', amount: 500 }], revenue: 0, orderQty: 0 });
    expect(result.costPerPiece).toBe(0);
  });

  it('handles an order with no cost heads yet', () => {
    const result = computeOrderCosting({ costHeads: [], revenue: 50000, orderQty: 1000 });
    expect(result.totalCost).toBe(0);
    expect(result.profit).toBe(50000);
  });
});

describe('attendance calculations', () => {
  it('computes minutes late against a shift start', () => {
    expect(minutesLate('08:12', '08:00')).toBe(12);
    expect(minutesLate('08:00', '08:00')).toBe(0);
    expect(minutesLate('07:58', '08:00')).toBe(0); // early is never negative
    expect(minutesLate('09:30', '08:00')).toBe(90);
  });

  it('returns 0 for an unreadable time rather than NaN', () => {
    expect(minutesLate('', '08:00')).toBe(0);
    expect(minutesLate('nonsense', '08:00')).toBe(0);
  });

  it('counts each attendance status', () => {
    const summary = summariseAttendance([
      { status: 'Present' }, { status: 'Present' },
      { status: 'Absent' },
      { status: 'Late' },
      { status: 'Leave' },
    ]);
    expect(summary.total).toBe(5);
    expect(summary.present).toBe(2);
    expect(summary.absent).toBe(1);
    expect(summary.late).toBe(1);
    expect(summary.onLeave).toBe(1);
  });
});

describe('delay and date helpers', () => {
  const today = new Date('2026-08-19T00:00:00');

  it('flags a shipment due within the risk window', () => {
    // Due in 2 days, nothing shipped: a real risk.
    expect(shipmentDelayRisk('2026-08-21', today, 3, 0, 1000)).toBe(true);
  });

  it('does not flag a shipment due further out', () => {
    expect(shipmentDelayRisk('2026-09-20', today, 3, 0, 1000)).toBe(false);
  });

  it('does not flag a fully shipped PO', () => {
    expect(shipmentDelayRisk('2026-08-20', today, 3, 1000, 1000)).toBe(false);
  });

  it('counts whole days past a due date', () => {
    expect(delayDaysAgainst('2026-08-17', today)).toBe(2);
    expect(delayDaysAgainst('2026-08-25', today)).toBe(0); // not yet due
  });

  it('normalises any date input to YYYY-MM-DD', () => {
    expect(toDateKey('2026-08-19T10:42:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toDateKey(new Date(2026, 7, 19))).toBe('2026-08-19');
    expect(toDateKey('')).toBe('');
    expect(toDateKey(null)).toBe('');
  });

  it('rejects an invalid date instead of returning garbage', () => {
    expect(toDateKey('not-a-date')).toBe('');
  });
});

describe('rounding', () => {
  it('rounds half away from zero consistently', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(2.675, 2)).toBe(2.68);
  });

  it('returns 0 for a non-numeric input', () => {
    expect(round('abc')).toBe(0);
    expect(round(NaN)).toBe(0);
  });
});
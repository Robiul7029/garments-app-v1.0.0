import { describe, it, expect } from 'vitest';
import {
  summariseOrders,
  filterOrderSummary,
  summariseOrderTotals,
  linesOf,
  orderDurationMonths,
  workingDaysInMonth,
  aggregateMonthly,
  applyOrderMonthlyTargets,
  summariseMonth,
} from '../productionAggregation';

/**
 * The Master Buyer & Order Summary table, pinned.
 *
 * The table joins two collections — the hourly rows (movement) and the order
 * master (Buyer, Style, PO Qty, Floor, Line, Supervisor) — keyed on the Order No
 * an entry was booked against. These tests fix that join and the daily / monthly
 * roll-ups, so the Overall Summary tab cannot disagree with the KPI cards above
 * it or with Order Management behind it.
 */
const ORDERS = [
  { id: 1, buyer: 'H&M', order_no: 'PO-105', style: 'STY-1001', item: 'Basic Tee', qty: 1000, floor: 'Floor-2', line_no: 'Line-03', supervisor: 'Md Robiul' },
  { id: 2, buyer: 'Zara', order_no: 'PO-106', style: 'STY-1002', item: 'Polo', qty: 500, floor: 'Floor-1', line_no: 'Line-01', supervisor: 'Mst Sarjina' },
];

const TARGET_ORDERS = [
  {
    ...ORDERS[0], order_date: '2026-10-01', ship_date: '2026-12-01',
  },
  {
    ...ORDERS[1], start_date: '2026-10-01', delivery_date: '2026-10-30',
  },
];

const PROCESS_SHEETS = [{
  style: 'STY-1001', order_no: 'PO-105', uploadedAt: '2026-10-01',
  operations: [{ operation: 'Collar Attach' }, { operation: 'Final Assembly' }],
}];

const ROWS = [
  // PO-105, the selected day: two operators, two processes.
  { id: 1, date: '2026-10-12', employee: 'Md Robiul Islam', order_no: 'PO-105', style: 'STY-1001', process: 'Collar Attach', hours: { '08': 30 }, hourlyTarget: 30, workingHours: 10 },
  { id: 2, date: '2026-10-12', employee: 'Mst Sarjina Akter', order_no: 'PO-105', style: 'STY-1001', process: 'Collar Attach', hours: { '08': 20 }, hourlyTarget: 30, workingHours: 10 },
  // PO-105 earlier in the same month, but not on the selected day.
  { id: 3, date: '2026-10-05', employee: 'Md Robiul Islam', order_no: 'PO-105', style: 'STY-1001', process: 'Collar Attach', hours: { '08': 100 }, hourlyTarget: 30, workingHours: 10 },
  // PO-106, the selected day.
  { id: 4, date: '2026-10-12', employee: 'Md Robiul Islam', order_no: 'PO-106', style: 'STY-1002', process: 'Sleeve Join', hours: { '09': 40 }, hourlyTarget: 25, workingHours: 10 },
  // A row from another month, which the month window must exclude entirely.
  { id: 5, date: '2026-09-30', employee: 'Md Robiul Islam', order_no: 'PO-105', style: 'STY-1001', process: 'Collar Attach', hours: { '08': 999 }, hourlyTarget: 30, workingHours: 10 },
];

describe('the master buyer & order summary', () => {
  const summary = summariseOrders(ROWS, ORDERS, '2026-10-12');

  it('pulls Buyer / Style / PO Qty / Floor / Line / Supervisor from the order master', () => {
    const po105 = summary.find((r) => r.order_no === 'PO-105');
    expect(po105.buyer).toBe('H&M');
    expect(po105.style).toBe('STY-1001');
    expect(po105.poQty).toBe(1000);
    expect(po105.floor).toBe('Floor-2');
    expect(po105.line).toBe('Line-03');
    expect(po105.supervisor).toBe('Md Robiul');
  });

  it('rolls the month-to-date output and the selected day separately', () => {
    const po105 = summary.find((r) => r.order_no === 'PO-105');
    // Month: 30 + 20 (12th) + 100 (5th) = 150; September is excluded.
    expect(po105.monthOutput).toBe(150);
    // Day: only the 12th → 50.
    expect(po105.dailyOutput).toBe(50);
  });

  it('counts the manpower active on the order for the selected day', () => {
    const po105 = summary.find((r) => r.order_no === 'PO-105');
    expect(po105.activeEmployees).toBe(2);
    const po106 = summary.find((r) => r.order_no === 'PO-106');
    expect(po106.activeEmployees).toBe(1);
  });

  it('derives the PO progress and the remaining balance', () => {
    const po105 = summary.find((r) => r.order_no === 'PO-105');
    expect(po105.poProgress).toBe(15); // 150 / 1000
    expect(po105.remaining).toBe(850);
    expect(po105.dueLabel).toBe('850 Due');
  });

  it('derives the daily and monthly achievement percentages', () => {
    const po105 = summary.find((r) => r.order_no === 'PO-105');
    // Day target: one process counted once → 30 × 10 = 300; output 50 → 16.7%.
    expect(po105.dailyTarget).toBe(300);
    expect(po105.dailyAchievement).toBe(16.7);
    // Month target: two days × 300 = 600; output 150 → 25%.
    expect(po105.monthTarget).toBe(600);
    expect(po105.monthAchievement).toBe(25);
  });

  it('sorts by buyer then order number', () => {
    expect(summary.map((r) => r.order_no)).toEqual(['PO-105', 'PO-106']);
  });
});

describe('calendar-based target calculations', () => {
  it('calculates complete and fractional calendar-month schedule durations', () => {
    expect(orderDurationMonths('2026-10-01', '2026-11-01')).toBe(1);
    expect(orderDurationMonths('2026-10-01', '2026-11-16')).toBeCloseTo(1.5, 1);
    expect(orderDurationMonths('2026-10-01', '2026-10-01')).toBe(1);
    expect(orderDurationMonths('2026-11-01', '2026-10-01')).toBe(0);
  });

  it('uses the required working-day count for each calendar month length', () => {
    expect(workingDaysInMonth('2026-01-15')).toBe(25);
    expect(workingDaysInMonth('2026-04-15')).toBe(24);
    expect(workingDaysInMonth('2024-02-15')).toBe(23);
    expect(workingDaysInMonth('2026-02-15')).toBe(22);
  });

  it('derives monthly and daily targets from the order schedule', () => {
    const rows = [
      ...ROWS.filter((row) => row.order_no === 'PO-105'),
      ...ROWS.filter((row) => row.order_no === 'PO-106'),
    ];
    const summary = summariseOrders(rows, TARGET_ORDERS, '2026-10-12');
    const po105 = summary.find((row) => row.order_no === 'PO-105');
    const po106 = summary.find((row) => row.order_no === 'PO-106');
    // PO-105 spans two calendar months (Oct 1 to Dec 1): 1000 / 2.
    expect(po105.monthTarget).toBe(500);
    // October has 25 factory working days.
    expect(po105.dailyTarget).toBe(20);
    expect(po105.startDate).toBe('2026-10-01');
    expect(po105.deliveryDate).toBe('2026-12-01');
    // PO-106's schedule is one calendar month less one day, so it remains one target period.
    expect(po106.monthTarget).toBe(500);
    expect(po106.dailyTarget).toBeCloseTo(po106.monthTarget / 25, 5);
  });
});

describe('monthly matrix targets stay aligned with the order summary', () => {
  const production = [
    { id: 1, date: '2026-10-12', employee: 'Alex', order_no: 'PO-105', style: 'STY-1001', process: 'Sewing', hours: { '08': 100 }, workingHours: 8 },
    { id: 2, date: '2026-10-13', employee: 'Sam', order_no: 'PO-105', style: 'STY-1001', process: 'Sewing', hours: { '08': 50 }, workingHours: 8 },
  ];
  const order = { ...ORDERS[0], order_date: '2026-10-01', ship_date: '2026-12-01' };

  it('allocates the exact shared order Monthly Target across employee rows and summary totals', () => {
    const expected = summariseOrders(production, [order], '2026-10-12')[0].monthTarget;
    const rows = applyOrderMonthlyTargets(aggregateMonthly(production, '2026-10'), production, [order], '2026-10');
    const totals = summariseMonth(rows);
    expect(rows.reduce((sum, row) => sum + row.totalTarget, 0)).toBe(expected);
    expect(totals.target).toBe(expected);
    expect(rows.map((row) => row.totalTarget)).toEqual([expected * (100 / 150), expected * (50 / 150)]);
  });

  it('recalculates both views when PO quantity or order dates change', () => {
    const updatedOrder = { ...order, qty: 2400, order_date: '2026-10-01', ship_date: '2027-01-01' };
    const summaryTarget = summariseOrders(production, [updatedOrder], '2026-10-12')[0].monthTarget;
    const rows = applyOrderMonthlyTargets(aggregateMonthly(production, '2026-10'), production, [updatedOrder], '2026-10');
    expect(rows.reduce((sum, row) => sum + row.totalTarget, 0)).toBeCloseTo(summaryTarget, 8);
    expect(summaryTarget).toBe(800);
  });
});

describe('daily output process selection', () => {
  it('uses the explicitly designated output process when configured', () => {
    const rows = [
      { id: 10, date: '2026-10-12', order_no: 'PO-105', style: 'STY-1001', process: 'Collar Attach', hours: { '08': 15 } },
      { id: 11, date: '2026-10-12', order_no: 'PO-105', style: 'STY-1001', process: 'Final Assembly', hours: { '08': 40 } },
    ];
    const summary = summariseOrders(rows, [{ ...ORDERS[0], outputProcess: 'Collar Attach' }], '2026-10-12', PROCESS_SHEETS);
    expect(summary[0].outputProcess).toBe('Collar Attach');
    expect(summary[0].dailyOutput).toBe(15);
  });

  it('defaults to the final operation in the latest process sheet', () => {
    const rows = [
      { id: 10, date: '2026-10-12', order_no: 'PO-105', style: 'STY-1001', process: 'Collar Attach', hours: { '08': 15 } },
      { id: 11, date: '2026-10-12', order_no: 'PO-105', style: 'STY-1001', process: 'Final Assembly', hours: { '08': 40 } },
    ];
    const summary = summariseOrders(rows, [ORDERS[0]], '2026-10-12', PROCESS_SHEETS);
    expect(summary[0].outputProcess).toBe('Final Assembly');
    expect(summary[0].dailyOutput).toBe(40);
  });
});

describe('filtering the order summary', () => {
  const summary = summariseOrders(ROWS, ORDERS, '2026-10-12');

  it('matches the free-text search on buyer, order no and style', () => {
    expect(filterOrderSummary(summary, { search: 'zara' }).map((r) => r.order_no)).toEqual(['PO-106']);
    expect(filterOrderSummary(summary, { search: 'PO-105' }).map((r) => r.order_no)).toEqual(['PO-105']);
    expect(filterOrderSummary(summary, { search: 'STY-1002' }).map((r) => r.order_no)).toEqual(['PO-106']);
  });

  it('narrows to one line', () => {
    expect(filterOrderSummary(summary, { line: 'Line-03' }).map((r) => r.order_no)).toEqual(['PO-105']);
    expect(filterOrderSummary(summary, { line: 'Line-01' }).map((r) => r.order_no)).toEqual(['PO-106']);
  });

  it('lists the distinct lines from the unfiltered rows', () => {
    expect(linesOf(summary)).toEqual(['Line-01', 'Line-03']);
  });
});

describe('the order summary totals', () => {
  it('sums exactly the rows it is given', () => {
    const summary = summariseOrders(ROWS, ORDERS, '2026-10-12');
    const totals = summariseOrderTotals(summary);
    expect(totals.orders).toBe(2);
    expect(totals.poQty).toBe(1500);
    expect(totals.monthOutput).toBe(190); // 150 + 40
    expect(totals.dailyOutput).toBe(90); // 50 + 40
    expect(totals.remaining).toBe(1310); // 850 + 460
  });
});
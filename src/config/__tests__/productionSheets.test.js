import { describe, it, expect } from 'vitest';
import {
  aggregateDaily,
  groupDailyByEmployee,
  aggregateMonthly,
  summariseMonth,
  varianceText,
  varianceTone,
} from '../productionAggregation';

/**
 * The Daily and Monthly production sheets, pinned at the data layer.
 *
 * Both screens are pure projections of the hourly rows, so what is worth testing
 * is the projection: the hourly breakdown the daily sheet draws, the date-range
 * filter the monthly matrix applies, and the month-end summary figures. If these
 * are right the tables cannot show anything else.
 */
const ROWS = [
  // Robiul on Collar Attach: recorded at two different hours, so the daily sheet
  // must merge them into ONE row with BOTH hours in the breakdown.
  {
    id: 1, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Collar Attach',
    style: 'STY-1001', order_no: 'PO-105', line_no: 'Line-03',
    hours: { 8: 10, 9: 12 }, hourlyTarget: 30, workingHours: 10,
  },
  {
    id: 2, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Collar Attach',
    style: 'STY-1001', order_no: 'PO-105', line_no: 'Line-03',
    hours: { 15: 8 }, hourlyTarget: 30, workingHours: 10,
  },
  // The same person on a second process — a separate daily row.
  {
    id: 3, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Sleeve Join',
    style: 'STY-1001', order_no: 'PO-105', line_no: 'Line-03',
    hours: { 11: 20 }, hourlyTarget: 25, workingHours: 10,
  },
  // A second operator, same process — their own row.
  {
    id: 4, date: '2026-10-12', employee: 'Mst Sarjina Akter', process: 'Collar Attach',
    style: 'STY-1001', order_no: 'PO-105', line_no: 'Line-03',
    hours: { 8: 25 }, hourlyTarget: 30, workingHours: 10,
  },
  // Another day, for the monthly grid.
  {
    id: 5, date: '2026-10-13', employee: 'Md Robiul Islam', process: 'Collar Attach',
    style: 'STY-1001', order_no: 'PO-105', line_no: 'Line-03',
    hours: { 8: 5 }, hourlyTarget: 30, workingHours: 10,
  },
];

describe('the daily sheet carries an hourly breakdown', () => {
  const daily = aggregateDaily(ROWS, '2026-10-12');

  it('merges two entries of the same process into one row', () => {
    const row = daily.find((r) => r.employee === 'Md Robiul Islam' && r.process === 'Collar Attach');
    expect(row.output).toBe(30); // 10 + 12 + 8
    expect(row.entryIds).toEqual([1, 2]);
  });

  it('keeps each recorded hour in its own breakdown column', () => {
    const row = daily.find((r) => r.employee === 'Md Robiul Islam' && r.process === 'Collar Attach');
    // The 08:00 entry and the 15:00 entry are different columns, not one sum.
    expect(row.hours[8]).toBe(10);
    expect(row.hours[9]).toBe(12);
    expect(row.hours[15]).toBe(8);
  });

  it('does not mix hours between two employees on the same process', () => {
    const sarjina = daily.find((r) => r.employee === 'Mst Sarjina Akter');
    expect(sarjina.hours[8]).toBe(25);
    expect(Object.keys(sarjina.hours)).toEqual(['8']);
  });

  it('carries the line and the order/style the row belongs to', () => {
    const row = daily[0];
    expect(row.line).toBe('Line-03');
    expect(row.order_no).toBe('PO-105');
    expect(row.style).toBe('STY-1001');
  });

  it('excludes another day from the daily sheet', () => {
    expect(daily.every((r) => r.date === '2026-10-12')).toBe(true);
  });
});

describe('variance wording and tone', () => {
  it('reports a shortfall as "Due" in the bad tone', () => {
    expect(varianceText(-12)).toBe('12 Due');
    expect(varianceTone(-12)).toBe('bad');
  });

  it('reports a surplus as "Achieved" in the good tone', () => {
    expect(varianceText(8)).toBe('+8 Achieved');
    expect(varianceTone(8)).toBe('good');
  });

  it('treats exactly meeting the target as good, not as a shortfall', () => {
    expect(varianceText(0)).toBe('On target');
    expect(varianceTone(0)).toBe('good');
  });

  it('is attached to every aggregated row', () => {
    const daily = aggregateDaily(ROWS, '2026-10-12');
    daily.forEach((r) => {
      expect(['good', 'bad']).toContain(r.varianceTone);
      expect(typeof r.varianceLabel).toBe('string');
    });
  });

  it('flags a row that missed its target as bad', () => {
    // 30 pcs against a 30/hr × 10h = 300 target is a 270 shortfall.
    const row = aggregateDaily(ROWS, '2026-10-12')
      .find((r) => r.employee === 'Md Robiul Islam' && r.process === 'Collar Attach');
    expect(row.dailyTarget).toBe(300);
    expect(row.variance).toBe(-270);
    expect(row.varianceTone).toBe('bad');
    expect(row.varianceLabel).toBe('270 Due');
  });
});

describe('merging employee names across processes', () => {
  const groups = groupDailyByEmployee(aggregateDaily(ROWS, '2026-10-12'));

  it('writes each employee name once', () => {
    expect(groups.map((g) => g.employee).sort()).toEqual(['Md Robiul Islam', 'Mst Sarjina Akter']);
  });

  it('carries every process that person ran under their one name', () => {
    const robiul = groups.find((g) => g.employee === 'Md Robiul Islam');
    expect(robiul.rows).toHaveLength(2);
    expect(robiul.totals.processCount).toBe(2);
    // The merged cell shows this day total: 30 collar + 20 sleeve.
    expect(robiul.totals.output).toBe(50);
  });
});

describe('the monthly matrix date-range filter', () => {
  const all = aggregateMonthly(ROWS, '2026-10');

  it('includes both days with no range set', () => {
    const robiul = all.find((r) => r.employee === 'Md Robiul Islam');
    // Collar 10+12+8 = 30, sleeve 20, plus 5 on the 13th = 55.
    expect(robiul.totalOutput).toBe(55);
    expect(robiul.activeDays).toBe(2);
  });

  it('narrows to a from date', () => {
    const filtered = aggregateMonthly(ROWS, '2026-10', { from: '2026-10-13' });
    const robiul = filtered.find((r) => r.employee === 'Md Robiul Islam');
    // Only the 13th survives: 5 pieces.
    expect(robiul.totalOutput).toBe(5);
    expect(robiul.activeDays).toBe(1);
  });

  it('narrows to a to date', () => {
    const filtered = aggregateMonthly(ROWS, '2026-10', { to: '2026-10-12' });
    const robiul = filtered.find((r) => r.employee === 'Md Robiul Islam');
    // Only the 12th survives: 30 + 20 = 50.
    expect(robiul.totalOutput).toBe(50);
  });

  it('excludes everyone when the range covers no recorded day', () => {
    const filtered = aggregateMonthly(ROWS, '2026-10', { from: '2026-10-20', to: '2026-10-25' });
    expect(filtered).toEqual([]);
  });

  it('drops the employee entirely when the range excludes all their work', () => {
    const filtered = aggregateMonthly(ROWS, '2026-10', { from: '2026-10-13' });
    // Sarjina only worked the 12th, so she is not in the filtered month at all.
    expect(filtered.map((r) => r.employee)).toEqual(['Md Robiul Islam']);
  });

  it('keeps the day grid aligned when a range is applied', () => {
    const filtered = aggregateMonthly(ROWS, '2026-10', { from: '2026-10-13' });
    const robiul = filtered.find((r) => r.employee === 'Md Robiul Islam');
    // The 13th is still index 12 in the 31-column grid, not shifted to 0.
    expect(robiul.days[12]).toBe(5);
    expect(robiul.days[11]).toBe(0);
  });
});

describe('the month-end summary', () => {
  const monthRows = aggregateMonthly(ROWS, '2026-10');
  const totals = summariseMonth(monthRows);

  it('totals present days across employees', () => {
    // Robiul 2 days + Sarjina 1 day = 3.
    expect(totals.presentDays).toBe(3);
  });

  it('totals active hours', () => {
    // Robiul: 10 (12th) + 10 (13th) = 20; Sarjina: 10 → 30.
    expect(totals.hours).toBe(30);
  });

  it('states the monthly target and the achieved output', () => {
    // Targets: 300 + 250 (12th) + 300 (13th) for Robiul = 850; Sarjina 300 → 1150.
    // Output: Robiul 30 + 20 + 5 = 55; Sarjina 25 → 80.
    expect(totals.target).toBe(1150);
    expect(totals.output).toBe(80);
  });

  it('reports the overall monthly efficiency', () => {
    expect(totals.efficiency).toBe(7); // 80 / 1150 × 100 = 6.96 → 7.0
  });

  it('carries the month variance', () => {
    expect(totals.variance).toBe(80 - 1150);
  });

  it('counts the employees it covered', () => {
    expect(totals.employees).toBe(2);
  });

  it('reports zeros rather than NaN for an empty month', () => {
    const empty = summariseMonth([]);
    expect(empty.efficiency).toBe(0);
    expect(empty.variance).toBe(0);
    expect(empty.output).toBe(0);
  });

  it('survives a missing argument', () => {
    expect(summariseMonth().output).toBe(0);
  });
});
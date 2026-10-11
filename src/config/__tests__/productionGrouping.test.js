import { describe, it, expect } from 'vitest';
import {
  processFigures,
  varianceLabel,
  groupedByEmployee,
} from '../productionGrouping';

/**
 * Tests for the grouped production model.
 *
 * The grouping is what the Daily Production and Worker Production tables render,
 * so these pin the two things that would silently break the display: an employee
 * who worked several processes must appear ONCE, and each process must carry its
 * own target, actual, defects, efficiency and variance.
 */
const ROWS = [
  {
    id: 1, employee: 'Rina', date: '2026-08-19', line_no: 'Line-03', style: 'STY-1001',
    process: 'Collar Attach', daily_target: 280, quantity: 300, defect_qty: 5,
  },
  {
    id: 2, employee: 'Rina', date: '2026-08-19', line_no: 'Line-03', style: 'STY-1001',
    process: 'Sleeve Join', daily_target: 200, quantity: 180, defect_qty: 2,
  },
  {
    id: 3, employee: 'Salma', date: '2026-08-19', line_no: 'Line-03', style: 'STY-1001',
    process: 'Side Seam', daily_target: 160, quantity: 176, defect_qty: 0,
  },
];

describe('processFigures', () => {
  it('derives good output, efficiency and variance for one process', () => {
    const f = processFigures(ROWS[0]);
    expect(f.target).toBe(280);
    expect(f.actual).toBe(300);
    expect(f.defect).toBe(5);
    expect(f.good).toBe(295);           // 300 − 5
    expect(f.efficiency).toBe(105.4);    // 295 / 280
    expect(f.variance).toBe(15);         // 295 − 280
    expect(f.isSurplus).toBe(true);
  });

  it('reports a shortfall for a process below target', () => {
    const f = processFigures(ROWS[1]);
    expect(f.good).toBe(178);
    expect(f.variance).toBe(-22);
    expect(f.isShortfall).toBe(true);
    expect(f.efficiency).toBe(89);
  });

  it('never reports negative good output when defects exceed actual', () => {
    const f = processFigures({ process: 'Hemming', daily_target: 100, quantity: 10, defect_qty: 25 });
    expect(f.good).toBe(0);
    expect(f.variance).toBe(-100);
  });

  it('reports no efficiency when there is no target', () => {
    const f = processFigures({ process: 'Hemming', quantity: 50 });
    expect(f.target).toBe(0);
    expect(f.efficiency).toBe(0);
  });

  it('falls back to the legacy output/defect keys', () => {
    const f = processFigures({ process: 'X', target: 100, output: 80, defects: 3 });
    expect(f.actual).toBe(80);
    expect(f.defect).toBe(3);
  });
});

describe('varianceLabel', () => {
  it('words a surplus, a shortfall and a match as the brief does', () => {
    expect(varianceLabel(8)).toBe('+8 Extra');
    expect(varianceLabel(-12)).toBe('12 Due');
    expect(varianceLabel(0)).toBe('On target');
  });
});

describe('groupedByEmployee', () => {
  it('states each employee ONCE with every process underneath', () => {
    const groups = groupedByEmployee(ROWS);
    expect(groups).toHaveLength(2); // Rina, Salma
    const rina = groups.find((g) => g.employee === 'Rina');
    expect(rina.processes).toHaveLength(2);
    expect(rina.processes.map((p) => p.process)).toEqual(['Collar Attach', 'Sleeve Join']);
    const salma = groups.find((g) => g.employee === 'Salma');
    expect(salma.processes).toHaveLength(1);
  });

  it('totals the day across every process the worker touched', () => {
    const rina = groupedByEmployee(ROWS).find((g) => g.employee === 'Rina');
    expect(rina.totals.target).toBe(480);   // 280 + 200
    expect(rina.totals.actual).toBe(480);   // 300 + 180
    expect(rina.totals.good).toBe(473);     // 295 + 178
    expect(rina.totals.defect).toBe(7);     // 5 + 2
    expect(rina.totals.variance).toBe(-7);  // 473 − 480
    expect(rina.totals.processCount).toBe(2);
  });

  it('keys the group on employee + date + line, so two days do not merge', () => {
    const groups = groupedByEmployee([
      ...ROWS,
      { id: 4, employee: 'Rina', date: '2026-08-20', line_no: 'Line-03', process: 'Collar Attach', daily_target: 280, quantity: 250 },
    ]);
    expect(groups.filter((g) => g.employee === 'Rina')).toHaveLength(2);
  });

  it('keeps an unnamed employee rather than dropping the row', () => {
    const groups = groupedByEmployee([{ id: 9, date: '2026-08-19', line_no: 'L1', process: 'P', quantity: 5 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].employee).toBe('—');
  });

  it('returns nothing for an empty or missing list', () => {
    expect(groupedByEmployee([])).toEqual([]);
    expect(groupedByEmployee(undefined)).toEqual([]);
  });

  it('preserves first-appearance order', () => {
    expect(groupedByEmployee(ROWS).map((g) => g.employee)).toEqual(['Rina', 'Salma']);
  });
});

import { describe, it, expect } from 'vitest';
import { supervisorNames, isSupervisor } from '../employeeDirectory';
import { processSheetTargets, targetSourceNote } from '../lineOutputSheet';
import {
  monthlyCollectionFor,
  monthKeyOfCollection,
  buildLineOutputRecord,
  lineOutputDailyRow,
  summariseLineOutputMonth,
  lineOutputRowsForDate,
  lineOptionsOf,
} from '../monthlyLineOutput';
import { aggregateDaily, summariseDay } from '../productionAggregation';

/**
 * Total Line Output, pinned to the brief:
 *
 *   1. the person field offers SUPERVISORS only;
 *   2. the targets come from the order's Process Sheet, never from a typing hand;
 *   3. the record is stored per MONTH, and the same entry reaches the day figures
 *      the Overall Summary and the KPI cards read.
 */

const DIRECTORY = [
  { id: 'e1', name: 'Md Robiul Islam', designation: 'Supervisor', status: 'active' },
  { id: 'e2', name: 'Mst Sarjina Akter', designation: 'Operator', status: 'active' },
  { id: 'e3', name: 'Abdul Karim', designation: 'line supervisor', status: 'active' },
  { id: 'e4', name: 'Nasrin Sultana', designation: 'Supervisor', status: 'inactive' },
  { id: 'e5', name: 'Rokeya Begum', role: 'Supervisor', status: 'active' },
];

const ORDER = { style: 'STY-1001', order_no: 'PO-105' };
const SHEET = {
  id: 10,
  style: 'STY-1001',
  order_no: 'PO-105',
  uploadedAt: '2026-10-01',
  targetBuffer: 10,
  workingHours: 10,
  manpower: 20,
  lineOutputProcess: 'Side Seam',
  operations: [
    { operation: 'Collar Attach', smv: 1.2 },
    { operation: 'Side Seam', smv: 1.5 },
  ],
};

describe('the supervisor list', () => {
  it('offers supervisors and nobody else', () => {
    expect(supervisorNames(DIRECTORY, [])).toEqual([
      'Abdul Karim', 'Md Robiul Islam', 'Rokeya Begum',
    ]);
  });

  it('never offers an inactive supervisor', () => {
    expect(supervisorNames(DIRECTORY, [])).not.toContain('Nasrin Sultana');
  });

  it('recognises the spellings a designation is actually written in', () => {
    expect(isSupervisor({ designation: 'Supervisor' })).toBe(true);
    expect(isSupervisor({ designation: 'Line Supervisor' })).toBe(true);
    expect(isSupervisor({ role: 'supervisor' })).toBe(true);
    expect(isSupervisor({ designation: 'Operating Supervisor' })).toBe(true);
    expect(isSupervisor({ designation: 'Operator' })).toBe(false);
    expect(isSupervisor({})).toBe(false);
  });

  it('does not invent a supervisor from a bare name list', () => {
    // `employees` is names only — no designation — so nobody may be promoted.
    expect(supervisorNames([], ['Md Robiul Islam'])).toEqual([]);
  });
});

describe('the line dropdown', () => {
  it('offers the ERP master first, then the roster, then the floor', () => {
    const options = lineOptionsOf({
      erpLines: [{ id: 'line-3', lineNo: 'Line-03' }],
      directory: [{ line_no: 'Line-05' }],
      productionRows: [{ line_no: 'Line-01' }],
    });
    expect(options.map((o) => o.value)).toEqual(['Line-01', 'Line-03', 'Line-05']);
  });

  it('de-duplicates case-insensitively and keeps the ERP spelling', () => {
    const options = lineOptionsOf({
      erpLines: [{ id: 'line-3', lineNo: 'Line-03' }],
      directory: [{ line_no: 'line-03' }],
      productionRows: [{ line_no: 'LINE-03' }],
    });
    expect(options).toEqual([{ value: 'Line-03', label: 'Line-03', erpId: 'line-3' }]);
  });

  it('still offers a line the floor has booked when no master exists', () => {
    const options = lineOptionsOf({ productionRows: [{ line: 'Line-07' }] });
    expect(options.map((o) => o.value)).toEqual(['Line-07']);
  });

  it('carries the ERP id when a source knows it', () => {
    const options = lineOptionsOf({ erpLines: [{ id: 'line-9', name: 'Line-09' }] });
    expect(options[0]).toMatchObject({ value: 'Line-09', erpId: 'line-9' });
  });

  it('returns nothing rather than a blank option', () => {
    expect(lineOptionsOf({})).toEqual([]);
    expect(lineOptionsOf({ directory: [{}, { line_no: '  ' }] })).toEqual([]);
  });
});

describe('targets from the Process Sheet', () => {
  it('uses the line targets saved for the style first', () => {
    const capacity = [{ style: 'STY-1001', lineHourlyTarget: 120, bodyTarget: 1200 }];
    const targets = processSheetTargets([SHEET], ORDER, capacity);
    expect(targets).toMatchObject({ hourlyTarget: 120, dailyTarget: 1200, source: 'capacity' });
    expect(targets.hasTarget).toBe(true);
  });

  it("falls back to the sheet's line-output operation", () => {
    const targets = processSheetTargets([SHEET], ORDER, []);
    expect(targets.source).toBe('line-output');
    // 60 / 1.5 = 40/hr, +10% buffer = 44/hr, ×10 = 440/day.
    expect(targets.hourlyTarget).toBe(44);
    expect(targets.dailyTarget).toBe(440);
    expect(targets.process).toBe('Side Seam');
  });

  it('falls back to the whole garment when no line-output process is named', () => {
    const targets = processSheetTargets([{ ...SHEET, lineOutputProcess: '' }], ORDER, []);
    expect(targets.source).toBe('garment');
    expect(targets.dailyTarget).toBeGreaterThan(0);
  });

  it('reports no target rather than a zero when the order has no sheet', () => {
    const targets = processSheetTargets([SHEET], { style: 'STY-NONE' }, []);
    expect(targets.hasTarget).toBe(false);
    expect(targets.source).toBe('none');
    expect(targetSourceNote(targets)).toContain('No Process Sheet');
  });

  it('completes a half-stated capacity target from the other figure', () => {
    const capacity = [{ style: 'STY-1001', lineHourlyTarget: 50 }];
    expect(processSheetTargets([SHEET], ORDER, capacity).dailyTarget).toBe(500); // 50/hr × 10h
  });
});

describe('month-scoped storage', () => {
  it('names the collection after the month', () => {
    expect(monthlyCollectionFor('2026-10-17')).toBe('line-output-2026-10');
    expect(monthlyCollectionFor('2026-01-01')).toBe('line-output-2026-01');
    expect(monthlyCollectionFor('')).toBe('');
  });

  it('reads the month back out of the collection name', () => {
    expect(monthKeyOfCollection('line-output-2026-10')).toBe('2026-10');
    expect(monthKeyOfCollection('hourlyProduction')).toBe('');
  });

  it('files a record in the month of its own date, not of today', () => {
    const record = buildLineOutputRecord({
      date: '2026-09-30', achievement: 900, dailyTarget: 1000, hourlyTarget: 100,
    });
    expect(record.month).toBe('2026-09');
    expect(monthlyCollectionFor(record.date)).toBe('line-output-2026-09');
    expect(record.achievementPercent).toBe(90);
  });

  it('stores the supervisor under both names a reader may expect', () => {
    const record = buildLineOutputRecord({ date: '2026-10-17', supervisor: 'Md Robiul Islam', achievement: 500 });
    expect(record.supervisor).toBe('Md Robiul Islam');
    expect(record.employee).toBe('Md Robiul Islam');
  });

  it('summarises the month', () => {
    const rows = [
      buildLineOutputRecord({ date: '2026-10-01', line_no: 'Line-03', achievement: 900, dailyTarget: 1000 }),
      buildLineOutputRecord({ date: '2026-10-02', line_no: 'Line-03', achievement: 1100, dailyTarget: 1000 }),
    ];
    expect(summariseLineOutputMonth(rows)).toMatchObject({
      entries: 2, achievement: 2000, dailyTarget: 2000, achievementPercent: 100, lines: 1,
    });
  });

  it('returns only the day asked for', () => {
    const rows = [
      buildLineOutputRecord({ date: '2026-10-17', line_no: 'Line-03', achievement: 1 }),
      buildLineOutputRecord({ date: '2026-10-16', line_no: 'Line-02', achievement: 2 }),
    ];
    expect(lineOutputRowsForDate(rows, '2026-10-17').map((r) => r.line_no)).toEqual(['Line-03']);
  });
});

describe('a line entry reaching the day figures', () => {
  const record = buildLineOutputRecord({
    date: '2026-10-17',
    line_no: 'Line-03',
    order_no: 'PO-105',
    process: 'Collar Attach',
    supervisor: 'Md Robiul Islam',
    achievement: 900,
    hourlyTarget: 100,
    dailyTarget: 1000,
  });

  it('carries the achievement in the shape the aggregators read', () => {
    const row = lineOutputDailyRow(record);
    expect(row.date).toBe('2026-10-17');
    expect(row.entry_type).toBe('line');
    expect(row.output).toBe(900);
    expect(row.employee).toBe('Md Robiul Islam');
  });

  it('counts toward the day total and its stated target', () => {
    const summary = summariseDay([lineOutputDailyRow(record)], '2026-10-17');
    expect(summary.completedPieces).toBe(900);
    expect(summary.target).toBe(1000);
    expect(summary.achievement).toBe(90);
  });

  it('is one row per line and order, not one per process', () => {
    const a = lineOutputDailyRow(record);
    const b = lineOutputDailyRow({ ...record, process: 'Side Seam' });
    const daily = aggregateDaily([a, b], '2026-10-17');
    expect(daily).toHaveLength(1);
    // Two saved variants of the same line/day are summed, not shown as two rows.
    expect(daily[0].output).toBe(1800);
  });

  it('keeps a line entry out of the houred grid columns', () => {
    const daily = aggregateDaily([lineOutputDailyRow(record)], '2026-10-17');
    // The DAY sentinel is a whole-day total, not an hour cell.
    expect(Object.keys(daily[0].hours)).toEqual([]);
  });
});

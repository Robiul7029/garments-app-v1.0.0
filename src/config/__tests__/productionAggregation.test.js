import { describe, it, expect } from 'vitest';
import {
  aggregateDaily,
  groupDailyByEmployee,
  aggregateMonthly,
  summariseDay,
  efficiencyTone,
  operatorEfficiencyPercent,
  operatorDayRows,
  operatorEfficiencyRows,
  averageEfficiency,
  aggregationKey,
  daysInMonth,
  monthKeyOf,
} from '../productionAggregation';

/**
 * The unified production architecture, pinned.
 *
 * Hourly Production is the single source of truth; the Daily all-employee sheet,
 * the Monthly matrix and the Overall Summary are three views of the same rows.
 * These tests fix the aggregation that makes that true, so the four views can
 * never quietly disagree about the same day.
 */
const ROWS = [
  // Robiul on Collar Attach, recorded at two different hours — must merge to ONE
  // daily line, because the key is employee + process + style + date.
  { id: 1, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Collar Attach', style: 'STY-1001', hours: { '08': 10, '09': 12 }, hourlyTarget: 30, workingHours: 10 },
  { id: 2, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Collar Attach', style: 'STY-1001', hours: { '15': 8 }, hourlyTarget: 30, workingHours: 10 },
  // The same person on a second process — a separate daily line.
  { id: 3, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Sleeve Join', style: 'STY-1001', hours: { '11': 20 }, hourlyTarget: 25, workingHours: 10 },
  // A second operator, same process, same day — their own line.
  { id: 4, date: '2026-10-12', employee: 'Mst Sarjina Akter', process: 'Collar Attach', style: 'STY-1001', hours: { '08': 25 }, hourlyTarget: 30, workingHours: 10 },
  // A different day, so the daily filter must exclude it.
  { id: 5, date: '2026-10-13', employee: 'Md Robiul Islam', process: 'Collar Attach', style: 'STY-1001', hours: { '08': 5 }, hourlyTarget: 30, workingHours: 10 },
];

describe('the aggregation key', () => {
  it('combines employee, process, style and date', () => {
    const a = aggregationKey({ employee: 'A', process: 'P', style: 'S', date: '2026-10-12' });
    const b = aggregationKey({ employee: 'a', process: 'p', style: 's', date: '2026-10-12' });
    // Case-insensitive, so "Collar Attach" and "collar attach" merge.
    expect(a).toBe(b);
  });

  it('separates two rows that differ only by process', () => {
    const a = aggregationKey({ employee: 'A', process: 'P1', style: 'S', date: 'D' });
    const b = aggregationKey({ employee: 'A', process: 'P2', style: 'S', date: 'D' });
    expect(a).not.toBe(b);
  });
});

describe('the daily all-employee sheet', () => {
  const daily = aggregateDaily(ROWS, '2026-10-12');

  it('merges repeat entries for the same employee/process into one line', () => {
    // Robiul's two Collar Attach entries are ONE line: 10 + 12 + 8 = 30.
    const robiulCollar = daily.find((r) => r.employee === 'Md Robiul Islam' && r.process === 'Collar Attach');
    expect(robiulCollar.output).toBe(30);
    expect(robiulCollar.entryIds).toEqual([1, 2]);
  });

  it('keeps a separate line per process', () => {
    const robiul = daily.filter((r) => r.employee === 'Md Robiul Islam');
    expect(robiul).toHaveLength(2);
    expect(robiul.map((r) => r.process).sort()).toEqual(['Collar Attach', 'Sleeve Join']);
  });

  it('does not mix two employees on the same process', () => {
    const collar = daily.filter((r) => r.process === 'Collar Attach');
    expect(collar).toHaveLength(2);
    expect(collar.map((r) => r.employee).sort()).toEqual(['Md Robiul Islam', 'Mst Sarjina Akter']);
  });

  it('excludes other days', () => {
    expect(daily.every((r) => r.date === '2026-10-12')).toBe(true);
  });

  it('takes the target as the highest rate, not the sum of rates', () => {
    // Two entries at 30/hr must not give a 60/hr target.
    const robiulCollar = daily.find((r) => r.employee === 'Md Robiul Islam' && r.process === 'Collar Attach');
    expect(robiulCollar.target).toBe(30);
    // Daily target is the rate over the day's hours: 30 × 10 = 300.
    expect(robiulCollar.dailyTarget).toBe(300);
  });

  it('computes variance and efficiency from the day target', () => {
    const robiulCollar = daily.find((r) => r.employee === 'Md Robiul Islam' && r.process === 'Collar Attach');
    expect(robiulCollar.variance).toBe(30 - 300);
    expect(robiulCollar.efficiency).toBe(10); // 30 / 300 × 100
  });
});

describe('grouping the daily sheet by employee', () => {
  const groups = groupDailyByEmployee(aggregateDaily(ROWS, '2026-10-12'));

  it('writes each employee name once', () => {
    expect(groups.map((g) => g.employee).sort()).toEqual(['Md Robiul Islam', 'Mst Sarjina Akter']);
  });

  it('puts every process that person ran under their one name', () => {
    const robiul = groups.find((g) => g.employee === 'Md Robiul Islam');
    expect(robiul.rows).toHaveLength(2);
    expect(robiul.totals.output).toBe(50); // 30 + 20
    expect(robiul.totals.processCount).toBe(2);
  });

  it('reports the group day efficiency from its own totals', () => {
    const robiul = groups.find((g) => g.employee === 'Md Robiul Islam');
    // Target: Collar Attach 300 + Sleeve Join 250 = 550; output 50 → 9.1%.
    expect(robiul.totals.target).toBe(550);
    expect(robiul.totals.efficiency).toBe(9.1);
  });
});

describe('the overall summary dashboard', () => {
  const summary = summariseDay(ROWS, '2026-10-12');

  it('totals the factory output for the day', () => {
    // Robiul 30 + 20, Sarjina 25 = 75.
    expect(summary.completedPieces).toBe(75);
    expect(summary.activeEmployees).toBe(2);
  });

  it('breaks the total down per process', () => {
    const collar = summary.byProcess.find((p) => p.process === 'Collar Attach');
    // Robiul 30 + Sarjina 25 = 55.
    expect(collar.output).toBe(55);
  });

  it('states achievement against the day target', () => {
    // Target: 300 + 300 (collar, both operators) + 250 (sleeve) = 850.
    expect(summary.target).toBe(850);
    expect(summary.achievement).toBe(8.8); // 75 / 850 × 100
  });

  it('counts defects recorded on the rows', () => {
    const withDefects = [...ROWS, { id: 9, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Collar Attach', style: 'STY-1001', hours: { '16': 5 }, defect_qty: 2, hourlyTarget: 30, workingHours: 10 }];
    expect(summariseDay(withDefects, '2026-10-12').defects).toBe(2);
  });

  it('names the top performer', () => {
    expect(summary.topPerformer.employee).toBe('Md Robiul Islam');
  });
});

describe('the monthly matrix', () => {
  const monthly = aggregateMonthly(ROWS, '2026-10');

  it('has one row per employee', () => {
    expect(monthly.map((r) => r.employee).sort()).toEqual(['Md Robiul Islam', 'Mst Sarjina Akter']);
  });

  it('places each day output in its own column', () => {
    const robiul = monthly.find((r) => r.employee === 'Md Robiul Islam');
    // The 12th is the day's TOTAL across both processes: 30 collar + 20 sleeve.
    expect(robiul.days[11]).toBe(50);
    expect(robiul.days[12]).toBe(5);  // 13th (index 12)
  });

  it('counts active days and the month total', () => {
    const robiul = monthly.find((r) => r.employee === 'Md Robiul Islam');
    expect(robiul.activeDays).toBe(2);
    expect(robiul.totalOutput).toBe(55); // 30 + 20 + 5
  });

  it('carries working hours and a monthly efficiency', () => {
    const robiul = monthly.find((r) => r.employee === 'Md Robiul Islam');
    // Hours are per DAY, so two working days at 10h each is 20 — not 30, which
    // would count the same day once per process.
    expect(robiul.workingHours).toBe(20);
    expect(robiul.totalTarget).toBe(850);
    expect(robiul.efficiency).toBe(6.5); // 55 / 850 × 100
  });

  it('knows how many days each month has', () => {
    expect(daysInMonth('2026-10')).toBe(31);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2024-02')).toBe(29); // leap year
  });

  it('derives the month key from a date', () => {
    expect(monthKeyOf('2026-10-12')).toBe('2026-10');
  });
});

/**
 * The per-day detail behind each cell.
 *
 * The rich cell and the day-breakdown modal both read `dayDetails`, so its shape
 * and its arithmetic are pinned here. The key property is that the detail's day
 * totals are the SAME numbers the flat `days`/`dayTargets` arrays hold — a cell's
 * headline figure and the breakdown behind it must never describe the day
 * differently.
 */
describe('the per-day breakdown behind each cell', () => {
  const DETAIL_ROWS = [
    {
      id: 1, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Collar Attach',
      style: 'STY-1001', department: 'SEWING', attendance: 'Present', line_no: 'Line-3',
      order_no: 'PO-105', hours: { '08': 120, '09': 80 }, hourlyTarget: 20, workingHours: 10,
    },
    // The same process, recorded again later the same day — must merge into ONE
    // process line, exactly as the daily sheet groups the same work.
    {
      id: 2, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Collar Attach',
      style: 'STY-1001', department: 'SEWING', attendance: 'Present', line_no: 'Line-3',
      order_no: 'PO-105', hours: { '15': 60 }, hourlyTarget: 20, workingHours: 10,
    },
    {
      id: 3, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Sleeve Join',
      style: 'STY-1001', department: 'SEWING', attendance: 'Present', line_no: 'Line-3',
      order_no: 'PO-105', hours: { '10': 100, '11': 80 }, hourlyTarget: 20, workingHours: 10,
    },
  ];

  const monthly = aggregateMonthly(DETAIL_ROWS, '2026-10');
  const robiul = monthly.find((r) => r.employee === 'Md Robiul Islam');
  const day12 = robiul.dayDetails[11];

  it('carries the department, attendance, line and order for the day', () => {
    expect(day12.department).toBe('SEWING');
    expect(day12.attendance).toBe('Present');
    expect(day12.line).toBe('Line-3');
    expect(day12.order_no).toBe('PO-105');
  });

  it('itemises each process once, with its own output and target', () => {
    expect(day12.processes.map((p) => p.process)).toEqual(['Collar Attach', 'Sleeve Join']);
    const collar = day12.processes.find((p) => p.process === 'Collar Attach');
    // 120 + 80 + 60 = 260, merged from the two records of the same process.
    expect(collar.output).toBe(260);
    // Its target is the rate over the hours worked, counted once for the day.
    expect(collar.target).toBe(200);
    expect(collar.achievement).toBe(130);
  });

  it('states each process achievement as its own percentage', () => {
    const sleeve = day12.processes.find((p) => p.process === 'Sleeve Join');
    expect(sleeve.output).toBe(180);
    expect(sleeve.achievement).toBe(90);
  });

  it('reports the day cumulative totals and the shortfall', () => {
    // 260 collar + 180 sleeve = 440 against a 400 day target.
    expect(day12.totalOutput).toBe(440);
    expect(day12.totalTarget).toBe(400);
    expect(day12.surplus).toBe(40);
    expect(day12.due).toBe(0);
    expect(day12.efficiency).toBe(110);
  });

  it('reports a shortfall as a positive Due figure, never a negative one', () => {
    const shortRows = [{
      id: 1, date: '2026-10-12', employee: 'A', process: 'P', hours: { '08': 50 },
      hourlyTarget: 20, workingHours: 10,
    }];
    const day = aggregateMonthly(shortRows, '2026-10').find((r) => r.employee === 'A').dayDetails[11];
    // 50 made against a 200 target.
    expect(day.totalOutput).toBe(50);
    expect(day.totalTarget).toBe(200);
    expect(day.due).toBe(150);
    expect(day.surplus).toBe(0);
    expect(day.efficiency).toBe(25);
  });

  it('agrees with the flat per-day figure the cell headlines', () => {
    // The detail's totals and the arrays the cell reads are the same numbers.
    expect(day12.totalOutput).toBe(robiul.days[11]);
    expect(day12.totalTarget).toBe(Math.round(robiul.dayTargets[11]));
    expect(day12.hours).toBe(robiul.dayHours[11]);
  });

  it('leaves a day with no work as null rather than an empty object', () => {
    expect(robiul.dayDetails[12]).toBeNull();
    expect(robiul.dayDetails[0]).toBeNull();
  });
});

/**
 * The brief's day-efficiency colour bands: green ≥100%, yellow 80–99%, red <80%.
 * Stated as a function so the cell, the modal and any export band identically.
 */
describe('the day efficiency colour bands', () => {
  it('is good at 100% and above', () => {
    expect(efficiencyTone(100)).toBe('good');
    expect(efficiencyTone(140)).toBe('good');
  });

  it('is warning between 80% and 99%', () => {
    expect(efficiencyTone(80)).toBe('warning');
    expect(efficiencyTone(95)).toBe('warning');
    expect(efficiencyTone(99.9)).toBe('warning');
  });

  it('is critical below 80%', () => {
    expect(efficiencyTone(79.9)).toBe('critical');
    expect(efficiencyTone(0)).toBe('critical');
  });
});

describe('operator efficiency — the SMV formula', () => {
  it('is (pieces × SMV) / active minutes', () => {
    // 100 pieces × 1.5 SMV = 150 allowed minutes, over 300 worked = 0.5 → 50%.
    expect(operatorEfficiencyPercent({ producedPieces: 100, smvMinutes: 1.5, activeMinutes: 300 })).toBe(50);
  });

  it('reports 0 rather than infinity when no minutes were worked', () => {
    expect(operatorEfficiencyPercent({ producedPieces: 100, smvMinutes: 1.5, activeMinutes: 0 })).toBe(0);
  });

  it('reports 0 when the operation has no SMV', () => {
    expect(operatorEfficiencyPercent({ producedPieces: 100, smvMinutes: 0, activeMinutes: 300 })).toBe(0);
  });

  it('gives 100% when the operator exactly matches the standard', () => {
    // 60 pieces × 5 SMV = 300 allowed minutes = 300 worked → 100%.
    expect(operatorEfficiencyPercent({ producedPieces: 60, smvMinutes: 5, activeMinutes: 300 })).toBe(100);
  });
});

describe('the operator performance rows', () => {
  const smv = { 'Collar Attach': 2, 'Sleeve Join': 1.5 };

  it('rolls a day up per operator', () => {
    const rows = operatorDayRows(ROWS, '2026-10-12');
    const robiul = rows.find((r) => r.employee === 'Md Robiul Islam');
    expect(robiul.output).toBe(50);
    expect(robiul.processes).toHaveLength(2);
  });

  it('uses the SMV of each operation in the efficiency figure', () => {
    const rows = operatorEfficiencyRows(ROWS, '2026-10-12', smv);
    const robiul = rows.find((r) => r.employee === 'Md Robiul Islam');
    // Allowed minutes: collar 30 × 2 = 60, sleeve 20 × 1.5 = 30 → 90.
    expect(robiul.allowedMinutes).toBe(90);
    // Worked: 10 hours × 60 = 600 minutes.
    expect(robiul.activeMinutes).toBe(600);
    expect(robiul.efficiency).toBe(15); // 90 / 600 × 100
  });

  it('averages the operators who have a figure', () => {
    const rows = operatorEfficiencyRows(ROWS, '2026-10-12', smv);
    // Robiul 15%, Sarjina 25 × 2 = 50 / 600 = 8.3%.
    expect(averageEfficiency(rows)).toBe(11.7); // (15 + 8.3) / 2
  });

  it('returns 0 for an empty set rather than NaN', () => {
    expect(averageEfficiency([])).toBe(0);
  });
});
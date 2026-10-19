import { describe, it, expect } from 'vitest';
import {
  parseOperations,
  buildProcessSheet,
  withRecomputedTotals,
  detectLineOutputProcess,
  lineOutputProcessFor,
  readLineOutputFlag,
} from '../orderWorkflow';
import {
  aggregateLineOutput,
  lineOutputByOperator,
  lineOutputSummary,
  findLineOutputOverride,
  buildLineOutputOverride,
  LINE_OUTPUT_OVERRIDE_COLLECTION,
} from '../productionAggregation';

/**
 * The Line Output feature, pinned.
 *
 * Which operation IS the line's output can be set two ways — the uploaded sheet's
 * own column (Option A) or the in-app dropdown (Option B) — and either way the
 * designation lands on the sheet and the aggregation sums the operator output
 * logged under it. A manual override replaces the aggregate only after a
 * confirmation, and the aggregate is kept beside it.
 */
describe('Option A — reading the Line Output designation from a sheet', () => {
  it('marks the operation the sheet\'s Line Output column ticks', () => {
    const rows = parseOperations([
      ['Operation', 'Machine', 'SMV', 'Line Output'],
      ['Collar Attach', 'Overlock', 1.2, ''],
      ['Body Complete', 'Single Needle', 4.0, 'Yes'],
      ['Sleeve Join', 'Overlock', 1.5, ''],
    ]);
    expect(rows.map((r) => r.lineOutput)).toEqual([false, true, false]);
    expect(detectLineOutputProcess(rows)).toBe('Body Complete');
  });

  it('accepts the operation\'s own name in the flag cell', () => {
    const rows = parseOperations([
      ['Operation', 'SMV', 'Line Output'],
      ['Collar Attach', 1.2, 'Collar Attach'],
      ['Body Complete', 4.0, ''],
    ]);
    expect(detectLineOutputProcess(rows)).toBe('Collar Attach');
  });

  it('does not treat an explicit No / 0 as a designation', () => {
    const rows = parseOperations([
      ['Operation', 'SMV', 'Line Output'],
      ['Collar Attach', 1.2, 'No'],
      ['Body Complete', 4.0, '0'],
    ]);
    expect(rows.every((r) => r.lineOutput === false)).toBe(true);
    expect(detectLineOutputProcess(rows)).toBe('');
  });

  it('reads a truthy flag in any of its common spellings', () => {
    ['Yes', 'Y', 'true', '1', '✓', '✔'].forEach((v) => {
      expect(readLineOutputFlag(v, 'Any Op')).toBe(true);
    });
    ['No', 'N', 'false', '0', '', 'n/a'].forEach((v) => {
      expect(readLineOutputFlag(v, 'Any Op')).toBe(false);
    });
  });

  it('records the designation on the sheet when the file marked one', () => {
    const rows = parseOperations([
      ['Operation', 'SMV', 'Line Output'],
      ['Collar Attach', 1.2, ''],
      ['Body Complete', 4.0, 'Yes'],
    ]);
    const sheet = buildProcessSheet({ style: 'STY-1001', operations: rows });
    expect(sheet.lineOutputProcess).toBe('Body Complete');
  });

  it('leaves the designation blank when the file has no Line Output column', () => {
    const rows = parseOperations([
      ['Operation', 'SMV'],
      ['Collar Attach', 1.2],
    ]);
    const sheet = buildProcessSheet({ style: 'STY-1001', operations: rows });
    expect(sheet.lineOutputProcess).toBe('');
  });
});

describe('Option B — the in-app designation', () => {
  it('reads the designation back through the shared reader', () => {
    const sheets = [{ id: 1, style: 'STY-1001', uploadedAt: '2026-10-01', operations: [], lineOutputProcess: 'Body Complete' }];
    expect(lineOutputProcessFor(sheets, { style: 'STY-1001' })).toBe('Body Complete');
  });

  it('carries the designation through a totals recompute', () => {
    const sheet = { id: 1, style: 'S', operations: [{ operation: 'A', smv: 1 }], lineOutputProcess: 'A' };
    expect(withRecomputedTotals(sheet).lineOutputProcess).toBe('A');
  });

  it('drops a designation that names an operation no longer on the sheet', () => {
    const sheet = { id: 1, style: 'S', operations: [{ operation: 'A', smv: 1 }], lineOutputProcess: 'Removed Op' };
    expect(withRecomputedTotals(sheet).lineOutputProcess).toBe('');
  });
});

describe('the auto-aggregation', () => {
  const ROWS = [
    { id: 1, date: '2026-10-12', employee: 'Md Robiul', process: 'Body Complete', hours: { '08': 30, '09': 20 } },
    { id: 2, date: '2026-10-12', employee: 'Mst Sarjina', process: 'Body Complete', hours: { '08': 25 } },
    { id: 3, date: '2026-10-12', employee: 'Md Robiul', process: 'Collar Attach', hours: { '08': 40 } },
    { id: 4, date: '2026-10-13', employee: 'Md Robiul', process: 'Body Complete', hours: { '08': 99 } },
  ];

  it('sums only the designated process, for the selected day', () => {
    // 30 + 20 + 25 = 75; the Collar Attach row and the other day are excluded.
    expect(aggregateLineOutput(ROWS, 'Body Complete', '2026-10-12')).toBe(75);
  });

  it('matches the process case- and whitespace-insensitively', () => {
    expect(aggregateLineOutput(ROWS, '  body complete ', '2026-10-12')).toBe(75);
  });

  it('itemises the sum per operator', () => {
    const byOp = lineOutputByOperator(ROWS, 'Body Complete', '2026-10-12');
    expect(byOp).toEqual([
      { employee: 'Md Robiul', output: 50, defects: 0 },
      { employee: 'Mst Sarjina', output: 25, defects: 0 },
    ]);
  });

  it('reports the auto figure with no override in force', () => {
    const s = lineOutputSummary(ROWS, { lineOutputProcess: 'Body Complete' }, '2026-10-12');
    expect(s.hasProcess).toBe(true);
    expect(s.autoOutput).toBe(75);
    expect(s.manual).toBe(false);
    expect(s.output).toBe(75);
  });
});

describe('the manual override', () => {
  const ROWS = [
    { id: 1, date: '2026-10-12', employee: 'A', process: 'Body Complete', hours: { '08': 50 } },
  ];

  it('displays the manual value while keeping the aggregate beside it', () => {
    const s = lineOutputSummary(
      ROWS,
      { lineOutputProcess: 'Body Complete' },
      '2026-10-12',
      { manual: true, value: 60, process: 'Body Complete' },
    );
    expect(s.manual).toBe(true);
    expect(s.manualValue).toBe(60);
    expect(s.output).toBe(60);
    expect(s.autoOutput).toBe(50);
    expect(s.variance).toBe(10);
  });

  it('finds the override for the right style AND day only', () => {
    const overrides = [
      buildLineOutputOverride({ style: 'STY-1001', date: '2026-10-12', value: 60, manual: true }),
      buildLineOutputOverride({ style: 'STY-1002', date: '2026-10-12', value: 10, manual: true }),
    ];
    expect(findLineOutputOverride(overrides, { style: 'STY-1001', date: '2026-10-12' })?.value).toBe(60);
    // A different day is a different record — a manual figure does not leak.
    expect(findLineOutputOverride(overrides, { style: 'STY-1001', date: '2026-10-13' })).toBeNull();
  });

  it('keys the override by style + date', () => {
    const rec = buildLineOutputOverride({ style: 'STY-1001', date: '2026-10-12', value: 60, manual: true });
    expect(rec.id).toBe('STY-1001__2026-10-12');
    expect(rec.manual).toBe(true);
  });

  it('restores the auto figure when the override is cleared', () => {
    const cleared = buildLineOutputOverride({ style: 'STY-1001', date: '2026-10-12', value: 0, manual: false });
    expect(cleared.manual).toBe(false);
    const s = lineOutputSummary(ROWS, { lineOutputProcess: 'Body Complete' }, '2026-10-12', cleared);
    expect(s.output).toBe(50);
  });

  it('targets its own collection', () => {
    expect(LINE_OUTPUT_OVERRIDE_COLLECTION).toBe('line-output-overrides');
  });
});
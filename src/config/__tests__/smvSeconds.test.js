import { describe, it, expect } from 'vitest';
import {
  normaliseToMinutes,
  readOperationSmv,
  parseOperations,
  totalSmvOf,
  buildProcessSheet,
} from '../orderWorkflow';
import {
  smvMinutes,
  detectSmvUnit,
  evaluateSmvTotal,
  calculateCapacity,
  targetForOperation,
} from '../smvTargetEngine';

/**
 * Seconds-based SMV.
 *
 * Breakdown sheets state their standard times in either unit, and a seconds sheet
 * read as minutes makes every target 60× wrong — the most expensive way this can
 * fail, because the number still looks plausible. These tests pin the conversion
 * at each point it can happen.
 */
describe('reading a sheet written in seconds', () => {
  // Rows as `parseOperations` produces them: already normalised to minutes.
  const asMinuteRows = () => [{ smv: 1440 }, { smv: 1380 }, { smv: 1500 }].map((r) => ({ ...r, smv: r.smv / 60 }));

  it('converts a seconds column to minutes', () => {
    // 72 seconds is 1.2 standard minutes.
    expect(normaliseToMinutes(72, 'seconds')).toBe(1.2);
  });

  it('leaves a minutes column alone', () => {
    expect(normaliseToMinutes(1.2, 'minutes')).toBe(1.2);
  });

  it('treats an unlabelled value of 60 or more as seconds', () => {
    // No operation takes 60 standard minutes, so 72 cannot be minutes.
    expect(normaliseToMinutes(72)).toBe(1.2);
    // …while 1.2 plainly is.
    expect(normaliseToMinutes(1.2)).toBe(1.2);
  });

  it('reads a seconds total of 4320 as 72 minutes', () => {
    expect(evaluateSmvTotal(4320, 'seconds')).toBe(72);
  });

  it('does not divide a minutes total by 60', () => {
    expect(evaluateSmvTotal(72, 'minutes')).toBe(72);
    // A large but genuine minutes total survives when it is consistent with the
    // rows it came from.
    expect(evaluateSmvTotal(72, 'minutes', asMinuteRows())).toBe(72);
  });

  it('infers seconds from an operations list when no unit is declared', () => {
    expect(evaluateSmvTotal(4320, undefined, [{ smv: 1200 }, { smv: 3120 }])).toBe(72);
  });

  it('does not mistake one heavy operation for a change of unit', () => {
    // A minute-based sheet with one long operation stays in minutes.
    expect(detectSmvUnit([{ smv: 1.2 }, { smv: 70 }])).toBe('minutes');
    // A sheet where EVERY value is large is a seconds sheet.
    expect(detectSmvUnit([{ smv: 1200 }, { smv: 3120 }])).toBe('seconds');
  });
});

describe('parsing a seconds-based sheet', () => {
  const grid = [
    ['Operation', 'Machine', 'Seconds'],
    ['Collar Attach', 'Overlock', 72],
    ['Sleeve Join', 'Overlock', 90],
    ['Side Seam', 'Flatlock', 108],
  ];

  it('normalises every row to minutes as it is read', () => {
    const rows = parseOperations(grid);
    expect(rows.map((r) => r.smv)).toEqual([1.2, 1.5, 1.8]);
  });

  it('sums to minutes, not to seconds', () => {
    const rows = parseOperations(grid);
    // 72 + 90 + 108 = 270 seconds = 4.5 minutes.
    expect(totalSmvOf(rows)).toBe(4.5);
    expect(totalSmvOf(rows)).not.toBe(270);
  });

  it('still reads a plain SMV/minutes header', () => {
    const rows = parseOperations([
      ['Operation', 'Machine', 'SMV'],
      ['Collar Attach', 'Overlock', 1.2],
    ]);
    expect(rows[0].smv).toBe(1.2);
  });

  it('handles a sheet in seconds end to end into a target', () => {
    // 4.5 total SMV minutes, 25 operators, 8 hours, 70%:
    // 12000 minutes ÷ 4.5 = 2666.67 at 100% → ×0.7 = 1866/day → ÷8 = 233/hr.
    const rows = parseOperations(grid);
    const capacity = calculateCapacity(rows, { manpower: 25, workingHours: 8, efficiency: 70 });
    expect(capacity.totalSmv).toBe(4.5);
    expect(capacity.line.dailyTarget).toBe(1866);
    expect(capacity.line.hourlyTarget).toBe(233);
  });
});

describe('saving a seconds-based sheet', () => {
  it('stores the total in minutes and keeps the seconds figure', () => {
    const record = buildProcessSheet({
      style: 'STY-1001',
      order_no: 'PO-105',
      fileName: 'sheet.xlsx',
      operations: parseOperations([
        ['Operation', 'Seconds'],
        ['Collar Attach', 4320],
      ]),
      smvUnit: 'seconds',
    });
    // 4320 seconds is 72 standard minutes — stored as minutes, so every existing
    // reader keeps working without knowing the sheet was in seconds.
    expect(record.totalSmv).toBe(72);
    expect(record.smvUnit).toBe('seconds');
    expect(record.totalSmvSeconds).toBe(4320);
  });

  it('records a minutes sheet as minutes', () => {
    const record = buildProcessSheet({
      style: 'STY-1001',
      operations: [{ operation: 'Collar Attach', smv: 1.2 }],
    });
    expect(record.totalSmv).toBe(1.2);
    expect(record.smvUnit).toBe('minutes');
    expect(record.totalSmvSeconds).toBe(72);
  });

  it('exposes the total to the other modules without re-conversion', () => {
    // What Hourly Production and the Capacity panel read off a saved sheet.
    const record = buildProcessSheet({
      style: 'STY-1001',
      operations: [{ operation: 'Collar Attach', smv: 1.2 }, { operation: 'Side Seam', smv: 1.8 }],
    });
    expect(record.totalSmv).toBe(3);
    expect(evaluateSmvTotal(record.totalSmv, record.smvUnit)).toBe(3);
  });
});

describe('the engine guards against a raw seconds value', () => {
  it('reads a row carrying only seconds', () => {
    expect(smvMinutes({ seconds: 72 })).toBe(1.2);
  });

  it('does not treat a 1.2 value as seconds', () => {
    expect(smvMinutes({ smv: 1.2 })).toBe(1.2);
  });

  it('honours a declared seconds unit on the row value', () => {
    expect(smvMinutes({ smv: 72 }, 'seconds')).toBe(1.2);
  });

  it('gives the same target whether the SMV arrives in minutes or seconds', () => {
    const settings = { manpower: 25, workingHours: 8, efficiency: 70 };
    const fromMinutes = targetForOperation({
      operations: [{ operation: 'Collar Attach', smv: 1.2 }],
      settings,
      operationName: 'Collar Attach',
    });
    const fromSeconds = targetForOperation({
      operations: [{ operation: 'Collar Attach', seconds: 72 }],
      settings,
      operationName: 'Collar Attach',
    });
    expect(fromSeconds.hourlyTarget).toBe(fromMinutes.hourlyTarget);
    expect(fromSeconds.smv).toBe(1.2);
  });
});

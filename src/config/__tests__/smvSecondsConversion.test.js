import { describe, it, expect } from 'vitest';
import { calculateCapacity, smvMinutes, evaluateSmvTotal } from '../smvTargetEngine';
import { parseOperations, buildProcessSheet, totalSmvOf } from '../orderWorkflow';

/**
 * The seconds-to-minutes bug in Capacity & Target.
 *
 * The reported symptom was a line target of about 2 pcs with a 4320-second sheet,
 * 25 operators, 10 hours and 70% efficiency. 2 pcs is what 15,000 available
 * minutes divided by 4,320 "SMV" looks like — i.e. a seconds total used as if it
 * were minutes. Every case below is a way that total can arrive, and each one must
 * land on the same realistic figures:
 *
 *   15,000 minutes ÷ 72 SMV = 208.33 at 100% → ×0.7 = 145 pcs/day → 14 pcs/hour
 */
const SETTINGS = { manpower: 25, workingHours: 10, efficiency: 70 };
const EXPECTED = { totalSmv: 72, daily: 145, hourly: 14 };

const asSeconds = [
  { operation: 'Collar Attach', machine: 'Overlock', smv: 1440 },
  { operation: 'Sleeve Join', machine: 'Overlock', smv: 1380 },
  { operation: 'Side Seam', machine: 'Flatlock', smv: 1500 },
];
const asMinutes = asSeconds.map((r) => ({ ...r, smv: r.smv / 60 }));

describe('the reported case: a 4320-second sheet is not read as 4320 minutes', () => {
  it('converts rows carrying raw seconds, with no unit declared', () => {
    const c = calculateCapacity(asSeconds, SETTINGS);
    expect(c.totalSmv).toBe(EXPECTED.totalSmv);
    expect(c.line.dailyTarget).toBe(EXPECTED.daily);
    expect(c.line.hourlyTarget).toBe(EXPECTED.hourly);
  });

  it('gives the SAME figures when the unit is declared seconds', () => {
    const c = calculateCapacity(asSeconds, { ...SETTINGS, smvUnit: 'seconds' });
    expect(c.totalSmv).toBe(EXPECTED.totalSmv);
    expect(c.line.dailyTarget).toBe(EXPECTED.daily);
  });

  it('never reports the 2-piece symptom', () => {
    const c = calculateCapacity(asSeconds, SETTINGS);
    expect(c.line.dailyTarget).not.toBe(2);
    expect(c.line.dailyTarget).toBeGreaterThan(100);
    // 15000 ÷ 4320 × 0.7 is the wrong answer this guards against.
    expect(c.totalSmv).not.toBe(4320);
  });

  it('agrees with rows that were already normalised to minutes', () => {
    const fromSeconds = calculateCapacity(asSeconds, SETTINGS);
    const fromMinutes = calculateCapacity(asMinutes, SETTINGS);
    expect(fromSeconds.totalSmv).toBe(fromMinutes.totalSmv);
    expect(fromSeconds.line.dailyTarget).toBe(fromMinutes.line.dailyTarget);
    expect(fromSeconds.line.hourlyTarget).toBe(fromMinutes.line.hourlyTarget);
  });
});

describe('a row value too large to be minutes is treated as seconds', () => {
  it('converts a single 60+ value', () => {
    expect(smvMinutes({ smv: 1440 })).toBe(24);
  });

  it('leaves ordinary minute values alone', () => {
    expect(smvMinutes({ smv: 1.2 })).toBe(1.2);
    expect(smvMinutes({ smv: 24 })).toBe(24);
    expect(smvMinutes({ smv: 59 })).toBe(59);
  });

  it('converts the large row in a MIXED sheet without touching the small ones', () => {
    // 1.2 + 1.5 + (72 s → 1.2) = 3.9 minutes.
    const c = calculateCapacity(
      [{ operation: 'a', smv: 1.2 }, { operation: 'b', smv: 1.5 }, { operation: 'c', smv: 72 }],
      SETTINGS,
    );
    expect(c.totalSmv).toBe(3.9);
  });

  it('does not divide a small value again just because the sheet is labelled seconds', () => {
    // Rows arrive already normalised, so honouring the label here would make every
    // target 60× too low — the same fault, from the other direction.
    expect(smvMinutes({ smv: 1.2 }, 'seconds')).toBe(1.2);
    const declared = calculateCapacity(asMinutes, { ...SETTINGS, smvUnit: 'seconds' });
    expect(declared.line.dailyTarget).toBe(EXPECTED.daily);
  });
});

describe('a total is not converted twice', () => {
  it('leaves a stored minutes total alone even when the sheet is labelled seconds', () => {
    // The double-division bug: 72 → 1.2 made the line look almost incapable.
    // A stored total is already minutes, so the 'seconds' label — which describes
    // the ROWS, not the total — must not divide it again.
    expect(evaluateSmvTotal(72, 'seconds')).toBe(72);
    expect(evaluateSmvTotal(4.5, 'seconds')).toBe(4.5);
  });

  it('does not re-divide a total when it is given the rows it came from', () => {
    // The rows are ALREADY minutes, so a total consistent with them is returned as
    // is. This is the same guard seen from the row side, which is how the Capacity
    // panel and Line Balancing actually call it.
    const rows = asMinutes; // [24, 23, 25] minutes
    expect(evaluateSmvTotal(72, 'seconds', rows)).toBe(72);
  });

  it('does divide a total that is impossibly larger than its own rows', () => {
    // 4320 cannot coexist with rows summing to 72 minutes; it is a seconds figure.
    const rows = [{ operation: 'a', smv: 1.2 }];
    expect(evaluateSmvTotal(72, 'seconds', rows)).toBe(1.2);
    expect(evaluateSmvTotal(4320, 'seconds', asSeconds)).toBe(72);
  });

  it('converts a bare seconds total when told the total itself is seconds', () => {
    expect(evaluateSmvTotal(4320, 'seconds', [], true)).toBe(72);
  });

  it('re-derives the total from rows when rows are given', () => {
    expect(evaluateSmvTotal(4320, 'seconds', asSeconds)).toBe(72);
  });

  it('is a no-op for an ordinary minutes total', () => {
    expect(evaluateSmvTotal(4.5, 'minutes')).toBe(4.5);
  });
});

describe('the whole path: parse → save → calculate', () => {
  it('keeps the figures realistic from the uploaded sheet to the line target', () => {
    const parsed = parseOperations([
      ['Operation', 'Machine', 'Seconds'],
      ['Collar Attach', 'Overlock', 1440],
      ['Sleeve Join', 'Overlock', 1380],
      ['Side Seam', 'Flatlock', 1500],
      // A summary row that must not be counted as an operation.
      ['TOTAL', '', 4320],
    ]);
    expect(parsed.map((r) => r.smv)).toEqual([24, 23, 25]);
    expect(totalSmvOf(parsed)).toBe(72);

    const saved = buildProcessSheet({ style: 'STY-1001', orderNo: 'PO-105', operations: parsed, smvUnit: 'seconds' });
    expect(saved.totalSmv).toBe(72);
    expect(saved.totalSmvSeconds).toBe(4320);

    // What the Capacity & Target panel renders from the saved sheet.
    const c = calculateCapacity(saved.operations, SETTINGS);
    expect(c.totalSmv).toBe(EXPECTED.totalSmv);
    expect(c.line.dailyTarget).toBe(EXPECTED.daily);
    expect(c.line.hourlyTarget).toBe(EXPECTED.hourly);
    expect(c.line.perOperatorDaily).toBe(5); // 145 ÷ 25
  });
});

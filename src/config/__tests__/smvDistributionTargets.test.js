import { describe, it, expect } from 'vitest';
import {
  distributeSmvByWeight,
  autoTargetForProcess,
  predefinedWeightFor,
  readTotalGarmentSmv,
  defaultWeightsFor,
  AUTO_TARGET_ALLOWANCE,
  STANDARD_DAY_HOURS,
} from '../smvTargetEngine';
import {
  buildProcessSheet,
  withRecomputedTotals,
  parseOperations,
  totalSmvOf,
  operationsForStyle,
  readWeightPercent,
} from '../orderWorkflow';

/**
 * The brief's three requirements, verified end to end:
 *
 *   1. Dynamic SMV distribution from the Total Garment SMV
 *        Process SMV = Total Garment SMV × (Weight % ÷ 100)
 *   2. Dynamic target derivation per process
 *        Base Hourly Capacity = 60 / Process SMV
 *        Auto Hourly Target   = Base Hourly Capacity × 1.05
 *        Auto Daily Target    = Auto Hourly Target × 10
 *   3. Excel view & edit integration — the computed figures are shown and stored
 *
 * The parser, the engine and the persistence layer are exercised together here,
 * because the failure this feature is prone to is not "the formula is wrong" but
 * "the three disagree": the preview showed one figure and the database saved another.
 */

// A pant breakdown as the brief describes it: 72 minutes total, six operations,
// none of which states its own SMV — exactly the case the distribution exists for.
const PANT_OPERATIONS = [
  { operation: 'Front Rise Join', machine: 'Overlock', section: 'Front' },
  { operation: 'Side Seam', machine: 'Overlock', section: 'Body' },
  { operation: 'Inseam Join', machine: 'Overlock', section: 'Body' },
  { operation: 'Waist Band Attach', machine: 'Flatlock', section: 'Waist' },
  { operation: 'Bottom Hem', machine: 'Flatlock', section: 'Leg' },
  { operation: 'Label Attach', machine: 'Single Needle', section: 'Waist' },
];

describe('1. dynamic SMV distribution from the total garment time', () => {
  it('reads the total garment SMV the brief asks for', () => {
    expect(readTotalGarmentSmv('72')).toBe(72);
    expect(readTotalGarmentSmv('72 min')).toBe(72);
    expect(readTotalGarmentSmv(' 72 minutes ')).toBe(72);
    expect(readTotalGarmentSmv('')).toBe(0);
    expect(readTotalGarmentSmv('abc')).toBe(0);
  });

  it('distributes the garment total so the rows sum to exactly that total', () => {
    const rows = distributeSmvByWeight(PANT_OPERATIONS, 72);
    expect(rows).toHaveLength(6);
    // The invariant the brief depends on: the distributed SMVs add up to the
    // garment total, so the sheet cannot advertise a total its rows do not make.
    expect(totalSmvOf(rows)).toBeCloseTo(72, 2);
    // Every row got a share of the time, none was dropped.
    rows.forEach((r) => expect(r.smv).toBeGreaterThan(0));
    // Every row is marked as computed rather than stated by the sheet.
    rows.forEach((r) => expect(r.smvSource).toBe('distributed'));
  });

  it('applies Process SMV = Total × (Weight % ÷ 100) for an explicit weight', () => {
    const rows = distributeSmvByWeight(
      [{ operation: 'Collar Attach', weight: 25 }, { operation: 'Cuff', weight: 75 }],
      100,
    );
    expect(rows[0].smv).toBeCloseTo(25, 2);
    expect(rows[1].smv).toBeCloseTo(75, 2);
    expect(rows[0].weightPercent).toBeCloseTo(25, 2);
    expect(rows[1].weightPercent).toBeCloseTo(75, 2);
  });

  it('leaves an operation that states its own SMV untouched', () => {
    const rows = distributeSmvByWeight(
      [
        { operation: 'Collar Attach', smv: 2 },
        { operation: 'Cuff' },
        { operation: 'Hem' },
      ],
      72,
    );
    // The stated row keeps its figure, and the remaining time is split between the
    // two that left theirs blank — the stated row is not handed extra time.
    expect(rows[0].smv).toBe(2);
    expect(rows[0].smvSource).toBe('sheet');
    expect(rows[1].smv + rows[2].smv).toBeCloseTo(70, 2);
  });

  it('falls back to the predefined complexity weights when no weight is given', () => {
    const rows = distributeSmvByWeight([{ operation: 'Label Attach' }, { operation: 'Collar Attach' }], 72);
    // Label Attach is lighter than Collar Attach in the complexity table, so it
    // gets the smaller share — the whole point of the fallback.
    expect(predefinedWeightFor('Collar Attach')).toBeGreaterThan(predefinedWeightFor('Label Attach'));
    expect(rows[0].smv).toBeLessThan(rows[1].smv);
    expect(totalSmvOf(rows)).toBeCloseTo(72, 2);
  });

  it('shows the fallback percentages before any total is typed', () => {
    const weights = defaultWeightsFor(PANT_OPERATIONS);
    expect(weights).toHaveLength(6);
    // The shares are stated as percentages that sum to ~100, so the preview's
    // Weight % column has something real to show.
    const sum = weights.reduce((s, w) => s + w.percent, 0);
    expect(sum).toBeGreaterThan(99);
    expect(sum).toBeLessThan(101);
  });

  it('reads a Weight % cell in every form a sheet writes it', () => {
    expect(readWeightPercent('25')).toBe(25);
    expect(readWeightPercent('25%')).toBe(25);
    expect(readWeightPercent('0.25')).toBe(25); // a spreadsheet percentage cell
    expect(readWeightPercent('')).toBeNull();
    expect(readWeightPercent('n/a')).toBeNull();
  });

  it('reads the Weight % column out of an uploaded sheet', () => {
    const grid = [
      ['Operation', 'Machine', 'Weight %'],
      ['Collar Attach', 'Overlock', '25'],
      ['Cuff', 'Flatlock', '75'],
      ['TOTAL', '', '100'],
    ];
    const rows = parseOperations(grid);
    expect(rows).toHaveLength(2);
    expect(rows[0].weight).toBe(25);
    expect(rows[1].weight).toBe(75);
  });
});

describe('2. dynamic target derivation per process', () => {
  it('computes Base Hourly Capacity = 60 / Process SMV', () => {
    expect(autoTargetForProcess(1.5).baseHourlyCapacity).toBe(40);
    expect(autoTargetForProcess(2).baseHourlyCapacity).toBe(30);
    expect(autoTargetForProcess(3).baseHourlyCapacity).toBe(20);
  });

  it('computes Auto Hourly Target = Base Hourly × 1.05', () => {
    // 60 / 2 = 30 base, × 1.05 = 31.5 → 31 pieces.
    const auto = autoTargetForProcess(2, AUTO_TARGET_ALLOWANCE);
    expect(auto.baseHourlyCapacity).toBe(30);
    expect(auto.hourlyTarget).toBe(31);
  });

  it('computes Auto Daily Target = Auto Hourly × 10', () => {
    const auto = autoTargetForProcess(2, AUTO_TARGET_ALLOWANCE);
    // 31.5 × 10 = 315 pieces for the ten-hour day.
    expect(STANDARD_DAY_HOURS).toBe(10);
    expect(auto.dailyTarget).toBe(315);
  });

  it('carries the derived targets onto every distributed row', () => {
    const rows = distributeSmvByWeight(PANT_OPERATIONS, 72);
    rows.forEach((r) => {
      const expected = autoTargetForProcess(r.smv, AUTO_TARGET_ALLOWANCE);
      expect(r.autoHourlyTarget).toBe(expected.hourlyTarget);
      expect(r.autoDailyTarget).toBe(expected.dailyTarget);
      expect(r.baseHourlyCapacity).toBe(expected.baseHourlyCapacity);
    });
  });

  it('reports no target rather than an invented one when SMV is missing', () => {
    const auto = autoTargetForProcess(0, AUTO_TARGET_ALLOWANCE);
    expect(auto.hasSmv).toBe(false);
    expect(auto.hourlyTarget).toBe(0);
    expect(auto.dailyTarget).toBe(0);
  });
});

describe('3. persistence — the saved sheet carries what the preview showed', () => {
  it('stores the total garment SMV on the sheet', () => {
    const saved = buildProcessSheet({
      style: 'STY-9001',
      order_no: 'PO-900',
      operations: distributeSmvByWeight(PANT_OPERATIONS, 72),
      totalGarmentSmv: 72,
    });
    expect(saved.totalGarmentSmv).toBe(72);
    expect(saved.totalSmv).toBeCloseTo(72, 2);
    expect(saved.operations).toHaveLength(6);
  });

  it('stores the computed target figures on each operation', () => {
    const saved = buildProcessSheet({
      style: 'STY-9001',
      order_no: 'PO-900',
      operations: distributeSmvByWeight(PANT_OPERATIONS, 72),
      totalGarmentSmv: 72,
      targetBuffer: AUTO_TARGET_ALLOWANCE,
    });
    saved.operations.forEach((op) => {
      expect(op.baseHourlyCapacity).toBeGreaterThan(0);
      expect(op.autoHourlyTarget).toBeGreaterThan(0);
      expect(op.autoDailyTarget).toBeGreaterThan(0);
      // The stored figures match the formula applied to the stored SMV, so the
      // database and the preview cannot disagree.
      expect(op.autoDailyTarget).toBe(autoTargetForProcess(op.smv, AUTO_TARGET_ALLOWANCE).dailyTarget);
    });
  });

  it('keeps the distributed figures when a sheet is read back for a style', () => {
    const saved = buildProcessSheet({
      style: 'STY-9001',
      order_no: 'PO-900',
      operations: distributeSmvByWeight(PANT_OPERATIONS, 72),
      totalGarmentSmv: 72,
    });
    const read = operationsForStyle([saved], { style: 'STY-9001' });
    expect(read).toHaveLength(6);
    expect(totalSmvOf(read)).toBeCloseTo(72, 2);
  });

  it('re-derives a row’s targets when its SMV is edited on the saved sheet', () => {
    const saved = buildProcessSheet({
      style: 'STY-9001',
      operations: [{ operation: 'Collar Attach', smv: 2 }],
      targetBuffer: AUTO_TARGET_ALLOWANCE,
    });
    expect(saved.operations[0].autoDailyTarget).toBe(315);

    const edited = withRecomputedTotals({
      ...saved,
      operations: [{ ...saved.operations[0], smv: 4 }],
    });
    // 60 / 4 = 15 base, × 1.05 = 15.75 → 15/hr, × 10 = 157/day. The target MOVED
    // with the SMV rather than staying at the figure it was saved with.
    expect(edited.operations[0].baseHourlyCapacity).toBe(15);
    expect(edited.operations[0].autoHourlyTarget).toBe(15);
    expect(edited.operations[0].autoDailyTarget).toBe(157);
    expect(edited.totalSmv).toBe(4);
  });

  it('re-derives targets when the sheet’s buffer changes', () => {
    const saved = buildProcessSheet({
      style: 'STY-9001',
      operations: [{ operation: 'Collar Attach', smv: 2 }],
      targetBuffer: 0,
    });
    // No buffer: 60 / 2 = 30 base, × 10 = 300/day.
    expect(saved.operations[0].autoDailyTarget).toBe(300);

    const buffered = withRecomputedTotals({ ...saved, targetBuffer: 10 });
    // A 10% buffer: 30 × 1.10 = 33/hr, × 10 = 330/day.
    expect(buffered.operations[0].autoHourlyTarget).toBe(33);
    expect(buffered.operations[0].autoDailyTarget).toBe(330);
  });

  it('carries a manual target override through a re-save', () => {
    const saved = buildProcessSheet({
      style: 'STY-9001',
      operations: [{ operation: 'Collar Attach', smv: 2, target: 200 }],
    });
    expect(saved.operations[0].target).toBe(200);
    const reSaved = withRecomputedTotals(saved);
    // The override is a choice, so it survives; the auto figures are recomputed.
    expect(reSaved.operations[0].target).toBe(200);
    expect(reSaved.operations[0].autoDailyTarget).toBe(300);
  });
});

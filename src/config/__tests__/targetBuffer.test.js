import { describe, it, expect } from 'vitest';
import {
  autoTargetForProcess,
  autoTargetForOperation,
  completeBodyTarget,
  capacitySettings,
  calculateCapacity,
  STANDARD_DAY_HOURS,
  DEFAULT_TARGET_BUFFER,
} from '../smvTargetEngine';
import {
  buildProcessSheet,
  withRecomputedTotals,
  targetBufferForStyle,
  latestSheetForStyle,
} from '../orderWorkflow';

/**
 * The dynamic target & percentage buffer calculation, pinned.
 *
 * The brief's formula is exact and the floor is measured against the result, so
 * each step is asserted separately:
 *
 *   Base Hourly Capacity = 60 / Process SMV
 *   Auto Hourly Target   = Base Hourly Capacity × (1 + Buffer% / 100)
 *   Auto Daily Target    = Auto Hourly Target × 10
 */
describe('the auto-target formula', () => {
  it('derives the base hourly capacity from the SMV', () => {
    // 60 / 1.5 = 40 pieces an hour.
    expect(autoTargetForProcess(1.5).baseHourlyCapacity).toBe(40);
  });

  it('computes the standard day as 10 hours', () => {
    expect(STANDARD_DAY_HOURS).toBe(10);
  });

  it('gives the plain SMV target with no buffer', () => {
    const auto = autoTargetForProcess(1.5);
    expect(auto.hourlyTarget).toBe(40);
    expect(auto.dailyTarget).toBe(400); // 40 × 10
  });

  it('applies a 5% buffer', () => {
    // 40 × 1.05 = 42/hr, 42 × 10 = 420/day.
    const auto = autoTargetForProcess(1.5, 5);
    expect(auto.hourlyTarget).toBe(42);
    expect(auto.dailyTarget).toBe(420);
  });

  it('applies a 10% buffer', () => {
    const auto = autoTargetForProcess(1.5, 10);
    expect(auto.hourlyTarget).toBe(44); // 40 × 1.10 = 44
    expect(auto.dailyTarget).toBe(440);
  });

  it('reports no target for an operation with no SMV', () => {
    const auto = autoTargetForProcess(0, 5);
    expect(auto.hasSmv).toBe(false);
    expect(auto.dailyTarget).toBe(0);
  });

  it('reads the SMV off an operation row', () => {
    const auto = autoTargetForProcess({ operation: 'Collar Attach', smv: 2 });
    expect(auto.baseHourlyCapacity).toBe(30); // 60 / 2
    expect(auto.dailyTarget).toBe(300);
  });

  it('defaults to no buffer', () => {
    expect(DEFAULT_TARGET_BUFFER).toBe(0);
    expect(autoTargetForProcess(2).dailyTarget).toBe(300);
  });

  it('never subtracts, whatever a negative buffer would say', () => {
    const auto = autoTargetForProcess(2, -20);
    expect(auto.hourlyTarget).toBe(30);
  });
});

describe('the auto-target for a named operation', () => {
  const operations = [
    { operation: 'Collar Attach', smv: 2 },
    { operation: 'Sleeve Join', smv: 1.5 },
  ];

  it('finds the operation on the sheet and applies the buffer', () => {
    const auto = autoTargetForOperation({
      operations,
      settings: { targetBuffer: 10 },
      operationName: 'Collar Attach',
    });
    expect(auto.smv).toBe(2);
    expect(auto.dailyTarget).toBe(330); // 30 × 1.1 = 33/hr → 330
  });

  it('reports no target for an operation the sheet does not list', () => {
    const auto = autoTargetForOperation({ operations, operationName: 'Not There' });
    expect(auto.hasSmv).toBe(false);
  });

  it('takes the buffer from the settings when one is agreed', () => {
    const auto = autoTargetForOperation({
      operations,
      settings: { targetBuffer: 5 },
      operationName: 'Sleeve Join',
    });
    // 60 / 1.5 = 40, × 1.05 = 42, × 10 = 420.
    expect(auto.dailyTarget).toBe(420);
  });
});

describe('the complete body target', () => {
  const operations = [
    { operation: 'Collar Attach', smv: 2 },   // 300/day
    { operation: 'Sleeve Join', smv: 1.5 },   // 400/day
  ];

  it('sums the per-process auto targets', () => {
    const body = completeBodyTarget(operations, {});
    expect(body.dailyTarget).toBe(700); // 300 + 400
    expect(body.hasTarget).toBe(true);
    expect(body.processCount).toBe(2);
  });

  it('applies the percentage buffer to the whole garment', () => {
    const body = completeBodyTarget(operations, { targetBuffer: 10 });
    // 300×1.1 + 400×1.1 = 330 + 440 = 770.
    expect(body.dailyTarget).toBe(770);
    expect(body.buffer).toBe(10);
  });

  it('reports no target when no operation has an SMV', () => {
    const body = completeBodyTarget([{ operation: 'X', smv: 0 }], {});
    expect(body.hasTarget).toBe(false);
    expect(body.dailyTarget).toBe(0);
  });
});

describe('the buffer survives storage', () => {
  it('is read from any of the names a sheet may carry', () => {
    expect(capacitySettings({ targetBuffer: 5 }).targetBuffer).toBe(5);
    expect(capacitySettings({ buffer: 10 }).targetBuffer).toBe(10);
    expect(capacitySettings({ bufferPercent: 3 }).targetBuffer).toBe(3);
    expect(capacitySettings({ percentage: 7 }).targetBuffer).toBe(7);
  });

  it('defaults to zero and refuses a negative figure', () => {
    expect(capacitySettings({}).targetBuffer).toBe(0);
    expect(capacitySettings({ targetBuffer: -5 }).targetBuffer).toBe(0);
  });

  it('rides on the saved process sheet', () => {
    const sheet = buildProcessSheet({
      style: 'STY-1001',
      operations: [{ operation: 'Collar Attach', smv: 2 }],
      targetBuffer: 10,
    });
    expect(sheet.targetBuffer).toBe(10);
    expect(targetBufferForStyle([sheet], { style: 'STY-1001' })).toBe(10);
  });

  it('is preserved when the sheet totals are recomputed', () => {
    const sheet = withRecomputedTotals({
      style: 'STY-1001',
      targetBuffer: 5,
      operations: [{ operation: 'Collar Attach', smv: 2 }],
    });
    expect(sheet.targetBuffer).toBe(5);
    expect(sheet.totalSmv).toBe(2);
  });

  it('finds the latest sheet for a style by upload date', () => {
    const older = { id: 1, style: 'STY-1', uploadedAt: '2026-01-01', targetBuffer: 5, operations: [] };
    const newer = { id: 2, style: 'STY-1', uploadedAt: '2026-02-01', targetBuffer: 10, operations: [] };
    expect(latestSheetForStyle([older, newer], { style: 'STY-1' })).toBe(newer);
    expect(targetBufferForStyle([older, newer], { style: 'STY-1' })).toBe(10);
  });
});

describe('the capacity panel shows the buffered body target', () => {
  const operations = [
    { operation: 'Collar Attach', smv: 2 },
    { operation: 'Sleeve Join', smv: 1.5 },
  ];

  it('reports the complete body target alongside the line target', () => {
    const capacity = calculateCapacity(operations, { manpower: 10, workingHours: 8, efficiency: 70, targetBuffer: 5 });
    expect(capacity.bodyTarget.hasTarget).toBe(true);
    expect(capacity.bodyTarget.dailyTarget).toBe(735); // (300 + 400) × 1.05
    expect(capacity.targetBuffer).toBe(5);
  });

  it('reports the unbuffered figure when no buffer is set', () => {
    const capacity = calculateCapacity(operations, { manpower: 10, workingHours: 8, efficiency: 70 });
    expect(capacity.bodyTarget.dailyTarget).toBe(700);
    expect(capacity.targetBuffer).toBe(0);
  });
});
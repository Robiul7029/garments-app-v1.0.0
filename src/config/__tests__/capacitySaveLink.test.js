import { describe, it, expect } from 'vitest';
import {
  calculateCapacity,
  buildCapacityRecord,
  capacityForStyle,
  targetForOperation,
} from '../smvTargetEngine';

/**
 * Tests the SAVE → READ → AUTO-TARGET chain, which is the whole point of the
 * feature and the part a DOM probe cannot be trusted to confirm.
 *
 * This mirrors what `ProcessUploadPage.saveCapacity` writes and what
 * `DailyProductionEntry.handleSelectProcess` reads back, using the same
 * functions, so the two ends are pinned against each other rather than each
 * being tested in isolation against its own assumptions.
 */
const SHEET = [
  { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
  { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
  { operation: 'Side Seam', machine: 'Flatlock', smv: 2.1, section: 'Body' },
  { operation: 'Hemming', machine: 'Flatlock', smv: 1.7, section: 'Bottom' },
];

/** What ProcessUploadPage.saveCapacity() does. */
function saveForStyle(records, { style, order_no, settings }) {
  const capacity = calculateCapacity(SHEET, settings);
  const record = buildCapacityRecord({ style, order_no, settings, capacity });
  return [...records.filter((r) => String(r.style || '') !== String(style)), record];
}

/** What DailyProductionEntry.handleSelectProcess() does. */
function targetFromSaved(records, { style, order_no, operationName }) {
  const saved = capacityForStyle(records, { style, order_no });
  return targetForOperation({ operations: SHEET, settings: saved || {}, operationName });
}

describe('Process Sheet → saved capacity → Daily Production target', () => {
  it('carries the target from the saved sheet into the entry form', () => {
    const records = saveForStyle([], {
      style: 'STY-1001', order_no: 'PO-105',
      settings: { manpower: 25, workingHours: 8, efficiency: 70 },
    });
    const result = targetFromSaved(records, { style: 'STY-1001', operationName: 'Collar Attach' });
    // 8h × 60 × 0.70 = 336 minutes ÷ 1.2 SMV = 280.
    expect(result.target).toBe(280);
    expect(result.hasSmv).toBe(true);
    expect(result.source).toBe('smv');
  });

  it('stores every operation with its own target', () => {
    const records = saveForStyle([], {
      style: 'STY-1001', settings: { manpower: 25, workingHours: 8, efficiency: 70 },
    });
    const record = records[0];
    expect(record.perProcess).toHaveLength(4);
    expect(record.perProcess.map((p) => p.name)).toEqual([
      'Collar Attach', 'Sleeve Join', 'Side Seam', 'Hemming',
    ]);
    expect(record.perProcess.find((p) => p.name === 'Collar Attach').dailyTarget).toBe(7000);
  });

  it('gives a different target to a slower operation', () => {
    const records = saveForStyle([], {
      style: 'STY-1001', settings: { manpower: 25, workingHours: 8, efficiency: 70 },
    });
    expect(targetFromSaved(records, { style: 'STY-1001', operationName: 'Side Seam' }).target).toBe(160);
    expect(targetFromSaved(records, { style: 'STY-1001', operationName: 'Collar Attach' }).target).toBe(280);
  });

  it('re-saving a style replaces its record rather than duplicating it', () => {
    let records = saveForStyle([], {
      style: 'STY-1001', settings: { manpower: 25, workingHours: 8, efficiency: 70 },
    });
    records = saveForStyle(records, {
      style: 'STY-1001', settings: { manpower: 30, workingHours: 8, efficiency: 70 },
    });
    expect(records).toHaveLength(1);
    expect(records[0].manpower).toBe(30);
  });

  it('leaves another style’s record untouched', () => {
    let records = saveForStyle([], {
      style: 'STY-1001', settings: { manpower: 25, workingHours: 8, efficiency: 70 },
    });
    records = saveForStyle(records, {
      style: 'STY-1002', settings: { manpower: 10, workingHours: 8, efficiency: 60 },
    });
    expect(records).toHaveLength(2);
    expect(capacityForStyle(records, { style: 'STY-1001' }).manpower).toBe(25);
    expect(capacityForStyle(records, { style: 'STY-1002' }).manpower).toBe(10);
  });

  it('honours a raised manpower on the next entry', () => {
    const records = saveForStyle([], {
      style: 'STY-1001', settings: { manpower: 50, workingHours: 8, efficiency: 70 },
    });
    // Doubling the operators halves the per-operator day: 336 ÷ 1.2 stays 280,
    // because the per-operator figure does NOT depend on how many are deployed.
    // The LINE figure is what changes.
    expect(targetFromSaved(records, { style: 'STY-1001', operationName: 'Collar Attach' }).target).toBe(280);
    expect(records[0].lineDailyTarget).toBe(2584); // 16800 ÷ 6.5
  });

  it('honours a changed efficiency on the next entry', () => {
    const records = saveForStyle([], {
      style: 'STY-1001', settings: { manpower: 25, workingHours: 8, efficiency: 100 },
    });
    // 480 minutes ÷ 1.2 = 400.
    expect(targetFromSaved(records, { style: 'STY-1001', operationName: 'Collar Attach' }).target).toBe(400);
  });

  it('falls back to the defaults when no capacity was ever saved', () => {
    // A style whose sheet was uploaded but whose manpower was never agreed still
    // gets a usable target rather than a blank.
    const result = targetFromSaved([], { style: 'STY-1001', operationName: 'Collar Attach' });
    expect(result.target).toBe(280);
  });

  it('finds the record through the order number when the style is blank', () => {
    const records = saveForStyle([], {
      style: '', order_no: 'PO-105', settings: { manpower: 25, workingHours: 8, efficiency: 70 },
    });
    expect(capacityForStyle(records, { order_no: 'PO-105' }).manpower).toBe(25);
  });

  it('agrees with the panel: the saved per-process figure ÷ manpower is the entry target', () => {
    // The join a reader would check by eye: the process sheet showed 7,000 pcs
    // for Collar Attach across the line, and 25 operators produce 280 each.
    const records = saveForStyle([], {
      style: 'STY-1001', settings: { manpower: 25, workingHours: 8, efficiency: 70 },
    });
    const collar = records[0].perProcess.find((p) => p.name === 'Collar Attach');
    const entryTarget = targetFromSaved(records, { style: 'STY-1001', operationName: 'Collar Attach' }).target;
    expect(Math.floor(collar.dailyTarget / records[0].manpower)).toBe(entryTarget);
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildProcessSheet,
  operationsForStyle,
  processNamesForStyle,
  smvForProcess,
} from '../orderWorkflow';
import { calculateCapacity, targetForOperation } from '../smvTargetEngine';

/**
 * "Save to Style" makes a sheet global.
 *
 * Saving writes the record into the `process-breakdown` collection. Everything
 * else — Hourly Production's process dropdown and hourly target, Daily
 * Production, Worker Production, the Capacity panel — reads that collection back
 * through the helpers exercised here. These tests follow one saved sheet from the
 * save handler out to each reader, so "it appears everywhere instantly" is
 * something the suite actually checks rather than something assumed.
 *
 * The store is simulated as the plain array DataContext keeps: `setRaw` replaces
 * the collection, and every reader is handed `getData('process-breakdown')`.
 */
function saveToStore(store, record) {
  return [...store, record];
}

const SHEET_ROWS = [
  { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
  { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
  { operation: 'Side Seam', machine: 'Flatlock', smv: 1.8, section: 'Body' },
];

describe('saving a sheet makes it available to every module', () => {
  it('writes the sheet, its operations and its total under the style', () => {
    const store = saveToStore([], buildProcessSheet({
      style: 'STY-1001',
      order_no: 'PO-105',
      fileName: 'sheet.xlsx',
      operations: SHEET_ROWS,
      smvUnit: 'minutes',
    }));

    expect(store).toHaveLength(1);
    const saved = store[0];
    expect(saved.style).toBe('STY-1001');
    expect(saved.order_no).toBe('PO-105');
    expect(saved.operations).toHaveLength(3);
    expect(saved.totalSmv).toBe(4.5);
  });

  it('feeds the process dropdown on the other pages', () => {
    const store = saveToStore([], buildProcessSheet({
      style: 'STY-1001', order_no: 'PO-105', operations: SHEET_ROWS,
    }));
    // Hourly Production and Daily Production both resolve their options this way.
    expect(processNamesForStyle(store, { style: 'STY-1001' }))
      .toEqual(['Collar Attach', 'Sleeve Join', 'Side Seam']);
    expect(operationsForStyle(store, { style: 'STY-1001' })).toHaveLength(3);
  });

  it('is found by order number too, not only by style', () => {
    const store = saveToStore([], buildProcessSheet({
      style: 'STY-1001', order_no: 'PO-105', operations: SHEET_ROWS,
    }));
    // A sheet saved before the style was set still resolves from the order.
    expect(processNamesForStyle(store, { order_no: 'PO-105' }))
      .toEqual(['Collar Attach', 'Sleeve Join', 'Side Seam']);
  });

  it('gives Hourly Production a real hourly target from the saved SMV', () => {
    const store = saveToStore([], buildProcessSheet({
      style: 'STY-1001', order_no: 'PO-105', operations: SHEET_ROWS,
    }));
    const settings = { manpower: 25, workingHours: 8, efficiency: 70 };
    const derived = targetForOperation({
      operations: operationsForStyle(store, { style: 'STY-1001' }),
      settings,
      operationName: 'Collar Attach',
    });
    // 8h = 480 min at 70% = 336 available; ÷ 1.2 SMV = 280/day → 35/hr.
    expect(derived.hasSmv).toBe(true);
    expect(derived.hourlyTarget).toBe(35);
    expect(smvForProcess(store, { style: 'STY-1001' }, 'Collar Attach')).toBe(1.2);
  });

  it('lets a re-upload supersede the previous sheet for the same style', () => {
    const first = buildProcessSheet({
      style: 'STY-1001', order_no: 'PO-105', operations: SHEET_ROWS,
    });
    const second = buildProcessSheet({
      style: 'STY-1001',
      order_no: 'PO-105',
      operations: [{ operation: 'Bottom Hem', smv: 1.4 }],
      uploadedAt: '2099-01-01',
    });
    const store = saveToStore(saveToStore([], first), second);

    // A breakdown is superseded, not accumulated — the newest sheet wins.
    expect(processNamesForStyle(store, { style: 'STY-1001' })).toEqual(['Bottom Hem']);
    expect(operationsForStyle(store, { style: 'STY-1001' })).toHaveLength(1);
  });

  it('carries a seconds-based sheet through save and into a target', () => {
    const store = saveToStore([], buildProcessSheet({
      style: 'STY-2002',
      order_no: 'PO-200',
      smvUnit: 'seconds',
      // Already normalised to minutes by the parser, as the page passes them in.
      operations: [{ operation: 'Collar Attach', smv: 1.2 }, { operation: 'Side Seam', smv: 1.8 }],
    }));
    const capacity = calculateCapacity(
      operationsForStyle(store, { style: 'STY-2002' }),
      { manpower: 20, workingHours: 8, efficiency: 60 },
    );
    // 3.0 total SMV minutes — not 180.
    expect(capacity.totalSmv).toBe(3);
    expect(store[0].smvUnit).toBe('seconds');
    expect(store[0].totalSmvSeconds).toBe(180);
  });
});

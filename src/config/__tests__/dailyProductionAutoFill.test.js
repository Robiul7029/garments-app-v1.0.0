import { describe, it, expect } from 'vitest';
import { orderPrefill, splitValues, joinValues, DEFAULT_WORKING_HOURS } from '../orderWorkflow';
import { buildDailyProductionRecord, COLOR_SUGGESTIONS, SIZE_PRESETS } from '../dailyProductionForm';

/**
 * The Daily Production auto-fill and multi-process entry.
 *
 * The form itself is rendered in the component test; this pins the data layer that
 * feeds it — what an order prefills, how a multi-value field round-trips, and what
 * a multi-process record looks like once saved.
 */
const ORDER = {
  id: 1,
  buyer: 'H&M',
  order_no: 'PO-105',
  style: 'STY-1001',
  item: 'Basic Tee',
  color: 'Navy, Black',
  size_range: 'S, M, L',
  qty: 5000,
  floor: 'Floor-2',
  line_no: 'Line-03',
  shift: 'Morning',
  supervisor: 'Md Robiul Islam',
};

describe('auto-filling from the selected order', () => {
  it('carries every order-owned field onto the entry', () => {
    const p = orderPrefill(ORDER, { today: '2026-10-12' });
    expect(p.buyer).toBe('H&M');
    expect(p.style).toBe('STY-1001');
    expect(p.item).toBe('Basic Tee');
    expect(p.po_qty).toBe(5000);
    expect(p.floor).toBe('Floor-2');
    expect(p.line_no).toBe('Line-03');
    expect(p.shift).toBe('Morning');
    expect(p.supervisor).toBe('Md Robiul Islam');
  });

  it('carries multi-value colour and size through as stored strings', () => {
    const p = orderPrefill(ORDER);
    expect(p.color).toBe('Navy, Black');
    expect(p.size_range).toBe('S, M, L');
  });

  it('defaults the production date to today', () => {
    expect(orderPrefill(ORDER, { today: '2026-10-12' }).date).toBe('2026-10-12');
  });

  it('takes working hours and manpower from the agreed capacity', () => {
    const p = orderPrefill(ORDER, { capacity: { workingHours: 8, manpower: 25 } });
    expect(p.working_hours).toBe(8);
    expect(p.manpower).toBe(25);
  });

  it('defaults working hours to 10 when no capacity is agreed', () => {
    expect(orderPrefill(ORDER).working_hours).toBe(DEFAULT_WORKING_HOURS);
    expect(DEFAULT_WORKING_HOURS).toBe(10);
  });

  it('never invents a manpower figure', () => {
    // With no saved capacity there is nothing true to put there.
    expect(orderPrefill(ORDER).manpower).toBeUndefined();
  });

  it('returns nothing for no order, so a pick cannot blank the form', () => {
    expect(orderPrefill(null)).toEqual({});
  });
});

describe('colour and size as multi-value fields', () => {
  it('offers colour and size suggestions', () => {
    expect(COLOR_SUGGESTIONS).toContain('Navy');
    expect(SIZE_PRESETS).toContain('M');
  });

  it('accepts a value typed by hand alongside the suggestions', () => {
    // A colour not on the list must still be usable.
    const joined = joinValues(['Navy', 'Pantone 19-4052']);
    expect(splitValues(joined)).toEqual(['Navy', 'Pantone 19-4052']);
  });

  it('removes duplicates regardless of case', () => {
    expect(joinValues(['Navy', 'navy', 'Black'])).toBe('Navy, Black');
  });

  it('round-trips several sizes through the stored string', () => {
    const stored = joinValues(['S', 'M', 'L']);
    expect(stored).toBe('S, M, L');
    expect(splitValues(stored)).toEqual(['S', 'M', 'L']);
  });
});

describe('a multi-process entry', () => {
  const form = {
    date: '2026-10-12',
    style: 'STY-1001',
    order_no: 'PO-105',
    processes: 'Collar Attach, Sleeve Join',
    process_targets: { 'Collar Attach': 280, 'Sleeve Join': 224 },
    quantity: 500,
    hourly: {},
  };

  it('keeps every chosen process on the saved row', () => {
    const record = buildDailyProductionRecord(form);
    expect(record.processes).toEqual(['Collar Attach', 'Sleeve Join']);
  });

  it('keeps the first process in the legacy single field', () => {
    // The grouped table, the export and Line Status still read `process`.
    const record = buildDailyProductionRecord(form);
    expect(record.process).toBe('Collar Attach');
  });

  it('stores each process with its own target', () => {
    const record = buildDailyProductionRecord(form);
    expect(record.process_targets).toEqual({ 'Collar Attach': 280, 'Sleeve Join': 224 });
  });

  it('sums the per-process targets into the day target', () => {
    // 280 + 224 = 504 — measuring the entry against only the first would
    // understate what the line was asked to make.
    const record = buildDailyProductionRecord(form);
    expect(record.target).toBe(504);
  });

  it('still works for a single process', () => {
    const record = buildDailyProductionRecord({
      ...form,
      processes: 'Collar Attach',
      process_targets: { 'Collar Attach': 280 },
    });
    expect(record.process).toBe('Collar Attach');
    expect(record.processes).toEqual(['Collar Attach']);
    expect(record.target).toBe(280);
  });

  it('reads a legacy row that only has the singular process field', () => {
    const record = buildDailyProductionRecord({ ...form, processes: undefined, process: 'Side Seam' });
    expect(record.processes).toEqual(['Side Seam']);
    expect(record.process).toBe('Side Seam');
  });
});

describe('the manual hourly target drives the daily target', () => {
  const base = {
    date: '2026-10-12',
    style: 'STY-1001',
    processes: 'Collar Attach',
    process_targets: { 'Collar Attach': 280 },
    quantity: 200,
    hourly: {},
  };

  it('multiplies the typed hourly target by the working hours', () => {
    const record = buildDailyProductionRecord({ ...base, hourly_target: 120, working_hours: 10 });
    expect(record.hourly_target).toBe(120);
    expect(record.working_hours).toBe(10);
    // 120 × 10 = 1200, overriding the per-process sum of 280.
    expect(record.daily_target).toBe(1200);
    expect(record.target).toBe(1200);
  });

  it('respects a shortened day (lunch-excluded active hours)', () => {
    // 9.5 productive hours × 100 = 950 — the figure the Hourly module also shows.
    const record = buildDailyProductionRecord({ ...base, hourly_target: 100, working_hours: 9.5 });
    expect(record.daily_target).toBe(950);
  });

  it('falls back to the per-process sum when no hourly target is typed', () => {
    const record = buildDailyProductionRecord(base);
    expect(record.daily_target).toBe(280);
  });
});

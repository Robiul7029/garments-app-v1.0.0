import { describe, it, expect } from 'vitest';
import {
  HOUR_SLOTS,
  computeDailySummary,
  buildDailyProductionRecord,
  emptyHourly,
} from '../dailyProductionForm';

/**
 * Tests for the Daily Production template calculations.
 *
 * The end-of-day summary is the number the factory is judged on, so it is pinned
 * down here with worked figures from a real line, including the edge cases the
 * paper form never shows (an empty day, a row saved before the hourly grid).
 */
function rowWith(hours, extra = {}) {
  return { hourly: { ...emptyHourly(), ...hours }, ...extra };
}

describe('the hourly template', () => {
  it('defines the ten one-hour slots the paper form prints', () => {
    expect(HOUR_SLOTS).toHaveLength(10);
    expect(HOUR_SLOTS[0]).toBe('08:00-09:00');
    expect(HOUR_SLOTS[HOUR_SLOTS.length - 1]).toBe('17:00-18:00');
  });

  it('builds a blank grid with every slot present', () => {
    const hourly = emptyHourly();
    expect(Object.keys(hourly)).toHaveLength(HOUR_SLOTS.length);
    HOUR_SLOTS.forEach((slot) => {
      expect(hourly[slot]).toEqual({ target: '', actual: '', defect: '', remarks: '' });
    });
  });
});

describe('end-of-day summary', () => {
  it('totals the hourly grid and computes every printed figure', () => {
    // Two hours: 50 target / 48 actual (2 defects), then 50 / 52 (1 defect).
    const summary = computeDailySummary(rowWith({
      '08:00-09:00': { target: 50, actual: 48, defect: 2 },
      '09:00-10:00': { target: 50, actual: 52, defect: 1 },
    }, { daily_target: 200 }));

    expect(summary.hourlyTargetTotal).toBe(100);
    expect(summary.actualOutput).toBe(100);
    expect(summary.cumulativeOutput).toBe(100);
    expect(summary.variance).toBe(0);
    expect(summary.defectQty).toBe(3);
    // Good output = 100 - 3 defects.
    expect(summary.goodOutput).toBe(97);
    // Efficiency = good output / daily target = 97 / 200.
    expect(summary.efficiency).toBe(48.5);
    // Target achievement is the same base here, so the same figure.
    expect(summary.targetAchievement).toBe(48.5);
    // Defect rate = 3 / 100.
    expect(summary.defectRate).toBe(3);
    expect(summary.outputToFinishing).toBe(97);
  });

  it('builds a running cumulative series and per-hour variance', () => {
    const summary = computeDailySummary(rowWith({
      '08:00-09:00': { target: 10, actual: 8 },
      '09:00-10:00': { target: 10, actual: 12 },
    }));
    expect(summary.cumulative[0]).toBe(8);
    expect(summary.cumulative[1]).toBe(20);
    expect(summary.perHour[0].variance).toBe(-2);
    expect(summary.perHour[1].variance).toBe(0);
  });

  it('never reports a negative good output', () => {
    // More defects than pieces is impossible, but a form can be filled that way.
    const summary = computeDailySummary(rowWith({ '08:00-09:00': { target: 10, actual: 5, defect: 9 } }));
    expect(summary.goodOutput).toBe(0);
  });

  it('shows 0% rather than NaN on an empty day', () => {
    const summary = computeDailySummary(rowWith({}));
    expect(summary.actualOutput).toBe(0);
    expect(summary.efficiency).toBe(0);
    expect(summary.targetAchievement).toBe(0);
    expect(summary.defectRate).toBe(0);
  });

  it('falls back to the standard process target when no daily target is set', () => {
    // No daily_target: efficiency is measured against the hourly target total.
    const summary = computeDailySummary(rowWith({
      '08:00-09:00': { target: 100, actual: 90 },
    }));
    expect(summary.dailyTarget).toBe(0);
    expect(summary.efficiency).toBe(90);
    expect(summary.targetAchievement).toBe(0);
  });

  it('uses the legacy quantity when a row predates the hourly grid', () => {
    // An existing Firestore row has no `hourly` at all — it must still summarise.
    const summary = computeDailySummary({ date: '2026-08-19', quantity: 8, process: 'Collar Attach' });
    expect(summary.actualOutput).toBe(8);
    expect(summary.goodOutput).toBe(8);
    expect(summary.defectRate).toBe(0);
  });

  it('accepts an undefined row without throwing', () => {
    expect(() => computeDailySummary(undefined)).not.toThrow();
  });
});

describe('building the stored record', () => {
  it('mirrors quantity from the day’s good output so old screens keep working', () => {
    const record = buildDailyProductionRecord({
      date: '2026-08-19',
      style: 'STY-1001',
      department: 'Sewing',
      process: 'Collar Attach',
      hourly: { '08:00-09:00': { target: 50, actual: 48, defect: 2 } },
    });
    // good output = 48 - 2 = 46.
    expect(record.quantity).toBe(46);
    expect(record.hourly['08:00-09:00'].actual).toBe(48);
    expect(record.summary.goodOutput).toBe(46);
    expect(record.summary.outputToFinishing).toBe(46);
  });

  it('keeps the legacy fields untouched', () => {
    const record = buildDailyProductionRecord({
      date: '2026-08-19', employee: 'Salma', style: 'STY-1001', department: 'Sewing', process: 'Overlock',
    });
    expect(record.employee).toBe('Salma');
    expect(record.style).toBe('STY-1001');
    expect(record.department).toBe('Sewing');
    expect(record.process).toBe('Overlock');
  });

  it('stores an hourly object even when the form supplied none', () => {
    const record = buildDailyProductionRecord({ date: '2026-08-19', quantity: 12 });
    expect(typeof record.hourly).toBe('object');
    expect(record.quantity).toBe(12);
  });
});

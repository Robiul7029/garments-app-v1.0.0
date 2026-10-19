import { describe, it, expect } from 'vitest';
import {
  SHIFT_HOURS,
  LUNCH_START_HOUR,
  LUNCH_HOURS,
  STANDARD_SHIFT_HOURS,
  PRODUCTIVE_SHIFT_HOURS,
  SHIFT_END_MINUTES,
  productiveHours,
  overtimeHoursFrom,
  totalWorkingHours,
  dailyTargetFrom,
} from '../workingHours';

/**
 * The working day, and what counts as a working hour.
 *
 * The shop floor runs 08:00 → 18:30 with an unpaid lunch of 13:00 → 13:30, so
 * work resumes at 13:30. These pin the two rules the Hourly Production brief
 * turns on:
 *   1. the 13:00 slot is worth HALF an hour, because the lunch break sits inside
 *      it — so a full 08:00 → 18:30 day is 10 productive hours (10.5 on the clock
 *      less the 0.5 lunch);
 *   2. the daily target is the hourly target over the ACTIVE hours (plus OT),
 *      which is what keeps the Hourly and Daily modules showing the same figure.
 */
describe('the shift definition', () => {
  it('runs 08:00 to 18:00 as clock slots, plus the trailing 18 slot', () => {
    expect(SHIFT_HOURS).toEqual(['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18']);
  });

  it('puts the lunch break in the 13:00 slot and takes half an hour', () => {
    expect(LUNCH_START_HOUR).toBe(13);
    expect(LUNCH_HOURS).toBe(0.5);
  });

  it('ends the paid shift at 18:30, after the trailing half hour', () => {
    expect(SHIFT_END_MINUTES).toBe(18 * 60 + 30);
  });

  it('plans a full day at 10 productive hours', () => {
    expect(STANDARD_SHIFT_HOURS).toBe(10);
    expect(PRODUCTIVE_SHIFT_HOURS).toBe(10);
  });
});

describe('productiveHours', () => {
  it('counts a normal hour as a whole hour', () => {
    expect(productiveHours(['08', '09', '10'])).toBe(3);
  });

  it('counts the 13:00 lunch slot as half an hour', () => {
    // One ordinary hour plus the lunch hour = 1.5, not 2.
    expect(productiveHours(['12', '13'])).toBe(1.5);
  });

  it('reads a full 08:00→18:30 day as 10 productive hours, not 10.5', () => {
    // The trailing '18' slot is half an hour too (18:00 → 18:30), and 13:00 is
    // the lunch half hour, so ten whole slots plus two half slots gives 10.
    expect(productiveHours(SHIFT_HOURS)).toBe(10);
  });

  it('reads a written slot label as the time it names', () => {
    // A slot added from "Others Time..." as '13:30-14:30' is charged one hour,
    // measured from its own two clock times rather than its leading digit.
    expect(productiveHours(['08', '13:30-14:30'])).toBe(2);
    expect(productiveHours(['19:00-20:30'])).toBe(1.5);
  });

  it('handles no selection and junk input without throwing', () => {
    expect(productiveHours([])).toBe(0);
    expect(productiveHours(undefined)).toBe(0);
    // An unreadable slot contributes a whole hour rather than nothing.
    expect(productiveHours(['nonsense', '08'])).toBe(2);
  });
});

describe('overtimeHoursFrom', () => {
  it('is zero when no OT start is given', () => {
    expect(overtimeHoursFrom('')).toBe(0);
    expect(overtimeHoursFrom(undefined)).toBe(0);
  });

  it('measures the hours beyond the 18:30 shift end', () => {
    expect(overtimeHoursFrom('18:30')).toBe(0);
    expect(overtimeHoursFrom('19:00')).toBe(0.5);
    expect(overtimeHoursFrom('19:30')).toBe(1);
    expect(overtimeHoursFrom('21:00')).toBe(2.5);
  });

  it('is zero — never negative — for a start inside the shift', () => {
    expect(overtimeHoursFrom('17:00')).toBe(0);
    expect(overtimeHoursFrom('09:00')).toBe(0);
  });
});

describe('totalWorkingHours', () => {
  it('adds the OT to the productive hours', () => {
    expect(totalWorkingHours(['08', '09'], '19:00')).toBe(2.5);
    expect(totalWorkingHours(SHIFT_HOURS, '19:30')).toBe(11);
  });

  it('excludes lunch across a full day with no OT', () => {
    expect(totalWorkingHours(SHIFT_HOURS, '')).toBe(10);
  });
});

describe('dailyTargetFrom', () => {
  it('multiplies the hourly target by the productive hours', () => {
    // A full 08:00→18:30 day is 10 productive hours, so 100/hr gives 1000.
    expect(dailyTargetFrom(100, SHIFT_HOURS)).toBe(1000);
  });

  it('accepts a plain hour count as well as a slot list', () => {
    expect(dailyTargetFrom(120, 10)).toBe(1200);
    expect(dailyTargetFrom(120, 9.5)).toBe(1140);
  });

  it('rounds to whole pieces and treats a blank target as zero', () => {
    expect(dailyTargetFrom(33, 9.5)).toBe(314); // 313.5 → 314
    expect(dailyTargetFrom('', SHIFT_HOURS)).toBe(0);
    expect(dailyTargetFrom(undefined, 10)).toBe(0);
  });
});

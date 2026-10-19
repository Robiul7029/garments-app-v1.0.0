import { describe, it, expect } from 'vitest';
import { dailyTargetFrom, PRODUCTIVE_SHIFT_HOURS } from '../workingHours';
import { autoTargetForProcess } from '../smvTargetEngine';
import { DAY_MODE, productiveHoursFor } from '../hourlyEntryMode';

/**
 * The Day-mode target derivation, end to end.
 *
 * The spec is explicit: in Day mode the target is derived from the Daily Target
 * formula (Hourly Target × 10, or the SMV-calculated daily figure). Day mode has no
 * ticked clock hours, so the standard productive shift stands in for them — and
 * because that shift IS the ten hours the clock slots add up to, both modes land on
 * the same daily target. That equivalence is the thing worth pinning: if the two
 * ever diverged, the same day would be measured differently depending on how it was
 * entered.
 */
const SHIFT = PRODUCTIVE_SHIFT_HOURS; // 10

describe('the day-mode daily target', () => {
  it('is the hourly target times the standard day', () => {
    const hourly = 120;
    const workedHours = productiveHoursFor({ slots: [DAY_MODE], shiftHours: SHIFT, hourlyHours: 0 });
    expect(workedHours).toBe(10);
    expect(dailyTargetFrom(hourly, workedHours)).toBe(1200); // 120 × 10
  });

  it('matches the figure the hourly slots would give for a full day', () => {
    const hourly = 120;
    const dayModeHours = productiveHoursFor({ slots: [DAY_MODE], shiftHours: SHIFT, hourlyHours: 0 });
    // A full shift of clock slots also gives 10 productive hours (lunch excluded),
    // so the same hourly target produces the same daily target either way.
    const hourlyModeHours = productiveHoursFor({
      slots: ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18'],
      shiftHours: SHIFT,
      hourlyHours: 10,
    });
    expect(hourlyModeHours).toBe(10);
    expect(dailyTargetFrom(hourly, dayModeHours)).toBe(dailyTargetFrom(hourly, hourlyModeHours));
  });

  it('adds overtime on top of the standard day', () => {
    const workedHours = productiveHoursFor({ slots: [DAY_MODE], shiftHours: SHIFT, overtimeHours: 2 });
    expect(workedHours).toBe(12);
    expect(dailyTargetFrom(100, workedHours)).toBe(1200); // 100 × 12
  });

  it('derives the hourly figure from SMV when no manual target is typed', () => {
    // 60 / 1.5 = 40/hr, no buffer → 400 for the ten-hour day.
    const auto = autoTargetForProcess(1.5, 0);
    expect(auto.hourlyTarget).toBe(40);
    expect(dailyTargetFrom(auto.hourlyTarget, SHIFT)).toBe(400);
  });

  it('applies the process buffer to the day target', () => {
    // 40/hr with a 10% buffer = 44/hr → 440 for the day.
    const auto = autoTargetForProcess(1.5, 10);
    expect(auto.hourlyTarget).toBe(44);
    expect(dailyTargetFrom(auto.hourlyTarget, SHIFT)).toBe(440);
  });
});
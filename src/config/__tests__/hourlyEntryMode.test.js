import { describe, it, expect } from 'vitest';
import {
  DAY_MODE,
  resolveSlots,
  toggleSlot,
  modeOf,
  pruneQty,
  productiveHoursFor,
  slotLabel,
  isDayRow,
} from '../hourlyEntryMode';

/**
 * The Active Hours / Day mode model.
 *
 * The form logs the same day two ways — hourly slots, or one whole-day figure —
 * and the two must never both apply, or a day is counted twice. These pin the
 * rules the form's handlers delegate to, so the behaviour is verified directly
 * rather than through a rendered form a static render cannot drive.
 */
describe('resolving a slot selection into a mode', () => {
  it('treats the Day slot as day mode, on its own', () => {
    const { slots, mode } = resolveSlots([DAY_MODE]);
    expect(mode).toBe('day');
    expect(slots).toEqual([DAY_MODE]);
  });

  it('treats clock hours as hourly mode', () => {
    const { slots, mode } = resolveSlots(['08', '09']);
    expect(mode).toBe('hourly');
    expect(slots).toEqual(['08', '09']);
  });

  it('drops clock hours when Day is among the selection', () => {
    // Day is exclusive: a whole-day figure beside an hourly one is a double count.
    const { slots, mode } = resolveSlots(['08', DAY_MODE, '10']);
    expect(mode).toBe('day');
    expect(slots).toEqual([DAY_MODE]);
  });

  it('reports hourly mode for an empty selection', () => {
    expect(resolveSlots([]).mode).toBe('hourly');
    expect(resolveSlots([]).slots).toEqual([]);
  });

  it('survives a non-array input', () => {
    expect(resolveSlots(undefined).slots).toEqual([]);
  });
});

describe('toggling one slot', () => {
  it('adds a clock hour', () => {
    expect(toggleSlot(['08'], '09')).toEqual(['08', '09']);
  });

  it('removes a clock hour already selected', () => {
    expect(toggleSlot(['08', '09'], '08')).toEqual(['09']);
  });

  it('selects Day and clears the clock hours', () => {
    expect(toggleSlot(['08', '09'], DAY_MODE)).toEqual([DAY_MODE]);
  });

  it('unticks Day back to nothing', () => {
    expect(toggleSlot([DAY_MODE], DAY_MODE)).toEqual([]);
  });

  it('switches from Day to a single clock hour', () => {
    // Ticking an hour while Day is selected means "actually, this hour" — the
    // whole-day figure must go, or both would be recorded.
    expect(toggleSlot([DAY_MODE], '10')).toEqual(['10']);
  });
});

describe('reading the mode off a slot list', () => {
  it('reports day for the sentinel', () => {
    expect(modeOf([DAY_MODE])).toBe('day');
  });

  it('reports hourly for clock hours and for nothing', () => {
    expect(modeOf(['08'])).toBe('hourly');
    expect(modeOf([])).toBe('hourly');
  });
});

describe('pruning the quantity map on a mode change', () => {
  it('keeps a box for each selected slot', () => {
    const qty = { 'Collar Attach': { 8: 10, 9: 12 } };
    expect(pruneQty(qty, ['Collar Attach'], ['08', '09'])).toEqual({ 'Collar Attach': {} });
  });

  it('drops the figures of the mode being left', () => {
    // Switching to Day discards the hourly figures: an hourly count is not a day
    // total, and silently reinterpreting it would put a number on the floor that
    // nobody entered.
    const qty = { 'Collar Attach': { 8: 10, 9: 12 } };
    expect(pruneQty(qty, ['Collar Attach'], [DAY_MODE])).toEqual({ 'Collar Attach': {} });
  });

  it('keeps the day figure when Day is the selected slot', () => {
    const qty = { 'Collar Attach': { [DAY_MODE]: 240 } };
    expect(pruneQty(qty, ['Collar Attach'], [DAY_MODE])).toEqual({ 'Collar Attach': { [DAY_MODE]: 240 } });
  });

  it('gives every chosen process a box', () => {
    expect(pruneQty({}, ['A', 'B'], [DAY_MODE])).toEqual({ A: {}, B: {} });
  });
});

describe('the day productive hours', () => {
  it('uses the standard shift in day mode', () => {
    // Day mode has no ticked clock hours, so the shift length stands in — which is
    // the same ten hours the slots add up to, so the daily target matches.
    const hours = productiveHoursFor({
      slots: [DAY_MODE], shiftHours: 10, overtimeHours: 0, hourlyHours: 0,
    });
    expect(hours).toBe(10);
  });

  it('uses the ticked hours in hourly mode', () => {
    const hours = productiveHoursFor({
      slots: ['08', '09'], shiftHours: 10, overtimeHours: 0, hourlyHours: 2,
    });
    expect(hours).toBe(2);
  });

  it('adds overtime in either mode', () => {
    expect(productiveHoursFor({ slots: [DAY_MODE], shiftHours: 10, overtimeHours: 1.5 })).toBe(11.5);
    expect(productiveHoursFor({ slots: ['08'], shiftHours: 10, overtimeHours: 1.5, hourlyHours: 1 })).toBe(2.5);
  });
});

describe('labelling and detecting day rows', () => {
  it('labels the Day slot and clock hours', () => {
    expect(slotLabel(DAY_MODE)).toBe('Day');
    expect(slotLabel('08')).toBe('08:00');
    expect(slotLabel('18:30-19:30')).toBe('18:30-19:30');
  });

  it('recognises a stored whole-day row by its mode or its key', () => {
    expect(isDayRow({ mode: 'day', hours: {} })).toBe(true);
    expect(isDayRow({ hours: { [DAY_MODE]: 240 } })).toBe(true);
    expect(isDayRow({ mode: 'hourly', hours: { 8: 10 } })).toBe(false);
    expect(isDayRow({})).toBe(false);
  });
});
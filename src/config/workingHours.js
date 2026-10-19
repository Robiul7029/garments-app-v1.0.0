/**
 * ROBIUL GARMENTS ERP — the working day, and what counts as a working hour.
 *
 * The shop floor runs 08:00 → 18:30. Lunch is 13:00 → 13:30 (unpaid, so it is on
 * the clock but is NOT productive time), and work resumes at 13:30 rather than
 * at 14:00 — which is why the 13:00 slot covers two halves: half an hour of work
 * before the break and nothing after it. Counting that slot as a whole hour, or
 * counting the day as a flat 10.5, would put the day's target wrong.
 *
 *   08:00 → 18:30         10.5 hours on the clock
 *   less lunch 13:00→13:30  −0.5 hours
 *   = 10 productive hours
 *
 * The 13:30 resume is what makes the AFTERNOON different from the morning, and
 * it is why the shift keeps a half-hour at the end (18:00 → 18:30) that is the
 * natural home for the "Others Time" a supervisor adds from the Active Hours
 * dropdown.
 *
 * This lives here rather than in a component because three screens need the same
 * answer to "how many productive hours is this day?" — the Hourly Production
 * form, the Daily Production summary and the capacity figures. Two of them
 * disagreeing by half an hour is exactly the sort of discrepancy nobody notices
 * until the targets are wrong.
 */

/**
 * The shift slots the form offers by default, as clock hours.
 *
 * '13' is the lunch hour: 13:00 → 13:30 is work, 13:30 → 14:00 is the break, so
 * the slot carries half an hour and `productiveHours` charges it as such. '18'
 * is the trailing half hour after the morning's equivalent — 18:00 → 18:30.
 */
export const SHIFT_HOURS = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18'];

/** The ten whole productive hours the shift is planned around. */
export const STANDARD_SHIFT_HOURS = 10;

/** The lunch break: it starts on the 13:00 slot and half of that slot is off. */
export const LUNCH_START_HOUR = 13;
export const LUNCH_HOURS = 0.5;

/** The clock end of the paid shift. Overtime is anything that starts after this. */
export const SHIFT_END_MINUTES = 18 * 60 + 30; // 18:30

/** Productive hours in a full standard shift: 10.5 on the clock − 0.5 lunch = 10. */
export const PRODUCTIVE_SHIFT_HOURS = STANDARD_SHIFT_HOURS;

/**
 * Clock hours that are only half productive, with the fraction that counts.
 *
 * '13' is the lunch slot (13:00 → 13:30 works, then the break). '18' is the
 * trailing half hour (18:00 → 18:30) at the end of the paid shift. Counting
 * either as a whole hour would overstate the day.
 */
export const HALF_HOUR_SLOTS = { 13: 0.5, 18: 0.5 };

/**
 * Productive hours for a set of chosen clock hours.
 *
 * Chosen hours are the 'HH' keys the form works in, or a written range for a slot
 * added from the dropdown's "Others Time" box. A bare key uses `HALF_HOUR_SLOTS`
 * to decide its fraction (13:00 and 18:00 are half hours, the rest are whole). A
 * written range ('13:30-14:30') is measured from its own two clock times instead,
 * so a custom slot is charged for exactly the time it names.
 *
 * @param {string[]} hours  e.g. ['08','09','13']
 * @returns {number}        productive hours, e.g. 2.5
 */
export function productiveHours(hours = []) {
  const list = Array.isArray(hours) ? hours : [];
  return list.reduce((sum, h) => sum + slotHours(h), 0);
}

/** The minutes a clock reading names, or null when it is not a clock reading. */
function clockMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * One slot's productive hours.
 *
 * A written range ('13:30-14:30', '19:00-20:00') is measured between its two
 * clock times. A bare clock key ('13', '08') falls back to `HALF_HOUR_SLOTS`.
 * Anything unreadable counts as a whole hour rather than nothing, so an unusual
 * label still contributes to the day.
 */
function slotHours(slot) {
  const parts = String(slot).split('-').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    const from = clockMinutes(parts[0]);
    const to = clockMinutes(parts[1]);
    if (from !== null && to !== null && to > from) {
      return Math.round(((to - from) / 60) * 100) / 100;
    }
  }
  const hour = Number(String(slot).split(/[^0-9]/)[0]);
  if (!Number.isFinite(hour)) return 1;
  return HALF_HOUR_SLOTS[hour] ?? 1;
}

/**
 * The overtime a start time implies, to the end of the shift.
 *
 * OT is logged by its START time, which is how a supervisor thinks about it
 * ("we ran on until seven"), so this turns '19:00' into the hours beyond 18:30.
 * A start before the paid shift ends is not overtime and returns 0 rather than a
 * negative figure that would silently shrink the day.
 *
 * @param {string} overtimeStart  'HH:MM', or '' for none
 * @returns {number}              OT hours, e.g. 1 for 19:30
 */
export function overtimeHoursFrom(overtimeStart) {
  if (!overtimeStart) return 0;
  const [h, m] = String(overtimeStart).split(':').map(Number);
  if (!Number.isFinite(h)) return 0;
  const minutes = h * 60 + (Number.isFinite(m) ? m : 0);
  const beyond = minutes - SHIFT_END_MINUTES;
  return beyond > 0 ? Math.round((beyond / 60) * 100) / 100 : 0;
}

/**
 * The day's total productive hours: chosen productive hours plus overtime.
 *
 * @param {string[]} hours        the chosen 'HH' slots
 * @param {string} overtimeStart  'HH:MM' or ''
 */
export function totalWorkingHours(hours = [], overtimeStart = '') {
  return Math.round((productiveHours(hours) + overtimeHoursFrom(overtimeStart)) * 100) / 100;
}

/**
 * The daily target for an hourly target over a day's hours.
 *
 * The brief is explicit that the daily figure is the hourly target multiplied by
 * the active working hours. A full 08:00 → 18:30 day with no OT gives 10 ×
 * hourly, because the 0.5 lunch is deducted from the 10.5 on the clock. Callers
 * pass the hours that actually apply so the two modules always agree.
 */
export function dailyTargetFrom(hourlyTarget, hours = []) {
  const perHour = Number(hourlyTarget) || 0;
  const worked = Array.isArray(hours) ? productiveHours(hours) : (Number(hours) || 0);
  return Math.round(perHour * worked);
}

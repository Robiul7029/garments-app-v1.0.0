import { describe, it, expect } from 'vitest';
import {
  employeeOutputByLine,
  applyAutoLineOutput,
  buildAutoLineRecord,
  isAutoLineRecord,
  autoLineTooltip,
  autoRecordKey,
  AUTO_LINE_SOURCE,
  AUTO_LINE_TARGET_SOURCE,
} from '../monthlyLineOutput';

/**
 * The fallback line output.
 *
 * The brief: if a supervisor does NOT submit a Total Line Output entry for a line on a
 * day, the line's figure must be aggregated from the individual employee output
 * records for that line — and it must never read zero while employee entries exist.
 *
 * Three properties carry that, and each is pinned below:
 *   1. a hand entry always wins, and is never overwritten or duplicated;
 *   2. a line with no employee output stays ABSENT rather than becoming a row of zeroes;
 *   3. re-deriving the same day is idempotent, so no total can be doubled.
 */

const DAY = '2026-10-17';

/** An hourly row for one employee on one line. */
function hourly({ employee, line, output, date = DAY, entry_type = 'hourly', ...rest }) {
  return {
    id: `${employee}-${line}-${output}`,
    date,
    employee,
    line_no: line,
    hours: { '09': output },
    output,
    entry_type,
    ...rest,
  };
}

describe('summing employee output by line', () => {
  it('sums every employee on a line into one line figure', () => {
    const lines = employeeOutputByLine([
      hourly({ employee: 'Salma', line: 'Line-03', output: 300 }),
      hourly({ employee: 'Rina', line: 'Line-03', output: 250 }),
      hourly({ employee: 'Karim', line: 'Line-03', output: 150 }),
    ], DAY);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ line_no: 'Line-03', output: 700, entries: 3 });
    expect(lines[0].employees).toEqual(['Karim', 'Rina', 'Salma']);
  });

  it('keeps each line separate, biggest first', () => {
    const lines = employeeOutputByLine([
      hourly({ employee: 'A', line: 'Line-01', output: 100 }),
      hourly({ employee: 'B', line: 'Line-02', output: 900 }),
    ], DAY);
    expect(lines.map((l) => l.line_no)).toEqual(['Line-02', 'Line-01']);
  });

  it('reads a whole-day row stored under the DAY sentinel', () => {
    // A Daily-mode row keeps its figure under the day key, not a clock hour.
    const lines = employeeOutputByLine([
      { date: DAY, employee: 'Salma', line_no: 'Line-03', hours: { day: 480 }, entry_type: 'daily' },
    ], DAY);
    expect(lines[0].output).toBe(480);
  });

  it('counts only the day asked for', () => {
    const lines = employeeOutputByLine([
      hourly({ employee: 'A', line: 'Line-01', output: 100 }),
      hourly({ employee: 'A', line: 'Line-01', output: 999, date: '2026-10-16' }),
    ], DAY);
    expect(lines[0].output).toBe(100);
  });

  it('excludes a submitted line total from the employee sum', () => {
    // A `line` row IS a supervisor's figure, not an employee's work. Counting it here
    // would make the fallback a copy of the very entry it stands in for.
    const lines = employeeOutputByLine([
      hourly({ employee: 'A', line: 'Line-01', output: 100 }),
      hourly({ employee: 'Md Robiul Islam', line: 'Line-01', output: 5000, entry_type: 'line' }),
    ], DAY);
    expect(lines[0].output).toBe(100);
  });

  it('ignores a row with no line and a row with no output', () => {
    // Neither can be attributed to a line, and pooling them into a "no line" bucket
    // would put a row on the table that reads as a line.
    const lines = employeeOutputByLine([
      hourly({ employee: 'A', line: '', output: 400 }),
      hourly({ employee: 'B', line: 'Line-01', output: 0 }),
      hourly({ employee: 'C', line: 'Line-01', output: 50 }),
    ], DAY);
    expect(lines.map((l) => l.line_no)).toEqual(['Line-01']);
    expect(lines[0].output).toBe(50);
  });

  it('returns nothing for a missing or unreadable day', () => {
    expect(employeeOutputByLine([], DAY)).toEqual([]);
    expect(employeeOutputByLine([hourly({ employee: 'A', line: 'L', output: 1 })], '')).toEqual([]);
    expect(employeeOutputByLine(null, DAY)).toEqual([]);
  });
});

describe('filling the month in', () => {
  it('adds a derived row for a line nobody submitted', () => {
    const { records, added } = applyAutoLineOutput([], [
      hourly({ employee: 'Salma', line: 'Line-03', output: 300 }),
      hourly({ employee: 'Rina', line: 'Line-03', output: 250 }),
    ], DAY);
    expect(added).toHaveLength(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      line_no: 'Line-03', achievement: 550, source: AUTO_LINE_SOURCE,
    });
  });

  it('never overwrites a submitted entry', () => {
    // The supervisor's 1,200 stands; the 980 the operators logged does not replace it.
    const submitted = [{
      id: 'LO-1', date: DAY, line_no: 'Line-03', achievement: 1200, supervisor: 'Md Robiul Islam',
    }];
    const { records, added } = applyAutoLineOutput(submitted, [
      hourly({ employee: 'Salma', line: 'Line-03', output: 980 }),
    ], DAY);
    expect(added).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0].achievement).toBe(1200);
    expect(records[0].source).toBeUndefined();
  });

  it('fills the lines without an entry and leaves the submitted ones alone', () => {
    const submitted = [{ id: 'LO-1', date: DAY, line_no: 'Line-01', achievement: 1200 }];
    const { records, added } = applyAutoLineOutput(submitted, [
      hourly({ employee: 'A', line: 'Line-01', output: 999 }),
      hourly({ employee: 'B', line: 'Line-02', output: 400 }),
    ], DAY);
    expect(added.map((r) => r.line_no)).toEqual(['Line-02']);
    expect(records.find((r) => r.line_no === 'Line-01').achievement).toBe(1200);
    expect(records.find((r) => r.line_no === 'Line-02').achievement).toBe(400);
  });

  it('invents nothing when no employee recorded output', () => {
    // A line nobody logged stays ABSENT — a row of zeroes would be a record of work
    // that did not happen.
    const { records, added } = applyAutoLineOutput([], [], DAY);
    expect(records).toEqual([]);
    expect(added).toEqual([]);
  });

  it('is idempotent — re-running cannot double a total', () => {
    const input = [hourly({ employee: 'A', line: 'Line-03', output: 300 })];
    const first = applyAutoLineOutput([], input, DAY);
    const second = applyAutoLineOutput(first.records, input, DAY);
    expect(second.added).toEqual([]);
    expect(second.replaced).toHaveLength(1);
    expect(second.records).toHaveLength(1);
    expect(second.records[0].achievement).toBe(300);
  });

  it('refreshes a derived row when the employee figures are corrected', () => {
    const first = applyAutoLineOutput([], [hourly({ employee: 'A', line: 'L-1', output: 300 })], DAY);
    const next = applyAutoLineOutput(first.records, [hourly({ employee: 'A', line: 'L-1', output: 450 })], DAY);
    expect(next.records).toHaveLength(1);
    expect(next.records[0].achievement).toBe(450);
  });

  it('drops a derived row whose employee entries are gone', () => {
    // The line is no longer covered, so the calculated figure must not linger.
    const first = applyAutoLineOutput([], [hourly({ employee: 'A', line: 'L-1', output: 300 })], DAY);
    const next = applyAutoLineOutput(first.records, [], DAY);
    expect(next.records).toEqual([]);
  });

  it('leaves another day’s rows untouched', () => {
    const other = { id: 'LO-9', date: '2026-10-16', line_no: 'Line-09', achievement: 700 };
    const { records } = applyAutoLineOutput([other], [
      hourly({ employee: 'A', line: 'Line-03', output: 300 }),
    ], DAY);
    expect(records).toContainEqual(other);
  });

  it('never overwrites a submitted row with a differently-cased line name', () => {
    const submitted = [{ id: 'LO-1', date: DAY, line_no: 'line-03', achievement: 1200 }];
    const { added } = applyAutoLineOutput(submitted, [
      hourly({ employee: 'A', line: 'Line-03', output: 980 }),
    ], DAY);
    expect(added).toEqual([]);
  });

  it('still derives a line when the submitted entry names no line', () => {
    // The Total Line Output form no longer asks for a line (the field was replaced by
    // Daily Target), so a submitted entry can carry none. Such a row cannot suppress
    // the calculated figure for the line it was actually about — it is stored as its
    // own line-less row, and the employee-derived line is still filled in. Stated here
    // so the behaviour is deliberate rather than a surprise.
    const submitted = [{ id: 'LO-1', date: DAY, line_no: '', achievement: 1200, supervisor: 'Md Robiul Islam' }];
    const { records, added } = applyAutoLineOutput(submitted, [
      hourly({ employee: 'A', line: 'Line-03', output: 980 }),
    ], DAY);
    expect(added.map((r) => r.line_no)).toEqual(['Line-03']);
    expect(records).toHaveLength(2);
    // The supervisor's own row is kept exactly as it was.
    expect(records.find((r) => r.id === 'LO-1').achievement).toBe(1200);
  });
});

describe('the derived record', () => {
  const line = { line_no: 'Line-03', output: 550, entries: 3, employees: ['A', 'B', 'C'], dailyTarget: 1000 };

  it('is shaped like a submitted entry so every reader treats it the same', () => {
    const record = buildAutoLineRecord(line, DAY);
    expect(record).toMatchObject({
      date: DAY,
      month: '2026-10',
      entry_type: 'line',
      line_no: 'Line-03',
      achievement: 550,
      output: 550,
      quantity: 550,
      dailyTarget: 1000,
      achievementPercent: 55,
      source: AUTO_LINE_SOURCE,
      targetSource: AUTO_LINE_TARGET_SOURCE,
    });
  });

  it('names nobody as the supervisor, because nobody signed for it', () => {
    const record = buildAutoLineRecord(line, DAY);
    expect(record.supervisor).toBe('');
    expect(record.employee).toBe('All employees');
  });

  it('records the basis of the calculation', () => {
    const record = buildAutoLineRecord(line, DAY);
    expect(record.autoEntries).toBe(3);
    expect(record.autoEmployees).toBe(3);
  });

  it('is keyed on date + line, which is what makes it idempotent', () => {
    const a = buildAutoLineRecord(line, DAY);
    const b = buildAutoLineRecord(line, DAY);
    expect(autoRecordKey(a)).toBe(autoRecordKey(b));
    expect(autoRecordKey(a)).toBe('2026-10-17||line-03');
  });

  it('is recognised as derived, and a submitted row is not', () => {
    expect(isAutoLineRecord(buildAutoLineRecord(line, DAY))).toBe(true);
    expect(isAutoLineRecord({ line_no: 'Line-03', achievement: 10 })).toBe(false);
    expect(isAutoLineRecord({ source: 'line-output' })).toBe(false);
  });
});

describe('the tooltip', () => {
  it('states what was summed, in English', () => {
    const record = buildAutoLineRecord(
      { line_no: 'Line-03', output: 550, entries: 3, employees: ['A', 'B', 'C'] }, DAY,
    );
    const tip = autoLineTooltip(record);
    expect(tip).toContain('Calculated automatically');
    expect(tip).toContain('3 employee entries');
    expect(tip).toContain('from 3 people');
    expect(tip).toContain('no Total Line Output entry was submitted');
  });

  it('reads naturally for a single entry', () => {
    const record = buildAutoLineRecord(
      { line_no: 'L', output: 10, entries: 1, employees: ['A'] }, DAY,
    );
    expect(autoLineTooltip(record)).toContain('1 employee entry');
    expect(autoLineTooltip(record)).toContain('from 1 person');
  });

  it('says nothing on a submitted row', () => {
    expect(autoLineTooltip({ line_no: 'L', achievement: 5 })).toBe('');
  });

  it('uses no non-Latin script', () => {
    const record = buildAutoLineRecord(
      { line_no: 'L', output: 1, entries: 2, employees: ['A', 'B'] }, DAY,
    );
    expect(/[\u0980-\u09FF\u0600-\u06FF\u0400-\u04FF]/.test(autoLineTooltip(record))).toBe(false);
  });
});

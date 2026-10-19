import { describe, it, expect } from 'vitest';
import {
  DAY_MODE,
  ENTRY_MODES,
  DEFAULT_ENTRY_MODE,
  isOutputMode,
  modeNeedsEmployee,
  modeNeedsProcess,
  modeNeedsHours,
  showsOvertimeSection,
  slotsForMode,
  resolveEmployee,
  LINE_EMPLOYEE_LABEL,
  computeQcTotals,
  buildQcRecord,
  QC_COLLECTION,
} from '../hourlyEntryMode';

/**
 * The unified multi-mode entry model.
 *
 * One form logs four kinds of fact — Hourly, Daily, Total Line Output and QC
 * Product Check. These pin the rules each mode follows, so the field set, the
 * required markers and the stored record cannot drift from the brief.
 */
describe('the four entry modes', () => {
  it('lists all four, with Hourly as the default', () => {
    expect(ENTRY_MODES.map((m) => m.key)).toEqual(['hourly', 'daily', 'line', 'qc']);
    expect(DEFAULT_ENTRY_MODE).toBe('hourly');
  });

  it('treats hourly, daily and line as output modes, qc as not', () => {
    expect(isOutputMode('hourly')).toBe(true);
    expect(isOutputMode('daily')).toBe(true);
    expect(isOutputMode('line')).toBe(true);
    // A QC check records inspection, not production.
    expect(isOutputMode('qc')).toBe(false);
  });

  it('requires an employee only for hourly and daily', () => {
    expect(modeNeedsEmployee('hourly')).toBe(true);
    expect(modeNeedsEmployee('daily')).toBe(true);
    // The brief makes the employee OPTIONAL for Total Line Output, and QC is by line.
    expect(modeNeedsEmployee('line')).toBe(false);
    expect(modeNeedsEmployee('qc')).toBe(false);
  });

  it('requires a process only for hourly and daily', () => {
    expect(modeNeedsProcess('hourly')).toBe(true);
    expect(modeNeedsProcess('daily')).toBe(true);
    expect(modeNeedsProcess('line')).toBe(false);
    expect(modeNeedsProcess('qc')).toBe(false);
  });

  it('asks for clock hours only in hourly mode', () => {
    expect(modeNeedsHours('hourly')).toBe(true);
    expect(modeNeedsHours('daily')).toBe(false);
    expect(modeNeedsHours('line')).toBe(false);
    expect(modeNeedsHours('qc')).toBe(false);
  });

  it('keeps the overtime-section predicate available but no longer used by the form', () => {
    // Overtime is now entered in the Active Hours dropdown's own add-field, so the
    // form no longer renders a separate section and no longer calls this predicate.
    // It stays in the config module — beside the other mode rules — so the
    // standalone box can be restored without rebuilding the rule.
    expect(showsOvertimeSection('hourly')).toBe(true);
    expect(showsOvertimeSection('daily')).toBe(false);
    expect(showsOvertimeSection('line')).toBe(false);
    expect(showsOvertimeSection('qc')).toBe(false);
  });

  it('logs hourly against clock slots and the whole-day modes against the sentinel', () => {
    expect(slotsForMode('hourly')).toEqual([]);
    expect(slotsForMode('daily')).toEqual([DAY_MODE]);
    expect(slotsForMode('line')).toEqual([DAY_MODE]);
    expect(slotsForMode('qc')).toEqual([DAY_MODE]);
  });
});

describe('the employee a line entry is stored under', () => {
  it('keeps a named employee', () => {
    expect(resolveEmployee('line', 'Md Robiul')).toBe('Md Robiul');
    expect(resolveEmployee('hourly', 'Md Robiul')).toBe('Md Robiul');
  });

  it('labels a whole-line entry with no operator', () => {
    expect(resolveEmployee('line', '')).toBe(LINE_EMPLOYEE_LABEL);
    expect(resolveEmployee('line', '   ')).toBe(LINE_EMPLOYEE_LABEL);
  });

  it('leaves a blank employee blank for the modes that require one', () => {
    // Hourly/Daily cannot be saved blank (the form blocks it), so this only guards
    // against inventing a name where none belongs.
    expect(resolveEmployee('hourly', '')).toBe('');
  });
});

describe('the QC Product Check auto-calculation', () => {
  it('computes Total Checked = OK + Alter + Defect', () => {
    const totals = computeQcTotals({ okPcs: 300, alterPcs: 25, defectPcs: 12 });
    expect(totals.totalChecked).toBe(337);
  });

  it('derives the pass, alter and defect rates', () => {
    const totals = computeQcTotals({ okPcs: 300, alterPcs: 25, defectPcs: 12 });
    expect(totals.passRate).toBe(89);
    expect(totals.alterRate).toBe(7.4);
    expect(totals.defectRate).toBe(3.6);
  });

  it('is zero-safe on an empty check', () => {
    const totals = computeQcTotals({});
    expect(totals.totalChecked).toBe(0);
    expect(totals.passRate).toBe(0);
    expect(totals.defectRate).toBe(0);
  });

  it('ignores a non-numeric box rather than producing NaN', () => {
    // 'abc' and '' both read as 0, so only the 10 alters count.
    const totals = computeQcTotals({ okPcs: 'abc', alterPcs: 10, defectPcs: '' });
    expect(totals.totalChecked).toBe(10);
    expect(totals.alterRate).toBe(100);
    expect(Number.isNaN(totals.passRate)).toBe(false);
  });
});

describe('the QC record', () => {
  it('writes the Quality Control screen\'s own field names', () => {
    const record = buildQcRecord({
      date: '2026-10-12',
      order_no: 'PO-105',
      style: 'STY-1001',
      line_no: 'Line-03',
      process: 'Collar Attach',
      ok_pcs: 300,
      alter_pcs: 25,
      defect_pcs: 12,
      defect_type: 'Skip Stitch',
    });
    // The existing QC report reads `checked` and `defect_qty`.
    expect(record.checked).toBe(337);
    expect(record.defect_qty).toBe(12);
    // The fuller breakdown rides along additively.
    expect(record.ok_pcs).toBe(300);
    expect(record.alter_pcs).toBe(25);
    expect(record.total_checked).toBe(337);
    expect(record.defect_type).toBe('Skip Stitch');
    expect(record.entry_type).toBe('qc');
    expect(record.line).toBe('Line-03');
  });

  it('targets the same collection the QC screen already reads', () => {
    expect(QC_COLLECTION).toBe('quality-control');
  });
});
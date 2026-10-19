import { describe, it, expect } from 'vitest';
import {
  LINE_DEPARTMENTS,
  lineDepartmentOptions,
  normalizeLineNo,
  lineNoOf,
  validateLine,
  buildLineRecord,
  activeLineNames,
} from '../productionLineMaster';
import { lineOptionsOf } from '../monthlyLineOutput';

/**
 * The `productionLines` master.
 *
 * It is a REQUIRED foreign key for `hourlyProduction`, so what matters here is that
 * the document this module builds is one the schema will accept, that a line number
 * cannot collide, and that only ACTIVE lines are offered for new work.
 */

const FORM = {
  lineNo: 'Line-04',
  name: 'Sewing Line 04',
  department: 'Sewing',
  supervisorId: 'emp-1',
  capacityPerHour: '240',
  active: true,
};

const EXISTING = [
  { id: 'line-1', lineNo: 'Line-01', name: 'Sewing 01' },
  { id: 'line-3', lineNo: 'Line-03', name: 'Sewing 03' },
];

describe('normalising a line number', () => {
  it('trims and collapses the spaces people type', () => {
    expect(normalizeLineNo('  Line  03 ')).toBe('Line 03');
    expect(normalizeLineNo(undefined)).toBe('');
  });

  it('falls back to the name when a document carries no lineNo', () => {
    expect(lineNoOf({ name: 'Line-07' })).toBe('Line-07');
    expect(lineNoOf({ lineNo: 'Line-02', name: 'Sewing 02' })).toBe('Line-02');
  });
});

describe('validating a line', () => {
  it('accepts a complete line', () => {
    expect(validateLine(FORM, EXISTING, null)).toEqual({});
  });

  it('requires a line number and a name', () => {
    expect(validateLine({ ...FORM, lineNo: '  ' }, [], null).lineNo).toMatch(/line number is required/i);
    expect(validateLine({ ...FORM, name: '' }, [], null).name).toMatch(/line name is required/i);
  });

  it('rejects a duplicate line number, case- and space-insensitively', () => {
    expect(validateLine({ ...FORM, lineNo: 'line-03' }, EXISTING, null).lineNo)
      .toMatch(/already exists/i);
    expect(validateLine({ ...FORM, lineNo: 'Line 03' }, EXISTING, null).lineNo)
      .toMatch(/already exists/i);
  });

  it('does not treat the line being edited as a duplicate of itself', () => {
    expect(validateLine({ ...FORM, lineNo: 'Line-03' }, EXISTING, 'line-3')).toEqual({});
  });

  it('treats a different spacing or leading zero as the same line', () => {
    // "Line 3" and "Line-03" are one line on a floor, not two master records.
    expect(validateLine({ ...FORM, lineNo: 'Line 3' }, EXISTING, null).lineNo)
      .toMatch(/already exists/i);
  });

  it('requires a department from the listed set', () => {
    expect(validateLine({ ...FORM, department: '' }, [], null).department).toBeTruthy();
    expect(validateLine({ ...FORM, department: 'Rocketry' }, [], null).department).toBeTruthy();
    expect(lineDepartmentOptions()).toEqual(LINE_DEPARTMENTS);
  });

  it('allows capacity to be left blank but never negative or non-numeric', () => {
    expect(validateLine({ ...FORM, capacityPerHour: '' }, [], null)).toEqual({});
    expect(validateLine({ ...FORM, capacityPerHour: '-5' }, [], null).capacityPerHour).toMatch(/negative/i);
    expect(validateLine({ ...FORM, capacityPerHour: 'abc' }, [], null).capacityPerHour).toMatch(/number/i);
  });
});

describe('the saved document', () => {
  it('uses the schema field names and stores capacity as a number', () => {
    expect(buildLineRecord(FORM)).toEqual({
      lineNo: 'Line-04',
      name: 'Sewing Line 04',
      department: 'Sewing',
      supervisorId: 'emp-1',
      supervisorName: '',
      capacityPerHour: 240,
      active: true,
    });
  });

  it('states a blank capacity as 0 and defaults to active', () => {
    const record = buildLineRecord({ ...FORM, capacityPerHour: '', active: undefined });
    expect(record.capacityPerHour).toBe(0);
    expect(record.active).toBe(true);
  });

  it('carries the supervisor name beside the reference, additively', () => {
    expect(buildLineRecord(FORM, { supervisorName: 'Md Robiul Islam' }).supervisorName)
      .toBe('Md Robiul Islam');
  });
});

describe('which lines are offered', () => {
  const master = [
    { id: 'a', lineNo: 'Line-10', active: true },
    { id: 'b', lineNo: 'Line-02', active: true },
    { id: 'c', lineNo: 'Line-03', active: false },
    { id: 'd', name: 'Line-01', active: true },
  ];

  it('offers active lines only, in numeric order', () => {
    // Line-03 is deactivated: it stays in the master for history, not for new work.
    expect(activeLineNames(master)).toEqual(['Line-01', 'Line-02', 'Line-10']);
  });

  it('does not list the same line twice under two spellings', () => {
    const options = lineOptionsOf({
      erpLines: [{ id: 'a', lineNo: 'Line-03' }],
      directory: [{ line_no: 'line-03' }],
    });
    expect(options).toHaveLength(1);
    expect(options[0].erpId).toBe('a');
  });
});

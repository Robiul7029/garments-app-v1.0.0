import { describe, it, expect } from 'vitest';
import {
  firstInvalid,
  required,
  positiveNumber,
  percentWithin100,
  capacityRules,
  PROCESS_SHEET_RULES,
} from '../sequentialValidation';

/**
 * The sequential check is the whole point of these rules: a save action must stop
 * at the FIRST field that is wrong — never list several at once — and the next
 * save must move on to the next field. These tests pin exactly that behaviour,
 * field by field, so a future refactor cannot quietly turn it back into a
 * "everything is red" form.
 */
describe('firstInvalid — one field at a time', () => {
  it('returns null when every rule passes', () => {
    const rules = [
      { name: 'a', message: 'A', valid: required },
      { name: 'b', message: 'B', valid: required },
    ];
    expect(firstInvalid(rules, { a: 'x', b: 'y' })).toBe(null);
  });

  it('returns ONLY the first failing field, not all of them', () => {
    const rules = [
      { name: 'a', message: 'A is empty', valid: required },
      { name: 'b', message: 'B is empty', valid: required },
      { name: 'c', message: 'C is empty', valid: required },
    ];
    // a and b are both empty; only a — the first — is reported.
    expect(firstInvalid(rules, { a: '', b: '', c: 'ok' })).toEqual({ name: 'a', message: 'A is empty' });
  });

  it('moves on to the next field once the first is filled', () => {
    const rules = [
      { name: 'a', message: 'A is empty', valid: required },
      { name: 'b', message: 'B is empty', valid: required },
    ];
    expect(firstInvalid(rules, { a: 'filled', b: '' })).toEqual({ name: 'b', message: 'B is empty' });
  });

  it('treats a whitespace-only value as empty', () => {
    expect(required('   ')).toBe(false);
    expect(required(' x ')).toBe(true);
  });

  it('treats a rule that throws as failed rather than crashing the save', () => {
    const rules = [{ name: 'a', message: 'A', valid: () => { throw new Error('boom'); } }];
    expect(firstInvalid(rules, { a: 'x' })).toEqual({ name: 'a', message: 'A' });
  });
});

describe('the numeric predicates', () => {
  it('accepts only a positive number', () => {
    expect(positiveNumber('25')).toBe(true);
    expect(positiveNumber(0)).toBe(false);
    expect(positiveNumber('')).toBe(false);
    expect(positiveNumber('abc')).toBe(false);
  });

  it('accepts a percentage between 1 and 100', () => {
    expect(percentWithin100('70')).toBe(true);
    expect(percentWithin100(100)).toBe(true);
    expect(percentWithin100('0')).toBe(false);
    expect(percentWithin100('101')).toBe(false);
  });
});

describe('the capacity rules — manpower, hours, efficiency in order', () => {
  it('asks for manpower first, with the English prompt', () => {
    const values = { manpower: '', workingHours: '', efficiency: '' };
    expect(firstInvalid(capacityRules(values), values))
      .toEqual({ name: 'manpower', message: 'Please enter Total Deployed Manpower' });
  });

  it('flags a zero manpower as out of range rather than empty', () => {
    const values = { manpower: '0', workingHours: '', efficiency: '' };
    expect(firstInvalid(capacityRules(values), values))
      .toEqual({ name: 'manpower', message: 'Total Deployed Manpower must be greater than 0' });
  });

  it('moves to working hours once manpower is filled', () => {
    const values = { manpower: '25', workingHours: '', efficiency: '' };
    expect(firstInvalid(capacityRules(values), values))
      .toEqual({ name: 'workingHours', message: 'Please enter Working Hours' });
  });

  it('moves to efficiency last', () => {
    const values = { manpower: '25', workingHours: '8', efficiency: '' };
    expect(firstInvalid(capacityRules(values), values))
      .toEqual({ name: 'efficiency', message: 'Please enter Efficiency %' });
  });

  it('rejects a percentage above 100 with its own message', () => {
    const values = { manpower: '25', workingHours: '8', efficiency: '150' };
    expect(firstInvalid(capacityRules(values), values))
      .toEqual({ name: 'efficiency', message: 'Efficiency % must be between 1 and 100' });
  });

  it('passes when all three are valid', () => {
    const values = { manpower: '25', workingHours: '8', efficiency: '70' };
    expect(firstInvalid(capacityRules(values), values)).toBe(null);
  });
});

describe('the process sheet rules — style, file, operations in order', () => {
  it('asks for the style first', () => {
    expect(firstInvalid(PROCESS_SHEET_RULES, { style: '', file: '', operationCount: 0 }))
      .toEqual({ name: 'style', message: 'Please select Style/Order' });
  });

  it('asks for the process sheet next', () => {
    expect(firstInvalid(PROCESS_SHEET_RULES, { style: 'STY-1', file: '', operationCount: 0 }))
      .toEqual({ name: 'file', message: 'Please upload a process sheet' });
  });

  it('asks for operations when a file was chosen but parsed to nothing', () => {
    expect(firstInvalid(PROCESS_SHEET_RULES, { style: 'STY-1', file: 'sheet.xlsx', operationCount: 0 }))
      .toEqual({ name: 'operations', message: 'Please add at least one operation' });
  });

  it('accepts a hand-typed sheet with no file at all', () => {
    // A PDF reference with manually entered rows is a valid save.
    expect(firstInvalid(PROCESS_SHEET_RULES, { style: 'STY-1', file: '', operationCount: 4 })).toBe(null);
  });

  it('passes when a file parsed operations successfully', () => {
    expect(firstInvalid(PROCESS_SHEET_RULES, { style: 'STY-1', file: 'sheet.xlsx', operationCount: 4 })).toBe(null);
  });
});

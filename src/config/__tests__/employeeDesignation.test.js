import { describe, it, expect } from 'vitest';
import {
  DESIGNATIONS,
  CUSTOM_DESIGNATION,
  CUSTOM_DESIGNATION_LABEL,
  DEFAULT_DESIGNATION,
  normalizeDesignation,
  designationsInUse,
  buildEmployeeRecord,
  validateEmployee,
  resolveDesignation,
  withDesignation,
  normalizeEmployee,
  directoryList,
  supervisorNames,
  isSupervisor,
} from '../employeeDirectory';

/**
 * The Employee Directory's designation field and its field-level validation.
 *
 * Two things the brief pins down:
 *
 *   1. a designation is one of four grades, chosen from a dropdown — not free text,
 *      because the rest of the app asks "is this person a supervisor?" to build the
 *      Total Line Output form's Supervisor Name list;
 *   2. validation reports per FIELD, so the message can sit under the box that is
 *      wrong instead of in one banner at the top.
 */

const EXISTING = [
  { id: 'e1', employeeId: 'EMP-001', name: 'Md Robiul Islam', designation: 'Supervisor' },
  { id: 'e2', employeeId: 'EMP-002', name: 'Mst Sarjina Akter', designation: 'Operator' },
];

describe('the designation list', () => {
  it('carries the five grades the brief names, in order', () => {
    expect(DESIGNATIONS).toEqual(['Operator', 'Incharge', 'Supervisor', 'Manager', 'QC']);
  });

  it('is all English', () => {
    DESIGNATIONS.forEach((d) => expect(/^[A-Za-z]+$/.test(d)).toBe(true));
    expect(/^[A-Za-z /\u2026]+$/.test(CUSTOM_DESIGNATION_LABEL)).toBe(true);
  });

  it('normalises a stored spelling to the listed value', () => {
    expect(normalizeDesignation('operator')).toBe('Operator');
    expect(normalizeDesignation('  SUPERVISOR ')).toBe('Supervisor');
    expect(normalizeDesignation('qc')).toBe('QC');
  });

  it('defaults a blank designation to Operator', () => {
    // The brief: existing employees must not sit blank. Operator is the honest
    // default — the grade most of the floor holds.
    expect(normalizeDesignation('')).toBe('Operator');
    expect(normalizeDesignation(undefined)).toBe('Operator');
    expect(normalizeDesignation('   ')).toBe('Operator');
    expect(DEFAULT_DESIGNATION).toBe('Operator');
  });

  it('keeps an unrecognised designation rather than rewriting it', () => {
    // A custom value typed into the form must survive the round trip.
    expect(normalizeDesignation('Trainer')).toBe('Trainer');
    expect(normalizeDesignation('Senior Operator')).toBe('Senior Operator');
  });
});

describe('the custom designation route', () => {
  it('offers the presets plus the custom values already in use', () => {
    const directory = [
      { name: 'A', designation: 'Trainer' },
      { name: 'B', designation: 'Operator' },
      { name: 'C', designation: 'Trainer' }, // a duplicate custom value
      { name: 'D', designation: 'qc' },       // already a preset, differently cased
    ];
    expect(designationsInUse(directory)).toEqual([
      'Operator', 'Incharge', 'Supervisor', 'Manager', 'QC', 'Trainer',
    ]);
  });

  it('offers only the presets when nobody has a custom value', () => {
    expect(designationsInUse([])).toEqual(DESIGNATIONS);
  });

  it('resolves the sentinel to the typed value', () => {
    expect(resolveDesignation({ designation: CUSTOM_DESIGNATION, customDesignation: ' Trainer ' }))
      .toBe('Trainer');
    expect(resolveDesignation({ designation: 'QC', customDesignation: 'ignored' })).toBe('QC');
  });

  it('requires the typed box to be filled, and not to duplicate the list', () => {
    const base = { name: 'Salma Khatun', designation: CUSTOM_DESIGNATION };
    expect(validateEmployee({ ...base, customDesignation: '' }, EXISTING).customDesignation)
      .toMatch(/type the new designation/i);
    expect(validateEmployee({ ...base, customDesignation: '  ' }, EXISTING).customDesignation)
      .toBeTruthy();
    // "supervisor" lowercased is already on the list, so it belongs in the dropdown.
    expect(validateEmployee({ ...base, customDesignation: 'supervisor' }, EXISTING).customDesignation)
      .toMatch(/already on the list/i);
    expect(validateEmployee({ ...base, customDesignation: 'Trainer' }, EXISTING)).toEqual({});
  });

  it('stores the typed value on the new record', () => {
    const record = buildEmployeeRecord('Salma Khatun', EXISTING, '2026-10-17', 2, 'Trainer');
    expect(record.designation).toBe('Trainer');
  });
});

describe('editing a designation in place', () => {
  it('changes the grade and leaves everything else on the record alone', () => {
    const next = withDesignation(EXISTING, 'e2', 'Supervisor');
    const changed = next.find((r) => r.id === 'e2');
    expect(changed.designation).toBe('Supervisor');
    // The Employee ID is what attendance and payroll reference, so it must survive.
    expect(changed.employeeId).toBe('EMP-002');
    expect(changed.name).toBe('Mst Sarjina Akter');
  });

  it('touches only the record it was given', () => {
    const next = withDesignation(EXISTING, 'e2', 'Manager');
    expect(next.find((r) => r.id === 'e1').designation).toBe('Supervisor');
  });

  it('normalises what it is given, and defaults a blank to Operator', () => {
    expect(withDesignation(EXISTING, 'e2', 'qc')[1].designation).toBe('QC');
    expect(withDesignation(EXISTING, 'e2', '')[1].designation).toBe('Operator');
  });
});

describe('building a record with a designation', () => {
  it('stores the chosen designation and the next Employee ID', () => {
    const record = buildEmployeeRecord('Salma Khatun', EXISTING, '2026-10-17', 2, 'Incharge');
    expect(record).toMatchObject({
      name: 'Salma Khatun',
      employeeId: 'EMP-003',
      designation: 'Incharge',
      active: true,
    });
  });

  it('defaults a record with no designation to Operator', () => {
    // Not left blank: a record with no grade would silently drop out of any list
    // that filters on designation, so the brief defaults it instead.
    const record = buildEmployeeRecord('Salma Khatun', EXISTING, '2026-10-17', 2);
    expect(record.designation).toBe('Operator');
  });
});

describe('field-level validation', () => {
  it('reports the name and the designation separately', () => {
    const errors = validateEmployee({ name: '', designation: '' }, EXISTING);
    expect(errors.name).toMatch(/full name/i);
    expect(errors.designation).toMatch(/designation/i);
    // Two fields, two messages — never one banner covering both.
    expect(Object.keys(errors)).toHaveLength(2);
  });
  it('accepts a complete submission', () => {
    expect(validateEmployee({ name: 'Salma Khatun', designation: 'Operator' }, EXISTING)).toEqual({});
  });

  it('reports a duplicate name against the name field', () => {
    const errors = validateEmployee({ name: '  md robiul islam ', designation: 'Manager' }, EXISTING);
    expect(Object.keys(errors)).toEqual(['name']);
    expect(errors.name).toMatch(/already in the directory as EMP-001/i);
  });

  it('does not flag a designation that is merely whitespace as valid', () => {
    expect(validateEmployee({ name: 'Salma', designation: '   ' }, EXISTING).designation)
      .toMatch(/designation/i);
  });

  it('says nothing about a field that is fine', () => {
    const errors = validateEmployee({ name: 'Salma Khatun', designation: '' }, EXISTING);
    expect(errors.name).toBeUndefined();
    expect(errors.designation).toBeTruthy();
  });
});

describe('the designation reaches the rest of the app', () => {
  it('survives normalisation onto a stored record', () => {
    expect(normalizeEmployee({ name: 'A', designation: 'operator' }).designation).toBe('Operator');
  });

  it('reads as Operator on a legacy record that never had one', () => {
    // The brief: existing employees default to Operator rather than sitting blank.
    expect(normalizeEmployee('Legacy Name').designation).toBe('Operator');
    expect(normalizeEmployee({ name: 'A' }).designation).toBe('Operator');
  });

  it('is what the Supervisor Name dropdown filters on', () => {
    const directory = directoryList([
      { id: 'e1', name: 'Md Robiul Islam', designation: 'Supervisor', status: 'active' },
      { id: 'e2', name: 'Mst Sarjina Akter', designation: 'Operator', status: 'active' },
      { id: 'e3', name: 'Abdul Karim', designation: 'Incharge', status: 'active' },
      { id: 'e4', name: 'Nasrin Sultana', designation: 'Manager', status: 'active' },
    ]);
    expect(supervisorNames(directory, [])).toEqual(['Md Robiul Islam']);
    expect(directory.filter(isSupervisor).map((r) => r.designation)).toEqual(['Supervisor']);
  });
});

import { describe, it, expect } from 'vitest';
import {
  employeeIdNumber,
  formatEmployeeId,
  nextEmployeeId,
  normalizeEmployee,
  directoryList,
  employeeNames,
  findByName,
  buildEmployeeRecord,
  deriveNameList,
} from '../employeeDirectory';

/**
 * Tests for the employee directory.
 *
 * The Employee ID is the part that must not go wrong: it is referenced by
 * attendance rows, payroll and printed rosters, so an ID that is reused or
 * reissued after a rename would silently attach one person's history to another.
 * The ID-generation rules are pinned here.
 */
describe('Employee ID format', () => {
  it('pads to three digits', () => {
    expect(formatEmployeeId(1)).toBe('EMP-001');
    expect(formatEmployeeId(42)).toBe('EMP-042');
    expect(formatEmployeeId(999)).toBe('EMP-999');
  });

  it('never truncates a larger number', () => {
    expect(formatEmployeeId(1000)).toBe('EMP-1000');
    expect(formatEmployeeId(12345)).toBe('EMP-12345');
  });

  it('reads the numeric tail back out of an ID', () => {
    expect(employeeIdNumber('EMP-007')).toBe(7);
    expect(employeeIdNumber('EMP-1000')).toBe(1000);
    expect(employeeIdNumber('')).toBe(0);
    expect(employeeIdNumber(null)).toBe(0);
    expect(employeeIdNumber('nonsense')).toBe(0);
  });
});

describe('generating the next Employee ID', () => {
  it('starts at EMP-001 for an empty directory', () => {
    expect(nextEmployeeId([])).toBe('EMP-001');
    expect(nextEmployeeId(undefined)).toBe('EMP-001');
  });

  it('continues the sequence', () => {
    expect(nextEmployeeId([{ employeeId: 'EMP-001' }, { employeeId: 'EMP-002' }])).toBe('EMP-003');
  });

  it('is driven by the highest ID, not by the count', () => {
    // The classic bug: three records proving EMP-001, EMP-002 and EMP-009 exist.
    // A count-based counter would hand out EMP-004, reusing nothing but skipping
    // ahead wrongly; it must be EMP-010.
    const sparse = [{ employeeId: 'EMP-001' }, { employeeId: 'EMP-002' }, { employeeId: 'EMP-009' }];
    expect(nextEmployeeId(sparse)).toBe('EMP-010');
  });

  it('does not reuse an ID after a deletion', () => {
    // EMP-003 was removed; the next person must not be given EMP-003 again.
    const afterDelete = [{ employeeId: 'EMP-001' }, { employeeId: 'EMP-002' }, { employeeId: 'EMP-004' }];
    expect(nextEmployeeId(afterDelete)).toBe('EMP-005');
  });

  it('ignores records with no employeeId', () => {
    expect(nextEmployeeId([{ name: 'No ID' }, { employeeId: 'EMP-003' }])).toBe('EMP-004');
  });
});

describe('building an employee record', () => {
  it('issues the next ID and keeps the name', () => {
    const record = buildEmployeeRecord('Salma Khatun', []);
    expect(record.employeeId).toBe('EMP-001');
    expect(record.name).toBe('Salma Khatun');
    expect(record.active).toBe(true);
    expect(record.id).toBeTruthy();
  });

  it('collapses stray whitespace in a name', () => {
    expect(buildEmployeeRecord('  Salma   Khatun  ', []).name).toBe('Salma Khatun');
  });

  it('refuses an empty name', () => {
    expect(() => buildEmployeeRecord('', [])).toThrow(/name is required/i);
    expect(() => buildEmployeeRecord('   ', [])).toThrow(/name is required/i);
    expect(() => buildEmployeeRecord(null, [])).toThrow(/name is required/i);
  });

  it('gives each successive employee the next ID', () => {
    const first = buildEmployeeRecord('A', []);
    const second = buildEmployeeRecord('B', [first]);
    expect(second.employeeId).toBe('EMP-002');
  });
});

describe('normalising stored records', () => {
  it('passes a well-formed record through', () => {
    const record = normalizeEmployee({ id: 'x', employeeId: 'EMP-005', name: 'Rina' });
    expect(record).toMatchObject({ id: 'x', employeeId: 'EMP-005', name: 'Rina' });
  });

  it('accepts a bare name string from the legacy list', () => {
    expect(normalizeEmployee('Karim', 0)).toMatchObject({ name: 'Karim' });
  });

  it('accepts fullName as an alternative key', () => {
    expect(normalizeEmployee({ fullName: 'Jasmin Akter' }).name).toBe('Jasmin Akter');
  });

  it('drops a record with no usable name', () => {
    expect(normalizeEmployee({ employeeId: 'EMP-009' })).toBeNull();
    expect(normalizeEmployee(null)).toBeNull();
  });

  it('lists only the usable records', () => {
    const list = directoryList([
      { employeeId: 'EMP-001', name: 'Salma' },
      { employeeId: 'EMP-002' },
      'Rina',
    ]);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.name)).toEqual(['Salma', 'Rina']);
  });
});

describe('the name list the rest of the app reads', () => {
  it('extracts the names from the directory', () => {
    const names = employeeNames([
      { employeeId: 'EMP-001', name: 'Salma' },
      { employeeId: 'EMP-002', name: 'Rina' },
    ]);
    expect(names).toEqual(['Salma', 'Rina']);
  });

  it('de-duplicates case-insensitively', () => {
    const names = employeeNames([
      { name: 'Salma' },
      { name: 'salma' },
      { name: 'Rina' },
    ]);
    expect(names).toEqual(['Salma', 'Rina']);
  });

  it('keeps a legacy name that is not yet in the directory', () => {
    // The dropdowns must not lose somebody they could already select.
    const names = deriveNameList(
      [{ employeeId: 'EMP-001', name: 'Salma' }],
      ['Salma', 'Zakir'],
    );
    expect(names).toEqual(['Salma', 'Zakir']);
  });

  it('does not duplicate a legacy name already in the directory', () => {
    const names = deriveNameList(
      [{ employeeId: 'EMP-001', name: 'Salma' }],
      ['salma'],
    );
    expect(names).toEqual(['Salma']);
  });

  it('produces an empty list from an empty directory and no legacy names', () => {
    expect(deriveNameList([], [])).toEqual([]);
    expect(deriveNameList(undefined, undefined)).toEqual([]);
  });
});

describe('finding a duplicate name', () => {
  const list = [{ employeeId: 'EMP-001', name: 'Salma' }];

  it('finds a name regardless of case or padding', () => {
    expect(findByName(list, 'salma')?.employeeId).toBe('EMP-001');
    expect(findByName(list, '  SALMA  ')?.employeeId).toBe('EMP-001');
  });

  it('returns null for a new name', () => {
    expect(findByName(list, 'Nobody')).toBeNull();
    expect(findByName(list, '')).toBeNull();
    expect(findByName([], 'Salma')).toBeNull();
  });
});

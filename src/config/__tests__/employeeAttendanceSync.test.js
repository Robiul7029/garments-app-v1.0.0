import { describe, it, expect } from 'vitest';
import {
  STATUS,
  STATUS_LABEL,
  isSelectable,
  isArchived,
  isInactive,
  dormantRecords,
  employeeNames,
  deriveNameList,
  normalizeEmployee,
  attendanceWorkerFor,
  syncPayloadFor,
  employeeIdNumber,
} from '../employeeDirectory';
import { STANDARD_WORKERS } from '../../utils/attendance';

/**
 * Tests for the Smart Attendance integration and the three lifecycle states.
 *
 * Two things must not go wrong here:
 *   1. A person created in the directory must be clockable in Smart Attendance
 *      under the SAME key their attendance rows already use.
 *   2. Deactivating or archiving somebody must not orphan their history — the
 *      record is never removed, only its status changes.
 */
describe('the Smart Attendance roster is the source of the directory', () => {
  it('does not contain the old dummy names', () => {
    const names = STANDARD_WORKERS.map((w) => w.name);
    ['Salma Khatun', 'Rina Akter', 'Karim Hossain', 'Jasmin Nahar', 'Robiul Awal']
      .forEach((dummy) => expect(names).not.toContain(dummy));
  });

  it('carries the real factory roster', () => {
    const names = STANDARD_WORKERS.map((w) => w.name);
    expect(names).toContain('Md Robiul Islam');
    expect(names).toContain('Md Himel');
    expect(names.length).toBeGreaterThan(40);
  });

  it('gives every worker a numeric workerId and a name', () => {
    STANDARD_WORKERS.forEach((w) => {
      expect(Number.isInteger(w.workerId)).toBe(true);
      expect(w.workerId).toBeGreaterThan(0);
      expect(w.name).toBeTruthy();
    });
  });

  it('has no duplicate worker ids', () => {
    const ids = STANDARD_WORKERS.map((w) => w.workerId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the Smart Attendance mirror', () => {
  it('keys the worker by the numeric tail of the Employee ID', () => {
    // EMP-007 -> workerId 7, which is the key an attendance row stores. This is
    // what makes a person created here immediately clockable.
    const record = { employeeId: 'EMP-007', name: 'Md Himel' };
    const worker = attendanceWorkerFor(record);
    expect(worker.workerId).toBe(7);
    expect(employeeIdNumber(record.employeeId)).toBe(worker.workerId);
  });

  it('carries the fields Smart Attendance reads', () => {
    const worker = attendanceWorkerFor({
      employeeId: 'EMP-003', name: 'Md Sajjad Islam', department: 'Sewing', designation: 'Operator',
    });
    expect(worker).toMatchObject({
      workerId: 3,
      employeeId: 'EMP-003',
      name: 'Md Sajjad Islam',
      department: 'Sewing',
      designation: 'Operator',
      active: true,
    });
  });

  it('refuses to mirror a record with no Employee ID', () => {
    // A legacy name-only row has no key an attendance row could reference.
    expect(attendanceWorkerFor({ name: 'No ID' })).toBeNull();
    expect(attendanceWorkerFor(null)).toBeNull();
  });

  it('mirrors a long Employee ID without truncating it', () => {
    expect(attendanceWorkerFor({ employeeId: 'EMP-1042', name: 'X' }).workerId).toBe(1042);
  });

  it('bundles the directory row and its worker together', () => {
    const payload = syncPayloadFor({ employeeId: 'EMP-005', name: 'Md Nijam' });
    expect(payload.directory.employeeId).toBe('EMP-005');
    expect(payload.worker.workerId).toBe(5);
    expect(payload.worker.name).toBe('Md Nijam');
  });
});

describe('stopping the mirror when somebody leaves', () => {
  it('marks the attendance worker inactive, so it is not clockable', () => {
    const inactiveWorker = attendanceWorkerFor({ employeeId: 'EMP-007', name: 'X', status: STATUS.INACTIVE });
    expect(inactiveWorker.active).toBe(false);
  });

  it('marks an archived person inactive for attendance too', () => {
    const archivedWorker = attendanceWorkerFor({ employeeId: 'EMP-007', name: 'X', status: STATUS.ARCHIVED, archived: true });
    expect(archivedWorker.active).toBe(false);
  });
});

describe('the three lifecycle states', () => {
  it('treats an active record as selectable', () => {
    expect(isSelectable({ status: STATUS.ACTIVE, active: true })).toBe(true);
    expect(isSelectable({})).toBe(true); // no status at all means active
  });

  it('hides an inactive record from the dropdowns', () => {
    expect(isSelectable({ status: STATUS.INACTIVE })).toBe(false);
    expect(isInactive({ status: STATUS.INACTIVE })).toBe(true);
    expect(isArchived({ status: STATUS.INACTIVE })).toBe(false);
  });

  it('hides an archived record from the dropdowns', () => {
    expect(isSelectable({ status: STATUS.ARCHIVED, archived: true })).toBe(false);
    expect(isArchived({ status: STATUS.ARCHIVED, archived: true })).toBe(true);
    // Archived is a strictly stronger state than inactive.
    expect(isInactive({ status: STATUS.ARCHIVED, archived: true })).toBe(false);
  });

  it('understands a legacy record that only carries the active boolean', () => {
    expect(isSelectable({ active: false })).toBe(false);
    expect(isInactive({ active: false })).toBe(true);
    expect(isSelectable({ active: true })).toBe(true);
  });

  it('has a label for every state', () => {
    expect(STATUS_LABEL[STATUS.ACTIVE]).toBe('Active');
    expect(STATUS_LABEL[STATUS.INACTIVE]).toBe('Inactive');
    expect(STATUS_LABEL[STATUS.ARCHIVED]).toBe('Archived');
  });

  it('normalises a record into the newer shape', () => {
    const normalized = normalizeEmployee({ employeeId: 'EMP-002', name: 'X', active: false });
    expect(normalized.status).toBe(STATUS.INACTIVE);
    expect(normalized.archived).toBe(false);
  });

  it('collects the dormant records an admin should still see', () => {
    const records = [
      { employeeId: 'EMP-001', name: 'A', status: STATUS.ACTIVE },
      { employeeId: 'EMP-002', name: 'B', status: STATUS.INACTIVE },
      { employeeId: 'EMP-003', name: 'C', status: STATUS.ARCHIVED, archived: true },
    ];
    const dormant = dormantRecords(records);
    expect(dormant.map((r) => r.name)).toEqual(['B', 'C']);
  });
});

describe('dormant people drop out of the dropdowns', () => {
  const records = [
    { employeeId: 'EMP-001', name: 'Active Person', status: STATUS.ACTIVE },
    { employeeId: 'EMP-002', name: 'Inactive Person', status: STATUS.INACTIVE },
    { employeeId: 'EMP-003', name: 'Archived Person', status: STATUS.ARCHIVED, archived: true },
  ];

  it('offers only the active person to a select', () => {
    expect(employeeNames(records)).toEqual(['Active Person']);
  });

  it('keeps a dormant name out of the derived name list', () => {
    // The legacy merge must not resurrect somebody who was just deactivated.
    const names = deriveNameList(records, ['Active Person', 'Inactive Person', 'A Legacy Name']);
    expect(names).toContain('Active Person');
    expect(names).toContain('A Legacy Name');
    expect(names).not.toContain('Inactive Person');
    expect(names).not.toContain('Archived Person');
  });

  it('still returns every record from the full directory listing', () => {
    // Dormant people are hidden from dropdowns, not deleted from the directory.
    const all = records.map(normalizeEmployee);
    expect(all).toHaveLength(3);
  });
});

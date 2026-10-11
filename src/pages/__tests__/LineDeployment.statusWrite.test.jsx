import { describe, it, expect } from 'vitest';
import {
  STATUS,
  directoryList,
  deriveNameList,
  attendanceWorkerFor,
  isSelectable,
  isInactive,
  isArchived,
  attendanceWorkerFor as mirror,
} from '../../config/employeeDirectory';

/**
 * Tests the exact write a status change produces.
 *
 * The browser check confirmed the UI, but a DOM probe cannot be trusted to read
 * the resulting state — so the storage contract is pinned here instead, against
 * the same functions the page composes.
 *
 * This mirrors LineDeploymentPage.saveDirectory() + confirmRemove():
 *   1. the directory row is UPDATED IN PLACE (never removed)
 *   2. the `workers` mirror is rewritten with active:false
 *   3. the shared name list is re-derived, which drops the name
 */
function applyStatusChange(directory, recordId, nextStatus) {
  const next = directory.map((r) => (
    r.id === recordId
      ? {
        ...r,
        status: nextStatus,
        archived: nextStatus === STATUS.ARCHIVED,
        active: false,
      }
      : r
  ));

  // Mirrors saveDirectory()
  const sharedNames = deriveNameList(next, []);
  const workers = directoryList(next).map((r) => {
    const w = attendanceWorkerFor(r);
    return w ? { ...w, id: String(w.workerId) } : null;
  }).filter(Boolean);

  return { next, sharedNames, workers };
}

const DIRECTORY = [
  { id: 'a', employeeId: 'EMP-001', workerId: 1, name: 'Md Robiul Islam', status: STATUS.ACTIVE, active: true },
  { id: 'b', employeeId: 'EMP-002', workerId: 2, name: 'Md M U Sumon', status: STATUS.ACTIVE, active: true },
  { id: 'c', employeeId: 'EMP-003', workerId: 3, name: 'Md Mojibor Rahman', status: STATUS.ACTIVE, active: true },
];

describe('unchecked delete — set to Inactive', () => {
  const { next, sharedNames, workers } = applyStatusChange(DIRECTORY, 'a', STATUS.INACTIVE);

  it('keeps the record in the directory', () => {
    const record = next.find((r) => r.id === 'a');
    expect(record).toBeTruthy();
    expect(record.name).toBe('Md Robiul Islam');
    // The Employee ID and workerId survive, so attendance history still resolves.
    expect(record.employeeId).toBe('EMP-001');
    expect(record.workerId).toBe(1);
  });

  it('marks it inactive without archiving it', () => {
    const record = next.find((r) => r.id === 'a');
    expect(record.status).toBe(STATUS.INACTIVE);
    expect(record.archived).toBe(false);
    expect(record.active).toBe(false);
  });

  it('is not selectable on the floor', () => {
    expect(isSelectable(next.find((r) => r.id === 'a'))).toBe(false);
    expect(isInactive(next.find((r) => r.id === 'a'))).toBe(true);
    expect(isArchived(next.find((r) => r.id === 'a'))).toBe(false);
  });

  it('drops the name from the shared dropdown list', () => {
    expect(sharedNames).not.toContain('Md Robiul Islam');
    expect(sharedNames).toContain('Md M U Sumon');
    expect(sharedNames).toContain('Md Mojibor Rahman');
  });

  it('stops Smart Attendance offering them for a clock-in', () => {
    const worker = workers.find((w) => w.workerId === 1);
    expect(worker.active).toBe(false);
    // Still present, so past attendance rows keep resolving their name.
    expect(worker.name).toBe('Md Robiul Islam');
  });

  it('leaves the other employees untouched', () => {
    expect(isSelectable(next.find((r) => r.id === 'b'))).toBe(true);
    expect(isSelectable(next.find((r) => r.id === 'c'))).toBe(true);
    expect(sharedNames).toHaveLength(2);
  });
});

describe('checked delete — Archived', () => {
  const { next, sharedNames, workers } = applyStatusChange(DIRECTORY, 'b', STATUS.ARCHIVED);

  it('still keeps the record rather than hard-deleting it', () => {
    // A hard delete would orphan attendance rows that reference workerId 2.
    const record = next.find((r) => r.id === 'b');
    expect(record).toBeTruthy();
    expect(record.workerId).toBe(2);
  });

  it('marks it archived', () => {
    const record = next.find((r) => r.id === 'b');
    expect(record.status).toBe(STATUS.ARCHIVED);
    expect(record.archived).toBe(true);
    expect(record.active).toBe(false);
  });

  it('is distinguishable from merely inactive', () => {
    const record = next.find((r) => r.id === 'b');
    expect(isArchived(record)).toBe(true);
    // Archived is the stronger state; it must not also read as inactive.
    expect(isInactive(record)).toBe(false);
    expect(isSelectable(record)).toBe(false);
  });

  it('removes the name from every active list', () => {
    expect(sharedNames).not.toContain('Md M U Sumon');
    expect(sharedNames).toHaveLength(2);
  });

  it('removes it from Smart Attendance as well', () => {
    const worker = workers.find((w) => w.workerId === 2);
    expect(worker.active).toBe(false);
  });
});

describe('the two states are not interchangeable', () => {
  const inactive = applyStatusChange(DIRECTORY, 'a', STATUS.INACTIVE).next.find((r) => r.id === 'a');
  const archived = applyStatusChange(DIRECTORY, 'a', STATUS.ARCHIVED).next.find((r) => r.id === 'a');

  it('both leave the floor list, but differ for the admin', () => {
    expect(isSelectable(inactive)).toBe(false);
    expect(isSelectable(archived)).toBe(false);
    // Only one of them is the "removed from the entire site" state.
    expect(isArchived(inactive)).toBe(false);
    expect(isArchived(archived)).toBe(true);
  });

  it('both remain restorable, because neither is a hard delete', () => {
    const restored = { ...inactive, status: STATUS.ACTIVE, archived: false, active: true };
    expect(isSelectable(restored)).toBe(true);
    const restoredFromArchive = { ...archived, status: STATUS.ACTIVE, archived: false, active: true };
    expect(isSelectable(restoredFromArchive)).toBe(true);
  });
});

describe('reactivating brings somebody back', () => {
  it('restores the name to the shared list', () => {
    const { next } = applyStatusChange(DIRECTORY, 'a', STATUS.INACTIVE);
    const restored = next.map((r) => (
      r.id === 'a' ? { ...r, status: STATUS.ACTIVE, archived: false, active: true } : r
    ));
    const names = deriveNameList(restored, []);
    expect(names).toContain('Md Robiul Islam');
    expect(names).toHaveLength(3);
  });

  it('makes them clockable again', () => {
    const { next } = applyStatusChange(DIRECTORY, 'a', STATUS.ARCHIVED);
    const restored = next.map((r) => (
      r.id === 'a' ? { ...r, status: STATUS.ACTIVE, archived: false, active: true } : r
    ));
    expect(mirror(restored.find((r) => r.id === 'a')).active).toBe(true);
  });
});

describe('Employee IDs are never reused across a status change', () => {
  it('keeps the ID of a dormant record intact', () => {
    const { next } = applyStatusChange(DIRECTORY, 'a', STATUS.ARCHIVED);
    // If the ID were freed, a new hire could land on EMP-001 while attendance
    // rows for the archived person still point there.
    expect(next.find((r) => r.id === 'a').employeeId).toBe('EMP-001');
  });
});

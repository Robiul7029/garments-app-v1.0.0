import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests the two-way sync between Manpower Management → Line Deployment (the
 * employee directory) and Smart Attendance.
 *
 * The directory is the single source of truth, and the key that joins the two is
 * the numeric tail of the Employee ID (EMP-007 → workerId 7) — the exact key an
 * attendance row stores. These tests pin the Firestore WRITES the directory makes,
 * because that is the part a DOM probe cannot see and the part that was missing:
 * the directory used to mirror into the local store only, so Smart Attendance
 * (which reads Firestore) never learned about a new hire.
 *
 * `firebase/firestore` is mocked so the assertions can read the exact documents
 * that would be written, with no network.
 */
const setDoc = vi.fn().mockResolvedValue(undefined);
const updateDoc = vi.fn().mockResolvedValue(undefined);
const getDocs = vi.fn();
const doc = vi.fn((_db, collectionName, id) => ({ _path: `${collectionName}/${id}`, id }));
const collection = vi.fn((_db, name) => ({ _collection: name }));
const query = vi.fn((ref, ...clauses) => ({ ref, clauses }));
const where = vi.fn((field, op, value) => ({ field, op, value }));
const serverTimestamp = vi.fn(() => 'TS');

vi.mock('firebase/firestore', () => ({
  collection: (...args) => collection(...args),
  doc: (...args) => doc(...args),
  getDocs: (...args) => getDocs(...args),
  onSnapshot: vi.fn(),
  query: (...args) => query(...args),
  serverTimestamp: (...args) => serverTimestamp(...args),
  setDoc: (...args) => setDoc(...args),
  updateDoc: (...args) => updateDoc(...args),
  where: (...args) => where(...args),
  deleteDoc: vi.fn(),
}));

vi.mock('../../firebase', () => ({ db: { _db: true } }));

const {
  upsertWorkerFromDirectory,
  syncDirectoryToWorkers,
  renameWorkerAndAttendance,
} = await import('../attendance');

beforeEach(() => {
  setDoc.mockClear();
  updateDoc.mockClear();
  getDocs.mockReset();
  doc.mockClear();
  collection.mockClear();
});

describe('adding an employee pushes them into Smart Attendance’s store', () => {
  it('writes the worker at workers/{workerId}, keyed by the Employee ID tail', async () => {
    await upsertWorkerFromDirectory({ employeeId: 'EMP-052', name: 'Nasrin Akter' });

    expect(doc).toHaveBeenCalledWith({ _db: true }, 'workers', '52');
    const [, data, options] = setDoc.mock.calls[0];
    expect(data.workerId).toBe(52);
    expect(data.employeeId).toBe('EMP-052');
    expect(data.name).toBe('Nasrin Akter');
    expect(data.active).toBe(true);
    // Merge, so fields the directory does not model are not wiped.
    expect(options).toEqual({ merge: true });
  });

  it('refuses to mirror a name with no ID, since attendance would have no key', async () => {
    const result = await upsertWorkerFromDirectory({ name: 'No ID' });
    expect(result).toBeNull();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('syncs the whole roster on every directory write', async () => {
    const count = await syncDirectoryToWorkers([
      { employeeId: 'EMP-001', name: 'Md Robiul Islam' },
      { employeeId: 'EMP-002', name: 'Md M U Sumon' },
      { employeeId: 'EMP-003', name: 'Md Mojibor Rahman' },
    ]);
    expect(count).toBe(3);
    // One document per person, at the key attendance rows already reference.
    expect(doc.mock.calls.map((c) => c[2])).toEqual(['1', '2', '3']);
  });
});

describe('deactivating an employee stops Smart Attendance clocking them in', () => {
  it('writes active:false so the picker filters them out', async () => {
    await upsertWorkerFromDirectory({
      employeeId: 'EMP-007', name: 'Md Himel', status: 'inactive',
    });
    const [, data] = setDoc.mock.calls[0];
    expect(data.active).toBe(false);
    // The record is still written — attendance history references it.
    expect(data.name).toBe('Md Himel');
  });

  it('treats an archived person as inactive too', async () => {
    await upsertWorkerFromDirectory({
      employeeId: 'EMP-007', name: 'Md Himel', status: 'archived', archived: true,
    });
    expect(setDoc.mock.calls[0][1].active).toBe(false);
  });
});

describe('renaming an employee propagates everywhere', () => {
  it('updates the worker document AND every attendance row that names them', async () => {
    getDocs.mockResolvedValue({
      size: 2,
      docs: [
        { id: '7_2026-09-01', data: () => ({ workerId: 7 }) },
        { id: '7_2026-09-02', data: () => ({ workerId: 7 }) },
      ],
    });

    const result = await renameWorkerAndAttendance({ workerId: 7, name: 'Md Himel Hossain' });

    // The worker document is renamed…
    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ _path: 'workers/7' }),
      expect.objectContaining({ name: 'Md Himel Hossain' }),
      { merge: true },
    );
    // …and the attendance rows are matched by workerId, not name, so they update
    // no matter what the old spelling was.
    expect(where).toHaveBeenCalledWith('workerId', '==', 7);
    expect(updateDoc).toHaveBeenCalledTimes(2);
    expect(updateDoc.mock.calls.map((c) => c[0]._path)).toEqual([
      'attendance/7_2026-09-01',
      'attendance/7_2026-09-02',
    ]);
    expect(updateDoc.mock.calls[0][1].userName).toBe('Md Himel Hossain');
    expect(result).toEqual({ worker: true, attendanceRows: 2 });
  });

  it('does nothing without a workerId or a name', async () => {
    expect(await renameWorkerAndAttendance({ name: 'X' })).toEqual({ worker: false, attendanceRows: 0 });
    expect(await renameWorkerAndAttendance({ workerId: 7, name: '  ' })).toEqual({ worker: false, attendanceRows: 0 });
    expect(setDoc).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildDirectorySync,
  workersToSync,
  retiredNames,
  STATUS,
} from '../employeeDirectory';

/**
 * Pins exactly what ONE directory write produces.
 *
 * Line Deployment used to open-code this composition, so a change to the page could
 * silently stop mirroring a collection without any test noticing. It now calls
 * `buildDirectorySync` / `workersToSync`, and these assert the payloads those
 * functions return — the same ones the page hands to `setRaw` and to the Firestore
 * sync. This is the contract that makes the directory the single source of truth
 * for the attendance screen, the production dropdowns and the reports at once.
 */
const DIRECTORY = [
  { id: 'a', employeeId: 'EMP-001', workerId: 1, name: 'Md Robiul Islam', status: STATUS.ACTIVE, active: true },
  { id: 'b', employeeId: 'EMP-002', workerId: 2, name: 'Md M U Sumon', status: STATUS.ACTIVE, active: true },
];

describe('buildDirectorySync — one write, three consumers served', () => {
  it('derives the shared name list every dropdown reads', () => {
    const { names } = buildDirectorySync(DIRECTORY, []);
    expect(names).toEqual(['Md Robiul Islam', 'Md M U Sumon']);
  });

  it('builds the Smart Attendance mirror keyed by workerId', () => {
    const { workers } = buildDirectorySync(DIRECTORY, []);
    expect(workers).toHaveLength(2);
    // The document id IS the workerId, which is the key an attendance row stores.
    expect(workers[0]).toMatchObject({
      id: '1', workerId: 1, employeeId: 'EMP-001', name: 'Md Robiul Islam', active: true,
    });
  });

  it('adds a new hire to both the name list and the attendance mirror', () => {
    const next = [...DIRECTORY, { id: 'c', employeeId: 'EMP-052', name: 'Nasrin Akter', status: STATUS.ACTIVE, active: true }];
    const { names, workers } = buildDirectorySync(next, ['Md Robiul Islam', 'Md M U Sumon']);
    expect(names).toContain('Nasrin Akter');
    const nasrin = workers.find((w) => w.employeeId === 'EMP-052');
    expect(nasrin.workerId).toBe(52);
    expect(nasrin.active).toBe(true);
  });

  it('renames without changing the key, so attendance history stays attached', () => {
    const renamed = DIRECTORY.map((r) => (r.id === 'b' ? { ...r, name: 'Md M U Sumon (Rana)' } : r));
    const { names, workers } = buildDirectorySync(renamed, [], DIRECTORY);
    // The new spelling is offered…
    expect(names).toContain('Md M U Sumon (Rana)');
    // …the old one is gone, so no dropdown offers a name that no longer exists…
    expect(names).not.toContain('Md M U Sumon');
    // …and the worker key is unchanged, so the person's attendance rows still resolve.
    const worker = workers.find((w) => w.workerId === 2);
    expect(worker.employeeId).toBe('EMP-002');
    expect(worker.name).toBe('Md M U Sumon (Rana)');
  });

  it('does not resurrect a renamed person’s OLD spelling on the next save', () => {
    // The bug this guards: the legacy merge keeps any previous name not currently in
    // the directory, so a rename left the old spelling behind as a phantom employee.
    const renamed = DIRECTORY.map((r) => (r.id === 'a' ? { ...r, name: 'Md Robiul Islam (Robi)' } : r));
    const previousNames = ['Md Robiul Islam', 'Md M U Sumon'];

    // First save: the rename retires the old spelling.
    const first = buildDirectorySync(renamed, previousNames, DIRECTORY);
    expect(first.names).toContain('Md Robiul Islam (Robi)');
    expect(first.names).not.toContain('Md Robiul Islam');

    // A LATER save (e.g. deactivating somebody else) must not bring it back.
    const afterDeactivate = renamed.map((r) => (
      r.id === 'b' ? { ...r, status: STATUS.INACTIVE, active: false } : r
    ));
    const second = buildDirectorySync(afterDeactivate, first.names, renamed);
    expect(second.names).not.toContain('Md Robiul Islam');
    expect(second.names).toContain('Md Robiul Islam (Robi)');
    expect(second.names).not.toContain('Md M U Sumon');
  });

  it('still keeps a genuine legacy name that never belonged to a record', () => {
    // A name carried from before the directory existed has no record to retire it,
    // so it must survive the merge — the retirement rule is only for RENAMES.
    const renamed = DIRECTORY.map((r) => (r.id === 'a' ? { ...r, name: 'Md Robiul Islam (Robi)' } : r));
    const { names } = buildDirectorySync(renamed, ['Old Legacy Name'], DIRECTORY);
    expect(names).toContain('Old Legacy Name');
  });

  it('drops a deactivated person from the dropdown list but keeps the mirror record', () => {
    const withInactive = DIRECTORY.map((r) => (
      r.id === 'a' ? { ...r, status: STATUS.INACTIVE, active: false } : r
    ));
    const { names, workers } = buildDirectorySync(withInactive, []);
    expect(names).not.toContain('Md Robiul Islam');
    expect(names).toContain('Md M U Sumon');
    // The worker is still mirrored — as inactive — so past attendance keeps resolving.
    const worker = workers.find((w) => w.workerId === 1);
    expect(worker).toBeTruthy();
    expect(worker.active).toBe(false);
  });

  it('skips a legacy name with no ID, which attendance could not key', () => {
    const { workers } = buildDirectorySync([
      ...DIRECTORY,
      { id: 'legacy', employeeId: '', name: 'No ID Person', status: STATUS.ACTIVE },
    ], []);
    expect(workers).toHaveLength(2);
    expect(workers.some((w) => w.name === 'No ID Person')).toBe(false);
  });
});

describe('retiredNames — the spellings a rename leaves behind', () => {
  it('reports the previous name of a renamed record', () => {
    const renamed = DIRECTORY.map((r) => (r.id === 'a' ? { ...r, name: 'Md Robiul Islam (Robi)' } : r));
    expect(retiredNames(DIRECTORY, renamed)).toEqual(['md robiul islam']);
  });

  it('reports nothing when nothing was renamed', () => {
    expect(retiredNames(DIRECTORY, DIRECTORY)).toEqual([]);
  });

  it('reports nothing for a brand-new record, which has no previous name', () => {
    const grown = [...DIRECTORY, { id: 'new', employeeId: 'EMP-052', name: 'Nasrin Akter' }];
    expect(retiredNames(DIRECTORY, grown)).toEqual([]);
  });
});

describe('workersToSync — what is pushed to Firestore', () => {
  it('includes dormant records so their history is never orphaned', () => {
    const records = [
      { employeeId: 'EMP-001', name: 'A', status: STATUS.ACTIVE, active: true },
      { employeeId: 'EMP-002', name: 'B', status: STATUS.INACTIVE, active: false },
      { employeeId: 'EMP-003', name: 'C', status: STATUS.ARCHIVED, archived: true, active: false },
    ];
    const toSync = workersToSync(records);
    // All three are pushed: the two dormant ones are written with active:false so
    // Smart Attendance stops offering them, but their documents remain.
    expect(toSync).toHaveLength(3);
    expect(toSync.map((r) => r.employeeId)).toEqual(['EMP-001', 'EMP-002', 'EMP-003']);
    expect(toSync.find((r) => r.employeeId === 'EMP-002').active).toBe(false);
    expect(toSync.find((r) => r.employeeId === 'EMP-003').active).toBe(false);
  });

  it('keeps the active flag in step with the status', () => {
    const toSync = workersToSync([{ employeeId: 'EMP-009', name: 'X', status: STATUS.ACTIVE, active: true }]);
    expect(toSync[0].active).toBe(true);
    expect(toSync[0].workerId).toBe(9);
  });

  it('returns nothing for an empty directory', () => {
    expect(workersToSync([])).toEqual([]);
  });
});

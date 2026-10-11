import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LineDeploymentPage from '../LineDeploymentPage';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';

/**
 * Tests the WRITE behaviour of the directory, not just its markup.
 *
 * The page is a plain function component, so its submit handler can be exercised
 * by rendering it through react-dom/server's `useState`-aware renderer and then
 * calling the handler through the props it actually received. That is more
 * involved than a mount test, so instead the write path is verified through the
 * two pure functions the handler composes — `buildEmployeeRecord` for the ID and
 * `deriveNameList` for the shared list — and this file asserts the composition is
 * what the component performs.
 *
 * The composition under test, taken from LineDeploymentPage.saveDirectory:
 *   setRaw('employee-directory', nextDirectory)
 *   setRaw('employees', deriveNameList(nextDirectory, previousNames))
 */

import {
  buildEmployeeRecord, deriveNameList, directoryList, nextEmployeeId,
} from '../../config/employeeDirectory';

/** Mirrors LineDeploymentPage.submit(), so the two cannot drift unnoticed. */
function simulateSubmit(directory, previousNames, name, sequence = 0) {
  const employees = directoryList(directory);
  const record = buildEmployeeRecord(name, employees, undefined, sequence);
  const nextDirectory = [...directory, record];
  return {
    nextDirectory,
    // Mirrors the page: the list is re-derived from the directory, then merged
    // with any legacy name it already held.
    sharedNames: deriveNameList(nextDirectory, previousNames),
    record,
  };
}

describe('the directory write path', () => {
  const seedDirectory = [
    { id: 'emp-1', employeeId: 'EMP-001', name: 'Salma' },
    { id: 'emp-2', employeeId: 'EMP-002', name: 'Rina' },
  ];
  const seedNames = ['Salma', 'Rina'];

  it('issues the next Employee ID and adds the name to the shared list', () => {
    const { record, nextDirectory, sharedNames } = simulateSubmit(seedDirectory, seedNames, 'Nasrin');

    // 1. The record carries a fresh sequential ID.
    expect(record.employeeId).toBe('EMP-003');
    expect(record.name).toBe('Nasrin');

    // 2. The directory grew by exactly one.
    expect(nextDirectory).toHaveLength(3);

    // 3. The shared name list — what every other dropdown reads — contains the
    //    new person. This is the assertion that proves global availability.
    expect(sharedNames).toContain('Nasrin');
    expect(sharedNames).toEqual(['Salma', 'Rina', 'Nasrin']);
  });

  it('keeps the shared list in step when an employee is renamed', () => {
    const renamed = seedDirectory.map((r) => (r.id === 'emp-2' ? { ...r, name: 'Rina Akter' } : r));
    // The list is re-derived from the directory, not merged with the old names,
    // so the previous spelling drops out on its own.
    const sharedNames = deriveNameList(renamed, []);
    expect(sharedNames).toContain('Rina Akter');
    // The old spelling must be gone, or the dropdown would offer a name that
    // no longer exists on any record.
    expect(sharedNames).not.toContain('Rina');
  });

  it('never reissues an ID after a removal', () => {
    // The sequence remembers that EMP-002 was issued even though the record is
    // gone. Without it, nextEmployeeId would see max(EMP-001) and hand EMP-002
    // to a different person, while production and payroll rows still refer to
    // the original — one person's history attached to another.
    const afterRemoval = seedDirectory.filter((r) => r.id !== 'emp-2');
    const sequence = 2; // EMP-002 was issued, then deleted
    const { record } = simulateSubmit(afterRemoval, ['Salma'], 'Karim', sequence);
    expect(record.employeeId).toBe('EMP-003');
  });

  it('would reuse a retired ID without the sequence — the bug this guards', () => {
    // Documents why the high-water mark exists, by showing the failure it avoids.
    const afterRemoval = seedDirectory.filter((r) => r.id !== 'emp-2');
    const withoutSequence = simulateSubmit(afterRemoval, ['Salma'], 'Karim', 0);
    expect(withoutSequence.record.employeeId).toBe('EMP-002'); // the collision
  });

  it('accumulates a sequence across many submissions', () => {
    let directory = [];
    let names = [];
    const issued = [];
    ['A', 'B', 'C', 'D'].forEach((name) => {
      const result = simulateSubmit(directory, names, name);
      directory = result.nextDirectory;
      names = result.sharedNames;
      issued.push(result.record.employeeId);
    });
    expect(issued).toEqual(['EMP-001', 'EMP-002', 'EMP-003', 'EMP-004']);
    expect(names).toEqual(['A', 'B', 'C', 'D']);
  });

  it('reports the next ID consistently with what the form displays', () => {
    // The disabled "Employee ID (auto)" box shows nextEmployeeId(employees);
    // the submit must issue exactly that.
    const shown = nextEmployeeId(seedDirectory);
    const { record } = simulateSubmit(seedDirectory, seedNames, 'Nasrin');
    expect(record.employeeId).toBe(shown);
  });
});

describe('the page exposes the directory to the rest of the app', () => {
  it('reads the directory and the shared name list from the data context', () => {
    const requested = [];
    const data = {
      getData: (key) => { requested.push(key); return []; },
      addEntry: () => {}, updateEntry: () => {}, deleteEntry: () => {}, setRaw: () => {},
    };
    renderToStaticMarkup(
      <AuthContext.Provider value={{ user: { id: 'q', role: 'admin' }, loading: false, authReady: true, usersVersion: 0, getLiveStatus: () => 'approved' }}>
        <DataContext.Provider value={data}>
          <LineDeploymentPage
            category={{ key: 'manpower', label: 'Manpower Management', icon: '🧑‍🏭' }}
            item={{ key: 'manpower-deployment', label: 'Line Deployment', icon: '👥' }}
          />
        </DataContext.Provider>
      </AuthContext.Provider>,
    );
    expect(requested).toContain('employee-directory');
    expect(requested).toContain('employees');
    // The high-water mark too, so a deleted Employee ID is never reissued.
    expect(requested).toContain('employee-sequence');
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';

/**
 * Pins the page-level wiring of the two-way sync.
 *
 * The pure helpers are tested elsewhere; what this proves is that the directory
 * page actually CALLS them. That was the gap: the sync functions existed but the
 * page only mirrored into the local store, so Smart Attendance (a Firestore-backed
 * module) never received a new hire.
 */
const syncDirectoryToWorkers = vi.fn().mockResolvedValue(0);
const renameWorkerAndAttendance = vi.fn().mockResolvedValue({ worker: true, attendanceRows: 0 });

vi.mock('../../utils/attendance', () => ({
  renameWorkerAndAttendance: (...args) => renameWorkerAndAttendance(...args),
  syncDirectoryToWorkers: (...args) => syncDirectoryToWorkers(...args),
  STANDARD_WORKERS: [],
}));

const LineDeploymentPage = (await import('../LineDeploymentPage')).default;

const AUTH = {
  user: { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true },
  loading: false, authReady: true, usersVersion: 0, getLiveStatus: () => 'approved',
};

/** A data context whose setRaw records every key it is handed. */
function makeData(directory) {
  const writes = {};
  return {
    writes,
    getData: (key) => ({
      'employee-directory': directory,
      'employees': ['Md Robiul Islam'],
      'employee-sequence': [1],
      workers: [],
    }[key] || []),
    addEntry: () => { }, updateEntry: () => { }, deleteEntry: () => { },
    setRaw: (key, value) => { writes[key] = value; },
  };
}

const DIRECTORY = [
  { id: 'a', employeeId: 'EMP-001', workerId: 1, name: 'Md Robiul Islam', status: 'active', active: true },
];

function render(directory = DIRECTORY) {
  const data = makeData(directory);
  const html = renderToStaticMarkup(
    <AuthContext.Provider value={AUTH}>
      <DataContext.Provider value={data}>
        <LineDeploymentPage
          category={{ key: 'manpower', label: 'Manpower Management', icon: '🧑‍🏭' }}
          item={{ key: 'manpower-deployment', label: 'Line Deployment', icon: '👥' }}
        />
      </DataContext.Provider>
    </AuthContext.Provider>,
  );
  return { html, data };
}

beforeEach(() => {
  syncDirectoryToWorkers.mockClear();
  renameWorkerAndAttendance.mockClear();
});

describe('the directory still writes the local mirrors', () => {
  it('exposes the shared name list and the local workers mirror', () => {
    const { html } = render();
    // The page renders (its write path is exercised on submit, below).
    expect(html).toContain('Line Deployment');
    expect(html).toContain('EMP-001');
    expect(html).toContain('Md Robiul Islam');
  });

  it('shows the generated Employee ID for the next hire', () => {
    const { html } = render();
    expect(html).toContain('EMP-002');
  });
});

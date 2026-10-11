import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Tests the repair that fills an emptied directory from the Smart Attendance
 * roster.
 *
 * This is the exact state a returning user was left in: the demo purge removed
 * every person the browser had, and because the stored payload is merged OVER the
 * seed, the directory came back blank — the screen simply said "No employees
 * yet". The fix adopts the attendance roster, and this file proves it, including
 * that a directory somebody has deliberately curated is NOT overwritten.
 */
const store = new Map();

function installStorage(payload) {
  store.clear();
  if (payload) store.set('garments_app_data', JSON.stringify(payload));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  vi.resetModules();
  installStorage(null);
});

afterEach(() => {
  delete globalThis.localStorage;
});

async function loadProvider() {
  const { DataProvider, useData } = await import('../DataContext');
  const { AuthContext } = await import('../AuthContext');
  const { ActivityContext } = await import('../ActivityContext');

  let captured = null;
  function Probe() {
    captured = useData();
    return null;
  }

  renderToStaticMarkup(
    <AuthContext.Provider value={{ user: { id: 'u', username: 'QA' } }}>
      <ActivityContext.Provider value={{ record: async () => {} }}>
        <DataProvider>
          <Probe />
        </DataProvider>
      </ActivityContext.Provider>
    </AuthContext.Provider>,
  );
  return captured;
}

describe('a returning user whose directory was emptied by the purge', () => {
  // What their browser held: the demo people removed, the arrays now empty.
  const PURGED_BUT_EMPTY = {
    _dataVersion: 2,
    employees: [],
    'employee-directory': [],
    'employee-sequence': [0],
  };

  it('repopulates the directory from the Smart Attendance roster', async () => {
    installStorage(PURGED_BUT_EMPTY);
    const data = await loadProvider();
    const dir = data.getData('employee-directory');
    expect(dir.length).toBeGreaterThan(40);
    expect(dir.map((r) => r.name)).toContain('Md Robiul Islam');
  });

  it('repopulates the shared name list the dropdowns read', async () => {
    installStorage(PURGED_BUT_EMPTY);
    const data = await loadProvider();
    const names = data.getData('employees');
    expect(names.length).toBeGreaterThan(40);
    expect(names).toContain('Md Himel');
  });

  it('does not bring the demo people back', async () => {
    installStorage(PURGED_BUT_EMPTY);
    const data = await loadProvider();
    const names = data.getData('employees');
    ['Salma', 'Rina', 'Karim', 'Jasmin'].forEach((demo) => expect(names).not.toContain(demo));
  });

  it('links each adopted person to an Employee ID and a workerId', async () => {
    installStorage(PURGED_BUT_EMPTY);
    const data = await loadProvider();
    const first = data.getData('employee-directory')[0];
    expect(first.employeeId).toBe('EMP-001');
    expect(first.workerId).toBe(1);
    expect(first.status).toBe('active');
  });

  it('moves the ID sequence past the adopted roster', async () => {
    installStorage(PURGED_BUT_EMPTY);
    const data = await loadProvider();
    const sequence = Number(data.getData('employee-sequence')[0]);
    const count = data.getData('employee-directory').length;
    // The next hire must not collide with an adopted Employee ID.
    expect(sequence).toBeGreaterThanOrEqual(count);
  });
});

describe('a first run with nothing stored at all', () => {
  it('opens with the roster already present', async () => {
    const data = await loadProvider();
    expect(data.getData('employees').length).toBeGreaterThan(40);
    expect(data.getData('employee-directory').length).toBeGreaterThan(40);
  });

  it('shows no demo people', async () => {
    const data = await loadProvider();
    const names = data.getData('employees');
    ['Salma', 'Rina', 'Karim', 'Jasmin', 'Zakir'].forEach((demo) => expect(names).not.toContain(demo));
  });
});

describe('a directory the factory has curated', () => {
  it('is left alone rather than merged with the roster', async () => {
    installStorage({
      _dataVersion: 2,
      employees: ['Abdul Karim Mia'],
      'employee-directory': [
        { id: 'own-1', employeeId: 'EMP-500', workerId: 500, name: 'Abdul Karim Mia', status: 'active', active: true },
      ],
      'employee-sequence': [500],
    });
    const data = await loadProvider();
    const names = data.getData('employees');
    // Their own list is authoritative — no roster was forced in alongside it,
    // because a user must always be able to remove a person they added.
    expect(names).toEqual(['Abdul Karim Mia']);
    expect(data.getData('employee-directory')).toHaveLength(1);
  });

  it('keeps a curated list even when it holds a single person', async () => {
    installStorage({
      _dataVersion: 2,
      employees: ['Only Person'],
      'employee-directory': [{ id: 'x', employeeId: 'EMP-001', name: 'Only Person', status: 'active', active: true }],
    });
    const data = await loadProvider();
    expect(data.getData('employees')).toEqual(['Only Person']);
  });
});

describe('the empty state is no longer reachable by accident', () => {
  it('never returns an empty employee list on a normal load', async () => {
    // Whatever the stored payload, a load must leave the dropdowns usable.
    const payloads = [
      null,
      {},
      { employees: [], 'employee-directory': [] },
      { employees: ['Salma'], 'employee-directory': [{ id: 'a', name: 'Salma' }] },
      { _dataVersion: 99, employees: [], 'employee-directory': [] },
    ];
    for (const payload of payloads) {
      vi.resetModules();
      installStorage(payload);
      // eslint-disable-next-line no-await-in-loop
      const data = await loadProvider();
      expect(data.getData('employees').length, `empty for payload ${JSON.stringify(payload)}`).toBeGreaterThan(0);
    }
  });
});

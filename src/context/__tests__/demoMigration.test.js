import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Tests the demo-data migration by running it, not by reading the source.
 *
 * The migration's whole purpose is a returning user whose browser already holds
 * the old dummy names. That is exactly the state the earlier checks could not
 * reproduce — the app sits behind a sign-in, so the data layer never mounted and
 * the stored payload was left untouched. Here the provider is mounted directly
 * with a stub localStorage containing that stale payload, so the purge is
 * genuinely exercised.
 *
 * `seed` and `migrate` are not exported, so the test drives the real module by
 * importing DataProvider and letting it run `loadData` on mount.
 */
const STALE = {
  employees: ['Salma', 'Rina', 'Karim', 'Jasmin', 'Md Himel'],
  'employee-directory': [
    { id: 'emp-1', employeeId: 'EMP-001', name: 'Salma', status: 'active', active: true },
    { id: 'emp-2', employeeId: 'EMP-002', name: 'Rina', status: 'active', active: true },
    { id: 'emp-9', employeeId: 'EMP-009', name: 'Md Himel', status: 'active', active: true },
  ],
  'employee-sequence': [9],
  'daily-production': [
    { id: 1, date: '2026-08-19', employee: 'Salma', style: 'STY-1001', quantity: 8 },
    { id: 2, date: '2026-08-19', employee: 'Md Himel', style: 'STY-1001', quantity: 120 },
  ],
  salary: [
    { id: 1, name: 'Salma', department: 'Sewing', base_salary: 15000 },
    { id: 2, name: 'Md Himel', department: 'Sewing', base_salary: 17000 },
  ],
  'daily-attendance': [{ id: 1, employee: 'Karim', department: 'Sewing', in_time: '07:58' }],
  'leave-requests': [{ id: 1, employee: 'Rina', leave_type: 'Sick' }],
  late: [{ id: 1, name: 'Karim', minutes_late: 12 }],
  'order-model': [{ id: 1, buyer: 'H&M', style: 'STY-1001', qty: 5000 }],
};

// A minimal localStorage, installed before the module is imported so its
// module-level state sees it.
const store = new Map();

beforeEach(() => {
  store.clear();
  store.set('garments_app_data', JSON.stringify(STALE));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  vi.resetModules();
});

afterEach(() => {
  delete globalThis.localStorage;
});

/** Mounts the provider and returns the data it exposes. */
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
      <ActivityContext.Provider value={{ record: async () => { } }}>
        <DataProvider>
          <Probe />
        </DataProvider>
      </ActivityContext.Provider>
    </AuthContext.Provider>,
  );
  return captured;
}

describe('the demo-data migration', () => {
  it('removes the demo names from the shared employee list', async () => {
    const data = await loadProvider();
    const names = data.getData('employees');
    expect(names).not.toContain('Salma');
    expect(names).not.toContain('Rina');
    expect(names).not.toContain('Karim');
    expect(names).not.toContain('Jasmin');
  });

  it('keeps real people on the list', async () => {
    const data = await loadProvider();
    expect(data.getData('employees')).toContain('Md Himel');
  });

  it('removes demo records from the directory', async () => {
    const data = await loadProvider();
    const dir = data.getData('employee-directory');
    const dirNames = dir.map((r) => r.name);
    expect(dirNames).not.toContain('Salma');
    expect(dirNames).not.toContain('Rina');
    expect(dirNames).toContain('Md Himel');
  });

  it('drops production rows that named a demo person', async () => {
    const data = await loadProvider();
    const rows = data.getData('daily-production');
    expect(rows.map((r) => r.employee)).toEqual(['Md Himel']);
  });

  it('drops payroll rows that named a demo person', async () => {
    const data = await loadProvider();
    const rows = data.getData('salary');
    expect(rows.map((r) => r.name)).toEqual(['Md Himel']);
  });

  it('drops attendance and leave rows that named a demo person', async () => {
    const data = await loadProvider();
    expect(data.getData('daily-attendance')).toEqual([]);
    expect(data.getData('leave-requests')).toEqual([]);
    expect(data.getData('late')).toEqual([]);
  });

  it('leaves reference data alone', async () => {
    // Orders and styles are configuration, not people — a broken style list
    // would leave every form with nothing to select.
    const data = await loadProvider();
    expect(data.getData('order-model')).toHaveLength(1);
    expect(data.getData('order-model')[0].style).toBe('STY-1001');
  });

  it('writes the purged payload back to storage', async () => {
    await loadProvider();
    const persisted = JSON.parse(store.get('garments_app_data'));
    expect(persisted._dataVersion).toBeGreaterThanOrEqual(2);
    expect(persisted.employees).not.toContain('Salma');
  });

  it('stamps a version so the migration does not run twice', async () => {
    await loadProvider();
    const persisted = JSON.parse(store.get('garments_app_data'));
    expect(persisted._dataVersion).toBeTruthy();
  });

  it('is idempotent — running twice changes nothing further', async () => {
    const first = await loadProvider();
    const afterFirst = JSON.stringify(first.getData('employee-directory'));

    // Reload against the already-migrated payload.
    vi.resetModules();
    const second = await loadProvider();
    const afterSecond = JSON.stringify(second.getData('employee-directory'));

    expect(afterSecond).toEqual(afterFirst);
  });

  it('keeps a real person who happens to share a first name with a demo one', async () => {
    // 'Salma Khatun' is a genuine hire; only the bare placeholder 'Salma' is not.
    // The migration matches the exact placeholder, so the real person survives.
    store.set('garments_app_data', JSON.stringify({
      employees: ['Salma', 'Salma Khatun'],
      'employee-directory': [
        { id: 'a', employeeId: 'EMP-001', name: 'Salma' },
        { id: 'b', employeeId: 'EMP-002', name: 'Salma Khatun' },
      ],
    }));
    vi.resetModules();
    const data = await loadProvider();
    const names = data.getData('employees');
    expect(names).not.toContain('Salma');
    expect(names).toContain('Salma Khatun');
  });
});

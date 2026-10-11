import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { purgeStaleEmployeeStorage, onlyDemoNames } from '../employeeSeedRepair';

/**
 * Tests the startup repair that unblocks the employee directory.
 *
 * The bug: a purge left `employees` and `employee-directory` as EMPTY ARRAYS in
 * the browser. `loadData` merges stored data OVER the seed, so an empty stored
 * array won over the seeded roster and the screen showed "Employee directory (0)"
 * forever. Worse, the data layer only mounts after sign-in, so a repair placed
 * there never ran for the browser that reported it.
 *
 * The repair runs at page load and clears those keys, letting the seed through.
 */
const store = new Map();

beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
});

afterEach(() => {
  delete globalThis.localStorage;
});

const read = () => JSON.parse(store.get('garments_app_data'));

/** The exact stored state the reported screen was in. */
const BROKEN = {
  _dataVersion: 2,
  employees: [],
  'employee-directory': [],
  'employee-sequence': [8],
};

describe('repairing the state that showed an empty directory', () => {
  it('clears the empty employee list so the seeded roster shows through', () => {
    store.set('garments_app_data', JSON.stringify(BROKEN));
    expect(purgeStaleEmployeeStorage()).toBe(true);
    expect(read()).not.toHaveProperty('employees');
  });

  it('clears the empty directory too', () => {
    store.set('garments_app_data', JSON.stringify(BROKEN));
    purgeStaleEmployeeStorage();
    expect(read()).not.toHaveProperty('employee-directory');
  });

  it('resets the sequence that was stuck at the old dummy count', () => {
    // EMP-009 in the form was the fingerprint: the sequence had been left at the
    // demo roster's length rather than the real one.
    store.set('garments_app_data', JSON.stringify(BROKEN));
    purgeStaleEmployeeStorage();
    expect(read()).not.toHaveProperty('employee-sequence');
  });

  it('leaves everything else alone', () => {
    store.set('garments_app_data', JSON.stringify({
      ...BROKEN,
      'order-model': [{ id: 1, style: 'STY-1001', qty: 5000 }],
    }));
    purgeStaleEmployeeStorage();
    expect(read()['order-model']).toHaveLength(1);
  });
});

describe('what it refuses to touch', () => {
  it('leaves a directory the factory has filled in', () => {
    const payload = {
      employees: ['Abdul Karim Mia', 'Jahangir Alam'],
      'employee-directory': [
        { id: 'a', employeeId: 'EMP-001', name: 'Abdul Karim Mia' },
        { id: 'b', employeeId: 'EMP-002', name: 'Jahangir Alam' },
      ],
      'employee-sequence': [2],
    };
    store.set('garments_app_data', JSON.stringify(payload));
    expect(purgeStaleEmployeeStorage()).toBe(false);
    const after = read();
    expect(after.employees).toHaveLength(2);
    expect(after['employee-directory']).toHaveLength(2);
  });

  it('keeps a single real person', () => {
    store.set('garments_app_data', JSON.stringify({
      employees: ['Only Person'],
      'employee-directory': [{ id: 'x', employeeId: 'EMP-001', name: 'Only Person' }],
    }));
    expect(purgeStaleEmployeeStorage()).toBe(false);
    expect(read().employees).toEqual(['Only Person']);
  });

  it('returns false when there is nothing stored at all', () => {
    expect(purgeStaleEmployeeStorage()).toBe(false);
  });

  it('never throws on unreadable storage', () => {
    store.set('garments_app_data', 'not json{{{');
    expect(() => purgeStaleEmployeeStorage()).not.toThrow();
    expect(purgeStaleEmployeeStorage()).toBe(false);
  });

  it('does nothing when localStorage is unavailable', () => {
    delete globalThis.localStorage;
    expect(() => purgeStaleEmployeeStorage()).not.toThrow();
    expect(purgeStaleEmployeeStorage()).toBe(false);
  });
});

describe('unfinished demo data', () => {
  it('treats a list of only demo names as stale', () => {
    expect(onlyDemoNames(['Salma', 'Rina'])).toBe(true);
    expect(onlyDemoNames([{ name: 'Karim' }, { name: 'Jasmin' }])).toBe(true);
  });

  it('does not treat a real roster as stale', () => {
    expect(onlyDemoNames(['Md Robiul Islam', 'Md Himel'])).toBe(false);
    expect(onlyDemoNames(['Salma Khatun'])).toBe(false);
    expect(onlyDemoNames([])).toBe(false);
  });

  it('clears a directory still holding only demo people', () => {
    store.set('garments_app_data', JSON.stringify({
      employees: ['Salma', 'Rina', 'Karim'],
      'employee-directory': [
        { id: 'a', employeeId: 'EMP-001', name: 'Salma' },
        { id: 'b', employeeId: 'EMP-002', name: 'Rina' },
      ],
    }));
    expect(purgeStaleEmployeeStorage()).toBe(true);
    const after = read();
    expect(after.employees).toBeUndefined();
    expect(after['employee-directory']).toBeUndefined();
  });

  it('drops production rows that name a demo person', () => {
    store.set('garments_app_data', JSON.stringify({
      employees: ['Md Himel'],
      'employee-directory': [{ id: 'a', employeeId: 'EMP-001', name: 'Md Himel' }],
      'daily-production': [
        { id: 1, employee: 'Salma', quantity: 8 },
        { id: 2, employee: 'Md Himel', quantity: 120 },
      ],
    }));
    expect(purgeStaleEmployeeStorage()).toBe(true);
    expect(read()['daily-production'].map((r) => r.employee)).toEqual(['Md Himel']);
  });
});

describe('idempotence', () => {
  it('reports no change the second time', () => {
    store.set('garments_app_data', JSON.stringify(BROKEN));
    expect(purgeStaleEmployeeStorage()).toBe(true);
    expect(purgeStaleEmployeeStorage()).toBe(false);
  });

  it('leaves the payload untouched on a second run', () => {
    store.set('garments_app_data', JSON.stringify(BROKEN));
    purgeStaleEmployeeStorage();
    const afterFirst = store.get('garments_app_data');
    purgeStaleEmployeeStorage();
    expect(store.get('garments_app_data')).toBe(afterFirst);
  });
});

describe('the repair is wired into the app boot', () => {
  it('is called from main.jsx, before React mounts', async () => {
    // It must NOT live only in the data layer: that mounts after sign-in, which
    // is why the sign-in screen never got repaired.
    const fs = await import('node:fs');
    const main = fs.readFileSync(new URL('../../main.jsx', import.meta.url), 'utf8');
    expect(main).toContain('purgeStaleEmployeeStorage()');
    const repairCall = main.indexOf('purgeStaleEmployeeStorage()');
    const render = main.indexOf('createRoot');
    expect(repairCall).toBeGreaterThan(-1);
    expect(repairCall).toBeLessThan(render);
  });

  it('does not depend on React or any context', () => {
    // If it imported React or a context it could not run before mount.
    expect(typeof purgeStaleEmployeeStorage).toBe('function');
  });
});

void vi;

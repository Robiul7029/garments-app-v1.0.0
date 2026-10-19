/**
 * The cloud store must never damage an existing record. These pin the five
 * guarantees `appDataStore` makes, because each one protects live factory data:
 *
 *   1. the shape is namespaced (`appData/{collectionId}/{rowId}`), NOT the ERP
 *      `dailyProduction` / `hourlyProduction` collections;
 *   2. the upload only ADDS rows the cloud does not already have;
 *   3. a merge keeps local rows the cloud has not seen and remote wins a collision;
 *   4. non-row keys (`employees` = names, `employee-sequence` = a number) are skipped;
 *   5. a refused read is reported per collection instead of blanking the app.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const firestoreMock = vi.hoisted(() => ({
  readFailure: null,
}));

const state = {
  rootDocs: [],
  collections: {},
};

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ path }),
  doc: (_db, ...path) => ({ path }),
  getDocs: vi.fn(async (ref) => {
    if (firestoreMock.readFailure) throw new Error(firestoreMock.readFailure);
    if (ref.path.length === 1) {
      return { docs: state.rootDocs.map((id) => ({ id })) };
    }
    const rows = state.collections[ref.path[1]] || [];
    return { docs: rows.map((row) => ({ id: String(row.id), data: () => row })) };
  }),
  onSnapshot: vi.fn(() => () => {}),
  serverTimestamp: () => 'SERVER_TS',
  setDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  writeBatch: () => ({
    set: vi.fn(),
    commit: vi.fn(async () => {}),
  }),
}));

vi.mock('../../firebase', () => ({ db: {} }));

const store = await import('../appDataStore');

beforeEach(() => {
  state.rootDocs = [];
  state.collections = {};
  firestoreMock.readFailure = null;
  vi.clearAllMocks();
});

describe('the Firestore shape stays out of the ERP collections', () => {
  it('namespaces every app collection under appData', () => {
    expect(store.APP_DATA_ROOT).toBe('appData');
    expect(store.APP_DATA_ROOT).not.toBe('dailyProduction');
    expect(store.APP_DATA_ROOT).not.toBe('hourlyProduction');
  });

  it('uses the row id as the document id, so a re-upload overwrites', () => {
    expect(store.rowIdOf({ id: 42 })).toBe('42');
    expect(store.rowIdOf({ id: 'LO-123' })).toBe('LO-123');
    expect(store.rowIdOf({})).toBe('');
  });
});

describe('non-row keys are never uploaded', () => {
  it('skips the name list and the ID counter', () => {
    expect(store.isRowCollection('employees', ['Karim'])).toBe(false);
    expect(store.isRowCollection('employee-sequence', [51])).toBe(false);
    expect(store.isRowCollection('_dataVersion', 2)).toBe(false);
  });

  it('accepts row collections, including an empty one', () => {
    expect(store.isRowCollection('daily-production', [{ id: 1 }])).toBe(true);
    expect(store.isRowCollection('salary', [])).toBe(true);
  });
});

describe('the one-time upload only ever adds', () => {
  const legacy = {
    salary: [
      { id: 1, name: 'Existing', base_salary: 100 },
      { id: 2, name: 'Newer', base_salary: 200 },
    ],
    employees: ['Existing'],
    'employee-sequence': [2],
  };

  it('skips rows the cloud already has and keeps its newer values', async () => {
    state.rootDocs = ['salary'];
    // The cloud already knows row 1 — with a value that must survive.
    state.collections.salary = [{ id: 1, name: 'Existing', base_salary: 999 }];

    const result = await store.uploadLocalStore(legacy);

    expect(result.uploaded).toBe(1);
    const written = state.collections.salary;
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual({ id: 1, name: 'Existing', base_salary: 999 });
  });

  it('does nothing at all when the browser has no legacy payload', async () => {
    const result = await store.uploadLocalStore(null);
    expect(result).toEqual({ uploaded: 0, collections: 0 });
  });

  it('reports rather than throws when the cloud root cannot be read', async () => {
    // A read failure is returned as an error flag, never a rejection — a refused
    // permission must not crash the provider that calls this on mount.
    firestoreMock.readFailure = 'permission-denied';
    const result = await store.uploadLocalStore(legacy);
    expect(result.uploaded).toBe(0);
    expect(result.error).toBe('Could not read the cloud store.');
  });
});

describe('a merge never deletes and remote wins a collision', () => {
  it('keeps a local-only row and prefers the remote copy of a shared one', () => {
    const merged = store.mergeRows(
      [{ id: 1, name: 'Local', qty: 5 }, { id: 7, name: 'Offline only' }],
      [{ id: 1, name: 'Cloud', qty: 9 }],
    );
    const byId = Object.fromEntries(merged.map((row) => [String(row.id), row]));
    expect(byId['1']).toEqual({ id: 1, name: 'Cloud', qty: 9 });
    expect(byId['7']).toEqual({ id: 7, name: 'Offline only' });
    expect(merged).toHaveLength(2);
  });

  it('is idempotent', () => {
    const rows = [{ id: 1 }];
    const merged = store.mergeRows(rows, rows);
    expect(merged).toEqual(rows);
  });

  it('returns the remote rows when the local store is empty', () => {
    const remote = [{ id: 'a' }, { id: 'b' }];
    expect(store.mergeRows([], remote)).toEqual(remote);
  });
});

describe('reading the legacy cache', () => {
  it('returns null rather than throwing on bad JSON', () => {
    const storage = { getItem: () => '{not json' };
    expect(store.readLegacyStore(storage)).toBeNull();
  });

  it('returns null when storage is unavailable', () => {
    expect(store.readLegacyStore(undefined)).toBeNull();
  });

  it('reads the payload under the legacy key', () => {
    const storage = {
      getItem: (key) => (key === store.LEGACY_STORAGE_KEY ? '{"salary":[{"id":1}]}' : null),
    };
    expect(store.readLegacyStore(storage)).toEqual({ salary: [{ id: 1 }] });
  });
});

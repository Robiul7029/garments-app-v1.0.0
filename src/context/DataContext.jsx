import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useActivity } from './ActivityContext';
import { aggregateDaily } from '../config/productionAggregation';
import {
  NON_ROW_KEYS,
  ensureCategories,
  mergeRows,
  migrateFlatCollections,
  readLegacyStore,
  removeRow,
  subscribeAll,
  uploadLocalStore,
  writeRow,
} from '../services/appDataStore';
import { probeFirestoreConnection } from '../firebase';

// Keys that are local bookkeeping, not rows: a name list and an ID counter. They are
// derived from the roster/Smart Attendance, so they stay on the device.
const NON_CLOUD_KEYS = new Set([...NON_ROW_KEYS]);

// Every write goes to Firestore; localStorage remains an offline CACHE so the
// screens open instantly and keep working without a connection. See
// services/appDataStore.js for the cloud shape and the guarantees it gives
// existing records (merge, never replace; upload only what is missing).
const CLOUD_SYNC_FAILED = 'Cloud storage is unavailable — this entry is saved on THIS device only, and will be retried on reload.';

/**
 * Only a CONNECTION failure is "offline".
 *
 * A refused write (`permission-denied`) used to raise the same banner, which told the user
 * their entry was local-only when the real problem was access — and left the misleading
 * "Offline" indicator on screen while the app was perfectly online. The banner is now
 * gated on the actual transport state; an access error is a different, accurate message.
 */
const ACCESS_DENIED = 'Your account is not allowed to save this entry to the cloud. Ask an administrator for access.';

function syncErrorFor(error) {
  const code = String(error?.code || '');
  if (code === 'permission-denied' || code === 'unauthenticated') return ACCESS_DENIED;
  return CLOUD_SYNC_FAILED;
}

function isConnectionError(error) {
  const code = String(error?.code || '');
  return code === 'unavailable' || code === 'deadline-exceeded' || code === 'network-request-failed';
}

export const DataContext = createContext(null);

// Employee master list — feeds every "Employee Name" dropdown across the app.
//
// This stays a plain ARRAY OF NAMES on purpose: roughly a dozen screens read it
// as `getData('employees').map((e) => <option value={e}>{e}</option>)`, so
// turning it into objects would break every one of those dropdowns at once.
//
// The people come from SMART ATTENDANCE's roster — the same names the attendance
// screen clocks in — rather than a second, separate list of made-up employees.
// Entering a person twice, in two places, is how the two screens end up
// disagreeing about who works here.
//
// The ID'd records live alongside it in `employee-directory`, which Manpower
// Management → Line Deployment maintains. Each seeded person gets an Employee ID
// whose numeric tail matches their Smart Attendance `workerId`, so an attendance
// row and a directory row refer to the same human being by the same key.
import { STANDARD_WORKERS } from '../utils/attendance';

const EMPLOYEES = STANDARD_WORKERS.map((worker) => worker.name);

// The Smart Attendance roster as directory records. EMP-001 ↔ workerId 1, and so
// on — the numbering is aligned deliberately, so a person created here is
// immediately clockable and their history stays attached to one record.
const EMPLOYEE_DIRECTORY = STANDARD_WORKERS.map((worker) => ({
  id: `emp-seed-${worker.workerId}`,
  employeeId: `EMP-${String(worker.workerId).padStart(3, '0')}`,
  workerId: worker.workerId,
  name: worker.name,
  status: 'active',
  archived: false,
  createdAt: '2026-08-01',
  active: true,
}));

// Sample starter data so the app isn't empty on first run.
// Replace with real API calls when you connect a backend.
const seed = {
  employees: EMPLOYEES,
  'employee-directory': EMPLOYEE_DIRECTORY,
  // The high-water mark of issued Employee IDs. Held as a one-element array to
  // match the `getData(key)` contract, which always returns a list. Seeded to
  // the last ID above so the first new hire continues the sequence rather than
  // restarting at EMP-001 and colliding with the existing roster.
  'employee-sequence': [EMPLOYEE_DIRECTORY.length],
  // The designations a user ADDED by hand on Line Deployment with the "+ Add"
  // button. Empty by default — the preset grades come from the code list — and
  // appended to as grades are added, so an added grade is selectable for the
  // next person without having to be typed again.
  'designation-options': [],

  // Production, attendance and payroll rows deliberately start EMPTY.
  //
  // They used to be seeded with made-up people (Salma, Rina, Karim…), which
  // looked like a working factory but was worse than an empty screen: a name in
  // a production row is supposed to have come from the employee directory, and a
  // seeded row implied somebody had entered work that never happened. The
  // directory below is the only place a person is created; these collections
  // fill up from real entries.
  'daily-production': [],
  'worker-production': [],
  'quality-control': [
    { id: 1, date: '2026-08-19', line: 'Line-1', process: 'Collar Attach', checked: 300, defect_qty: 14 },
    { id: 2, date: '2026-08-19', line: 'Line-1', process: 'Collar Attach', checked: 280, defect_qty: 18 },
  ],
  'order-model': [
    { id: 1, buyer: 'H&M', style: 'STY-1001', qty: 5000, start_date: '2026-08-10', ship_date: '2026-09-20' },
    { id: 2, buyer: 'Zara', style: 'STY-1002', qty: 1500, start_date: '2026-08-05', ship_date: '2026-08-30' },
  ],
  'cutting-plan': [
    { id: 1, style: 'STY-1001', start_date: '2026-08-10', colors: 3, daily_qty: 800, note: 'Cut Parma before Tilo — Parma ships first' },
  ],
  'cutting-production': [],
  'fabric-material': [
    { id: 1, fabric: 'Cotton Twill', lot_no: 'LOT-22', received_qty: 2000, issued_qty: 1200 },
  ],
  'daily-attendance': [],
  late: [],
  'attendance-leave': [],
  'finishing-production': [],
  'quality-check': [
    { id: 1, date: '2026-08-19', hour_slot: '10:00-11:00', target: 120, checked: 100, altered: 6, final: 94, faulty: 6 },
  ],
  'washing-plan': [
    { id: 1, style: 'STY-1001', washable: 'Yes', ready_qty: 400, pending_qty: 120 },
  ],
  'send-to-washing': [
    { id: 1, date: '2026-08-19', style: 'STY-1001', color: 'Black', qty_sent: 400 },
  ],
  'received-from-washing': [
    { id: 1, date: '2026-08-18', style: 'STY-1000', color: 'Navy', qty_received: 350 },
  ],
  'washing-status': [
    { id: 1, style: 'STY-1001', color: 'Black', status: 'In Process' },
    { id: 2, style: 'STY-1000', color: 'Navy', status: 'Approved' },
  ],
  'delivery-plan': [
    { id: 1, style: 'STY-1001', qty: 5000, ship_date: '2026-09-20', urgency: 'Normal' },
  ],
  'ready-for-delivery': [
    { id: 1, style: 'STY-1000', qty: 3000, date_ready: '2026-08-18' },
  ],
  delivered: [
    { id: 1, style: 'STY-0999', qty: 4500, delivery_date: '2026-08-15', carrier: 'DHL' },
  ],
  'pending-delivery': [
    { id: 1, style: 'STY-1001', qty: 5000, status: 'In Process' },
  ],
  'leave-requests': [],
  salary: [],
  'hourly-timesheet-rows': [],
  // Manual Line Output overrides, keyed by style + date. Empty by default: the
  // line output is aggregated from operator entries until somebody deliberately
  // overrides it (see the Line Output panel's confirmation dialog).
  'line-output-overrides': [],
};

let nextId = 1000;
const DATA_KEY = 'garments_app_data';
// Bumped when the stored shape changes in a way that must be applied to data
// already sitting in a browser. See `migrate` below.
const DATA_VERSION = 2;
const VERSION_KEY = 'garments_app_data_version';

/**
 * Names that were only ever demo data.
 *
 * They shipped in the seed, and `loadData` merges what is already stored over
 * the seed — so clearing the seed alone would NOT remove them from a browser that
 * had already run the app. Somebody who opened this yesterday would still see
 * Salma in the production and salary lists, and conclude nothing had changed.
 * The migration below is what actually purges them.
 */
const DEMO_NAMES = [
  'Salma', 'Rina', 'Karim', 'Jasmin', 'Rahim', 'Nasrin', 'Zakir',
];

/** True when a value is one of the old placeholder names. */
function isDemoName(value) {
  const clean = String(value || '').trim().toLowerCase();
  return DEMO_NAMES.some((demo) => demo.toLowerCase() === clean);
}

/**
 * Collections whose rows belong to a person, and the field that names them.
 * A row naming a demo person is placeholder data and is dropped with them.
 */
const PERSON_FIELDS = {
  'daily-production': ['employee', 'supervisor'],
  'worker-production': ['employee'],
  'cutting-production': ['employee'],
  'finishing-production': ['employee'],
  'daily-attendance': ['employee'],
  late: ['name'],
  'attendance-leave': ['employee'],
  'leave-requests': ['employee'],
  salary: ['name'],
  'hourly-timesheet-rows': ['employee'],
};

/**
 * Removes demo data from a stored payload, once.
 *
 * Two jobs:
 *   1. drop every row that names a demo person, from the collections that hold
 *      personal records (production, attendance, salary, leave)
 *   2. drop any directory record whose name is a demo name, and rebuild the
 *      shared name list without them
 *
 * Real entries are left completely alone — only rows that name one of the
 * placeholder people are touched, so a factory that has been using the app keeps
 * every genuine record.
 */
function migrate(stored) {
  if (!stored || typeof stored !== 'object') return stored;
  if (Number(stored._dataVersion || 0) >= DATA_VERSION) return stored;

  const next = { ...stored };

  Object.entries(PERSON_FIELDS).forEach(([key, fields]) => {
    if (!Array.isArray(next[key])) return;
    next[key] = next[key].filter(
      (row) => !row || !fields.some((field) => isDemoName(row[field])),
    );
  });

  // The directory and the name list it feeds.
  if (Array.isArray(next['employee-directory'])) {
    next['employee-directory'] = next['employee-directory'].filter(
      (record) => record && !isDemoName(record.name),
    );
  }
  if (Array.isArray(next.employees)) {
    next.employees = next.employees.filter((name) => !isDemoName(name));
  }

  next._dataVersion = DATA_VERSION;
  return next;
}

/**
 * Fills an empty directory (and the name list it feeds) from Smart Attendance.
 *
 * Deliberately only fills an EMPTY one. If the factory has added its own people,
 * inventing rows alongside them would be worse than leaving it alone — the merge
 * in `loadData` would also mean a user could never remove a seeded person.
 *
 * Kept alongside `applyRosterFloor` because they guard different moments: this
 * repairs the STORED payload (so it is written back), while the floor guards the
 * RESULT after the seed merge. Both are needed — repairing only the stored copy
 * still let the merge blank the result.
 *
 * Returns true when it seeded anything.
 */
function adoptAttendanceRoster(target) {
  const directory = Array.isArray(target['employee-directory']) ? target['employee-directory'] : [];
  const names = Array.isArray(target.employees) ? target.employees : [];
  if (directory.length > 0 || names.length > 0) return false;

  target['employee-directory'] = EMPLOYEE_DIRECTORY.map((record) => ({ ...record }));
  target.employees = [...EMPLOYEES];
  // Keep the ID sequence ahead of the roster that was just adopted, so the next
  // hire continues the numbering instead of colliding with EMP-001.
  const currentSequence = Number(Array.isArray(target['employee-sequence']) ? target['employee-sequence'][0] : 0) || 0;
  target['employee-sequence'] = [Math.max(currentSequence, EMPLOYEE_DIRECTORY.length)];
  return true;
}

function loadData() {
  try {
    const stored = JSON.parse(localStorage.getItem(DATA_KEY));
    if (stored && typeof stored === 'object') {
      const migrated = migrate(stored);
      adoptAttendanceRoster(migrated);
      // Persist the repaired payload so the work is not repeated on the next load.
      try {
        localStorage.setItem(DATA_KEY, JSON.stringify(migrated));
        localStorage.setItem(VERSION_KEY, String(DATA_VERSION));
      } catch { /* storage blocked - the in-memory copy is still correct */ }
      return applyRosterFloor({ ...seed, ...migrated });
    }
  } catch { /* use the starter data */ }
  return applyRosterFloor(seed);
}

/**
 * Guarantees the roster is present in the FINAL result.
 *
 * The last line of defence, and the reason the directory can no longer come back
 * empty. `loadData` merges the stored payload OVER the seed, so any stored copy
 * of these keys wins — including an empty one left behind by the demo purge. That
 * made the symptom depend on the exact moment storage was read, which is how the
 * screen showed "Employee directory (0)" while the data layer held 51 people.
 *
 * Rather than reason about which writer got there first, this simply refuses to
 * return an empty roster: if the merged result has nobody in it, the attendance
 * roster is used. It is idempotent, so calling it twice changes nothing.
 */
function applyRosterFloor(data) {
  const directory = Array.isArray(data['employee-directory']) ? data['employee-directory'] : [];
  const names = Array.isArray(data.employees) ? data.employees : [];
  if (directory.length > 0 || names.length > 0) return data;
  return {
    ...data,
    'employee-directory': EMPLOYEE_DIRECTORY.map((record) => ({ ...record })),
    employees: [...EMPLOYEES],
    'employee-sequence': [
      Math.max(
        Number(Array.isArray(data['employee-sequence']) ? data['employee-sequence'][0] : 0) || 0,
        EMPLOYEE_DIRECTORY.length,
      ),
    ],
  };
}

// A one-line summary of what was typed, so the bell notification says something useful
// instead of just "new entry added".
function summarize(action, key, entry) {
  const values = Object.entries(entry || {})
    .filter(([field, value]) => field !== 'id' && value !== '' && value !== null && value !== undefined)
    .slice(0, 4)
    .map(([field, value]) => `${field.replace(/_/g, ' ')}: ${value}`);
  const verb = { create: 'added', update: 'updated', delete: 'deleted' }[action] || 'saved';
  return values.length ? `${verb} — ${values.join(', ')}` : `${verb} an entry`;
}

export function DataProvider({ children }) {
  const [data, setData] = useState(loadData);
  // Set when the cloud could not be read/written. Screens surface it so an entry that
  // only reached this device's cache is never mistaken for a permanent save.
  const [cloudError, setCloudError] = useState('');
  // The signed-in account gates the cloud: reading before sign-in would only be refused.
  const { user } = useAuth();
  const { record } = useActivity();
  const actor = user?.username || user?.email || 'Unknown user';
  // The upload runs once per session, and only for the account that loaded the app.
  const uploadedRef = useRef(false);
  // Ids deleted in THIS session. A cloud snapshot can still carry a row whose delete
  // has not propagated, and merging it back would make the row reappear on screen.
  const deletedRef = useRef(new Map());
  // The latest banner text, read by the retry timer below. `cloudError` itself is captured
  // by the effect's closure and would stay '' forever.
  const cloudErrorRef = useRef('');

  const reportCloudError = (message) => {
    cloudErrorRef.current = message || '';
    setCloudError(message || '');
  };

  // A readable one-liner travels with the notification (bell item + email) so neither has
  // to rebuild it from the raw entry.
  const activitySummary = (action, key, entry) => summarize(action, key, entry || {});

  useEffect(() => {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  }, [data]);

  // ---- Cloud: upload what this browser has, then follow the shared store -------
  useEffect(() => {
    if (!user) return undefined;

    let active = true;

    // One-time setup of the cloud layout, in this order:
    //   1. create the category folders (so `appData` reads as modules, not one flat pile)
    //   2. copy every legacy flat row into its category
    //   3. upload rows only this browser has
    // All three are idempotent, so a reload (or a second device) simply finds nothing to do.
    if (!uploadedRef.current) {
      uploadedRef.current = true;
      Promise.resolve()
        .then(() => ensureCategories())
        .then(() => migrateFlatCollections())
        // The rows may have just MOVED into a category. The live subscription below picks
        // them up on its own once the category folder appears, so nothing extra is needed
        // here; the result is only worth a log line while the migration is new.
        .then((migration) => {
          if (migration?.moved) {
            console.info(`[Data] Filed ${migration.moved} row(s) into ${migration.collections} category collection(s).`);
          }
          return null;
        })
        .catch(() => {});
      uploadLocalStore(readLegacyStore())
        .then((result) => {
          if (!active) return;
          if (result?.error) reportCloudError(CLOUD_SYNC_FAILED);
          else if (result?.uploaded) reportCloudError('');
        })
        .catch((error) => { if (active) reportCloudError(syncErrorFor(error)); });
    }

    // Live follow: every collection the cloud holds is merged over the cache. A merge
    // (not a replace) keeps a row a screen wrote while offline until it uploads.
    const off = subscribeAll(
      (collections) => {
        if (!active) return;
        // A snapshot that reached the client proves the server is answering: whatever
        // "offline" state an earlier, transient failure set is now stale.
        reportCloudError('');
        setData((prev) => {
          const next = { ...prev };
          Object.entries(collections).forEach(([key, remoteRows]) => {
            const gone = deletedRef.current.get(key);
            const visible = gone ? remoteRows.filter((row) => !gone.has(String(row?.id))) : remoteRows;
            next[key] = mergeRows(prev[key], visible);
          });
          return next;
        });
      },
      (error) => {
        if (!active) return;
        // Access errors are not "offline": keep the connection indicator honest and
        // let the write path report the refusal with its own message.
        if (isConnectionError(error)) reportCloudError(CLOUD_SYNC_FAILED);
      },
    );

    // Re-test the transport periodically while a banner is up, so the app returns to
    // "online" by itself once the connection is restored — no reload needed.
    const retryTimer = window.setInterval(() => {
      if (!active || !cloudErrorRef.current) return;
      probeFirestoreConnection(8000)
        .then((online) => { if (active && online) reportCloudError(''); })
        .catch(() => {});
    }, 20000);

    return () => { active = false; window.clearInterval(retryTimer); off(); };
  }, [user]);

  /**
   * Writes a row to the cloud, if this is a cloud collection.
   *
   * Best-effort by design: the local state has already been updated, so a failed
   * write must not throw into the screen's save handler and lose the entry.
   */
  function persistRow(key, row) {
    if (NON_CLOUD_KEYS.has(key) || !row) return;
    writeRow(key, row)
      .then(() => reportCloudError(''))
      .catch((error) => reportCloudError(syncErrorFor(error)));
  }

  function getData(key) {
    return data[key] || [];
  }

  /**
   * Auto-sync: an hourly save is reflected in `daily-production` immediately.
   *
   * Hourly Production is the single-source-of-truth input form (the brief's
   * "primary input source"). The Daily all-employee sheet, the Monthly matrix and
   * the Overall Summary are all VIEWS of the same hourly rows, but a handful of
   * existing screens (Production Report, Line Status, Target vs Actual) still read
   * the legacy `daily-production` collection — so that collection has to be kept in
   * step rather than left to rot.
   *
   * Rather than a second, parallel copy that can drift, this DERIVES the daily rows
   * from the hourly rows with `aggregateDaily` and REPLACES the synced subset in
   * one pass. Rows are marked `source: 'hourly'` so a hand-entered daily-production
   * row is never touched: only the rows this sync owns are rewritten.
   *
   * It runs inside the same `setData` update as the hourly write, so a screen can
   * never observe the two collections disagreeing — they change together or not at
   * all. It is idempotent, so calling it after an edit or a delete simply produces
   * the new truth.
   */
  function syncDailyFromHourly(prev, hourlyRows) {
    const derived = aggregateDaily(hourlyRows).map((group) => ({
      id: `hp-${group.key}`,
      source: 'hourly',
      date: group.date,
      employee: group.employee,
      process: group.process,
      processes: [group.process],
      style: group.style,
      order_no: group.order_no,
      line_no: group.line,
      line: group.line,
      quantity: group.good,
      output: group.output,
      defect_qty: group.defects,
      hourlyTarget: group.target,
      daily_target: group.dailyTarget,
      target: group.dailyTarget,
      working_hours: group.workingHours,
      // Which kind of entry produced this daily line. Hourly, Daily and Total
      // Line Output rows all land here (they share one stored shape); the QC
      // Product Check deliberately does NOT, because it records inspection, not
      // production, and counting it as output would inflate every figure.
      entry_type: group.entry_type || 'hourly',
      entryIds: group.entryIds,
    }));
    // Keep any daily-production row that was NOT written by this sync (a manual
    // entry, or a row from another module such as Worker Production).
    const manual = (prev['daily-production'] || []).filter((row) => row?.source !== 'hourly');
    return [...manual, ...derived];
  }

  function addEntry(key, entry) {
    const row = { id: ++nextId, ...entry };
    setData((prev) => {
      const next = {
        ...prev,
        [key]: [...(prev[key] || []), row],
      };
      // The auto-sync: an hourly row appearing updates the daily sheet at once.
      if (key === 'hourly-timesheet-rows') {
        next['daily-production'] = syncDailyFromHourly(prev, next[key]);
      }
      return next;
    });
    record('create', { key, entry: row, actor, summary: activitySummary('create', key, row), actionRequired: 'Review the new entry' });
    persistRow(key, row);
    return row;
  }

  function updateEntry(key, id, updated) {
    setData((prev) => {
      const rows = (prev[key] || []).map((row) => (row.id === id ? { ...row, ...updated } : row));
      const next = { ...prev, [key]: rows };
      // Editing an hourly row re-derives the daily sheet, so a corrected hour is
      // reflected in the Daily and Monthly views without a second save.
      if (key === 'hourly-timesheet-rows') {
        next['daily-production'] = syncDailyFromHourly(prev, rows);
      }
      return next;
    });
    record('update', { key, entry: { ...updated, id }, actor, summary: activitySummary('update', key, updated), actionRequired: 'Confirm the change is correct' });
    const existingRow = (data[key] || []).find((row) => row.id === id);
    if (existingRow) persistRow(key, { ...existingRow, ...updated, id });
  }

  function deleteEntry(key, id) {
    const previous = (data[key] || []).find((row) => row.id === id) || { id };
    setData((prev) => {
      const rows = (prev[key] || []).filter((row) => row.id !== id);
      const next = { ...prev, [key]: rows };
      // Deleting an hourly row removes its contribution from the daily sheet.
      if (key === 'hourly-timesheet-rows') {
        next['daily-production'] = syncDailyFromHourly(prev, rows);
      }
      return next;
    });
    record('delete', { key, entry: previous, actor, summary: activitySummary('delete', key, previous), actionRequired: 'Confirm the removal is intended' });
    if (NON_CLOUD_KEYS.has(key)) return;
    if (!deletedRef.current.has(key)) deletedRef.current.set(key, new Set());
    deletedRef.current.get(key).add(String(id));
    removeRow(key, id)
      .then(() => reportCloudError(''))
      .catch((error) => reportCloudError(syncErrorFor(error)));
  }

  function setRaw(key, value) {
    const previous = data[key] || [];
    setData((prev) => {
      const next = { ...prev, [key]: value };
      // A bulk replace of the hourly collection (a CSV import, say) syncs too.
      if (key === 'hourly-timesheet-rows') {
        next['daily-production'] = syncDailyFromHourly(prev, value || []);
      }
      return next;
    });
    // A bulk write (a CSV import, a process list) also goes to the cloud. Only rows
    // that are new or changed are sent, so a re-save of the same list is free.
    if (NON_CLOUD_KEYS.has(key)) return;
    const before = new Map((previous || []).map((row) => [String(row?.id), JSON.stringify(row)]));
    const changed = (Array.isArray(value) ? value : []).filter((row) => {
      if (!row || row.id === undefined || row.id === null) return false;
      return before.get(String(row.id)) !== JSON.stringify(row);
    });
    changed.forEach((row) => persistRow(key, row));
  }

  return (
    <DataContext.Provider value={{ getData, addEntry, updateEntry, deleteEntry, setRaw, summarize, cloudError }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}

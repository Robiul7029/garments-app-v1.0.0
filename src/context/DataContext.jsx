import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { useActivity } from './ActivityContext';

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
  // Every write is logged so the bell page and History have something real to show.
  const { user } = useAuth();
  const { record } = useActivity();
  const actor = user?.username || user?.email || 'Unknown user';

  // A readable one-liner travels with the notification (bell item + email) so neither has
  // to rebuild it from the raw entry.
  const activitySummary = (action, key, entry) => summarize(action, key, entry || {});

  useEffect(() => {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  }, [data]);

  function getData(key) {
    return data[key] || [];
  }

  function addEntry(key, entry) {
    const row = { id: ++nextId, ...entry };
    setData((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), row],
    }));
    record('create', { key, entry: row, actor, summary: activitySummary('create', key, row), actionRequired: 'Review the new entry' });
    return row;
  }

  function updateEntry(key, id, updated) {
    setData((prev) => ({
      ...prev,
      [key]: (prev[key] || []).map((row) => (row.id === id ? { ...row, ...updated } : row)),
    }));
    record('update', { key, entry: { ...updated, id }, actor, summary: activitySummary('update', key, updated), actionRequired: 'Confirm the change is correct' });
  }

  function deleteEntry(key, id) {
    const previous = (data[key] || []).find((row) => row.id === id) || { id };
    setData((prev) => ({
      ...prev,
      [key]: (prev[key] || []).filter((row) => row.id !== id),
    }));
    record('delete', { key, entry: previous, actor, summary: activitySummary('delete', key, previous), actionRequired: 'Confirm the removal is intended' });
  }

  function setRaw(key, value) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <DataContext.Provider value={{ getData, addEntry, updateEntry, deleteEntry, setRaw, summarize }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}

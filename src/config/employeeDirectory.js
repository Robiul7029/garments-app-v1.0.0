/**
 * ROBIUL GARMENTS ERP — the employee directory.
 *
 * Manpower Management → Line Deployment is the one place an employee is created.
 * Everything else (Daily Production, Operator Performance, Quality Control,
 * Supervisors, Attendance) reads the list it produces rather than keeping its own.
 *
 * STORAGE — two shapes, on purpose
 * --------------------------------
 * The app already has an `employees` list that is a plain ARRAY OF NAME STRINGS,
 * and roughly a dozen screens read it that way (`getData('employees')` then
 * `employees.map((e) => <option value={e}>{e}</option>)`). Changing it to objects
 * would break every one of those dropdowns at once.
 *
 * So this module keeps BOTH, and keeps them in step:
 *
 *   `employees`            → ['Salma', 'Rina', …]        names only, unchanged
 *   `employee-directory`   → [{ id, employeeId, name }]  the full records
 *
 * The directory is the master; `employees` is derived from it on every write.
 * A screen that only needs to offer a name keeps working with no change, and a
 * screen that needs the ID (attendance, payroll, a printed roster) reads the
 * directory. Keeping the names list derived rather than hand-maintained is what
 * stops the two drifting apart.
 *
 * The Employee ID format matches the rest of the app (`EMP-001`), so a person
 * created here is the same kind of record the admin Employee Management screen
 * already issues.
 */

export const DIRECTORY_COLLECTION = 'employee-directory';
export const EMPLOYEE_NAMES_KEY = 'employees';

/**
 * Smart Attendance's own store — the `workers` collection it seeds and keys
 * attendance rows on.
 *
 * The directory is the master list of PEOPLE and Smart Attendance is the list of
 * people who can be clocked in. They are kept in step: adding somebody here
 * writes them there too, so a new hire appears on the attendance screen without
 * being entered a second time. `workerId` is the numeric tail of the Employee ID
 * (EMP-007 -> 7), which is exactly the key an attendance row already stores.
 */
export const ATTENDANCE_WORKERS = 'workers';

// ---- Lifecycle statuses ----------------------------------------------------
//
// Three states, because "delete" means two different things to a factory:
//
//   active   — on every dropdown, clockable in Smart Attendance.
//   inactive — hidden from the daily-production dropdowns but still a real
//              record, still listed in the directory, still clockable if the
//              person returns. This is what an unchecked "Yes, delete" does.
//   archived — removed from EVERY active list across the app, kept only in the
//              Admin Panel's inactive section for payroll history and audit.
//              This is what a checked "Yes, delete" does.
//
// Nothing is ever hard-deleted, because attendance, production and payroll rows
// already reference the person by workerId; removing the record would orphan
// those rows and make historical reports unreadable.
export const STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived',
};

/** The label shown to a person for each status. */
export const STATUS_LABEL = {
  [STATUS.ACTIVE]: 'Active',
  [STATUS.INACTIVE]: 'Inactive',
  [STATUS.ARCHIVED]: 'Archived',
};

/**
 * True when the record should be offered in a dropdown on the factory floor.
 * Both `inactive` and `archived` are excluded; the difference between them is
 * where the record remains visible to an administrator, not whether the floor
 * can pick it.
 */
export function isSelectable(record) {
  if (!record) return false;
  if (record.archived === true) return false;
  const status = String(record.status || '').toLowerCase();
  if (status === STATUS.ARCHIVED || status === STATUS.INACTIVE) return false;
  // Legacy records used a boolean only.
  return record.active !== false;
}

/** True when the record is kept for the admin's inactive view only. */
export function isArchived(record) {
  if (!record) return false;
  return record.archived === true || String(record.status || '').toLowerCase() === STATUS.ARCHIVED;
}

/** True when the record is a real person who is simply not currently listed. */
export function isInactive(record) {
  if (!record || isArchived(record)) return false;
  return String(record.status || '').toLowerCase() === STATUS.INACTIVE || record.active === false;
}

/** Records an administrator should still be able to see and restore. */
export function dormantRecords(records = []) {
  return directoryList(records).filter((r) => !isSelectable(r));
}
/**
 * A high-water mark: the highest Employee ID ever issued.
 *
 * Stored separately because it CANNOT be derived from the directory after a
 * deletion. Delete EMP-002 and the highest surviving ID is EMP-001, so a derived
 * next-ID would hand EMP-002 out a second time — to a different person, while
 * production rows, attendance and payroll still reference the original EMP-002.
 * That silently attaches one person's history to another, which is the worst
 * kind of data bug in a factory system because nothing visibly breaks.
 *
 * The mark only ever moves forward, so an ID is never reissued.
 */
export const EMPLOYEE_SEQ_KEY = 'employee-sequence';

const ID_PREFIX = 'EMP-';
const ID_WIDTH = 3;

/** The numeric tail of an Employee ID, or 0. 'EMP-007' -> 7. */
export function employeeIdNumber(value) {
  const match = String(value ?? '').match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

/**
 * Formats a numeric tail as a display Employee ID: 1 -> EMP-001.
 * Never truncates a larger number, so EMP-1000 stays readable.
 */
export function formatEmployeeId(value) {
  return `${ID_PREFIX}${String(employeeIdNumber(value)).padStart(ID_WIDTH, '0')}`;
}

/**
 * The next free Employee ID.
 *
 * `highWaterMark` is the stored sequence (see EMPLOYEE_SEQ_KEY). When it is
 * supplied it wins, because it remembers IDs that have been deleted and the
 * directory no longer shows. Without it, the highest surviving ID is used as a
 * best-effort fallback for records written before the mark existed.
 *
 * The mark is deliberately NOT just `max(records)`: after a deletion that would
 * reissue a retired ID, which is the collision this function exists to prevent.
 */
export function nextEmployeeId(records = [], highWaterMark = 0) {
  const highestInList = records.reduce(
    (max, record) => Math.max(max, employeeIdNumber(record?.employeeId)),
    0,
  );
  const highest = Math.max(employeeIdNumber(highWaterMark), highestInList);
  return formatEmployeeId(highest + 1);
}

/** The numeric value of the stored sequence, for comparison and bumping. */
export function sequenceNumber(highWaterMark) {
  return employeeIdNumber(highWaterMark);
}

/**
 * The sequence value after issuing `employeeId`. Only moves forward, so an
 * out-of-order write can never lower the mark and re-open a retired ID.
 */
export function bumpSequence(highWaterMark, employeeId) {
  return Math.max(employeeIdNumber(highWaterMark), employeeIdNumber(employeeId));
}

/** Normalises a stored record, tolerating one written by an older shape. */
export function normalizeEmployee(record, index = 0) {
  if (!record) return null;
  // A bare string is a name from the legacy list — accepted, and given an id.
  if (typeof record === 'string') {
    return { id: `name-${index}`, employeeId: '', name: record, status: STATUS.ACTIVE, active: true };
  }
  const name = String(record.name || record.fullName || '').trim();
  if (!name) return null;
  // A record written before statuses existed carries only `active`. Derived into
  // the newer field so every reader can test one thing.
  const archived = record.archived === true;
  const status = record.status
    || (archived ? STATUS.ARCHIVED : (record.active === false ? STATUS.INACTIVE : STATUS.ACTIVE));
  return {
    ...record,
    id: record.id ?? record.employeeId ?? `emp-${index}`,
    employeeId: record.employeeId || '',
    // The numeric tail, which is the key Smart Attendance stores on an
    // attendance row. Derived so the two collections agree without a lookup.
    workerId: record.workerId ?? employeeIdNumber(record.employeeId),
    name,
    status,
    archived,
    active: status === STATUS.ACTIVE,
  };
}

/** The directory as a clean, sorted list — every record, including dormant ones. */
export function directoryList(records = []) {
  return records
    .map(normalizeEmployee)
    .filter(Boolean);
}

/**
 * Just the names the DROPDOWNS should offer.
 *
 * Dormant records (inactive and archived) are excluded here rather than at each
 * call site, so a screen that selects an employee cannot accidentally offer
 * somebody who has left — which is the whole point of deactivating them.
 */
export function employeeNames(records = []) {
  const seen = new Set();
  const names = [];
  directoryList(records).forEach((record) => {
    if (!isSelectable(record)) return;
    const key = record.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(record.name);
  });
  return names;
}

/**
 * True when the name is already on the roster (case-insensitive).
 * Two people can genuinely share a name, so the caller decides what to do with
 * this — it is reported as a warning, not enforced as an error.
 */
export function findByName(records = [], name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  return directoryList(records).find((r) => r.name.toLowerCase() === key) || null;
}

/**
 * The record produced when a name is submitted: a fresh sequential Employee ID
 * and the name, and nothing else — the form only collects a name by design.
 */
export function buildEmployeeRecord(name, existing = [], createdAt, highWaterMark = 0) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('A full name is required.');
  return {
    id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    employeeId: nextEmployeeId(existing, highWaterMark),
    name: clean,
    createdAt: createdAt || new Date().toISOString().slice(0, 10),
    active: true,
  };
}

/**
 * The `employees` name list derived from a directory.
 *
 * An existing name that is not yet in the directory (a legacy entry) is kept, so
 * this never removes somebody the rest of the app could already select.
 */
export function deriveNameList(directory = [], previousNames = []) {
  const names = employeeNames(directory);
  const known = new Set(names.map((n) => n.toLowerCase()));
  // A name of somebody who has been deactivated must NOT survive through the
  // legacy merge — otherwise deactivating a person would leave them selectable
  // because the old name list still carried them.
  const dormantNames = new Set(
    directoryList(directory)
      .filter((r) => !isSelectable(r))
      .map((r) => r.name.toLowerCase()),
  );
  (previousNames || []).forEach((name) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (known.has(key) || dormantNames.has(key)) return;
    known.add(key);
    names.push(clean);
  });
  return names;
}

/**
 * The names a directory write RETIRED — the previous spellings of anybody it renamed.
 *
 * A rename is the one case where a name leaves the directory without the person
 * going anywhere, and the legacy merge in `deriveNameList` cannot tell it apart
 * from a name that was never entered in the directory at all. Left alone, the old
 * spelling survived as a phantom employee: after renaming EMP-001 to
 * "Md Robiul Islam (Robi)", the next save put "Md Robiul Islam" back on every
 * dropdown — a name no record carries.
 *
 * Recording the retirement lets the name list drop it for good, while a genuine
 * legacy name (one that never belonged to any directory record) is still kept.
 */
export function retiredNames(previousDirectory = [], nextDirectory = []) {
  const before = new Map(
    directoryList(previousDirectory).map((r) => [String(r.id), r.name.toLowerCase()]),
  );
  const retired = [];
  directoryList(nextDirectory).forEach((record) => {
    const wasName = before.get(String(record.id));
    const nowName = record.name.toLowerCase();
    if (wasName && wasName !== nowName) retired.push(wasName);
  });
  return retired;
}

/**
 * `deriveNameList`, minus any spelling a rename retired.
 *
 * The directory page calls this rather than `deriveNameList` so a rename cannot
 * leave its old spelling behind. Kept as a thin wrapper so the retirement rule
 * lives next to the merge it corrects, and a caller that does not track renames
 * still gets the old behaviour.
 */
export function deriveNameListAfterRename(directory = [], previousNames = [], retired = []) {
  const gone = new Set(
    (retired || []).map((name) => String(name || '').trim().toLowerCase()).filter(Boolean),
  );
  if (gone.size === 0) return deriveNameList(directory, previousNames);
  // A retired spelling is dropped from the carried-over names, so the merge in
  // `deriveNameList` cannot resurrect it.
  const kept = (previousNames || []).filter(
    (name) => !gone.has(String(name || '').trim().toLowerCase()),
  );
  return deriveNameList(directory, kept);
}

// ---- Smart Attendance sync -------------------------------------------------

/**
 * The Smart Attendance record for a directory entry.
 *
 * Shaped for the `workers` collection, which Smart Attendance reads and keys its
 * attendance rows on. `workerId` is the numeric tail of the Employee ID, so
 * EMP-007 becomes worker 7 — the same key a clock-in already stores. That is what
 * makes a person created here immediately clockable, and what keeps their
 * attendance history attached to the right record when they are renamed.
 */
export function attendanceWorkerFor(record) {
  const normalized = normalizeEmployee(record);
  if (!normalized) return null;
  const workerId = employeeIdNumber(normalized.employeeId);
  if (!workerId) return null; // an ID-less legacy name cannot key an attendance row
  return {
    workerId,
    employeeId: normalized.employeeId,
    name: normalized.name,
    department: normalized.department || '',
    basicSalary: Number(normalized.basicSalary) || 0,
    designation: normalized.designation || '',
    // Smart Attendance filters on `active`, so the two states it understands map
    // onto it: anything not active is simply not clockable.
    active: isSelectable(normalized),
    status: normalized.status,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The full sync a single directory record implies: the directory row plus the
 * Smart Attendance worker it mirrors. Returned as data so the caller performs the
 * writes and a test can assert both halves at once.
 */
export function syncPayloadFor(record) {
  const directory = normalizeEmployee(record);
  if (!directory) return null;
  return { directory, worker: attendanceWorkerFor(directory) };
}

/**
 * Everything one directory write implies, computed in one place.
 *
 * Line Deployment used to open-code this composition, which meant the exact
 * payloads it writes could only be checked by re-typing the logic in a test — and
 * a change to the page could silently stop mirroring to a collection without any
 * test noticing. Returning the payloads as DATA lets the page write them and a test
 * assert them from the same source of truth.
 *
 * @returns {{ names:string[], workers:object[] }}
 *   names   — the plain name list every dropdown reads, re-derived from the directory
 *   workers — the Smart Attendance mirror, keyed by workerId
 */
export function buildDirectorySync(nextDirectory = [], previousNames = [], previousDirectory = []) {
  const records = directoryList(nextDirectory);
  const workers = records
    .map((record) => {
      const worker = attendanceWorkerFor(record);
      // An ID-less legacy name cannot key an attendance row, so it is skipped
      // rather than written with an undefined id.
      if (!worker) return null;
      return { ...worker, id: String(worker.workerId) };
    })
    .filter(Boolean);

  return {
    // The retirement list is passed so a renamed person's OLD spelling cannot be
    // carried back into the dropdowns by the legacy merge.
    names: deriveNameListAfterRename(
      nextDirectory,
      previousNames,
      retiredNames(previousDirectory, nextDirectory),
    ),
    workers,
  };
}

/**
 * The directory records that need pushing to Firestore, ready for
 * `syncDirectoryToWorkers`. Dormant records are included — with `active: false` —
 * because attendance rows reference them and their history must stay resolvable.
 */
export function workersToSync(nextDirectory = []) {
  return directoryList(nextDirectory)
    .map((record) => normalizeEmployee({
      ...record,
      active: isSelectable(record),
    }))
    .filter(Boolean);
}

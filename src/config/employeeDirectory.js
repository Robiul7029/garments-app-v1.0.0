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
 * The designations a directory record may carry.
 *
 * A CLOSED list rather than free text, and that is the point: the rest of the app
 * asks "is this person a supervisor?" to build the Total Line Output form's
 * Supervisor Name dropdown (see `isSupervisor`). Free text made that question
 * depend on how somebody happened to spell the word, so the same post was written
 * "Supervisor", "line supervisor" and "Supervisor " — and a person whose spelling
 * fell outside the pattern silently disappeared from the dropdown.
 *
 * A factory still needs to name a post this list does not carry, so the form offers
 * an "Other / Custom Designation" route that types one in (see `CUSTOM_DESIGNATION`
 * and `mergeDesignations`). A custom value is therefore allowed ON A RECORD while
 * the LIST stays curated — which keeps the dropdown short without making an
 * unusual post impossible to record.
 */
export const DESIGNATIONS = ['Operator', 'Incharge', 'Supervisor', 'Manager', 'QC'];

/**
 * The value the form's "custom" option carries.
 *
 * A sentinel rather than a real designation, so choosing it opens the text box
 * instead of writing the words "Custom Designation" onto somebody's record. It
 * starts with an underscore precisely so it can never collide with a grade a user
 * types in.
 */
export const CUSTOM_DESIGNATION = '__custom__';

/** The option label the form shows for the custom route. */
export const CUSTOM_DESIGNATION_LABEL = 'Other / Custom Designation…';

/**
 * The collection the designations a user ADDED by hand are kept in.
 *
 * A designation created with the form's "+ Add" button has to survive on its own,
 * before any employee carries it. `designationsInUse` reads the directory, which only
 * knows a custom grade once a RECORD holds it — so a grade added from the dropdown and
 * then not used would vanish on the next render. This store is what makes the addition
 * persist for future selections, which is exactly what the brief asks for.
 */
export const DESIGNATION_OPTIONS_KEY = 'designation-options';

/**
 * A typed designation, cleaned for storage: trimmed and inner-whitespace collapsed.
 * Returns '' for anything that is not a usable value, so a caller can treat empty as
 * "nothing was typed" without a second check.
 */
export function cleanDesignation(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * The custom designations the user has added by hand, in the order they were added.
 * Tolerates a missing or malformed store rather than throwing.
 */
export function storedDesignations(options = []) {
  return (Array.isArray(options) ? options : [])
    .map(cleanDesignation)
    .filter(Boolean);
}

/**
 * The designation list to OFFER, merged from BOTH sources.
 *
 *   preset grades (DESIGNATIONS)
 *   → the custom values already on a directory record  (designationsInUse)
 *   → the custom values ADDED by hand                   (storedDesignations)
 *
 * De-duplicated case-insensitively and kept in that order, so the presets stay put and
 * a newly added grade appears at the end of the list where it was just typed.
 *
 * @param {Array} directory  the stored records
 * @param {Array} stored     the `designation-options` store
 * @returns {string[]} every value the dropdown should carry
 */
export function designationOptionsFor(directory = [], stored = []) {
  const base = designationsInUse(directory);
  const seen = new Set(base.map((d) => d.toLowerCase()));
  const extras = [];
  storedDesignations(stored).forEach((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    extras.push(value);
  });
  return [...base, ...extras];
}

/**
 * The `designation-options` store after adding `value`, or `null` when the value is
 * not worth adding.
 *
 * Returns the SAME array reference semantics the caller expects: `null` means "leave the
 * store alone". A blank value, or one that is already on the merged list (case-
 * insensitively), adds nothing — the caller selects the existing spelling instead.
 *
 * @param {Array}  stored  the current store
 * @param {string} value   the typed designation
 * @param {Array}  merged  the merged options list the dropdown is showing
 * @returns {Array|null} the next store, or null when nothing should be written
 */
export function addDesignationOption(stored = [], value, merged = []) {
  const clean = cleanDesignation(value);
  if (!clean) return null;
  const existing = (merged || []).find((d) => String(d).toLowerCase() === clean.toLowerCase());
  if (existing) return null;
  if (storedDesignations(stored).some((d) => d.toLowerCase() === clean.toLowerCase())) return null;
  return [...storedDesignations(stored), clean];
}

/**
 * The option spelling a typed value should SELECT: the list's own spelling when the value
 * is already carried (any case), otherwise the cleaned value as typed.
 *
 * Keeps the dropdown on a single canonical spelling, so adding "operator" selects the
 * existing "Operator" rather than creating a second, differently-cased option.
 */
export function matchingDesignation(merged = [], value) {
  const clean = cleanDesignation(value);
  if (!clean) return '';
  return (merged || []).find((d) => String(d).toLowerCase() === clean.toLowerCase()) || clean;
}

/** The designation a record with none is shown as, in the table and the dropdown. */
export const DESIGNATION_NONE = '\u2014';

/**
 * The designation a record with none is STORED with.
 *
 * The brief: an existing employee's blank designation defaults to Operator rather
 * than staying empty. Operator is the honest default — it is the grade most of the
 * floor holds — and it is better than a blank, which silently removed the person
 * from any list that filters on designation.
 */
export const DEFAULT_DESIGNATION = 'Operator';

/**
 * The designation a stored record carries, normalised to the list above.
 *
 * A record written before this list existed (or by the admin Employee Management
 * screen, which still takes free text) may hold any spelling. A case-insensitive
 * match against the list is used, so "operator" reads as "Operator"; anything else
 * is returned as it was stored rather than being silently rewritten to a value
 * somebody did not choose.
 *
 * A record with NO designation at all returns the default (Operator) rather than an
 * empty string — see DEFAULT_DESIGNATION.
 */
export function normalizeDesignation(value) {
  const clean = String(value || '').trim();
  if (!clean) return DEFAULT_DESIGNATION;
  const match = DESIGNATIONS.find((d) => d.toLowerCase() === clean.toLowerCase());
  return match || clean;
}

/**
 * The designation list to OFFER, including any custom values already in use.
 *
 * A custom designation is not a one-off: once somebody is recorded as a "Trainer",
 * the next person in that post has to be selectable too, or the dropdown forces the
 * same value to be retyped (and mis-typed) every time. So the preset list is
 * extended with the custom values the directory already holds, in the order they
 * were first seen, de-duplicated case-insensitively.
 *
 * @param {Array} directory the stored records
 * @returns {string[]} the preset grades followed by the custom ones in use
 */
export function designationsInUse(directory = []) {
  const seen = new Set(DESIGNATIONS.map((d) => d.toLowerCase()));
  const extras = [];
  directoryList(directory).forEach((record) => {
    const value = String(record.designation || '').trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    extras.push(value);
  });
  return [...DESIGNATIONS, ...extras];
}

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
    return {
      id: `name-${index}`,
      employeeId: '',
      name: record,
      // A legacy name carries no grade, so it takes the default — the brief asks
      // for existing employees to read as Operator rather than sitting blank.
      designation: DEFAULT_DESIGNATION,
      status: STATUS.ACTIVE,
      active: true,
    };
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
    // The person's grade. Normalised to the closed list when it matches one, so
    // every reader can compare against a known value instead of a spelling.
    designation: normalizeDesignation(record.designation),
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
 * The record produced when the form is submitted.
 *
 * @param {string} name        the person's full name
 * @param {Array}  existing    the current directory, for the next free Employee ID
 * @param {string} createdAt   the date the record was created
 * @param {number} highWaterMark the stored ID sequence
 * @param {string} designation the grade chosen in the form (see DESIGNATIONS), or a
 *                             custom value typed into the form's text box
 */
export function buildEmployeeRecord(name, existing = [], createdAt, highWaterMark = 0, designation = '') {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('A full name is required.');
  return {
    id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    employeeId: nextEmployeeId(existing, highWaterMark),
    name: clean,
    // A blank falls back to the default rather than being stored empty, so a
    // record can never be left without a grade to filter on.
    designation: normalizeDesignation(designation || DEFAULT_DESIGNATION),
    createdAt: createdAt || new Date().toISOString().slice(0, 10),
    active: true,
  };
}

/**
 * The validation errors for the add-employee form, as one field -> message map.
 *
 * Field-level rather than a single form-level message, because the brief asks for
 * the error to sit UNDER the box that is wrong: a top banner makes the reader hunt
 * for which field it means, and with two fields on this form there is no reason to
 * make them.
 *
 * @param {object} form        { name, designation, customDesignation }
 * @param {Array}  existing    the current directory
 * @param {object} options     { designationOptions } — the list actually offered
 * @returns {Record<string,string>} empty when the form is valid
 */
export function validateEmployee(form = {}, existing = [], { designationOptions = DESIGNATIONS } = {}) {
  const errors = {};
  const clean = String(form.name || '').trim().replace(/\s+/g, ' ');
  if (!clean) {
    errors.name = 'Enter the employee\u2019s full name.';
  } else {
    const clash = findByName(existing, clean);
    if (clash) {
      errors.name = `\u201c${clash.name}\u201d is already in the directory as ${clash.employeeId}. `
        + 'Employee names must be unique \u2014 edit that record instead of adding it again.';
    }
  }

  // A custom designation is typed rather than chosen, so the two cases are checked
  // separately: the dropdown must carry a selection, and a typed value must not be
  // empty or a duplicate of a grade already on the list.
  if (form.designation === CUSTOM_DESIGNATION) {
    const typed = String(form.customDesignation || '').trim().replace(/\s+/g, ' ');
    if (!typed) {
      errors.customDesignation = 'Type the new designation.';
    } else if (designationOptions.some((d) => d.toLowerCase() === typed.toLowerCase())) {
      errors.customDesignation = `\u201c${typed}\u201d is already on the list \u2014 choose it from the dropdown.`;
    }
  } else if (!String(form.designation || '').trim()) {
    errors.designation = 'Choose the employee\u2019s designation.';
  }

  return errors;
}

/**
 * The designation a form submission should actually store.
 *
 * Resolves the custom route: the sentinel means "use the typed value", anything
 * else is the chosen grade. Kept here so the form and its tests agree on what the
 * sentinel means rather than each re-implementing the branch.
 */
export function resolveDesignation(form = {}) {
  if (form.designation === CUSTOM_DESIGNATION) return String(form.customDesignation || '').trim();
  return String(form.designation || '').trim();
}

/**
 * The directory with a designation applied to one record.
 *
 * The rename path already replaces a record in place so its Employee ID survives;
 * this is the same idea for the grade, so changing somebody from Operator to
 * Supervisor cannot touch the ID that attendance and payroll reference.
 */
export function withDesignation(directory = [], id, designation) {
  return (Array.isArray(directory) ? directory : []).map((record) => (
    record && String(record.id) === String(id)
      ? { ...record, designation: normalizeDesignation(designation) }
      : record
  ));
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

// ---- Supervisors -------------------------------------------------------------

/**
 * True when a person's designation is "Supervisor" — and only that.
 *
 * The Total Line Output form asks WHO was in charge of the line, so it must offer
 * supervisors and nobody else. The designation is free text on both the directory
 * and the ERP employee master, so the match is on the normalised words rather than
 * on an exact string: "Supervisor", "supervisor", "Line Supervisor" and
 * "Sr. Supervisor" all count, while "Operator" and "Sewing Supervisor Trainee"
 * spellings that merely CONTAIN the word as part of a longer post still count as
 * supervisors — which is the intent, because a line supervisor is who the field asks
 * for.
 *
 * A bare role is accepted too (`role: 'supervisor'`), for a record created on the
 * admin Employee Management screen, which stores `designation` and `role`
 * separately. Nothing else is inferred: an operator is never promoted to supervisor
 * because their `role` happens to read loosely.
 */
export function isSupervisor(record) {
  if (!record) return false;
  const candidates = [record.designation, record.designationName, record.role, record.jobTitle];
  return candidates.some((value) => {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return false;
    // A single word (or a phrase ending in it) — never a substring of another word.
    return /\bsupervisor\b/.test(text) || /\bline\s*in-?charge\b/.test(text);
  });
}

/**
 * The supervisor names a dropdown offers.
 *
 * Reads BOTH rosters, because a factory enters people in either place and the
 * brief names Manpower Management / Line Deployment:
 *
 *   `employee-directory`  the Line Deployment master (status-aware)
 *   `employees`           the plain name list, an array of strings
 *
 * Only ACTIVE records are offered, and only those whose designation is a
 * supervisor. A name that exists only as a legacy string carries no designation, so
 * it is deliberately NOT included: offering it would be guessing that a worker is a
 * supervisor, and the field would then be filled by whoever came first rather than
 * by the person in charge.
 */
export function supervisorNames(directory = [], employeeNamesList = []) {
  const seen = new Set();
  const names = [];
  const add = (name) => {
    const clean = String(name || '').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    names.push(clean);
  };

  directoryList(directory).forEach((record) => {
    if (!isSelectable(record)) return;
    if (!isSupervisor(record)) return;
    add(record.name);
  });

  // The name list holds strings only; when a supervisor record exists for the name
  // it has already been added above, so this only ever contributes nothing new
  // unless the two sources genuinely disagree.
  (Array.isArray(employeeNamesList) ? employeeNamesList : []).forEach((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && isSupervisor(entry)) {
      add(entry.name);
    }
  });

  return names.sort((a, b) => a.localeCompare(b));
}

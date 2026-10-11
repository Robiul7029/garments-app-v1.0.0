import { collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

export const DEPARTMENTS = ['Cutting', 'Sewing', 'Finishing', 'Washing', 'Delivery', 'Iron', 'Other'];

// Employee IDs look like EMP-001, EMP-002, … — a 3-digit zero-padded number. The numeric
// tail is reused as the numeric `workerId` that the attendance collection already keys on,
// so approving an employee is enough to make them selectable in the daily attendance
// dropdown. Padding keeps the IDs aligned in the table and sorts them correctly as text.
const ID_PREFIX = 'EMP-';
const ID_START = 1;
const ID_WIDTH = 3;

function toNumber(value) {
  const match = String(value || '').match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

/** Formats a numeric tail as the display Employee ID, e.g. 1 -> EMP-001. */
export function formatEmployeeId(value) {
  const digits = toNumber(value);
  // Never truncate a larger number: EMP-1000 stays EMP-1000 rather than wrapping to 3 digits.
  return `${ID_PREFIX}${String(digits).padStart(ID_WIDTH, '0')}`;
}

/**
 * Next sequential Employee ID, zero-padded to 3 digits (EMP-001, EMP-002, …). Both the
 * employees collection and the legacy workers collection are scanned so a seeded worker
 * (ID 1..50) is never handed out twice.
 */
export async function generateEmployeeId(existing = []) {
  const highest = existing.reduce((max, employee) => Math.max(max, toNumber(employee.employeeId)), ID_START - 1);
  return formatEmployeeId(highest + 1);
}

function normalize(employee) {
  const employeeId = employee.employeeId || '';
  return {
    ...employee,
    employeeId,
    // Keep the numeric workerId in sync so attendance lookups by workerId keep working.
    workerId: employee.workerId ?? toNumber(employeeId),
    name: employee.name || employee.fullName || 'Unnamed employee',
    department: employee.department || 'Other',
    designation: employee.designation || '-',
    joiningDate: employee.joiningDate || '',
    // Account identity, so the table can show who the roster row belongs to. These are
    // synced from the account's own profile when the employee signs in (see
    // syncEmployeeIdentity), and edited directly from the form otherwise.
    email: employee.email || '',
    username: employee.username || '',
    role: employee.role || 'employee',
    active: employee.active !== false,
    status: employee.status || (employee.active === false ? 'inactive' : 'active'),
  };
}

// The master list lives in two places, so the list view has to read both:
//   - `employees/{EMP-xxx}` — the modern records created by the approval flow, and
//   - `workers/{n}`         — the legacy / seeded roster the attendance dropdown still keys
//                             on. Seeded workers (ID 1-50) exist ONLY here, which is why
//                             reading `employees` alone showed "No employees found".
// A record present in both collections is deduplicated by its numeric tail, with the
// `employees` copy winning because that is the one the admin edits.
export function subscribeToEmployees(onData, onError) {
  let employeeDocs = [];
  let workerDocs = [];
  let employeesReady = false;
  let workersReady = false;

  function emit() {
    // Wait for both snapshots so the table never renders a half-loaded roster.
    if (!employeesReady || !workersReady) return;

    const byKey = new Map();
    for (const worker of workerDocs) {
      byKey.set(String(toNumber(worker.employeeId) || worker.workerId), worker);
    }
    // The modern `employees` collection overrides the legacy `workers` mirror.
    for (const employee of employeeDocs) {
      byKey.set(String(toNumber(employee.employeeId) || employee.workerId), employee);
    }

    const merged = [...byKey.values()]
      .sort((a, b) => toNumber(a.employeeId) - toNumber(b.employeeId));
    onData(merged);
  }

  const unsubscribeEmployees = onSnapshot(collection(db, 'employees'), (snapshot) => {
    employeeDocs = snapshot.docs.map((item) => normalize({ id: item.id, ...item.data() }));
    employeesReady = true;
    emit();
  }, onError);

  const unsubscribeWorkers = onSnapshot(collection(db, 'workers'), (snapshot) => {
    workerDocs = snapshot.docs.map((item) => normalize({
      // A legacy worker document is keyed by its numeric id and has no `employeeId`,
      // so synthesise a padded `EMP-<nnn>` to present it in the same shape as a modern
      // record (the key can be a non-numeric doc id, in which case toNumber yields 0).
      employeeId: item.data().employeeId || formatEmployeeId(item.id),
      id: item.id,
      ...item.data(),
    }));
    workersReady = true;
    emit();
  }, onError);

  return () => { unsubscribeEmployees(); unsubscribeWorkers(); };
}

export function subscribeToPendingEmployees(onData, onError) {
  return onSnapshot(collection(db, 'employeeRequests'), (snapshot) => {
    onData(snapshot.docs
      .map((item) => normalize({ id: item.id, ...item.data() }))
      .filter((request) => request.status === 'pending' || !request.status));
  }, onError);
}

/**
 * Saves a registration request for review. No Employee ID is assigned yet — approval
 * issues it, so a rejected request never burns an ID.
 */
export async function submitEmployeeRequest({ fullName, department, designation, joiningDate, requestedBy, role, email, username }) {
  if (!fullName?.trim()) throw new Error('Full name is required.');
  if (!department) throw new Error('Please select a department.');
  if (!joiningDate) throw new Error('Please select a joining date.');
  // The rule stamps ownership on `requestedBy`, so it must be the caller's uid — never the
  // literal string 'admin', which the security rules reject.
  if (!requestedBy) throw new Error('You must be signed in to file an employee request.');
  const key = `${Date.now()}_${String(fullName).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
  await setDoc(doc(db, 'employeeRequests', key), {
    fullName: fullName.trim(),
    name: fullName.trim(),
    department,
    designation: designation?.trim() || '-',
    joiningDate,
    email: email?.trim() || '',
    username: username?.trim() || '',
    role: role || 'employee',
    status: 'pending',
    requestedBy,
    createdAt: serverTimestamp(),
  });
  return key;
}

/**
 * Approving a request assigns the next Employee ID, writes the employee to the employees
 * collection, mirrors them into the workers collection used by the attendance dropdown,
 * and marks the request approved — all in one batch so a failure cannot half-apply it.
 */
export async function approveEmployeeRequest(request, allEmployees) {
  const employeeId = await generateEmployeeId(allEmployees);
  const workerId = toNumber(employeeId);
  const employee = {
    employeeId,
    workerId,
    fullName: request.name,
    name: request.name,
    department: request.department,
    designation: request.designation || '-',
    joiningDate: request.joiningDate,
    // Carry the role the requester picked, so the table can show it after approval.
    role: request.role || 'employee',
    active: true,
    status: 'active',
    approvedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(doc(db, 'employees', employeeId), { ...employee, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(db, 'workers', String(workerId)), { ...employee, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(db, 'employeeRequests', request.id), { status: 'approved', employeeId, decidedAt: serverTimestamp() });
  await batch.commit();
  return employeeId;
}

export async function rejectEmployeeRequest(request, reason = '') {
  await updateDoc(doc(db, 'employeeRequests', request.id), {
    status: 'rejected',
    rejectionReason: reason,
    decidedAt: serverTimestamp(),
  });
}

export async function createEmployeeDirectly(values, allEmployees) {
  const employeeId = await generateEmployeeId(allEmployees);
  const employee = {
    ...values,
    employeeId,
    workerId: toNumber(employeeId),
    active: true,
    status: 'active',
  };
  const batch = writeBatch(db);
  batch.set(doc(db, 'employees', employeeId), { ...employee, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(db, 'workers', String(toNumber(employeeId))), { ...employee, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await batch.commit();
  return employeeId;
}

export async function updateEmployee(employeeId, changes) {
  const workerId = toNumber(employeeId);
  const payload = { ...changes, updatedAt: serverTimestamp() };
  const batch = writeBatch(db);
  // `set` with merge, not `update`: a seeded legacy worker exists only in `workers`, so
  // updating `employees/{id}` would fail on a document that was never created. Merging
  // creates it on first edit and leaves an existing record otherwise untouched.
  batch.set(doc(db, 'employees', employeeId), { employeeId, ...payload }, { merge: true });
  // The workers mirror feeds the attendance dropdown, so both sides must move together.
  if (workerId) batch.set(doc(db, 'workers', String(workerId)), payload, { merge: true });
  await batch.commit();
}

/**
 * Deactivate instead of delete: historical attendance rows reference workerId, so
 * removing the employee would orphan their past records. A deactivated employee simply
 * drops out of the attendance dropdown.
 */
export async function setEmployeeActive(employeeId, active) {
  await updateEmployee(employeeId, {
    active,
    status: active ? 'active' : 'inactive',
  });
}

export async function deleteEmployee(employeeId) {
  const workerId = toNumber(employeeId);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'employees', employeeId));
  if (workerId) batch.delete(doc(db, 'workers', String(workerId)));
  await batch.commit();
}

/**
 * Syncs a signed-in account's own e-mail / username onto its employee record.
 *
 * This is what makes the Email / Username column populate on its own: when a person updates
 * their profile after signing in, the roster row that belongs to them is found (by the
 * explicit employeeId / workerId link, then by e-mail) and stamped with the fresh identity —
 * no admin typing required.
 *
 * Silently does nothing when no matching employee record exists, so a plain account holder
 * who is not on the roster is not an error. Pass `allEmployees` (the loaded list) to avoid
 * re-reading the collections.
 */
export async function syncEmployeeIdentity({ uid, email, username }, allEmployees = []) {
  const emailKey = String(email || '').trim().toLowerCase();
  const usernameKey = String(username || '').trim().toLowerCase();
  if (!emailKey && !usernameKey) return null;

  const match = (allEmployees || []).find((employee) => {
    if (uid && (employee.uid === uid)) return true;
    const employeeEmail = String(employee.email || '').trim().toLowerCase();
    if (emailKey && employeeEmail && employeeEmail === emailKey) return true;
    const employeeUsername = String(employee.username || '').trim().toLowerCase();
    return Boolean(usernameKey && employeeUsername && employeeUsername === usernameKey);
  });

  if (!match?.employeeId) return null;

  // Only write what actually changed, so a profile edit that leaves the identity alone does
  // not churn the roster document on every mount.
  const changes = {};
  if (email && match.email !== email) changes.email = email;
  if (username && match.username !== username) changes.username = username;
  if (uid && match.uid !== uid) changes.uid = uid;
  if (Object.keys(changes).length === 0) return match.employeeId;

  await updateEmployee(match.employeeId, changes);
  return match.employeeId;
}

/**
 * Finds the employee record linked to an account, so a profile update can be routed to the
 * right roster row. Returns null when the account is not on the roster.
 */
export function findEmployeeForAccount({ uid, email, username } = {}, allEmployees = []) {
  const emailKey = String(email || '').trim().toLowerCase();
  const usernameKey = String(username || '').trim().toLowerCase();
  return (allEmployees || []).find((employee) => {
    if (uid && employee.uid === uid) return true;
    const employeeEmail = String(employee.email || '').trim().toLowerCase();
    if (emailKey && employeeEmail && employeeEmail === emailKey) return true;
    const employeeUsername = String(employee.username || '').trim().toLowerCase();
    return Boolean(usernameKey && employeeUsername && employeeUsername === usernameKey);
  }) || null;
}

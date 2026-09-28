import { collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

export const DEPARTMENTS = ['Cutting', 'Sewing', 'Finishing', 'Washing', 'Delivery', 'Iron', 'Other'];

// Employee IDs look like EMP-101. The numeric tail is reused as the numeric `workerId`
// that the attendance collection already keys on, so approving an employee is enough to
// make them selectable in the daily attendance dropdown.
const ID_PREFIX = 'EMP-';
const ID_START = 101;

function toNumber(value) {
  const match = String(value || '').match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

/**
 * Next sequential Employee ID. Both the employees collection and the legacy workers
 * collection are scanned so a seeded worker (ID 1..50) is never handed out twice.
 */
export async function generateEmployeeId(existing = []) {
  const highest = existing.reduce((max, employee) => Math.max(max, toNumber(employee.employeeId)), ID_START - 1);
  return `${ID_PREFIX}${highest + 1}`;
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
    active: employee.active !== false,
    status: employee.status || (employee.active === false ? 'inactive' : 'active'),
  };
}

export function subscribeToEmployees(onData, onError) {
  return onSnapshot(collection(db, 'employees'), (snapshot) => {
    onData(snapshot.docs.map((item) => normalize({ id: item.id, ...item.data() })));
  }, onError);
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
export async function submitEmployeeRequest({ fullName, department, designation, joiningDate, requestedBy }) {
  if (!fullName?.trim()) throw new Error('Full name is required.');
  if (!department) throw new Error('Please select a department.');
  if (!joiningDate) throw new Error('Please select a joining date.');
  const key = `${Date.now()}_${String(fullName).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
  await setDoc(doc(db, 'employeeRequests', key), {
    fullName: fullName.trim(),
    name: fullName.trim(),
    department,
    designation: designation?.trim() || '-',
    joiningDate,
    status: 'pending',
    requestedBy: requestedBy || 'admin',
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
  batch.update(doc(db, 'employees', employeeId), payload);
  // The workers mirror feeds the attendance dropdown, so both sides must move together.
  if (workerId) batch.update(doc(db, 'workers', String(workerId)), payload);
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

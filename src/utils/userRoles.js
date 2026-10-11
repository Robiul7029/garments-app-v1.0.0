import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { ROLES } from '../config/erpRoles';

/**
 * ROBIUL GARMENTS ERP — account role writes.
 *
 * Employee Management lets an admin pick a garment-floor Role on an employee form. An
 * employee record itself has no permissions — it is a roster entry keyed by EMP-xxx.
 * Permissions live on the *account* document (`users/{uid}`) plus the role directory
 * (`managerDirectory/{uid}`), so the form writes that pair. Doing it here, in one place, is
 * what keeps the role the admin sees on the employee screen and the role the guards enforce
 * from ever drifting apart.
 *
 * This mirrors AuthContext.setUserAccess rather than importing it, because that helper is a
 * React callback (it calls setUsersVersion) and cannot be used from a plain utility.
 */

const USERS_COLLECTION = 'users';
const MANAGER_DIRECTORY = 'managerDirectory';
const MANAGER_IDS = 'managerIds';

/**
 * The garment-floor roles an admin can assign from the employee form.
 *
 * Only Admin and Manager carry the manager data-entry right, because that single flag is
 * what the whole manager-reads-are-allowed model hinges on. The three floor roles are
 * ordinary accounts: they may sign in and view, but they do not get data-entry rights.
 */
export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'line_incharge', label: 'Line Incharge' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'employee', label: 'Employee' },
];

const ROLE_VALUES = ROLE_OPTIONS.map((option) => option.value);

/** The stored `role` string for a chosen option. Anything unknown falls back to Employee. */
export function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ROLE_VALUES.includes(role) ? role : 'employee';
}

/**
 * The `roles` array that accompanies a role.
 *
 * Only Admin and Manager carry the manager right. A Line Incharge, Supervisor or Employee is
 * a plain account.
 */
function rolesFor(role) {
  if (role === 'admin') return ['user', 'manager', 'admin'];
  if (role === 'manager') return ['user', 'manager'];
  return ['user'];
}

/**
 * ERP roles granted by each dropdown role.
 *
 * The dropdown is the admin-facing, human-sized list (Admin / Manager / Line Incharge /
 * Supervisor / Employee); the permission matrix in config/erpRoles.js is keyed by the
 * 16-role ERP vocabulary. Without this bridge the three floor roles (Line Incharge,
 * Supervisor, Employee) carried no ERP permissions at all — `collectRoles` reads only
 * `erpRole` / `erpRoles`, so the role the admin picked was never enforced. Writing the
 * mapped ERP roles alongside the legacy `role` is what makes the dropdown actually grant
 * (and, just as importantly, withhold) access.
 *
 * The mapping is deliberately least-privilege:
 *   - Admin       -> super_admin (full ERP access, same as the legacy approver)
 *   - Manager     -> production_manager (records production, sees HR/quality, no accounts)
 *   - Line Incharge -> supervisor (records production, may not delete or see money)
 *   - Supervisor  -> supervisor
 *   - Employee    -> [] (a plain account: signs in and sees only the legacy viewer pages)
 * An employee is intentionally left with no ERP role rather than being given a read-only
 * one, because the ERP modules are management tooling, not a roster.
 */
export function erpRolesFor(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'admin') return [ROLES.SUPER_ADMIN];
  if (normalized === 'manager') return [ROLES.PRODUCTION_MANAGER];
  if (normalized === 'line_incharge') return [ROLES.SUPERVISOR];
  if (normalized === 'supervisor') return [ROLES.SUPERVISOR];
  return [];
}

/** Human label for a stored role, for the list table. */
export function roleLabel(value) {
  const role = normalizeRole(value);
  return ROLE_OPTIONS.find((option) => option.value === role)?.label || 'Employee';
}

/** True when the role carries the manager data-entry right. */
export function isManagerLikeRole(value) {
  const role = normalizeRole(value);
  return role === 'admin' || role === 'manager';
}

/**
 * Resolves an account uid from whatever identity the caller has.
 *
 * An employee record is keyed by EMP-xxx and holds no uid, so three sources are tried in
 * order of reliability: an explicit uid, the `managerIds` lookup (keyed by User ID or
 * e-mail), and finally the `users` collection scanned for a matching e-mail. Returns '' when
 * nothing matches, which the caller treats as "no account to update".
 */
export async function resolveAccountUid({ uid = '', email = '', username = '' } = {}) {
  const explicit = String(uid || '').trim();
  if (explicit) return explicit;

  const emailKey = String(email || '').trim().toLowerCase();
  const usernameKey = String(username || '').trim().toLowerCase();

  // The public lookup index is keyed by lower-cased User ID, and carries the uid + e-mail.
  for (const key of [usernameKey, emailKey]) {
    if (!key) continue;
    const snapshot = await getDoc(doc(db, MANAGER_IDS, key));
    if (snapshot.exists() && snapshot.data().uid) return String(snapshot.data().uid);
  }

  // Fall back to the users collection, matched on e-mail.
  if (emailKey) {
    const users = await getDocs(collection(db, USERS_COLLECTION));
    for (const item of users.docs) {
      const data = item.data();
      if (String(data.email || '').trim().toLowerCase() === emailKey) return item.id;
    }
  }

  return '';
}

/**
 * Writes a role to the account behind `identity`, atomically, so the profile document and
 * the role directory can never end up saying different things.
 *
 * An account being promoted to manager/admin is written as approved, because that is what
 * the sign-in gate and isManager() read; a plain user is approved as well so they keep the
 * access they already had.
 *
 * Returns `{ uid, role }`. Throws when no account matches, so the caller can tell the admin
 * that the role could not be applied rather than reporting a silent success.
 */
export async function writeAccountRole(identity, requestedRole) {
  const role = normalizeRole(requestedRole);
  const uid = await resolveAccountUid(identity);
  if (!uid) {
    throw new Error('No account is linked to this employee, so the role could not be saved. Add the employee an e-mail / account first.');
  }

  // The mapped ERP roles are written on every role change, even when empty, so demoting a
  // manager to Employee actually REVOKES the ERP access they had rather than leaving a
  // stale `erpRoles` array behind. `null` is not written — Firestore drops an explicit
  // empty array as a real value, which is what we want here.
  const erpRoles = erpRolesFor(role);

  const batch = writeBatch(db);
  batch.set(doc(db, USERS_COLLECTION, uid), {
    role,
    roles: rolesFor(role),
    erpRoles,
    status: 'approved',
    managerStatus: 'approved',
    updatedAt: new Date(),
  }, { merge: true });

  // The directory is the source of truth the sign-in gate and the rules read.
  batch.set(doc(db, MANAGER_DIRECTORY, uid), {
    uid,
    role,
    erpRoles,
    status: 'approved',
    managerStatus: 'approved',
    reviewedAt: new Date(),
  }, { merge: true });

  await batch.commit();
  return { uid, role, erpRoles };
}

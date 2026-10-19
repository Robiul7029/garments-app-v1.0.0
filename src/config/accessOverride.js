/**
 * The DEVELOPMENT-ONLY access override.
 *
 * While developing, an admin/manager account can be denied every management feature by a
 * Firestore role record that has not been seeded yet — `users/{uid}.erpRoles` empty, or a
 * `status` that is not "approved". That is the correct behaviour in production (an
 * un-approved account must not write), but it makes the developer's own session look
 * endlessly "demoted" to a restricted standard user.
 *
 * This module is the ONE switch that lifts that restriction, and it does so in exactly
 * one environment:
 *
 *   - it is on ONLY in a REAL development server: Vite's `DEV`, minus the test runner
 *     (`MODE === 'test'`) and minus any Node process outside a browser (`window` absent).
 *     A production bundle, a preview build and a unit test can therefore never contain
 *     an elevated session — a viewer test must still render as a viewer;
 *   - it is OFF for a production build even if `VITE_DEV_ACCESS_ROLE` is left set in the
 *     environment, so a mistyped variable can never ship admin rights to real users;
 *   - it defaults to `admin` and can be narrowed with `VITE_DEV_ACCESS_ROLE=manager`.
 *     Any other value (or `none`) disables it, which is the escape hatch for reproducing
 *     a restricted-session bug locally.
 *
 * What it does NOT do: it never touches the stored records and never changes the
 * sign-in/approval gate in AuthContext. Calling `setUserAccess` on somebody still writes
 * exactly the role the admin table chose — the override only decides what THIS session
 * is allowed to do, in this tab, while developing.
 */

/** Which ERP role the dev session holds. `''` means "no override". */
export const DEV_ACCESS_ROLE = (() => {
  // `import.meta.env` is typed by Vite. Guarded with optional chaining so a bare Node
  // test run (where the object can be absent) simply reports "no override".
  const env = import.meta.env || {};
  if (env.DEV !== true) return '';
  // Vitest also runs with DEV === true; a test must keep its own viewer/admin fixtures.
  if (env.MODE === 'test') return '';
  // `npm run dev` serves the app in a browser. Anything without a document is not the
  // developer's live session and gets no override.
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  const requested = String(env.VITE_DEV_ACCESS_ROLE || 'admin').trim().toLowerCase();
  if (requested === 'admin') return 'admin';
  if (requested === 'manager') return 'manager';
  return '';
})();

/** True while the development override is active. */
export const DEV_ACCESS_ENABLED = DEV_ACCESS_ROLE !== '';

/**
 * The role the Auth/Role layer reports for the current session.
 *
 * RoleContext's `isAdmin` means "may enter operational data", which is exactly what a
 * developer needs restored. The ERP matrix reads the same switch through its own
 * session-roles fallback (see PermissionContext.sessionRolesFromUser), and the admin-area
 * guard through AdminAccessContext — one constant, three consumers, so they cannot
 * disagree about whether the session is elevated.
 */
export function accessSessionRole(fallbackRole = 'viewer') {
  if (!DEV_ACCESS_ENABLED) return fallbackRole;
  return 'admin';
}

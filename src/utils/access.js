/**
 * The one definition of "this account may enter the admin area".
 *
 * It lives in its own module, free of React and of any context, for two reasons:
 *  - Both the runtime guard (AdminAccessContext / AdminProtectedRoute) and the admin
 *    sign-in (AuthContext.loginAdmin) must apply the *same* test. Two re-implementations
 *    of a privilege check drift, and the drift is a security hole.
 *  - Keeping it out of the contexts avoids a circular import: AuthContext already needs
 *    this predicate, and AdminAccessContext already imports AuthContext.
 */

/**
 * Only a record whose role is 'admin' (or which carries the explicit `isAdmin` / the
 * `isSuperAdmin` approver flag) may enter the admin area.
 *
 * The session role deliberately does NOT count here: it is 'admin' for every approved
 * manager (that is what grants them data entry on the operational pages), so honouring it
 * would hand every manager the approval table — exactly what managers are forbidden from.
 *
 * `isSuperAdmin` is honoured because it marks the built-in approver account, which must
 * never be locked out of the area it owns — the same exemption the rest of the app grants
 * it (see AuthContext.sessionFor and RoleContext).
 *
 * A failed/absent record yields false: for a permission check the closed direction is the
 * safe one.
 */
export function isElevatedRecord(record) {
  if (record?.isSuperAdmin === true || record?.isAdmin === true) return true;
  const role = String(record?.role || '').trim().toLowerCase();
  const roles = Array.isArray(record?.roles)
    ? record.roles.map((value) => String(value || '').trim().toLowerCase())
    : [];
  return role === 'admin' || roles.includes('admin');
}

import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthLoadingScreen } from './ProtectedRoute';
import { useAdminAccess, isElevatedRecord } from '../context/AdminAccessContext';

// Key used to mark a browser tab as holding an active Admin session. It is written
// only by the dedicated admin sign-in and cleared on sign-out / idle expiry, so it can
// never be set by a normal manager login.
const ADMIN_SESSION_KEY = 'adminSession';

// An active admin session: the tab was signed in through /admin/login. A stale entry
// (leftover from a crashed tab) is ignored by comparing it with the live auth state.
function hasActiveAdminSession(uid) {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return false;
    return JSON.parse(raw)?.uid === uid;
  } catch {
    return false;
  }
}

export function markAdminSession(user) {
  try {
    sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ uid: user?.id || '', at: Date.now() }));
  } catch {
    // A blocked sessionStorage must never break the sign-in itself.
  }
}

export function clearAdminSession() {
  try {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    // ignore
  }
}

// The users document is the record an admin edits when granting access, so it is the
// single source of truth here. `isSuperAdmin` on the same document is honoured too, so
// the approver account itself is never locked out of its own area.
export { isElevatedRecord as isAdminRecord };

/**
 * Reads the signed-in user's role straight from Firestore (`users/{uid}`).
 *
 * Returns `{ checking, allowed, record, error, refresh }` so the guard can render a
 * spinner while the document is in flight and an explicit denial once the verdict is in.
 * A read that fails is treated as a denial, never as a pass: for a permission check the
 * safe direction is the closed one.
 */
export function useAdminRoleCheck() {
  // The verdict now comes from AdminAccessContext, which is mounted once above the whole
  // app. That matters because the session role and the admin-area right are deliberately
  // different things: a manager's session role is `admin` (it unlocks data entry on every
  // operational page), yet the very same `admin` value must not open this area. Reading the
  // users document — which records role 'manager', not 'admin', for those accounts — is
  // what keeps a manager out while leaving their data rights intact.
  const { checking, elevated, record, refresh } = useAdminAccess();
  return {
    checking,
    allowed: elevated,
    record,
    // Only a read that actually failed carries a reason; a plain "this account is not an
    // admin" is an expected verdict, so the panel keeps its own wording for that case.
    error: checking || elevated ? '' : 'This account does not have administrator access.',
    refresh: typeof refresh === 'function' ? refresh : () => {},
  };
}

/**
 * Guard for every /admin/* route.
 *
 * Checks, in order:
 *  1. No signed-in user       -> /login, because there is no identity to judge yet.
 *  2. Role still being read   -> a spinner. The admin screen is never mounted before the
 *     Firestore verdict is in, so a manager cannot see even a frame of the dashboard.
 *  3. Role is not 'admin'     -> /admin/login, with `replace` so the URL they typed does
 *     not stay in the history stack. Passing `showDenied` swaps that redirect for a
 *     readable "Access Denied" panel instead.
 *  4. Admin role but no active admin tab session (a restored or stale session) -> the
 *     dedicated admin sign-in, so the elevated area is only ever entered deliberately.
 */
export default function AdminProtectedRoute({ children, showDenied = false }) {
  const { user, loading, authReady } = useAuth();
  const location = useLocation();
  const { checking, allowed, error, refresh } = useAdminRoleCheck();

  // Gate on the same two flags as ProtectedRoute. Without this, `user` is null for the whole
  // role-lookup window after a refresh and a perfectly valid admin would be redirected to
  // /login. Rendering the loading screen here is also what keeps this guard from returning
  // nothing at all, which is what showed up as a white screen.
  if (loading || !authReady) return <AuthLoadingScreen />;

  // A settled session with no user is the only real "signed out" state, so this is a genuine
  // redirect with `replace` — no empty render, no blank frame.
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (checking) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-logo">AB</div>
            <div className="brand-name">ART BOUTIQUE SRL</div>
          </div>
          <div className="auth-form">
            <p className="hint" role="status" aria-live="polite">Verifying administrator access…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!allowed) {
    if (showDenied) return <AccessDenied reason={error} onRetry={refresh} />;
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  if (!hasActiveAdminSession(user.id)) {
    // Admin rights without a dedicated admin sign-in must still pass through the admin
    // login to be re-authorised.
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  // `children` lets the guard wrap a single element; with no children it acts as a
  // layout route and renders its nested routes through the Outlet.
  return children ?? <Outlet />;
}

function AccessDenied({ reason, onRetry }) {
  const { user } = useAuth();
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-logo">AB</div>
          <div className="brand-name">ART BOUTIQUE SRL</div>
        </div>
        <div className="auth-form">
          <div className="auth-status">
            <div className="auth-status-icon">🔒</div>
            <p><strong>Access Denied</strong></p>
            <p className="hint">
              {reason || `This account${user?.email ? ` (${user.email})` : ''} does not have administrator access.`}
            </p>
          </div>
          <button type="button" className="btn btn-outline auth-submit" onClick={onRetry}>Try again</button>
          <a className="auth-text-button" href="/admin/login">Go to admin sign in</a>
        </div>
      </div>
    </div>
  );
}

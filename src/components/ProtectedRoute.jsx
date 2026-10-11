import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Full-screen loading state shown while Firebase Auth is still resolving.
 *
 * It deliberately renders no app chrome, header or sidebar — only the brand and a
 * spinner — so the dashboard UI can never flash before the session is known.
 */
export function AuthLoadingScreen() {
  return (
    <div className="auth-shell">
      <div className="auth-card auth-loading-card">
        <div className="auth-brand">
          <div className="brand-logo">AB</div>
          <div className="brand-name">ART BOUTIQUE SRL</div>
        </div>
        <div className="auth-loading">
          <span className="auth-spinner" aria-hidden="true" />
          <p className="hint" role="status" aria-live="polite">Checking your session…</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Guard for the main dashboard routes.
 *
 * Reads the live session that `onAuthStateChanged` in AuthContext maintains:
 *  - `loading` true  -> the auth listener has not answered yet, so nothing is rendered
 *    but the spinner. This is the branch that prevents the dashboard from flashing for a
 *    frame on a hard refresh or a cold start, when `user` is still null simply because the
 *    session has not been read back from browserSessionPersistence yet.
 *  - `user` null     -> genuinely signed out, so redirect to /login with `replace` and
 *    remember where they were headed in `state.from`.
 *  - `user` present  -> render the route.
 *
 * `children` wraps a single element; with no children it behaves as a layout route and
 * renders nested routes through the Outlet.
 */
export default function ProtectedRoute({ children }) {
  const { user, loading, authReady } = useAuth();
  const location = useLocation();

  // `authReady` is checked alongside `loading` on purpose. `user` is null for the whole window
  // between the auth listener replying and the Firestore role lookup finishing, so guarding on
  // `user` alone would bounce a signed-in user to /login on every hard refresh. This is also the
  // branch that prevents a white screen: the guard always renders *something* — a spinner while
  // the session is being resolved, a redirect once it is known to be absent.
  if (loading || !authReady) return <AuthLoadingScreen />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return children ?? <Outlet />;
}

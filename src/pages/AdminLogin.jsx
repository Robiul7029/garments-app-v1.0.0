import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { markAdminSession } from '../components/AdminProtectedRoute';
import { isElevatedRecord, managerIdsKeysFor } from '../context/AdminAccessContext';

const MANAGER_IDS = 'managerIds';

// Where an admin lands after a successful sign-in. Matches the guard's canonical route.
const ADMIN_HOME = '/admin/workers';

// Shown when a User ID (or any non-address) is typed into the email-only admin field.
const ADMIN_EMAIL_ERROR = 'Please enter a valid admin email address';
// The same test AuthContext uses, so "looks like an email" means the same thing everywhere.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// How long the toast stays up before it fades on its own.
const TOAST_MS = 4000;

export default function AdminLogin() {
  const { loginAdmin, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // A separate flag for the "not an email" case, so the field can be outlined while the
  // toast is showing without that styling leaking onto ordinary sign-in failures.
  const [invalidEmail, setInvalidEmail] = useState(false);
  // The transient toast. Carries its own id so a repeat submit restarts the timer instead
  // of leaving a stale message on screen.
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  // Whether this tab may proceed into the admin area. Deliberately NOT the session
  // `isAdmin`: a manager's session role is also `admin` (it is what unlocks data entry on
  // the operational pages), so trusting it here would invite every manager into this
  // screen. The `managerIds` entry is the authority, and for a manager it says
  // role 'manager' — never 'admin'.
  const [elevated, setElevated] = useState(false);
  const [checking, setChecking] = useState(Boolean(user?.id));

  useEffect(() => {
    const uid = user?.id;
    const lookupKeys = managerIdsKeysFor(user || {});
    if (!uid || lookupKeys.length === 0) {
      setElevated(false);
      setChecking(false);
      return undefined;
    }
    let active = true;
    setChecking(true);
    // Same lookup as AdminAccessProvider — by User ID, then by e-mail — so this screen and
    // the guards cannot disagree on whether the account is an admin.
    (async () => {
      for (const key of lookupKeys) {
        const snapshot = await getDoc(doc(db, MANAGER_IDS, key));
        if (snapshot.exists()) return snapshot.data();
      }
      return null;
    })()
      .then((record) => {
        if (!active) return;
        setElevated(isElevatedRecord(record));
      })
      .catch(() => { if (active) setElevated(false); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [user]);

  // An already-authorised admin has no reason to be on this page: send them straight to
  // the workers view rather than re-prompting for the credentials they already hold.
  const attempted = location.state?.from;
  const alreadyIn = Boolean(elevated);

  // The toast clears itself; the id in the dependency list restarts the timer when the
  // same error is raised again (a second submit), which a plain boolean would not do.
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    // The form is `noValidate`, so this is the only place the email rule is checked on the
    // client. Doing it here (rather than letting the browser pop its own "Please include an
    // '@'" bubble) is what lets the message match the app's wording and styling.
    const value = identifier.trim();
    if (!value) {
      setInvalidEmail(true);
      setError(ADMIN_EMAIL_ERROR);
      setToast({ id: Date.now(), text: ADMIN_EMAIL_ERROR });
      return;
    }
    if (!EMAIL_PATTERN.test(value)) {
      setInvalidEmail(true);
      setError(ADMIN_EMAIL_ERROR);
      setToast({ id: Date.now(), text: ADMIN_EMAIL_ERROR });
      return;
    }
    setInvalidEmail(false);

    setBusy(true);
    try {
      // loginAdmin re-verifies the admin claim server-side and signs the user out again
      // if the account turns out not to be an admin, so a non-admin can never end a
      // successful login here.
      const admin = await loginAdmin(value, password);
      markAdminSession(admin);
      navigate(attempted || ADMIN_HOME, { replace: true });
    } catch (err) {
      const message = err.message || 'Admin sign-in failed.';
      setError(message);
      // A rejected credential is worth surfacing as a toast too, so the failure is noticed
      // even if the form has been scrolled.
      setToast({ id: Date.now(), text: message });
    } finally {
      setBusy(false);
    }
  }

  // While the users document is being read, show neither the form nor the "continue"
  // panel: rendering the form first would flash a sign-in box at someone who is about to
  // be told they are already an admin.
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

  if (alreadyIn) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-logo">AB</div>
            <div className="brand-name">ART BOUTIQUE SRL</div>
          </div>
          <div className="auth-form">
            <p className="hint">You are signed in as {user?.username || user?.email} with admin rights.</p>
            <button
              type="button"
              className="btn btn-primary auth-submit"
              onClick={() => {
                markAdminSession(user);
                navigate(ADMIN_HOME, { replace: true });
              }}
            >
              Continue to Admin Dashboard
            </button>
            <button
              type="button"
              className="auth-text-button"
              onClick={() => navigate(attempted || ADMIN_HOME, { replace: true })}
            >
              Return to the page you requested
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-logo">AB</div>
          <div className="brand-name">ART BOUTIQUE SRL</div>
        </div>

        <div className="auth-tabs">
          <span className="auth-tab active">Admin Access</span>
        </div>

        {/* `noValidate` suppresses the browser's own validation bubble so the app can show
            its own message instead. The check itself still runs in `handleSubmit`, and the
            server-side `loginAdmin` rejects a non-address a second time regardless. */}
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <p className="hint">Restricted area. Sign in with your admin email address — User IDs are not accepted here.</p>
          <label className="form-field">
            <span>Admin email address</span>
            <input
              required
              autoFocus
              type="email"
              autoComplete="email"
              className={invalidEmail ? 'auth-input-invalid' : undefined}
              aria-invalid={invalidEmail || undefined}
              aria-describedby={invalidEmail ? 'admin-email-error' : undefined}
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                // Clear the complaint as soon as the user starts fixing it, so the red
                // outline does not linger while they type a valid address.
                if (invalidEmail) { setInvalidEmail(false); setError(''); }
              }}
              placeholder="admin@email.com"
            />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
          </label>
          {error && (
            <p className={invalidEmail ? 'auth-field-error' : 'auth-error'} id={invalidEmail ? 'admin-email-error' : undefined} role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Sign in as Admin'}
          </button>
          <Link className="auth-text-button" to="/login">Back to standard sign in</Link>
        </form>
      </div>

      {/* Toast, in place of the native validation bubble. `role="alert"` + `aria-live`
          so it is announced by a screen reader as well as shown. */}
      {toast && (
        <div className="notif-toast notif-toast-error" role="alert" aria-live="assertive">
          <span className="notif-toast-text">{toast.text}</span>
        </div>
      )}
    </div>
  );
}

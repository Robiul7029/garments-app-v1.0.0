import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { auth, authPersistenceReady, db } from '../firebase';

/**
 * The page URL, or `null` when the browser cannot supply it.
 *
 * `window.location.href` is not guaranteed to be a string: a tab being restored by the
 * browser, an extension that relaunches the page, or a `about:blank` window momentarily
 * hands back `undefined`. Firebase's `isSignInWithEmailLink` then calls `.indexOf` on it
 * and throws `Cannot read properties of undefined (reading 'indexOf')`, which used to
 * abort the whole auth bootstrap — the `[Auth] auth bootstrap failed` entry in the
 * console, with the app left on "Checking your session…".
 */
function currentUrl() {
  try {
    const href = window.location?.href;
    return typeof href === 'string' && href.length > 0 ? href : null;
  } catch {
    return null;
  }
}

/** True when this page is a Firebase email-link sign-in. Never throws. */
function isEmailSignInLink(url) {
  if (!url) return false;
  try {
    return isSignInWithEmailLink(auth, url);
  } catch (error) {
    // A malformed or half-written URL is simply "not an email link"; the normal sign-in
    // screen handles it. It must never take the bootstrap down with it.
    console.warn('[Auth] email-link check skipped', error?.message || error);
    return false;
  }
}
import { securitySettingsRef } from '../utils/security';
import { isElevatedRecord } from '../utils/access';
import {
  buildVerificationLink,
  confirmVerificationCode,
  generateVerificationCode,
  sendVerificationEmail,
} from '../services/verificationApi';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';
import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

export const AuthContext = createContext(null);

// Role information lives in a directory that is keyed by uid and writable only by the
// approver, never in the user-writable `users` document. Keeping the two apart is what
// stops a general user from promoting themselves.
const MANAGER_DIRECTORY = 'managerDirectory';
const MANAGER_IDS = 'managerIds';
const PROFILE_ROLES = ['role', 'roles', 'isSuperAdmin', 'managerStatus', 'status'];
const USERS_COLLECTION = 'users';
const MANAGER_PENDING_MESSAGE = 'Your manager account is pending admin approval';
// Which sign-in screen the visitor actually used: the standard one at `/`, or the dedicated
// admin one at `/admin/login`. It is the visitor's stated INTENT, and it decides where they
// land — a standard sign-in always lands on the Manager Dashboard even when the account
// happens to also hold admin rights, and only the admin sign-in opens the admin area.
//
// Kept in sessionStorage so it describes this tab's session only, and cleared on sign-out
// alongside `accessMode`.
export const LOGIN_ENTRY_KEY = 'loginEntry';
export const LOGIN_ENTRY_STANDARD = 'standard';
export const LOGIN_ENTRY_ADMIN = 'admin';
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
// Admins get a much stricter idle window than everyone else. General users and managers
// keep the long INACTIVITY_TIMEOUT_MS above and are never affected by this rule.
const ADMIN_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const ADMIN_IDLE_MESSAGE = 'Session expired due to 24 hours of inactivity.';
// Same idea as the admin rule, on the long 15 minute window.
export const GENERAL_IDLE_MESSAGE = 'Session expired due to 15 minutes of inactivity.';

// A manager is a user whose Firestore record carries the manager role and is approved.
// Both the `role: "manager"` field and a `roles` array containing "manager" count, and the
// approval flag is accepted on `managerStatus` or `status` so either write style works.
function hasManagerRole(record = {}) {
  const role = String(record.role || '').trim().toLowerCase();
  if (role === 'manager' || role === 'admin') return true;
  const roles = Array.isArray(record.roles) ? record.roles : [];
  return roles.some((value) => String(value || '').trim().toLowerCase() === 'manager');
}

function isApprovedManager(record = {}) {
  const approved = ['managerStatus', 'status']
    .map((key) => String(record[key] || '').trim().toLowerCase())
    .some((value) => value === 'approved' || value === 'active' || value === 'verified');
  return hasManagerRole(record) && approved;
}



function friendlyError(error) {
  const code = error?.code || '';
  const messages = {
    'auth/email-already-in-use': 'Your already have an account.',
    'auth/invalid-credential': 'Account not found. Please create an account first before signing in.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/user-not-found': 'Account not found. Please create an account first before signing in.',
    'auth/wrong-password': 'Account not found. Please create an account first before signing in.',
    'auth/weak-password': 'Password must meet the minimum security requirements.',
    'auth/network-request-failed': 'Network error. Please check your internet connection and try again.',
    'auth/unauthorized-domain': 'This domain is not authorized for Firebase Authentication. Please contact support.',
    'auth/operation-not-allowed': 'Email and password sign-in is not enabled. Please contact support.',
    'auth/configuration-not-found': 'Firebase Authentication is not configured correctly. Please contact support.',
    'permission-denied': 'You do not have permission to access this data.',
    'failed-precondition': 'The Firebase configuration or index is incomplete. Please contact support.',
  };
  return messages[code] || error?.message || 'Something went wrong. Please try again.';
}

function logAuthError(context, error) {
  console.error(`[Auth] ${context}`, {
    code: error?.code || 'unknown',
    message: error?.message || String(error),
    name: error?.name || 'Error',
  });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmailIdentifier(identifier) {
  const email = String(identifier || '').trim();
  if (!email) throw new Error('Please enter your email address.');
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('Please enter a valid email address to sign in.');
  }
  return email;
}

/**
 * Admin sign-in is email-only by policy: a User ID is refused outright, not silently
 * resolved through the manager lookup. The admin area is the highest-privilege surface in
 * the app, so its door is deliberately narrower than every other one — a username that
 * happens to map to an approver account must still be typed as the account's email.
 *
 * Rejecting here (rather than only hiding the field) is what makes the rule real: the
 * lookup below can never be reached with a bare User ID.
 */
function normalizeAdminEmailIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (!value) throw new Error('Please enter your admin email address.');
  if (!EMAIL_PATTERN.test(value)) {
    throw new Error('Admin sign-in requires an email address. User IDs are not accepted here.');
  }
  return value;
}

function isApprovedManagerRecord(record = {}) {
  return isApprovedManager(record);
}

// The 6-digit code and the custom link are generated in the app and emailed
// through EmailJS, so Firebase's default sendEmailVerification is deliberately
// NOT used. The code is kept only for the pending registration in sessionStorage
// and never written to Firestore, so there is nothing to leak from the `users`
// collection.
//
// The code is also stored on the pending session so the verification screen can
// compare what the user types against it.
async function dispatchVerificationEmail(user) {
  const email = String(user?.email || '').trim();
  if (!email) throw new Error('This account has no email address to verify.');

  const code = generateVerificationCode();
  const link = buildVerificationLink({ email, code });

  const pending = JSON.parse(sessionStorage.getItem('pendingVerificationAuth') || 'null') || {};
  sessionStorage.setItem('pendingVerificationAuth', JSON.stringify({
    ...pending,
    email,
    verificationCode: code,
    verificationLink: link,
  }));

  await sendVerificationEmail({ email, code, link });
  return { code, link };
}

function requiresTwoFactor() {
  const error = new Error('Two-factor verification is required for this account.');
  error.requiresTwoFactor = true;
  return error;
}

// 2FA is opt-in: only an account that explicitly turned it on is asked for a code.
async function assertTwoFactorNotRequired(uid) {
  try {
    const snapshot = await getDoc(securitySettingsRef(uid));
    if (snapshot.exists() && snapshot.data()?.twoFactorEnabled === true) {
      throw requiresTwoFactor();
    }
  } catch (error) {
    if (error?.requiresTwoFactor) throw error;
    // A missing subcollection or a read error must not block the normal sign-in.
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True only after Firebase has answered for the very first time AND the role/profile
  // lookup for the signed-in account has finished. `loading` alone flips to false as
  // soon as the auth listener replies, which can still be before the role is known — a
  // route or the sidebar rendered in that window would read `isAdmin` as false and fire
  // click handlers for a menu the user may not have. Every consumer that mounts app
  // chrome must wait for this one instead.
  const [authReady, setAuthReady] = useState(false);
  const [authHint, setAuthHint] = useState('signin');
  // One-shot message shown on the login screen after an automatic sign-out.
  const [sessionNotice, setSessionNotice] = useState('');
  // True once the Firebase action-code has been consumed from a verification link, so the
  // login screen can show the "email verified" panel instead of the plain sign-in form.
  const [linkVerification, setLinkVerification] = useState(null);
  const [usersVersion, setUsersVersion] = useState(0);
  const registrationInProgress = useRef(false);
  const authOperationInProgress = useRef(false);
  const superAdminEmail = (import.meta.env.VITE_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();

  // True when this session holds admin rights, by either signal. The session object uses
  // `role`, and an approver account whose document carries a different role string is
  // still recognised through `isSuperAdmin`.
  const isAdmin = Boolean(user) && (user.isSuperAdmin || user.role === 'admin');

  async function profileFor(firebaseUser) {
    try {
      const snapshot = await getDoc(doc(db, 'users', firebaseUser.uid));
      return snapshot.exists() ? snapshot.data() : {};
    } catch {
      return {};
    }
  }

  // The approver's record of who may use manager access, plus its current state.
  async function managerDirectoryFor(uid) {
    try {
      const snapshot = await getDoc(doc(db, MANAGER_DIRECTORY, uid));
      const data = snapshot.exists() ? snapshot.data() : {};
      return {
        managerStatus: String(data.managerStatus || data.status || '').trim().toLowerCase(),
        hasManagerRole: hasManagerRole(data),
      };
    } catch (error) {
      // A missing directory entry, or a read the rules refused, must never block a
      // normal sign-in — the account simply has no manager access.
      logAuthError('manager directory read failed', error);
      return { managerStatus: '', hasManagerRole: false };
    }
  }

  async function sessionFor(firebaseUser, requestedMode = sessionStorage.getItem('accessMode') || 'general') {
    const profile = await profileFor(firebaseUser);
    const isSuperAdmin = Boolean(profile.isSuperAdmin) || (firebaseUser.email || '').toLowerCase() === superAdminEmail;
    const directory = await managerDirectoryFor(firebaseUser.uid);
    // The approver may have written the role and the approval to the manager directory or
    // to the user's own document, so both are consulted before deciding.
    const managerStatus = String(directory.managerStatus || profile.managerStatus || profile.status || '').trim().toLowerCase();
    const userHasManagerRole = hasManagerRole(profile);
    const isApprovedManager = isApprovedManagerRecord({ ...profile, managerStatus, role: userHasManagerRole ? 'manager' : profile.role });
    // Manager access additionally requires the admin-controlled `status` on the users
    // document to be exactly "approved".
    const userDocApproved = String(profile.status || '').trim().toLowerCase() === 'approved';
    const effectiveStatus = managerStatus || 'approved';
    const accessMode = requestedMode === 'manager' && (isSuperAdmin || (isApprovedManager && userDocApproved)) ? 'manager' : 'general';
    // The *session* role is `admin` for a manager and `viewer` for a general user. This is
    // the flag every data page reads as "may add / edit / delete" — it deliberately says
    // nothing about the admin area, which is gated on the `isSuperAdmin` flag in the
    // stored document instead (see AdminAccessContext). Keeping the two apart is what
    // lets a manager have full data rights and no approval rights at the same time.
    const role = accessMode === 'manager' ? 'admin' : 'viewer';

    return {
      id: firebaseUser.uid,
      email: firebaseUser.email,
      username: profile.username || '',
      profilePicture: profile.profilePicture || '',
      bio: profile.bio || '',
      street: profile.street || '',
      city: profile.city || '',
      zipCode: profile.zipCode || '',
      phone: profile.phone || '',
      role,
      roles: (directory.hasManagerRole || userHasManagerRole) ? ['user', 'manager'] : ['user'],
      status: effectiveStatus,
      verified: firebaseUser.emailVerified || profile.customVerified === true,
      isSuperAdmin,
      accessMode,
    };
  }

  // browserSessionPersistence keeps the auth session across reloads and clears it when
  // the browser tab/session ends. Do not call signOut from beforeunload/pagehide: those
  // events also fire during an ordinary refresh and would incorrectly log the user out.
  //
  // Two independent windows share one set of activity listeners:
  //   - Admin sessions end after 3 minutes of total inactivity.
  //   - Everyone else keeps the long 15 minute window and is never auto-logged-out early.
  // The deadline is recomputed on every event so a mouse movement always buys a full new
  // window, and the timers are torn down whenever the signed-in user changes.
  // The inactivity redirect is a navigation, not just a state change: when the window ends
  // the browser URL is pushed to /login with `replace`, so the guard unmounts the protected
  // tree and the login route mounts immediately. Without it the app can be left sitting on a
  // now-unmounted shell — the blank white screen.
  const endSessionForInactivity = useCallback(() => {
    try {
      sessionStorage.removeItem('accessMode');
      // `replace` so the expired page never becomes a back-button trap.
      if (window.location.pathname !== '/login') {
        window.history.replaceState(null, '', '/login');
      }
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch {
      // A browser that refuses history manipulation still gets a clean state change below.
    }
    setUser(null);
    setAuthHint('signin');
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    let adminDeadline = Date.now() + ADMIN_IDLE_TIMEOUT_MS;
    let generalDeadline = Date.now() + INACTIVITY_TIMEOUT_MS;
    let adminTimer = 0;
    let generalTimer = 0;
    let signedOut = false;

    const clearTimers = () => {
      window.clearTimeout(adminTimer);
      window.clearTimeout(generalTimer);
    };

    // Signs the admin out once, then stops. A second call could race the Firebase
    // listener and clear the notice before the login screen ever reads it.
    const expireAdminSession = () => {
      if (signedOut) return;
      signedOut = true;
      clearTimers();
      endSessionForInactivity();
      signOut(auth).catch(() => {});
    };

    // The general window behaves exactly like the admin one, for the same reason: `user` is
    // dropped immediately so the route guards immediately redirect to /login. Without this
    // the sign-out only completed once Firebase's listener fired, leaving every protected
    // page rendering its (now empty) tree in the meantime — the blank white screen.
    const expireGeneralSession = () => {
      if (signedOut) return;
      signedOut = true;
      clearTimers();
      endSessionForInactivity();
      signOut(auth).catch(() => {});
    };

    // Events are passive so a scroll or pointer move can never block scrolling, and the
    // listener is throttled by the browser: only the deadline write is cheap.
    const markActivity = () => {
      const now = Date.now();
      if (isAdmin) {
        adminDeadline = now + ADMIN_IDLE_TIMEOUT_MS;
        window.clearTimeout(adminTimer);
        adminTimer = window.setTimeout(expireAdminSession, ADMIN_IDLE_TIMEOUT_MS);
      }
      generalDeadline = now + INACTIVITY_TIMEOUT_MS;
      window.clearTimeout(generalTimer);
      generalTimer = window.setTimeout(expireGeneralSession, INACTIVITY_TIMEOUT_MS);
    };

    const events = ['mousemove', 'mousedown', 'click', 'keydown', 'scroll', 'touchstart'];
    events.forEach((name) => window.addEventListener(name, markActivity, { passive: true }));
    markActivity();

    return () => {
      clearTimers();
      events.forEach((name) => window.removeEventListener(name, markActivity));
    };
  }, [user, isAdmin, endSessionForInactivity]);

  useEffect(() => {
    // Wait until browserSessionPersistence is applied before resolving the auth state,
    // otherwise a refresh could briefly be read from local (persistent) storage.
    let active = true;
    let unsubscribeAuthState = () => {};
    let bootstrapTimer = 0;
    // Every exit path funnels through here, so `loading`/`authReady` can never be left
    // stuck true. It only runs while this effect is still mounted, and it is safe to call
    // more than once (a re-fire of the listener just re-sets the same values).
    const settle = () => {
      if (!active) return;
      if (bootstrapTimer) {
        window.clearTimeout(bootstrapTimer);
        bootstrapTimer = 0;
      }
      setLoading(false);
      setAuthReady(true);
    };
    const handleAuthState = async (firebaseUser) => {
      if (!active) return;
      if (!firebaseUser) {
        setUser(null);
        settle();
        return;
      }
      if (registrationInProgress.current || authOperationInProgress.current) {
        setUser(null);
        settle();
        return;
      }
      try {
        const session = await sessionFor(firebaseUser);
        if (!active) return;
        // A manager must be approved regardless of whether the session was restored in
        // general mode or manager mode. General users remain approval-free.
        const managerPending = session.roles?.includes('manager') && session.status !== 'approved';
        if (!session.verified || managerPending) {
          await signOut(auth);
          if (!active) return;
          // `pendingManagerApproval` tells the login screen to say the manager account is
          // awaiting the admin, instead of a bare "verify your email".
          if (managerPending) setSessionNotice(MANAGER_PENDING_MESSAGE);
          setUser(null);
          settle();
          return;
        }
        setUser(session);
      } catch {
        if (!active) return;
        setUser({
          id: firebaseUser.uid,
          email: firebaseUser.email,
          username: '',
          role: 'viewer',
          roles: ['user'],
          status: 'active',
          // Fallback path only (profile read failed). Firebase's flag is a legacy signal
          // now; the real one is `customVerified` on the users document.
          verified: firebaseUser.emailVerified,
        });
      }
      settle();
    };

    // A verification link opened in this browser completes here. Firebase has already
    // marked the address verified at this point; the app only mirrors that flag into
    // the Firestore profile and reports the result to the login screen.
    const handleEmailLink = async () => {
      // `window.location` was previously written as `window.Location`, which is undefined,
      // so this whole branch never ran. Read the URL once, correctly, and guard it: a tab
      // restored by the browser can report no URL at all, and passing that to Firebase
      // throws from inside the check.
      const url = currentUrl();
      if (!active || !isEmailSignInLink(url)) return;
      try {
        const result = await signInWithEmailLink(auth, url);
        if (!active) return;
        window.history.replaceState({}, document.title, '/login');
        await auth.currentUser?.reload();
        const verified = Boolean(auth.currentUser?.emailVerified);
        if (verified && auth.currentUser) {
          await updateDoc(doc(db, 'users', auth.currentUser.uid), { customVerified: true }).catch(() => {});
        }
        const profile = verified && auth.currentUser ? await profileFor(auth.currentUser) : {};
        const isManager = hasManagerRole(profile);
        const status = String(profile.status || '').trim().toLowerCase();
        if (verified && isManager && status !== 'approved') {
          await signOut(auth).catch(() => {});
          setLinkVerification({ kind: 'manager', email: result.user?.email || '', approved: false });
        } else if (verified) {
          await signOut(auth).catch(() => {});
          setLinkVerification({ kind: 'user', email: result.user?.email || '', approved: true });
        } else {
          await signOut(auth).catch(() => {});
          setLinkVerification({ kind: 'failed', email: result.user?.email || '', approved: false });
        }
        setUsersVersion((value) => value + 1);
      } catch {
        // An expired or already-used link must not leave anyone stuck on a blank page.
        if (!active) return;
        window.history.replaceState({}, document.title, '/login');
        setLinkVerification({ kind: 'failed', email: '', approved: false });
      }
    };

    // Register the listener only once persistence has been applied. `settle()` must NOT
    // run here: at this point the listener has merely been attached, and Firebase has not
    // answered yet. Releasing the gate now would render the login screen (or an
    // "unverified" redirect) for a user whose session is about to be restored — the
    // stuck/flashing "Checking your session…" bug. `handleAuthState` settles instead.
    // Hard safety net. `onAuthStateChanged` is not guaranteed to fire: with no persisted
    // session, a blocked/partitioned storage, or a stalled network it can stay silent, and
    // then nothing would ever call `settle()` — which is precisely how a protected URL ends
    // up stuck on "Checking your session…" forever. After this window the gate opens
    // regardless, and the guard shows the sign-in screen instead of a dead spinner.
    bootstrapTimer = window.setTimeout(() => {
      if (!active) return;
      console.warn('[Auth] auth listener did not answer in time; releasing the loading gate.');
      settle();
    }, 8000);

    authPersistenceReady
      .then(() => {
        if (!active) return;
        // The listener is attached FIRST and unconditionally: a failure while reading the
        // URL (the email-link branch) must never be the reason no sign-in is ever heard.
        unsubscribeAuthState = onAuthStateChanged(auth, handleAuthState);
        // Runs after the listener is attached, so the two never race.
        return handleEmailLink();
      })
      .catch((error) => {
        // Persistence failed (blocked storage) or the link could not be consumed: nothing
        // can ever answer, so log it and release the gate rather than leaving the app on
        // the loading screen for ever. The normal sign-in screen is the fallback.
        logAuthError('auth bootstrap failed', error);
        settle();
      })
      .finally(() => {
        // Not `settle()`: that would release the gate before the listener has reported and
        // flash the sign-in screen for a user whose session is about to be restored. The
        // timeout above is the real safety net for a listener that never answers.
      });

    return () => {
      active = false;
      if (bootstrapTimer) window.clearTimeout(bootstrapTimer);
      unsubscribeAuthState();
    };
  }, []);

  async function saveProfile(firebaseUser, data) {
    await setDoc(doc(db, 'users', firebaseUser.uid), data, { merge: true });
  }

  async function updateUserProfile(fields) {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error('Please sign in before editing your profile.');

    const currentEmail = String(firebaseUser.email || '').trim();
    const nextUsername = String(fields.username || '').trim();
    // The email is locked on the profile form, so it always keeps the signed-in address.
    const nextEmail = currentEmail;
    if (!nextEmail) throw new Error('Email address is required.');
    if (!String(fields.phone || '').trim()) throw new Error('Phone number is required.');

    await updateFirebaseProfile(firebaseUser, {
      displayName: nextUsername,
    });

    const profileFields = {
      username: nextUsername,
      email: nextEmail,
      profilePicture: fields.profilePicture || '',
      bio: String(fields.bio || '').trim(),
      street: String(fields.street || '').trim(),
      city: String(fields.city || '').trim(),
      zipCode: String(fields.zipCode || '').trim(),
      phone: String(fields.phone || '').trim(),
    };
    await updateDoc(doc(db, 'users', firebaseUser.uid), profileFields);
    setUser((current) => current ? { ...current, ...profileFields } : current);
    return { emailChanged: false };
  }

  async function requestPasswordChange() {
    const email = String(auth.currentUser?.email || user?.email || '').trim();
    if (!email) throw new Error('No registered email address was found.');
    await sendPasswordResetEmail(auth, email);
  }

  // Used by the Sign In screen's "Forgot Password" link, where no user is signed in yet.
  async function sendPasswordReset(emailAddress) {
    const email = String(emailAddress || '').trim();
    if (!email) throw new Error('Please enter your email address.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email address.');
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      logAuthError('password reset failed', error);
      throw new Error(friendlyError(error));
    }
    return { sent: true };
  }

  async function signup(email, password) {
    registrationInProgress.current = true;
    try {
      const trimmedEmail = email.trim();
      const credential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      sessionStorage.setItem('pendingVerificationAuth', JSON.stringify({
        email: trimmedEmail,
        password,
        kind: 'user',
      }));
      await saveProfile(credential.user, {
        email: credential.user.email,
        role: 'user',
        roles: arrayUnion('user'),
        customVerified: false,
        status: 'active',
        createdAt: new Date(),
      });
      // Our own dispatcher: a 6-digit code + custom link, emailed via EmailJS.
      await dispatchVerificationEmail(credential.user);
      await signOut(auth);
      return { sent: true, email: trimmedEmail };
    } catch (error) {
      if (error?.code !== 'auth/email-already-in-use') {
        logAuthError('general registration failed', error);
      }
      throw new Error(friendlyError(error));
    } finally {
      await signOut(auth).catch(() => {});
      registrationInProgress.current = false;
    }
  }

  async function signupManager(username, email, password) {
    if (password.length < 8 || !/[0-9]/.test(password) || !/[A-Za-z]/.test(password)) {
      throw new Error('Password must be at least 8 characters and include both letters and numbers.');
    }
    const trimmedEmail = email.trim();
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!cleanUsername) throw new Error('Please enter your manager user ID.');
    registrationInProgress.current = true;
    try {
      // Firebase Auth is the authoritative uniqueness check. Never sign in to an
      // existing account during registration or overwrite its role/profile.
      const firebaseUser = (await createUserWithEmailAndPassword(auth, trimmedEmail, password)).user;
      sessionStorage.setItem('pendingVerificationAuth', JSON.stringify({
        email: trimmedEmail,
        password,
        username: cleanUsername,
        kind: 'manager',
      }));
      // Every manager registration starts as "pending"; only the admin can approve it.
      await saveProfile(firebaseUser, {
        username: cleanUsername || (await profileFor(firebaseUser)).username || '',
        email: firebaseUser.email,
        role: 'manager',
        status: 'pending',
        customVerified: false,
        createdAt: new Date(),
      });
      // The manager role is requested through the lookup index, never through the
      // user-writable profile. It stays "pending" until the approver acts on it.
      await setDoc(doc(db, MANAGER_IDS, cleanUsername), {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
      });
      // Our own dispatcher: a 6-digit code + custom link, emailed via EmailJS.
      await dispatchVerificationEmail(firebaseUser);
      await signOut(auth);
      return { sent: true, email: trimmedEmail };
    } catch (error) {
      if (error?.code !== 'auth/email-already-in-use') {
        logAuthError('manager registration failed', error);
      }
      throw new Error(friendlyError(error));
    } finally {
      await signOut(auth).catch(() => {});
      registrationInProgress.current = false;
    }
  }

  async function verifyEmail(code, token, email, password) {
    authOperationInProgress.current = true;
    let firebaseUser = auth.currentUser;
    const pending = JSON.parse(sessionStorage.getItem('pendingVerificationAuth') || 'null');
    const signedInForVerification = !firebaseUser;
    let profileRef;
    let profile;

    try {
      if (!firebaseUser && email && password) {
        firebaseUser = (await signInWithEmailAndPassword(auth, email.trim(), password)).user;
      } else if (!firebaseUser && pending?.email && pending?.password) {
        firebaseUser = (await signInWithEmailAndPassword(auth, pending.email, pending.password)).user;
      }

      // Verification is done against the 6-digit code the app generated for this pending
      // registration (kept in sessionStorage) and emailed through EmailJS. The link in the
      // email carries the same code, so a click verifies the same way. Firebase's own
      // emailVerified flag is not used.
      const verificationEmail = String(email || pending?.email || firebaseUser?.email || '').trim();
      if (!verificationEmail) {
        throw new Error('Enter your email and password to verify your account.');
      }
      const storedCode = pending?.verificationCode;
      const result = confirmVerificationCode({ code: code || token, storedCode });
      if (!result.verified) {
        throw new Error(result.error || 'That code is not correct. Please try again.');
      }
      // The code matched, so sign in to write the verified flag on the profile below.
      if (!firebaseUser) {
        const credentials = password || pending?.password;
        if (!credentials) {
          throw new Error('Enter your email and password to verify your account.');
        }
        firebaseUser = (await signInWithEmailAndPassword(auth, verificationEmail, credentials)).user;
      }

      profileRef = doc(db, 'users', firebaseUser.uid);
      const profileSnapshot = await getDoc(profileRef);
      profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
      // The backend has accepted the code, so record the account as verified in the app's
      // own document. `customVerified` is now the source of truth; the code and token were
      // never written here in the first place.
      await updateDoc(profileRef, { customVerified: true, verificationCode: null, verificationToken: null });
      sessionStorage.removeItem('pendingVerificationAuth');
      if (signedInForVerification) await signOut(auth);
      setUsersVersion((value) => value + 1);
      const verifiedRole = String(profile.role || '').trim().toLowerCase();
      const isManager = verifiedRole === 'manager'
        || profile.roles?.includes('manager')
        || profile.managerStatus === 'pending'
        || profile.managerStatus === 'approved';
      return { kind: isManager ? 'manager' : 'user', role: isManager ? 'manager' : 'user' };
    } finally {
      authOperationInProgress.current = false;
    }
  }

  /**
   * Re-sends the verification email through our own backend. Used by the "Resend"
   * button on the verify step.
   */
  async function resendVerification(email, password) {
    const address = String(email || pendingVerificationEmail() || '').trim();
    if (!address) throw new Error('Please enter your email address.');
    const current = auth.currentUser;
    if (!current && password) {
      await signInWithEmailAndPassword(auth, address, password);
    }
    const target = auth.currentUser;
    if (!target || String(target.email || '').toLowerCase() !== address.toLowerCase()) {
      if (target) await signOut(auth).catch(() => {});
      throw new Error('Could not verify that account. Check your email and password.');
    }
    await dispatchVerificationEmail(target);
    await signOut(auth).catch(() => {});
    return { sent: true, email: address };
  }

  function pendingVerificationEmail() {
    const pending = JSON.parse(sessionStorage.getItem('pendingVerificationAuth') || 'null');
    return pending?.email || '';
  }

  async function login(identifier, password) {
    authOperationInProgress.current = true;
    try {
      sessionStorage.setItem('accessMode', 'general');
      const email = normalizeEmailIdentifier(identifier);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const profile = await profileFor(credential.user);
      // The general sign-in at `/` is the standard entry point. Set before any throw so a
      // later retry cannot inherit a stale 'admin' marker from an earlier admin sign-in.
      sessionStorage.setItem(LOGIN_ENTRY_KEY, LOGIN_ENTRY_STANDARD);
      // `customVerified` is written by our own verification flow, so it is the source of
      // truth. Firebase's `emailVerified` is still accepted for any legacy account that
      // was verified before the backend took over.
      if (profile.customVerified !== true && !credential.user.emailVerified) {
        await signOut(auth);
        window.alert('Please verify your email first');
        throw new Error('Please verify your email first');
      }
      // An approved manager may use this General User form, but a pending/rejected
      // manager may not bypass the approval gate through it.
      const isManagerAccount = hasManagerRole(profile);
      const managerStatus = String(profile.status || '').trim().toLowerCase();
      if (isManagerAccount && managerStatus !== 'approved') {
        await signOut(auth);
        window.alert(MANAGER_PENDING_MESSAGE);
        throw new Error(MANAGER_PENDING_MESSAGE);
      }
      // Pauses here when 2FA is on; the login screen collects the code and retries.
      await assertTwoFactorNotRequired(credential.user.uid);
      setUser(await sessionFor(credential.user, 'general'));
    } catch (error) {
      logAuthError('general sign-in failed', error);
      const generalMessage = String(error?.message || '');
      if (generalMessage.includes('Please verify') || generalMessage.includes('valid email address')) throw error;
      // The login screen uses this flag to show the 2FA prompt instead of an error.
      if (error?.requiresTwoFactor) throw error;
      if (error?.code === 'auth/user-not-found' || error?.code === 'auth/invalid-credential') {
        throw new Error('Account not found. Please create an account first before signing in.');
      }
      throw new Error(friendlyError(error));
    } finally {
      authOperationInProgress.current = false;
    }
  }

  // Resolve a manager username only through the public lookup index. Never query the
  // users collection before authentication: that would be both unsafe and rejected by
  // the Firestore rules.
  async function resolveManagerAccount(raw) {
    const cleanUserId = raw.toLowerCase();
    const lookupSnapshot = await getDoc(doc(db, MANAGER_IDS, cleanUserId));
    if (!lookupSnapshot.exists()) return { lookup: null, email: '' };
    const lookup = { ...lookupSnapshot.data(), userId: cleanUserId };
    return { lookup, email: String(lookup.email || '').trim() };
  }

  async function loginManager(identifier, password) {
    const raw = String(identifier || '').trim();
    if (!raw) throw new Error('Please enter your manager user ID.');
    // The identifier is either the manager User ID or the account's email address.
    const identifierIsEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);

    authOperationInProgress.current = true;
    try {
      // A direct document read, not a query: the lookup has to work before any
      // credential exists, so it can only rely on the publicly readable collection.
      // When the identifier is a User ID the index is tried first, then the user
      // collection; when it is an email the index is skipped and the role is resolved
      // from the account's own Firestore documents instead.
      let lookup = null;
      let resolvedEmail = identifierIsEmail ? raw : '';
      if (!identifierIsEmail) {
        ({ lookup, email: resolvedEmail } = await resolveManagerAccount(raw));
        if (!lookup) {
          console.log(`No manager user ID found: ${raw}`);
          throw new Error('Manager account not found. Please check your user ID or create an account first.');
        }
      }
      if (!resolvedEmail) {
        throw new Error('No email is associated with this manager user ID.');
      }
      const credential = await signInWithEmailAndPassword(auth, resolvedEmail, password);
      const uid = credential.user.uid;
      const [directorySnapshot, userSnapshot] = await Promise.all([
        getDoc(doc(db, MANAGER_DIRECTORY, uid)),
        getDoc(doc(db, USERS_COLLECTION, uid)),
      ]);
      const directory = directorySnapshot.exists() ? directorySnapshot.data() : {};
      const userDoc = userSnapshot.exists() ? userSnapshot.data() : {};
      // The user document wins: it is the record an admin edits when approving, and it is
      // the one that carries role / roles / managerStatus.
      const profile = { ...(lookup || {}), ...directory, ...userDoc };
      const customVerified = profile.customVerified === true;
      const status = String(profile.status || '').trim().toLowerCase();
      const managerStatus = String(profile.managerStatus || '').trim().toLowerCase();
      const managerRoleFound = hasManagerRole(profile);
      const approved = isApprovedManager(profile);
      console.debug('[Auth] manager profile found', {
        documentId: uid,
        email: resolvedEmail,
        role: profile.role,
        roles: profile.roles,
        status,
        managerStatus,
        managerRoleFound,
        approved,
      });
      if (identifierIsEmail && !managerRoleFound) {
        await signOut(auth);
        throw new Error('This account is not registered for Manager Access.');
      }
      if (!credential.user.emailVerified && customVerified !== true) {
        await signOut(auth);
        throw new Error('Please verify your email before signing in to Manager Access.');
      }
      // The users document must be explicitly approved by the admin. "pending",
      // "rejected", missing, or any other value blocks access. The super admin is exempt
      // so the approver can never be locked out.
      const userDocStatus = String(userDoc.status || '').trim().toLowerCase();
      // Manager Access always requires an explicitly approved users document. This
      // check intentionally applies to every manager account, including admins.
      if (userDocStatus !== 'approved') {
        await signOut(auth);
        window.alert(MANAGER_PENDING_MESSAGE);
        throw new Error(MANAGER_PENDING_MESSAGE);
      }
      sessionStorage.setItem('accessMode', 'manager');
      // This is the standard sign-in path, so the visitor's intent is "manager dashboard".
      // `loginAdmin` overwrites it with 'admin' AFTER its role check passes, which is what
      // keeps the two entry points from being confused for one another.
      sessionStorage.setItem(LOGIN_ENTRY_KEY, LOGIN_ENTRY_STANDARD);
      await assertTwoFactorNotRequired(credential.user.uid);
      setUser(await sessionFor(credential.user, 'manager'));
    } catch (error) {
      logAuthError('manager sign-in failed', error);
      // The login screen uses this flag to show the 2FA prompt instead of an error.
      if (error?.requiresTwoFactor) throw error;
      // Coerce first, then probe with optional chaining: a thrown non-Error (or an Error
      // with no message) would otherwise blow up here with
      // "Cannot read properties of undefined (reading 'indexOf')".
      const managerMessage = String(error?.message || '');
      const mentionsManagerContext =
        managerMessage?.indexOf('Manager') !== -1
        || managerMessage?.indexOf('manager') !== -1
        || managerMessage?.indexOf('verify') !== -1
        || managerMessage?.indexOf('pending') !== -1
        || managerMessage?.indexOf('Account not found') !== -1;
      if (mentionsManagerContext) {
        throw error;
      }
      throw new Error(friendlyError(error));
    } finally {
      authOperationInProgress.current = false;
    }
  }

  // Signs the user out and sends them to the sign-in page. Every signed-out visitor must
  // end up on /login, so the redirect is done here rather than left to each caller.
  //
  // A full navigation (assign) is used instead of `history.replaceState` + a synthetic
  // `popstate`: the latter left the app shell mounted at the old URL for one render pass
  // with `user` already null, which is what produced
  // "Cannot read properties of null (reading 'username')". A real navigation discards
  // that state entirely and cannot race the sign-out.
  async function logout(hint = 'signin') {
    // A deliberate sign-out has no "session expired" reason to show.
    setSessionNotice('');
    setLinkVerification(null);
    setAuthHint(hint);
    try {
      await signOut(auth);
    } catch (error) {
      logAuthError('sign-out failed', error);
    }
    sessionStorage.removeItem('accessMode');
    sessionStorage.removeItem(LOGIN_ENTRY_KEY);
    sessionStorage.removeItem('pendingVerificationAuth');
    // Already on the sign-in screen: nothing to navigate to, the cleared session is enough.
    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  }
  async function pendingManagers() {
    try {
      // Every manager is indexed in managerIds, so the pending list can be built by
      // reading the directory alone — no access to other people's profiles needed.
      const idsSnapshot = await getDocs(collection(db, MANAGER_IDS));
      const pending = [];
      for (const idDoc of idsSnapshot.docs) {
        const lookup = idDoc.data();
        const uid = String(lookup.uid || '').trim();
        if (!uid) continue;
        const directory = await managerDirectoryFor(uid);
        if (directory.hasManagerRole && directory.managerStatus === 'pending') {
          pending.push({
            id: uid,
            username: idDoc.id,
            email: lookup.email || '',
          });
        }
      }
      return pending;
    } catch (error) {
      logAuthError('pending managers list failed', error);
      return [];
    }
  }

  // Writes the decision to both records atomically: `users/{uid}.status` (checked at
  // manager sign-in) and `managerDirectory/{uid}` (checked by the Firestore rules for
  // manager data access). Only the super admin is allowed to write either.
  async function setManagerStatus(id, status) {
    const uid = String(id || '').trim();
    if (!uid) throw new Error('Manager account not found.');
    const batch = writeBatch(db);
    batch.update(doc(db, USERS_COLLECTION, uid), { status });
    batch.set(doc(db, MANAGER_DIRECTORY, uid), {
      uid,
      role: 'manager',
      status,
      managerStatus: status,
      reviewedAt: new Date(),
    }, { merge: true });
    await batch.commit();
    setUsersVersion((value) => value + 1);
  }

  async function approveManager(id) {
    try {
      await setManagerStatus(id, 'approved');
      if (user?.id === id) {
        setUser((current) => current ? { ...current, status: 'approved', role: 'admin' } : current);
      }
    } catch (error) {
      logAuthError('manager approval failed', error);
      throw new Error('Manager approval failed. Try again.');
    }
  }

  async function rejectManager(id) {
    try {
      await setManagerStatus(id, 'rejected');
    } catch (error) {
      logAuthError('manager rejection failed', error);
      throw new Error('Manager rejection failed. Try again.');
    }
  }

  /* ---------------- Approvals: role + status from the admin table ---------------- */

  // The users document is the record the admin table edits and the single source of truth
  // for both the session and the guard, so a decision is written there and mirrored into
  // the manager directory in a single atomic batch. A partial write could leave a manager
  // approved in one place and pending in the other.
  //
  // `role`    'manager' -> full data-entry rights | 'user' -> view-only account
  // `status`  'approved' | 'pending' | 'rejected'
  // `deleteRecord` removes the account instead of marking it rejected.
  //
  // The written role is the literal string 'manager', never 'admin'. AuthContext maps a
  // manager to the *session* role `admin` when building its session, but the stored
  // document must not say `admin`: the approval table would then be reading `role` and
  // could not tell a manager (who must stay out of /admin) from an approver account.
  async function setUserAccess(id, { role, status, deleteRecord = false } = {}) {
    const uid = String(id || '').trim();
    if (!uid) throw new Error('Account not found.');
    if (uid === user?.id) throw new Error('You cannot change your own access from this table.');

    const userRef = doc(db, USERS_COLLECTION, uid);

    // A delete removes every trace of the account so a rejected applicant cannot be
    // re-approved by simply signing up again with the same email.
    if (deleteRecord) {
      const batch = writeBatch(db);
      batch.delete(userRef);
      batch.delete(doc(db, MANAGER_DIRECTORY, uid));
      // The lookup index is keyed by user ID, so the entry has to be found by value first.
      const idsSnapshot = await getDocs(collection(db, MANAGER_IDS));
      for (const idDoc of idsSnapshot.docs) {
        if (String(idDoc.data().uid || '').trim() === uid) batch.delete(idDoc.ref);
      }
      await batch.commit();
      setUsersVersion((value) => value + 1);
      return { deleted: true };
    }

    const nextRole = role === 'manager' ? 'manager' : 'user';
    const nextStatus = ['approved', 'pending', 'rejected'].includes(status) ? status : 'pending';
    // The ERP side of the same decision: an approved manager is a production_manager (the
    // same role the Employee Management dropdown grants), everyone else gets none. Writing
    // the empty array on a demotion is what revokes the ERP access they previously held.
    const nextErpRoles = nextRole === 'manager' && nextStatus === 'approved' ? ['production_manager'] : [];
    const batch = writeBatch(db);

    // `set` with merge rather than `update`: the target document is created if it does not
    // exist yet, so an approval never fails on a missing record.
    batch.set(userRef, {
      role: nextRole,
      roles: nextRole === 'manager' ? ['user', 'manager'] : ['user'],
      erpRoles: nextErpRoles,
      status: nextStatus,
      managerStatus: nextStatus,
      updatedAt: new Date(),
    }, { merge: true });
    batch.set(doc(db, MANAGER_DIRECTORY, uid), {
      uid,
      role: nextRole === 'manager' ? 'manager' : 'user',
      erpRoles: nextErpRoles,
      status: nextStatus,
      managerStatus: nextStatus,
      reviewedAt: new Date(),
    }, { merge: true });

    await batch.commit();
    setUsersVersion((value) => value + 1);

    return { role: nextRole, status: nextStatus };
  }

  // Convenience wrappers used by the buttons in the admin table.
  async function approveAsManager(id) {
    return setUserAccess(id, { role: 'manager', status: 'approved' });
  }

  async function approveAsViewer(id) {
    return setUserAccess(id, { role: 'user', status: 'approved' });
  }

  async function rejectUser(id) {
    return setUserAccess(id, { role: 'user', status: 'rejected' });
  }

  async function deleteUser(id) {
    return setUserAccess(id, { deleteRecord: true });
  }

  function getLiveStatus(id) {
    if (!id) return null;
    if (user?.id === id) return user.status;
    return null;
  }

  /**
   * Sign-in used exclusively by /admin/login.
   *
   * It never trusts the caller's intent: after the credentials are accepted, the role is
   * re-read directly from `users/{uid}` — the same document the guard reads — and the
   * session is torn down again if that record does not name an approver account. That is
   * what stops a manager from reaching the admin area through this form. Returns the
   * session so the caller can open the admin tab session.
   */
  async function loginAdmin(identifier, password) {
    // Email-only, enforced before anything else. A User ID is refused here rather than
    // being resolved through the manager lookup, so the admin door can never be opened
    // with a username even if that username belongs to an approver account.
    const adminEmail = normalizeAdminEmailIdentifier(identifier);
    await loginManager(adminEmail, password);
    const uid = auth.currentUser?.uid;
    let adminSession = null;
    if (uid) {
      // Both records are read, because the role can legitimately live on either one: the
      // Employee Management dropdown and the approval table write `managerDirectory/{uid}`
      // (the authoritative role record the guards read), while `users/{uid}` is what an
      // older/hand-promoted approver carries. A read that fails is a DENIAL, never a pass.
      const [userSnapshot, directorySnapshot] = await Promise.all([
        getDoc(doc(db, USERS_COLLECTION, uid)).catch(() => null),
        getDoc(doc(db, MANAGER_DIRECTORY, uid)).catch(() => null),
      ]);
      const userDoc = userSnapshot?.exists() ? userSnapshot.data() : null;
      const directory = directorySnapshot?.exists() ? directorySnapshot.data() : null;
      // `isElevatedRecord` is the same predicate the admin guard uses, so the sign-in and
      // the guard agree by construction instead of by two separate re-implementations.
      if (isElevatedRecord(userDoc) || isElevatedRecord(directory)) {
        adminSession = await sessionFor(auth.currentUser, 'manager');
      }
    }
    // Only record the admin entry once the role check has actually passed, so a rejected
    // attempt leaves the session on the standard landing rather than claiming admin intent.
    if (adminSession) {
      sessionStorage.setItem(LOGIN_ENTRY_KEY, LOGIN_ENTRY_ADMIN);
    }
    if (!adminSession || !(adminSession.isSuperAdmin || adminSession.role === 'admin')) {
      // Belt and braces: a non-admin that slipped past the manager checks above is
      // signed out here rather than being handed a session.
      await signOut(auth).catch(() => {});
      sessionStorage.removeItem('accessMode');
      setUser(null);
      throw new Error('This account does not have administrator access.');
    }
    return adminSession;
  }

  /**
   * The standard sign-in at `/`, accepting EITHER an email address or a User ID.
   *
   * This is the single entry point the login screen calls, so a person never has to know in
   * advance which kind of account they hold:
   *   - an email goes through the ordinary account path (`login`), and
   *   - anything else is treated as a User ID and resolved through the manager lookup
   *     (`loginManager`), which is also what gives a manager their Manager Dashboard.
   *
   * The email test is the same one the admin gate uses, so "looks like an email" means the
   * same thing everywhere in the app.
   */
  async function loginWithIdentifier(identifier, password) {
    const raw = String(identifier || '').trim();
    if (!raw) throw new Error('Please enter your email address or User ID.');
    if (EMAIL_PATTERN.test(raw)) return login(raw, password);
    return loginManager(raw, password);
  }

  // Dismissed once the login screen has shown the notice, so it cannot reappear on a
  // later reload.
  function clearSessionNotice() {
    setSessionNotice('');
  }

  // Cleared once the login screen has consumed the verification-link result, so a later
  // reload starts from the ordinary sign-in form.
  function clearLinkVerification() {
    setLinkVerification(null);
  }

  return (
    <AuthContext.Provider value={{
      user, loading, authReady, authHint, usersVersion,
      // `isAdmin` is the single role check every consumer (router, sidebar, idle timer)
      // should use, so the two admin signals can never disagree between components.
      isAdmin, sessionNotice, clearSessionNotice, linkVerification, clearLinkVerification,
      signup, signupManager, verifyEmail, resendVerification, login, loginManager, loginAdmin, loginWithIdentifier, logout,
      updateUserProfile, requestPasswordChange, sendPasswordReset,
      pendingManagers, approveManager, rejectManager, getLiveStatus,
      setUserAccess, approveAsManager, approveAsViewer, rejectUser, deleteUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }

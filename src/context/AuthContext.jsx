import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import emailjs from '@emailjs/browser';
import { auth, authPersistenceReady, db } from '../firebase';
import { securitySettingsRef } from '../utils/security';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
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
  query,
  setDoc,
  updateDoc,
  where,
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
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

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

function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function genToken() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

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

function normalizeEmailIdentifier(identifier) {
  const email = String(identifier || '').trim();
  if (!email) throw new Error('Please enter your email address.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address to sign in.');
  }
  return email;
}

function isApprovedManagerRecord(record = {}) {
  return isApprovedManager(record);
}

async function sendVerificationCode(email, code, verificationLink) {
  await emailjs.send(
    import.meta.env.VITE_EMAILJS_SERVICE_ID,
    import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
    {
      email,
      passcode: code,
      verificationCode: code,
      verification_link: verificationLink,
      verificationLink,
    },
    import.meta.env.VITE_EMAILJS_PUBLIC_KEY
  );
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
  const [authHint, setAuthHint] = useState('signin');
  const [usersVersion, setUsersVersion] = useState(0);
  const registrationInProgress = useRef(false);
  const authOperationInProgress = useRef(false);
  const superAdminEmail = (import.meta.env.VITE_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();

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
    const effectiveStatus = managerStatus || (isSuperAdmin ? 'approved' : 'approved');
    const accessMode = requestedMode === 'manager' && (isSuperAdmin || (isApprovedManager && userDocApproved)) ? 'manager' : 'general';
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
  useEffect(() => {
    let lastActivity = Date.now();
    let timer;
    const markActivity = () => { lastActivity = Date.now(); };
    const checkInactivity = () => {
      if (auth.currentUser && Date.now() - lastActivity >= INACTIVITY_TIMEOUT_MS) {
        signOut(auth).catch(() => {});
        return;
      }
      timer = window.setTimeout(checkInactivity, 60 * 1000);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));
    timer = window.setTimeout(checkInactivity, 60 * 1000);
    return () => {
      window.clearTimeout(timer);
      events.forEach((eventName) => window.removeEventListener(eventName, markActivity));
    };
  }, []);

  useEffect(() => {
    // Wait until browserSessionPersistence is applied before resolving the auth state,
    // otherwise a refresh could briefly be read from local (persistent) storage.
    let active = true;
    let unsubscribeAuthState = () => {};
    const handleAuthState = async (firebaseUser) => {
      if (!active) return;
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }
      if (registrationInProgress.current || authOperationInProgress.current) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const session = await sessionFor(firebaseUser);
        // A manager must be approved regardless of whether the session was restored in
        // general mode or manager mode. General users remain approval-free.
        const managerPending = session.roles?.includes('manager') && session.status !== 'approved';
        if (!session.verified || managerPending) {
          await signOut(auth);
          setUser(null);
          setLoading(false);
          return;
        }
        setUser(session);
      } catch {
        setUser({
          id: firebaseUser.uid,
          email: firebaseUser.email,
          username: '',
          role: 'viewer',
          roles: ['user'],
          status: 'active',
          verified: firebaseUser.emailVerified,
        });
      }
      setLoading(false);
    };
    authPersistenceReady.then(() => {
      if (!active) return;
      unsubscribeAuthState = onAuthStateChanged(auth, handleAuthState);
    });
    return () => {
      active = false;
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
      const code = genCode();
      const token = genToken();
      const link = `${window.location.origin}${window.location.pathname}?verify=${token}&email=${encodeURIComponent(trimmedEmail)}`;
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
        verificationCode: code,
        verificationToken: token,
        status: 'active',
        createdAt: new Date(),
      });
      await sendVerificationCode(trimmedEmail, code, link);
      await signOut(auth);
      return { sent: true };
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
      const code = genCode();
      const token = genToken();
      const link = `${window.location.origin}${window.location.pathname}?verify=${token}&email=${encodeURIComponent(trimmedEmail)}`;
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
        verificationCode: code,
        verificationToken: token,
        createdAt: new Date(),
      });
      // The manager role is requested through the lookup index, never through the
      // user-writable profile. It stays "pending" until the approver acts on it.
      await setDoc(doc(db, MANAGER_IDS, cleanUsername), {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
      });
      await sendVerificationCode(trimmedEmail, code, link);
      await signOut(auth);
      return { sent: true };
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
        firebaseUser = (await signInWithEmailAndPassword(auth, pending.email.trim(), pending.password)).user;
      }

      if (token && !firebaseUser) {
      const tokenSnapshot = await getDocs(query(
        collection(db, 'users'),
        where('verificationToken', '==', token)
      ));
      const tokenDoc = tokenSnapshot.docs[0];
      if (!tokenDoc) throw new Error('Invalid or expired verification link.');
      profileRef = tokenDoc.ref;
      profile = tokenDoc.data();
      } else {
        if (!firebaseUser) throw new Error('Enter your email and password to verify your account.');
        profileRef = doc(db, 'users', firebaseUser.uid);
        const profileSnapshot = await getDoc(profileRef);
        if (!profileSnapshot.exists()) throw new Error('Account profile not found. Please create an account first.');
        profile = profileSnapshot.data();
      }

      if (token && profile.verificationToken !== token) throw new Error('Invalid verification link.');
      if (!token && String(profile.verificationCode) !== String(code).trim()) throw new Error('Incorrect verification code.');
      await updateDoc(profileRef, { customVerified: true, verificationCode: null, verificationToken: null });
      sessionStorage.removeItem('pendingVerificationAuth');
      if (firebaseUser) {
        await firebaseUser.reload();
        if (signedInForVerification) await signOut(auth);
      }
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

  async function login(identifier, password) {
    authOperationInProgress.current = true;
    try {
      sessionStorage.setItem('accessMode', 'general');
      const email = normalizeEmailIdentifier(identifier);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const profile = await profileFor(credential.user);
      if (!credential.user.emailVerified && profile.customVerified !== true) {
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
      if (error.message.includes('Please verify') || error.message.includes('valid email address')) throw error;
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
      await assertTwoFactorNotRequired(credential.user.uid);
      setUser(await sessionFor(credential.user, 'manager'));
    } catch (error) {
      logAuthError('manager sign-in failed', error);
      // The login screen uses this flag to show the 2FA prompt instead of an error.
      if (error?.requiresTwoFactor) throw error;
      if (error.message.includes('Manager') || error.message.includes('manager') || error.message.includes('verify') || error.message.includes('pending') || error.message.includes('Account not found')) {
        throw error;
      }
      throw new Error(friendlyError(error));
    } finally {
      authOperationInProgress.current = false;
    }
  }

  async function logout(hint = 'signin') {
    await signOut(auth);
    sessionStorage.removeItem('accessMode');
    setAuthHint(hint);
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

  function getLiveStatus(id) {
    if (!id) return null;
    if (user?.id === id) return user.status;
    return null;
  }

  return (
    <AuthContext.Provider value={{
      user, loading, authHint, usersVersion,
      signup, signupManager, verifyEmail, login, loginManager, logout,
      updateUserProfile, requestPasswordChange, sendPasswordReset,
      pendingManagers, approveManager, rejectManager, getLiveStatus,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }

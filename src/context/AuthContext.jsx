import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import emailjs from '@emailjs/browser';
import { auth, db } from '../firebase';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const AuthContext = createContext(null);

function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function genToken() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function friendlyError(error) {
  const code = error?.code || '';
  const messages = {
    'auth/email-already-in-use': 'এই email দিয়ে account আছে। একই password দিয়ে Manager role যোগ করুন।',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/invalid-email': 'সঠিক email address দিন।',
    'auth/user-not-found': 'Invalid email or password.',
    'auth/wrong-password': 'Invalid email or password.',
    'auth/weak-password': 'Password কমপক্ষে ৬ অক্ষরের হতে হবে।',
    'auth/network-request-failed': 'Internet connection পরীক্ষা করে আবার চেষ্টা করুন।',
    'auth/unauthorized-domain': 'এই live domain Firebase Authentication-এ authorized করা হয়নি। Firebase Console-এর Authorized domains-এ domain যোগ করুন।',
    'auth/operation-not-allowed': 'Firebase Console-এ Email/Password sign-in provider চালু করুন।',
    'auth/configuration-not-found': 'Firebase Authentication configuration পাওয়া যায়নি। Production Firebase project configuration পরীক্ষা করুন।',
    'permission-denied': 'Firestore users query অনুমোদিত নয়। Firestore Rules-এ authenticated users-এর users collection read permission দিন।',
    'failed-precondition': 'Firestore configuration বা index সমস্যা হয়েছে। Firebase Console পরীক্ষা করুন।',
  };
  return messages[code] || error?.message || 'কাজটি সম্পন্ন করা যায়নি। আবার চেষ্টা করুন।';
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
  if (!email) throw new Error('Email address লিখুন।');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Sign in করতে actual email address দিন। Username দিয়ে login করা যায় না।');
  }
  return email;
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

  async function sessionFor(firebaseUser, requestedMode = sessionStorage.getItem('accessMode') || 'general') {
    const profile = await profileFor(firebaseUser);
    const isSuperAdmin = Boolean(profile.isSuperAdmin) || (firebaseUser.email || '').toLowerCase() === superAdminEmail;
    const status = String(profile.status || '').trim().toLowerCase();
    const managerStatus = String(profile.managerStatus || '').trim().toLowerCase();
    const hasManagerRole = profile.roles?.some((role) => String(role).trim().toLowerCase() === 'manager')
      || String(profile.role || '').trim().toLowerCase() === 'manager';
    const isApprovedManager = hasManagerRole && (status === 'approved' || managerStatus === 'approved');
    const effectiveStatus = status === 'approved' || managerStatus === 'approved'
      ? 'approved'
      : managerStatus || status || 'approved';
    const accessMode = requestedMode === 'manager' && (isSuperAdmin || isApprovedManager) ? 'manager' : 'general';
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
      roles: profile.roles || ['user'],
      status: effectiveStatus,
      verified: firebaseUser.emailVerified || profile.customVerified === true,
      isSuperAdmin,
      accessMode,
    };
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
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
        const managerPending = session.accessMode === 'manager' && session.roles?.includes('manager') && session.status !== 'approved';
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
    });
    return unsubscribe;
  }, []);

  async function saveProfile(firebaseUser, data) {
    await setDoc(doc(db, 'users', firebaseUser.uid), data, { merge: true });
  }

  async function updateUserProfile(fields) {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error('Please sign in before editing your profile.');

    const nextEmail = String(fields.email || '').trim();
    const currentEmail = String(firebaseUser.email || '').trim();
    const nextUsername = String(fields.username || '').trim();
    if (!nextEmail) throw new Error('Email address is required.');
    if (!String(fields.phone || '').trim()) throw new Error('Phone number is required.');

    if (nextEmail !== currentEmail) {
      await updateEmail(firebaseUser, nextEmail);
      await sendEmailVerification(firebaseUser);
    }

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
      ...(nextEmail !== currentEmail ? { customVerified: false } : {}),
    };
    await updateDoc(doc(db, 'users', firebaseUser.uid), profileFields);
    setUser((current) => current ? { ...current, ...profileFields } : current);
    return { emailChanged: nextEmail !== currentEmail };
  }

  async function requestPasswordChange() {
    const email = String(auth.currentUser?.email || user?.email || '').trim();
    if (!email) throw new Error('No registered email address was found.');
    await sendPasswordResetEmail(auth, email);
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
      logAuthError('general registration failed', error);
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
    if (!cleanUsername) throw new Error('Manager User ID লিখুন।');
    registrationInProgress.current = true;
    try {
      let firebaseUser;
      try {
        firebaseUser = (await createUserWithEmailAndPassword(auth, trimmedEmail, password)).user;
      } catch (error) {
        if (error.code !== 'auth/email-already-in-use') throw new Error(friendlyError(error));
        try {
          firebaseUser = (await signInWithEmailAndPassword(auth, trimmedEmail, password)).user;
        } catch {
          throw new Error('এই email-এর account আছে, কিন্তু password মিলছে না। একই password ব্যবহার করুন।');
        }
      }
      const code = genCode();
      const token = genToken();
      const link = `${window.location.origin}${window.location.pathname}?verify=${token}&email=${encodeURIComponent(trimmedEmail)}`;
      sessionStorage.setItem('pendingVerificationAuth', JSON.stringify({
        email: trimmedEmail,
        password,
        username: cleanUsername,
        kind: 'manager',
      }));
      await saveProfile(firebaseUser, {
        email: firebaseUser.email,
        username: cleanUsername || (await profileFor(firebaseUser)).username || '',
        role: 'manager',
        roles: arrayUnion('manager'),
        managerStatus: 'pending'.trim(),
        status: 'pending'.trim(),
        customVerified: false,
        verificationCode: code,
        verificationToken: token,
        createdAt: new Date(),
      });
      await sendVerificationCode(trimmedEmail, code, link);
      await signOut(auth);
      return { sent: true };
    } catch (error) {
      logAuthError('manager registration failed', error);
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
        if (!firebaseUser) throw new Error('Code verify করতে email ও password দিন।');
        profileRef = doc(db, 'users', firebaseUser.uid);
        const profileSnapshot = await getDoc(profileRef);
        if (!profileSnapshot.exists()) throw new Error('Account profile পাওয়া যায়নি।');
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
      return { kind: profile.roles?.includes('manager') ? 'manager' : 'user' };
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
      setUser(await sessionFor(credential.user, 'general'));
    } catch (error) {
      logAuthError('general sign-in failed', error);
      if (error.message.includes('verify করুন') || error.message.includes('actual email address')) throw error;
      if (error?.code === 'auth/user-not-found' || error?.code === 'auth/invalid-credential') {
        throw new Error('Invalid email or password.');
      }
      throw new Error(friendlyError(error));
    } finally {
      authOperationInProgress.current = false;
    }
  }

  async function loginManager(identifier, password) {
    const cleanUserId = String(identifier || '').trim().toLowerCase();
    if (!cleanUserId) throw new Error('Manager User ID লিখুন।');

    authOperationInProgress.current = true;
    try {
      const q = query(
        collection(db, 'users'),
        where('username', '==', cleanUserId)
      );
      const managerSnapshot = await getDocs(q);
      if (managerSnapshot.empty) {
        console.log(`No user found with username: ${cleanUserId}`);
        throw new Error('এই User ID দিয়ে Manager Access তৈরি করা হয়নি।');
      }
      const managerDoc = managerSnapshot.docs.find((item) => {
        const profile = item.data();
        const role = String(profile.role || '').trim().toLowerCase();
        const roles = profile.roles?.map((itemRole) => String(itemRole).trim().toLowerCase()) || [];
        return role === 'manager' || roles.includes('manager');
      });
      if (!managerDoc) {
        console.error('[Auth] manager User ID not found', {
          username: cleanUserId,
          matchedDocuments: managerSnapshot.size,
        });
        throw new Error('এই User ID দিয়ে Manager Access তৈরি করা হয়নি।');
      }

      const profile = managerDoc.data();
      const status = String(profile.status || '').trim().toLowerCase();
      const managerStatus = String(profile.managerStatus || '').trim().toLowerCase();
      const userEmail = String(profile.email || '').trim();
      console.debug('[Auth] manager profile found', {
        documentId: managerDoc.id,
        email: userEmail,
        role: profile.role,
        status,
        managerStatus,
      });
      if (!userEmail) {
        console.error('[Auth] manager profile has no email', { documentId: managerDoc.id, profile });
        throw new Error('Manager account profile-এ email পাওয়া যায়নি।');
      }
      const credential = await signInWithEmailAndPassword(auth, userEmail, password);
      if (!credential.user.emailVerified && profile.customVerified !== true) {
        await signOut(auth);
        throw new Error('আগে আপনার email verify করুন, তারপর Manager Sign In করুন।');
      }
      if (status !== 'approved' && managerStatus !== 'approved') {
        await signOut(auth);
        window.alert('Your manager account is pending admin approval');
        throw new Error('Your manager account is pending admin approval');
      }
      sessionStorage.setItem('accessMode', 'manager');
      setUser(await sessionFor(credential.user, 'manager'));
    } catch (error) {
      logAuthError('manager sign-in failed', error);
      if (error.message.includes('Manager') || error.message.includes('verify করুন') || error.message.includes('pending')) {
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
      const snapshot = await getDocs(collection(db, 'users'));
      return snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((item) => item.roles?.includes('manager') && item.managerStatus === 'pending');
    } catch {
      return [];
    }
  }

  async function approveManager(id) {
    try {
      const ref = doc(db, 'users', id);
      await updateDoc(ref, { managerStatus: 'approved'.trim(), status: 'approved'.trim() });
      setUsersVersion((value) => value + 1);

      if (user?.id === id) {
        setUser((current) => current ? { ...current, status: 'approved', role: 'admin' } : current);
      }
    } catch {
      throw new Error('Manager approval failed. Try again.');
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
      updateUserProfile, requestPasswordChange,
      pendingManagers, approveManager, getLiveStatus,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }

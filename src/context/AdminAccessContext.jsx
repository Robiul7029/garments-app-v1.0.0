import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { isElevatedRecord } from '../utils/access';

// Re-exported so every existing `import { isElevatedRecord } from '.../AdminAccessContext'`
// keeps working; the definition now lives in utils/access.js to keep it import-cycle-free
// and shared with the admin sign-in. See that module for why.
export { isElevatedRecord };

// The public lookup index. It is keyed by username / User ID and maps to that person's
// uid and e-mail. It is still consulted for identity resolution (and as a legacy role
// source), but the authoritative role now lives in the directory below.
const MANAGER_IDS = 'managerIds';
// The role directory, keyed by uid. This is what the Role dropdown in Employee Management
// (and the approval table) writes, so it is read first.
const MANAGER_DIRECTORY = 'managerDirectory';

/**
 * The single place the "may this account enter /admin" question is answered.
 *
 * It reads the signed-in account's own role record: `managerDirectory/{uid}` first, since
 * that is what the Role dropdown in Employee Management and the approval table write, and
 * then the account's `managerIds` entry as a fallback for records that predate the
 * directory. The session object in AuthContext is not enough on its own:
 *   - a manager signs in through Manager Access and is given the session role `admin`,
 *     which is what unlocks the operational data pages, but
 *   - that same `admin` session role must NOT open the admin area unless the account's
 *     role record actually says so.
 *
 * Keeping the two apart here is what lets the sidebar, the route guard and the data pages
 * disagree on purpose instead of by accident.
 */
const AdminAccessContext = createContext(null);

// The managerIds document is keyed by the account's lower-cased username / User ID. The
// e-mail is the fallback key, so an account that only has an e-mail entry is still found.
// Both are read from the session, which is the only identity available before the record
// is loaded.
export function managerIdsKeysFor(user = {}) {
  const keys = [user.username, user.email].map((value) => String(value || '').trim().toLowerCase());
  // A duplicate-free list, order preserved (username first, then e-mail).
  return [...new Set(keys.filter(Boolean))];
}

export function AdminAccessProvider({ children }) {
  // usersVersion is bumped by every approval write anywhere in the app, so re-reading on
  // it means an admin who approves somebody in this tab — or who is promoted from a
  // second tab — sees the sidebar and the guards react without a reload.
  const { user, usersVersion } = useAuth() || {};
  const [state, setState] = useState({ checking: true, elevated: false, record: null });

  const uid = user?.id || '';
  // The lookup keys are fixed for the life of the session, so memoise them on identity
  // instead of rebuilding the array on every render (which would loop the effect below).
  const username = user?.username || '';
  const email = user?.email || '';
  const lookupKeys = useMemo(() => managerIdsKeysFor({ username, email }), [username, email]);

  // Read the account's role record. The uid-keyed directory is authoritative because the
  // Role dropdown and the approval table write there; managerIds is the fallback used when
  // the directory entry does not exist. A read that fails is a denial, never a pass.
  const readManagerIdsRecord = useCallback(async () => {
    if (uid) {
      const directorySnapshot = await getDoc(doc(db, MANAGER_DIRECTORY, uid));
      if (directorySnapshot.exists()) return directorySnapshot.data();
    }
    for (const key of lookupKeys) {
      const snapshot = await getDoc(doc(db, MANAGER_IDS, key));
      if (snapshot.exists()) return snapshot.data();
    }
    return null;
  }, [uid, lookupKeys]);

  const refresh = useCallback(async () => {
    // The directory is keyed by uid, so a signed-in account is checkable even when it has
    // no username / e-mail lookup key.
    if (!uid) {
      setState({ checking: false, elevated: false, record: null });
      return;
    }
    setState((current) => ({ ...current, checking: true }));
    try {
      const record = await readManagerIdsRecord();
      setState({ checking: false, elevated: isElevatedRecord(record), record });
    } catch {
      setState({ checking: false, elevated: false, record: null });
    }
  }, [uid, lookupKeys, readManagerIdsRecord]);

  useEffect(() => {
    let active = true;
    // Ignore the result of a read for an account that has since signed out, so a slow
    // response cannot re-grant access on the way out.
    if (!uid) {
      setState({ checking: false, elevated: false, record: null });
      return undefined;
    }
    setState((current) => ({ ...current, checking: true }));
    readManagerIdsRecord()
      .then((record) => {
        if (!active) return;
        setState({ checking: false, elevated: isElevatedRecord(record), record });
      })
      .catch(() => {
        if (!active) return;
        setState({ checking: false, elevated: false, record: null });
      });
    return () => { active = false; };
  }, [uid, lookupKeys, readManagerIdsRecord, usersVersion]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <AdminAccessContext.Provider value={value}>{children}</AdminAccessContext.Provider>;
}

// Safe to call outside the provider (for example on the admin sign-in screen, which is
// deliberately rendered above the app shell): it then reports "not elevated", which is
// the correct answer there anyway.
export function useAdminAccess() {
  return useContext(AdminAccessContext) || { checking: false, elevated: false, record: null, refresh: () => {} };
}
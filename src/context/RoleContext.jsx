import React from 'react';
import { useAuth } from './AuthContext';

// Role now comes from the logged-in account (see AuthContext) instead of
// a demo toggle. This wrapper is kept so every component that already
// calls useRole() for isAdmin keeps working without changes.
//
// NOTE: `isAdmin` from this hook means "may add / edit / delete operational data". It is
// NOT a claim on the admin area — a manager holds this too. The admin area has its own
// right, `useAdminAccess().elevated`, which is read from the Firestore record.
export function RoleProvider({ children }) {
  return children;
}

export function useRole() {
  // Guarded so a render before AuthProvider mounts (or without it) yields a viewer role
  // instead of a destructuring crash.
  const { user, getLiveStatus, usersVersion } = useAuth() || {};
  if (!user) return { role: 'viewer', isAdmin: false, canEdit: false };

  // `isAdmin` here means "may enter data on the operational pages" — NOT "may open the
  // admin area". Those are two different rights and conflating them was what stopped
  // managers from editing Attendance, Sewing, Salary and the rest. The admin area is
  // guarded separately by AdminProtectedRoute, which reads the Firestore record.
  //
  // The session role is `admin` for an approved manager (it is what carries the data
  // rights) and `viewer` for a general user, so this single check is exactly the
  // "manager vs view-only" distinction.
  // Re-check live approval status (not the cached session) so access upgrades to full
  // manager the moment someone approves this account — no need to log out and back in.
  // usersVersion just forces a re-check whenever any account's status changes anywhere in
  // the app.
  void usersVersion;
  const liveStatus = (typeof getLiveStatus === 'function' ? getLiveStatus(user.id) : null) || user.status;
  // Super admin (the built-in approver account) is always full-access, whatever status the
  // document happens to carry.
  const approved = user.isSuperAdmin || liveStatus === 'approved';
  const canEdit = user.isSuperAdmin || user.role === 'admin' ? approved : false;

  // A manager account that has not been approved yet is treated exactly like a view-only
  // user: it can see every report but nothing may be added, edited or deleted.
  return {
    role: canEdit ? 'admin' : 'viewer',
    isAdmin: canEdit,
    canEdit,
    pendingApproval: !approved && !user.isSuperAdmin && user.role === 'admin',
  };
}

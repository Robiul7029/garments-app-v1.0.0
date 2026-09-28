import React from 'react';
import { useAuth } from './AuthContext';

// Role now comes from the logged-in account (see AuthContext) instead of
// a demo toggle. This wrapper is kept so every component that already
// calls useRole() for isAdmin keeps working without changes.
export function RoleProvider({ children }) {
  return children;
}

export function useRole() {
  // Guarded so a render before AuthProvider mounts (or without it) yields a viewer role
  // instead of a destructuring crash.
  const { user, getLiveStatus, usersVersion } = useAuth() || {};
  if (!user) return { role: 'viewer', isAdmin: false };
  // A super admin may carry a non-admin role string in older documents, so both
  // signals count: role === 'admin' OR the isSuperAdmin flag.
  if (!user.isSuperAdmin && user.role !== 'admin') return { role: 'viewer', isAdmin: false };

  // Super admin (the built-in approver account) is always full-access.
  if (user.isSuperAdmin) return { role: 'admin', isAdmin: true };

  // Re-check live approval status (not the cached session) so access
  // upgrades to full manager the moment someone approves this account —
  // no need to log out and back in. usersVersion just forces a re-check
  // whenever any account's status changes anywhere in the app.
  void usersVersion;
  const liveStatus = (typeof getLiveStatus === 'function' ? getLiveStatus(user.id) : null) || user.status;
  const approved = liveStatus === 'approved';
  return { role: approved ? 'admin' : 'viewer', isAdmin: approved, pendingApproval: !approved };
}

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { subscribeDocument } from '../services/erpRepository';
import { useAuth } from './AuthContext';
import {
  ACTION, MODULE, can, actionsFor, visibleModules, collectRoles, unknownRoles,
} from '../config/erpRoles';

/**
 * ROBIUL GARMENTS ERP — permissions.
 *
 * Sits on top of the existing AuthContext rather than replacing it. The legacy
 * three-way model (isSuperAdmin / manager / viewer) is read exactly as before;
 * this provider only adds the 15-role ERP layer, read live from the signed-in
 * user's own Firestore record.
 *
 * Why live and not from the session: the existing app already re-reads
 * `users/{uid}` when an approval changes, which is what lets an access upgrade
 * take effect without a sign-out. ERP roles work the same way — subscribe to
 * the document and the sidebar, guards and buttons all react on the spot.
 *
 * A user with no ERP roles is not blocked: they see no ERP section at all and
 * keep every legacy screen they had before.
 */
const PermissionContext = createContext(null);

export function PermissionProvider({ children }) {
  const { user, usersVersion } = useAuth() || {};
  const uid = user?.id || '';
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(Boolean(uid));

  useEffect(() => {
    if (!uid) {
      setRecord(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsubscribe = subscribeDocument('users', uid, {
      onChange: (doc) => {
        setRecord(doc);
        setLoading(false);
      },
      onError: () => {
        // A refused read is a denial, never a pass: fall back to no record, which
        // means no ERP access.
        setRecord(null);
        setLoading(false);
      },
    });
    return () => {
      unsubscribe();
    };
  }, [uid, usersVersion]);

  const value = useMemo(() => {
    const roles = collectRoles(record);
    const allowed = new Set(visibleModules(record));
    return {
      loading,
      record,
      uid,
      // The display name used by the audit trail and the header.
      actorName: user?.username || user?.email || record?.username || record?.email || 'Unknown user',
      roles,
      unknownRoles: unknownRoles(record),
      isSuperAdmin: record?.isSuperAdmin === true,

      /** May the user view this module? */
      canView: (moduleKey) => allowed.has(moduleKey),
      /** May the user perform `action` (create/edit/delete/approve/export) here? */
      can: (moduleKey, action = ACTION.VIEW) => can(record, moduleKey, action),
      /** Everything the user may do on a module, for a screen to consult. */
      actionsOn: (moduleKey) => new Set(actionsFor(record, moduleKey)),
      visibleModules: [...allowed],
      hasAnyRole: (list) => (list || []).some((r) => roles.includes(r)),
      /** True when the user holds at least one ERP role (not the legacy model). */
      hasErpAccess: roles.length > 0,
    };
  }, [loading, record, uid, user]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionContext) || {
    loading: false,
    record: null,
    uid: '',
    actorName: 'Unknown user',
    roles: [],
    unknownRoles: [],
    isSuperAdmin: false,
    canView: () => false,
    can: () => false,
    actionsOn: () => new Set(),
    visibleModules: [],
    hasAnyRole: () => false,
    hasErpAccess: false,
  };
}

export { ACTION, MODULE };
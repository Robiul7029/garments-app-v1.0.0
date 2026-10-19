import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { subscribeDocument } from '../services/erpRepository';
import { useAuth } from './AuthContext';
import {
  ACTION, MODULE, ROLES, MANAGER_ERP_ROLE, can, actionsFor, visibleModules, collectRoles,
  unknownRoles, declaresManagerRole, isApprovedRecord,
} from '../config/erpRoles';
import { DEV_ACCESS_ENABLED, DEV_ACCESS_ROLE } from '../config/accessOverride';

/**
 * The ERP roles the SIGNED-IN SESSION itself proves, used while — or instead of — the
 * role record being read.
 *
 * An approved manager arrives from AuthContext with the session role `admin` and
 * `roles: ['user', 'manager']`; a super admin with `isSuperAdmin: true`. Reading only
 * `users/{uid}.erpRoles` therefore demoted BOTH to "no ERP role" whenever that array had
 * not been seeded — every write button disappeared, including Process Sheet Upload. The
 * session is the same account and the same approval gate that produced it, so its role is
 * a valid source; a viewer session still proves nothing.
 *
 * This mirrors `isLegacyManagerRecord` in config/erpRoles.js: the session `role: 'admin'`
 * is only ever issued to an APPROVED manager, which is why it maps to an ERP manager here.
 */
export function sessionRolesFromUser(user, overrideRole = '') {
  if (!user) return [];
  const out = new Set();
  if (user.isSuperAdmin === true) out.add(ROLES.SUPER_ADMIN);
  const approved = user.isSuperAdmin === true
    || isApprovedRecord({ status: user.status || 'approved' });
  if (approved && (user.role === 'admin' || declaresManagerRole(user))) {
    out.add(MANAGER_ERP_ROLE);
  }
  // The development-only switch (see config/accessOverride.js). Inert in a production
  // build and in the test runner, where DEV_ACCESS_ROLE is ''.
  if (overrideRole === 'admin') out.add(ROLES.SUPER_ADMIN);
  else if (overrideRole === 'manager') out.add(MANAGER_ERP_ROLE);
  return [...out];
}

/** The ERP roles named by the user's Firestore record (handles the approved-manager case). */
function recordRoles(record) {
  return collectRoles(record);
}

/**
 * ROBIUL GARMENTS ERP — permissions.
 *
 * Sits on top of the existing AuthContext rather than replacing it. The legacy
 * three-way model (isSuperAdmin / manager / viewer) is read exactly as before;
 * this provider only adds the 15-role ERP layer, read live from the signed-in
 * user's own Firestore record.
 *
 * Why live and not only from the session: the existing app already re-reads
 * `users/{uid}` when an approval changes, which is what lets an access upgrade
 * take effect without a sign-out. ERP roles work the same way — subscribe to
 * the document and the sidebar, guards and buttons all react on the spot.
 *
 * The session is used as a SECOND source, never as a demotion: an approved manager
 * (session role `admin`, `roles: ['user', 'manager']`) and a super admin hold their
 * rights even when the role record has not been seeded yet — see
 * `sessionRolesFromUser`. A general user (session role `viewer`) still gets none.
 */
// Exported so a test (or a preview harness) can provide a permission set directly —
// the same way DataContext is provided — without mounting the whole provider. Its
// absence is what made the render tests crash with "cannot read 'Provider'".
export const PermissionContext = createContext(null);

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
    const roles = recordRoles(record);
    // The session's own roles are added, never subtracted: a Firestore record that names a
    // more specific role still wins, and the union only ever restores what the session
    // already proves. `devAccessOverride` is the development-only switch (inert in a
    // production build and in the test runner).
    const sessionRoles = sessionRolesFromUser(user, DEV_ACCESS_ROLE);
    const knownRoles = new Set([...roles, ...sessionRoles]);
    // A matrix row resolved against the record OR against the session. `record` is handed
    // over as `{ erpRoles }` on purpose: passing it raw would re-run the legacy
    // `role: 'manager'` mapping in `collectRoles` and double-grant the same role.
    const recordMatrix = record ? { erpRoles: roles } : null;
    const decide = (moduleKey, action) => (
      can(recordMatrix, moduleKey, action)
      || sessionRoles.some((role) => can({ erpRoles: [role] }, moduleKey, action))
    );
    const allowed = new Set(
      Object.values(MODULE).filter((moduleKey) => decide(moduleKey, ACTION.VIEW)),
    );
    const mergedRoles = [...knownRoles];
    return {
      loading,
      record,
      uid,
      // The display name used by the audit trail and the header.
      actorName: user?.username || user?.email || record?.username || record?.email || 'Unknown user',
      roles: mergedRoles,
      unknownRoles: unknownRoles(record),
      isSuperAdmin: record?.isSuperAdmin === true || user?.isSuperAdmin === true,
      /** True while the development-only access switch is elevating this session. */
      devAccessOverride: DEV_ACCESS_ENABLED,

      /** May the user view this module? */
      canView: (moduleKey) => allowed.has(moduleKey),
      /** May the user perform `action` (create/edit/delete/approve/export/upload) here? */
      can: (moduleKey, action = ACTION.VIEW) => decide(moduleKey, action),
      /**
       * The named write checks the entry screens call.
       *
       * These are FUNCTIONS taking a module key, not booleans: one account can hold
       * CREATE on orders and only VIEW on inventory, so a single boolean could not
       * answer the question a screen is asking. They were missing from this provider
       * (only the no-provider fallback below defined them), which made
       * `permissions.canCreate(...)` throw a TypeError on the Order Input page.
       */
      canCreate: (moduleKey) => decide(moduleKey, ACTION.CREATE),
      canEdit: (moduleKey) => decide(moduleKey, ACTION.EDIT),
      canDelete: (moduleKey) => decide(moduleKey, ACTION.DELETE),
      /** May the user add a document (a process sheet, an import) to the module? */
      canUpload: (moduleKey) => decide(moduleKey, ACTION.UPLOAD),
      /** Everything the user may do on a module, for a screen to consult. */
      actionsOn: (moduleKey) => new Set(Object.values(ACTION).filter((action) => decide(moduleKey, action))),
      visibleModules: [...allowed],
      hasAnyRole: (list) => (list || []).some((r) => mergedRoles.includes(r)),
      /** True when the user holds at least one ERP role (record or session). */
      hasErpAccess: mergedRoles.length > 0,
      /**
       * True when the account may change data anywhere. Read by screens that need
       * "is this a read-only account?" rather than one module at a time.
       */
      isViewOnly: !Object.values(MODULE).some((moduleKey) => (
        decide(moduleKey, ACTION.CREATE)
        || decide(moduleKey, ACTION.EDIT)
        || decide(moduleKey, ACTION.DELETE)
      )),
    };
  }, [loading, record, uid, user, usersVersion]);

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
    // The same three write checks as the provider, answered "no". They must exist
    // here too: a screen rendered without the provider (a preview route, a test)
    // would otherwise throw a TypeError instead of rendering read-only.
    canCreate: () => false,
    canEdit: () => false,
    canDelete: () => false,
    canUpload: () => false,
    devAccessOverride: DEV_ACCESS_ENABLED,
    actionsOn: () => new Set(),
    visibleModules: [],
    hasAnyRole: () => false,
    hasErpAccess: false,
    isViewOnly: true,
  };
}

export { ACTION, MODULE };
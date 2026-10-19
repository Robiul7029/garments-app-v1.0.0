import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * A signed-in manager must never be demoted by the permission layer.
 *
 * Two regressions are pinned here:
 *
 *  1. The session record arriving LATE (or a transient failed read) used to leave
 *     `record` null, and the matrix then read the account as having no roles at all —
 *     an approved manager saw their `+ Add` / `Edit` / `Delete` controls disappear.
 *     The session's own role is now a fallback source of ERP roles.
 *
 *  2. The dev access override is a REAL-DEV-SERVER switch. Under Vitest (MODE 'test') it
 *     must be inert, so a `viewer` fixture still renders as a viewer.
 */

// The role record never arrives: this is the "loading / transient failure" window.
vi.mock('../../services/erpRepository', () => ({
  subscribeDocument: () => () => {},
}));

const MODULE_PRODUCTION = 'production';

async function permissionsFor(user) {
  const { PermissionProvider, usePermissions } = await import('../PermissionContext');
  const { AuthContext } = await import('../AuthContext');

  const auth = {
    user,
    loading: false,
    authReady: true,
    usersVersion: 0,
    getLiveStatus: () => user?.status || null,
  };
  let captured = null;
  function Probe() {
    const permissions = usePermissions();
    captured = permissions;
    return <span>{String(permissions.canCreate(MODULE_PRODUCTION))}</span>;
  }
  renderToStaticMarkup(
    <AuthContext.Provider value={auth}>
      <PermissionProvider>
        <Probe />
      </PermissionProvider>
    </AuthContext.Provider>,
  );
  return captured;
}

describe('the permission layer does not demote an active session', () => {
  it('keeps an approved manager’s write rights while the role record is missing', async () => {
    const permissions = await permissionsFor({
      id: 'mgr', role: 'admin', roles: ['user', 'manager'], status: 'approved', isSuperAdmin: false,
    });
    expect(permissions.roles).toContain('production_manager');
    expect(permissions.canCreate(MODULE_PRODUCTION)).toBe(true);
    expect(permissions.canEdit(MODULE_PRODUCTION)).toBe(true);
    expect(permissions.isViewOnly).toBe(false);
  });

  it('keeps a super admin’s rights while the role record is missing', async () => {
    const permissions = await permissionsFor({
      id: 'root', role: 'admin', status: 'approved', isSuperAdmin: true,
    });
    expect(permissions.isSuperAdmin).toBe(true);
    expect(permissions.canDelete(MODULE_PRODUCTION)).toBe(true);
  });

  it('still treats a general user as View-Only', async () => {
    const permissions = await permissionsFor({
      id: 'usr', role: 'viewer', roles: ['user'], status: 'approved', isSuperAdmin: false,
    });
    expect(permissions.roles).toEqual([]);
    expect(permissions.canCreate(MODULE_PRODUCTION)).toBe(false);
    expect(permissions.isViewOnly).toBe(true);
  });

  it('does not apply the development override inside the test runner', async () => {
    const { DEV_ACCESS_ENABLED } = await import('../../config/accessOverride');
    expect(DEV_ACCESS_ENABLED).toBe(false);
    const permissions = await permissionsFor({
      id: 'usr', role: 'viewer', roles: ['user'], status: 'approved', isSuperAdmin: false,
    });
    expect(permissions.devAccessOverride).toBe(false);
  });
});

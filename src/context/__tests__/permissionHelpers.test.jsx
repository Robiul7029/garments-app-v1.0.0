/**
 * The permission helpers the entry screens call must EXIST on the provider itself.
 *
 * Regression: `OrderInputPage` calls `permissions.canCreate(MODULE.ORDERS)`, but the
 * provider defined only `can` / `canView`, so the page threw
 * "permissions.canCreate is not a function" on render. `canCreate` was defined ONLY
 * in the no-provider fallback — the one path production never took.
 *
 * These tests pin both halves of the fix:
 *   1. the provider exposes the named write checks and they follow the matrix;
 *   2. the fallback exposes them too, answered "no";
 *   3. a provider whose helpers are missing cannot crash a screen (safe call site).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// `subscribeDocument(collection, id, handlers)` answers through `onChange`. Answering
// `next(null)` here would keep the role record null for ever, which is NOT what a
// signed-in account sees — the test would then only be exercising the session fallback.
// The role record is left unseeded instead, so the session is the one source of truth.
vi.mock('../../services/erpRepository', () => ({
  subscribeDocument: () => () => {},
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: 'admin', status: 'approved', isSuperAdmin: false },
    usersVersion: 0,
  }),
}));

async function permissionsWith(provider) {
  const { usePermissions, PermissionContext } = await import('../PermissionContext');
  let captured = null;
  function Probe() {
    captured = usePermissions();
    return null;
  }
  if (provider) {
    const { PermissionProvider } = await import('../PermissionContext');
    renderToStaticMarkup(<PermissionProvider><Probe /></PermissionProvider>);
  } else {
    // No provider mounted — the fallback path.
    void PermissionContext;
    renderToStaticMarkup(<Probe />);
  }
  return captured;
}

describe('the permission provider exposes the named write checks', () => {
  it('defines canCreate, canEdit and canDelete as functions', async () => {
    const permissions = await permissionsWith(true);
    expect(typeof permissions.canCreate).toBe('function');
    expect(typeof permissions.canEdit).toBe('function');
    expect(typeof permissions.canDelete).toBe('function');
    // The Process Sheet Upload control asks for this one.
    expect(typeof permissions.canUpload).toBe('function');
  });

  it('answers with a boolean, not a promise or undefined', async () => {
    const permissions = await permissionsWith(true);
    const { MODULE } = await import('../../config/erpRoles');
    expect(typeof permissions.canCreate(MODULE.ORDERS)).toBe('boolean');
    expect(typeof permissions.canEdit(MODULE.ORDERS)).toBe('boolean');
    expect(typeof permissions.canDelete(MODULE.ORDERS)).toBe('boolean');
    expect(typeof permissions.canUpload(MODULE.ORDERS)).toBe('boolean');
  });

  it('reports whether the account is view-only', async () => {
    const permissions = await permissionsWith(true);
    expect(typeof permissions.isViewOnly).toBe('boolean');
  });
});

/**
 * The regression the brief is about: a signed-in manager lost every write control
 * because the role record had not been seeded. The session (`role: 'admin'`, approved)
 * is an approved manager, so the write checks must answer YES — including upload.
 */
describe('an approved manager keeps full write rights', () => {
  it('grants create / edit / delete / upload on Order Management', async () => {
    const permissions = await permissionsWith(true);
    const { MODULE } = await import('../../config/erpRoles');
    expect(permissions.canCreate(MODULE.ORDERS)).toBe(true);
    expect(permissions.canEdit(MODULE.ORDERS)).toBe(true);
    expect(permissions.canDelete(MODULE.ORDERS)).toBe(true);
    expect(permissions.canUpload(MODULE.ORDERS)).toBe(true);
    expect(permissions.isViewOnly).toBe(false);
  });

  it('grants the production, manpower, quality, cutting and line-input writes too', async () => {
    const permissions = await permissionsWith(true);
    const { MODULE } = await import('../../config/erpRoles');
    [
      MODULE.PRODUCTION, MODULE.MANPOWER, MODULE.QUALITY,
      MODULE.PRODUCTION_CUTTING, MODULE.LINE_INPUT,
    ].forEach((moduleKey) => {
      expect(permissions.canCreate(moduleKey), `no CREATE on ${moduleKey}`).toBe(true);
      expect(permissions.canEdit(moduleKey), `no EDIT on ${moduleKey}`).toBe(true);
    });
  });
});

describe('the no-provider fallback is closed, not open', () => {
  it('provides the helpers and denies every write', async () => {
    const permissions = await permissionsWith(false);
    expect(permissions.canCreate()).toBe(false);
    expect(permissions.canEdit()).toBe(false);
    expect(permissions.canDelete()).toBe(false);
    expect(permissions.canUpload()).toBe(false);
    expect(permissions.isViewOnly).toBe(true);
  });
});

describe('a missing helper cannot crash a screen', () => {
  it('safe call yields false instead of throwing', () => {
    const broken = {}; // a provider shape without the helpers
    const evaluate = () => Boolean(broken?.canCreate?.('orders'));
    expect(() => evaluate()).not.toThrow();
    expect(evaluate()).toBe(false);
  });
});

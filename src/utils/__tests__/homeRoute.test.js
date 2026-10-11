import { describe, it, expect } from 'vitest';
import ErpHome from '../../pages/erp/dashboard/ErpHome';
import ErpDashboard from '../../pages/erp/dashboard/ErpDashboard';
import {
  MODULE, ROLES, ACTION, visibleModules, can, collectRoles,
} from '../../config/erpRoles';

/**
 * The home route (`/`) serves the new ERP Overview to EVERY signed-in account.
 *
 * It used to branch on an ERP role and fall back to the legacy Dashboard, which
 * meant an account with no `erpRole` on its `users/{uid}` document never saw the
 * new screen at all. That is the bug these tests now pin: `ErpHome` must render
 * the ERP dashboard unconditionally, with no permission gate in front of it.
 */
describe('ErpHome — the home route', () => {
  it('renders the ERP dashboard, not the legacy one', () => {
    const element = ErpHome();
    expect(element.type).toBe(ErpDashboard);
  });

  it('takes no props, so no caller can gate it', () => {
    // A `legacy` fallback prop would let the route silently revert. There is
    // none, and this test fails if one is reintroduced.
    expect(ErpHome.length).toBe(0);
  });
});

/**
 * The permission layer is still worth pinning, because the ERP sidebar and the
 * module routes depend on it — only the home route stopped consulting it.
 */
describe('ERP role grants', () => {
  it('an ERP role is granted the dashboard module', () => {
    // The role lives on `erpRole`/`erpRoles`, not on the legacy `role` field.
    expect(visibleModules({ erpRole: ROLES.PRODUCTION_MANAGER })).toContain(MODULE.DASHBOARD);
  });

  it('the erpRoles array form works too', () => {
    expect(visibleModules({ erpRoles: [ROLES.SUPERVISOR] })).toContain(MODULE.DASHBOARD);
  });

  it('a legacy role is NOT treated as an ERP role', () => {
    // This is what keeps the ERP sidebar hidden from a legacy production user.
    expect(visibleModules({ role: 'admin', roles: ['admin', 'manager'] }))
      .not.toContain(MODULE.DASHBOARD);
    expect(collectRoles({ role: 'admin', roles: ['admin'] })).toEqual([]);
  });

  it('an unknown ERP role grants nothing', () => {
    expect(visibleModules({ erpRole: 'not-a-real-role' })).not.toContain(MODULE.DASHBOARD);
  });

  it('view is the level the UI checks for read access', () => {
    expect(can({ erpRole: ROLES.PRODUCTION_MANAGER }, MODULE.DASHBOARD, ACTION.VIEW)).toBe(true);
  });

  it('a super admin sees the dashboard module', () => {
    expect(visibleModules({ isSuperAdmin: true })).toContain(MODULE.DASHBOARD);
  });

  it('a null or malformed record yields no modules rather than throwing', () => {
    expect(() => visibleModules(null)).not.toThrow();
    expect(visibleModules(null)).toEqual([]);
    expect(visibleModules({ erpRoles: null })).toEqual([]);
  });
});

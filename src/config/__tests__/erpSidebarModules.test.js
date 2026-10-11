import { describe, it, expect } from 'vitest';
import {
  ERP_MODULES, LIVE_ERP_MODULES, PLANNED_MODULES, erpModulePath, erpChildPath, erpRoutes,
} from '../erpMenu';
import { MODULE, PERMISSIONS, ROLES, can, collectRoles, ROLE_LIST } from '../erpRoles';

/**
 * The five sidebar sections the factory asked for must be present, routed and
 * reachable by role. The sidebar and the router are both generated from
 * `ERP_MODULES`, so these tests are what stop a module being added to the menu
 * without a screen, or granted to nobody and therefore invisible.
 */
const REQUIRED_MODULES = [
  { key: MODULE.ORDERS, label: 'Order Management' },
  { key: MODULE.PLANNING, label: 'TNA Management' },
  { key: MODULE.OPERATOR_PERFORMANCE, label: 'Operator Performance' },
  { key: MODULE.QUALITY, label: 'Quality Control' },
  { key: MODULE.MANPOWER, label: 'Manpower Management' },
];

describe('the five requested sidebar sections', () => {
  it('declares all five as live modules with a component', () => {
    REQUIRED_MODULES.forEach(({ key, label }) => {
      const found = LIVE_ERP_MODULES.find((m) => m.key === key);
      expect(found, `${label} should be a live module`).toBeTruthy();
      expect(found.label).toBe(label);
      expect(typeof found.component).toBe('function');
    });
  });

  it('gives each one a description for the ERP nav and dashboard', () => {
    REQUIRED_MODULES.forEach(({ key }) => {
      const found = ERP_MODULES.find((m) => m.key === key);
      expect(found.description).toBeTruthy();
      expect(found.icon).toBeTruthy();
      expect(found.accent).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('produces a route for each, from the same array the sidebar renders', () => {
    const routes = erpRoutes();
    REQUIRED_MODULES.forEach(({ key }) => {
      expect(routes.some((r) => r.path === `/erp/${key}`)).toBe(true);
    });
  });

  it('does not list a live module in the planned list as well', () => {
    // A module in both arrays would render twice in the sidebar.
    const liveKeys = new Set(LIVE_ERP_MODULES.map((m) => m.key));
    PLANNED_MODULES.forEach((p) => {
      expect(liveKeys.has(p.key), `${p.label} is both live and planned`).toBe(false);
    });
  });

  it('no longer shows the old planned entries for orders/tna/quality', () => {
    const plannedKeys = PLANNED_MODULES.map((p) => p.key);
    expect(plannedKeys).not.toContain(MODULE.ORDERS);
    expect(plannedKeys).not.toContain(MODULE.PLANNING);
    expect(plannedKeys).not.toContain(MODULE.QUALITY);
    expect(plannedKeys).not.toContain(MODULE.PRODUCTION);
  });
});

describe('Order Management nesting', () => {
  it('nests Order Input and Process Breakdown under it', () => {
    const orders = LIVE_ERP_MODULES.find((m) => m.key === MODULE.ORDERS);
    const childKeys = (orders.children || []).map((c) => c.key);
    expect(childKeys).toEqual(['order-input', 'process-breakdown']);
  });

  it('gives each child a component and a 3-segment route', () => {
    const routes = erpRoutes();
    const inputRoute = routes.find((r) => r.path === erpChildPath(MODULE.ORDERS, 'order-input'));
    expect(inputRoute).toBeTruthy();
    expect(inputRoute.path).toBe('/erp/orders/order-input');
    expect(typeof inputRoute.component).toBe('function');
    // The child is gated by its PARENT's permission, not one of its own.
    expect(inputRoute.moduleKey).toBe(MODULE.ORDERS);
  });

  it('keeps the parent reachable at its own route', () => {
    expect(erpRoutes().some((r) => r.path === erpModulePath(MODULE.ORDERS))).toBe(true);
  });
});

describe('role grants make the modules visible', () => {
  it('gives Super Admin every new module', () => {
    const record = { isSuperAdmin: true };
    REQUIRED_MODULES.forEach(({ key }) => expect(can(record, key, 'view')).toBe(true));
  });

  it('gives Production Manager the shop-floor modules', () => {
    const record = { erpRole: ROLES.PRODUCTION_MANAGER };
    expect(can(record, MODULE.OPERATOR_PERFORMANCE, 'view')).toBe(true);
    expect(can(record, MODULE.MANPOWER, 'view')).toBe(true);
    expect(can(record, MODULE.QUALITY, 'view')).toBe(true);
  });

  it('gives Planning the TNA module with edit rights', () => {
    const record = { erpRole: ROLES.PLANNING };
    expect(can(record, MODULE.PLANNING, 'view')).toBe(true);
    expect(can(record, MODULE.PLANNING, 'edit')).toBe(true);
    expect(can(record, MODULE.PLANNING, 'create')).toBe(true);
  });

  it('gives HR the manpower module with full rights', () => {
    const record = { erpRole: ROLES.HR };
    expect(can(record, MODULE.MANPOWER, 'view')).toBe(true);
    expect(can(record, MODULE.MANPOWER, 'delete')).toBe(true);
  });

  it('gives QC the quality module and read-only operator performance', () => {
    const record = { erpRole: ROLES.QC };
    expect(can(record, MODULE.QUALITY, 'create')).toBe(true);
    expect(can(record, MODULE.OPERATOR_PERFORMANCE, 'view')).toBe(true);
    // Read-only: the QC role inspects the product, it does not mark operators.
    expect(can(record, MODULE.OPERATOR_PERFORMANCE, 'edit')).toBe(false);
  });

  it('gives Merchandising the order module', () => {
    const record = { erpRole: ROLES.MERCHANDISING };
    expect(can(record, MODULE.ORDERS, 'create')).toBe(true);
  });

  it('gives a user with no ERP role no access at all', () => {
    expect(can({ role: 'admin' }, MODULE.ORDERS, 'view')).toBe(false);
    expect(can(null, MODULE.ORDERS, 'view')).toBe(false);
  });

  it('merges grants when a user holds several roles', () => {
    // QC alone cannot edit operator performance; QC + Production Manager can.
    const record = { erpRoles: [ROLES.QC, ROLES.PRODUCTION_MANAGER] };
    expect(collectRoles(record)).toHaveLength(2);
    expect(can(record, MODULE.OPERATOR_PERFORMANCE, 'edit')).toBe(true);
  });

  it('does not grant the new keys to the STORE role', () => {
    const record = { erpRole: ROLES.STORE };
    expect(can(record, MODULE.OPERATOR_PERFORMANCE, 'view')).toBe(false);
    expect(can(record, MODULE.MANPOWER, 'view')).toBe(false);
    expect(can(record, MODULE.PLANNING, 'view')).toBe(false);
  });

  it('has a readable label for every module key in the matrix', () => {
    const keys = new Set();
    ROLE_LIST.forEach((role) => {
      Object.keys(PERMISSIONS[role] || {}).forEach((k) => keys.add(k));
    });
    // The four keys added for these sections must exist in MODULE.
    expect(Object.values(MODULE)).toEqual(expect.arrayContaining([...keys]));
  });
});

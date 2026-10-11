import { describe, it, expect } from 'vitest';
import {
  ACTION, MODULE, ROLES, PERMISSIONS, can, actionsFor, visibleModules,
  collectRoles, ROLE_LIST, ROLE_LABELS,
} from '../erpRoles';

/**
 * Tests for role-based access control.
 *
 * A permission bug here is a data-security bug, so these tests are deliberately
 * adversarial: they check that a role is *denied* what it should not have, not
 * only that it is granted what it should.
 */
describe('the role model', () => {
  it('defines all sixteen named roles', () => {
    // The brief lists fifteen department roles plus the Super Admin.
    expect(ROLE_LIST.length).toBe(16);
    expect(ROLE_LIST).toContain(ROLES.SUPERVISOR);
    expect(ROLE_LIST).toContain(ROLES.SHIPMENT);
    expect(ROLE_LIST).toContain(ROLES.SUPER_ADMIN);
  });

  it('gives every role a human-readable label', () => {
    ROLE_LIST.forEach((role) => expect(ROLE_LABELS[role]).toBeTruthy());
  });

  it('gives every role at least one module', () => {
    ROLE_LIST.forEach((role) => {
      expect(Object.keys(PERMISSIONS[role] || {}).length).toBeGreaterThan(0);
    });
  });

  it('grants the super admin every action on every module', () => {
    Object.values(MODULE).forEach((moduleKey) => {
      expect(can({ erpRoles: [ROLES.SUPER_ADMIN] }, moduleKey, ACTION.DELETE)).toBe(true);
      expect(can({ erpRoles: [ROLES.SUPER_ADMIN] }, moduleKey, ACTION.APPROVE)).toBe(true);
    });
  });

  it('treats the isSuperAdmin flag as full ERP access', () => {
    expect(can({ isSuperAdmin: true }, MODULE.ACCOUNTS, ACTION.DELETE)).toBe(true);
    expect(collectRoles({ isSuperAdmin: true })).toContain(ROLES.SUPER_ADMIN);
  });
});

describe('least privilege per role', () => {
  it('lets a supervisor record production but not touch accounts', () => {
    const supervisor = { erpRoles: [ROLES.SUPERVISOR] };
    expect(can(supervisor, MODULE.PRODUCTION, ACTION.CREATE)).toBe(true);
    expect(can(supervisor, MODULE.PRODUCTION, ACTION.VIEW)).toBe(true);
    // A supervisor must not be able to see or change money.
    expect(can(supervisor, MODULE.ACCOUNTS, ACTION.VIEW)).toBe(false);
    expect(can(supervisor, MODULE.ACCOUNTS, ACTION.EDIT)).toBe(false);
    // Nor assign themselves access.
    expect(can(supervisor, MODULE.USERS, ACTION.CREATE)).toBe(false);
  });

  it('stops a supervisor deleting a production record', () => {
    // A deleted hour changes the achievement figure management already saw.
    const supervisor = { erpRoles: [ROLES.SUPERVISOR] };
    expect(can(supervisor, MODULE.PRODUCTION, ACTION.DELETE)).toBe(false);
  });

  it('lets the production manager delete production but not manage users', () => {
    const manager = { erpRoles: [ROLES.PRODUCTION_MANAGER] };
    expect(can(manager, MODULE.PRODUCTION, ACTION.DELETE)).toBe(true);
    expect(can(manager, MODULE.USERS, ACTION.APPROVE)).toBe(false);
  });

  it('restricts the QC role to quality work', () => {
    const qc = { erpRoles: [ROLES.QC] };
    expect(can(qc, MODULE.QUALITY, ACTION.CREATE)).toBe(true);
    expect(can(qc, MODULE.QUALITY, ACTION.DELETE)).toBe(true);
    expect(can(qc, MODULE.INVENTORY, ACTION.VIEW)).toBe(false);
    expect(can(qc, MODULE.HR, ACTION.VIEW)).toBe(false);
  });

  it('restricts the store role to inventory and procurement', () => {
    const store = { erpRoles: [ROLES.STORE] };
    expect(can(store, MODULE.INVENTORY, ACTION.CREATE)).toBe(true);
    expect(can(store, MODULE.PROCUREMENT, ACTION.CREATE)).toBe(true);
    expect(can(store, MODULE.ACCOUNTS, ACTION.VIEW)).toBe(false);
    expect(can(store, MODULE.HR, ACTION.VIEW)).toBe(false);
  });

  it('restricts the HR role to HR', () => {
    const hr = { erpRoles: [ROLES.HR] };
    expect(can(hr, MODULE.HR, ACTION.APPROVE)).toBe(true);
    expect(can(hr, MODULE.PRODUCTION, ACTION.VIEW)).toBe(false);
    expect(can(hr, MODULE.ACCOUNTS, ACTION.EDIT)).toBe(false);
  });

  it('restricts the accounts role from approving purchase requests into stock', () => {
    const accounts = { erpRoles: [ROLES.ACCOUNTS] };
    expect(can(accounts, MODULE.ACCOUNTS, ACTION.EDIT)).toBe(true);
    expect(can(accounts, MODULE.INVENTORY, ACTION.CREATE)).toBe(false);
  });

  it('lets merchandising manage buyers and orders', () => {
    const merch = { erpRoles: [ROLES.MERCHANDISING] };
    expect(can(merch, MODULE.BUYERS, ACTION.CREATE)).toBe(true);
    expect(can(merch, MODULE.ORDERS, ACTION.CREATE)).toBe(true);
    expect(can(merch, MODULE.PRODUCTION, ACTION.CREATE)).toBe(false);
  });

  it('lets planning own the TNA but not the order book', () => {
    const planning = { erpRoles: [ROLES.PLANNING] };
    expect(can(planning, MODULE.PLANNING, ACTION.EDIT)).toBe(true);
    expect(can(planning, MODULE.ORDERS, ACTION.DELETE)).toBe(false);
  });

  it('lets shipping create shipments but not edit production', () => {
    const shipment = { erpRoles: [ROLES.SHIPMENT] };
    expect(can(shipment, MODULE.SHIPMENT, ACTION.CREATE)).toBe(true);
    expect(can(shipment, MODULE.SHIPMENT, ACTION.APPROVE)).toBe(true);
    expect(can(shipment, MODULE.PRODUCTION, ACTION.CREATE)).toBe(false);
  });

  it('restricts the maintenance role from payroll', () => {
    const maint = { erpRoles: [ROLES.MAINTENANCE] };
    expect(can(maint, MODULE.MAINTENANCE, ACTION.EDIT)).toBe(true);
    expect(can(maint, MODULE.HR, ACTION.VIEW)).toBe(false);
  });

  it('restricts cutting and finishing to production entry', () => {
    expect(can({ erpRoles: [ROLES.CUTTING] }, MODULE.PRODUCTION, ACTION.CREATE)).toBe(true);
    expect(can({ erpRoles: [ROLES.CUTTING] }, MODULE.PRODUCTION, ACTION.DELETE)).toBe(false);
    expect(can({ erpRoles: [ROLES.FINISHING] }, MODULE.QUALITY, ACTION.CREATE)).toBe(true);
    expect(can({ erpRoles: [ROLES.FINISHING] }, MODULE.QUALITY, ACTION.DELETE)).toBe(false);
  });

  it('restricts packing from editing the production record', () => {
    const packing = { erpRoles: [ROLES.PACKING] };
    expect(can(packing, MODULE.PACKING, ACTION.CREATE)).toBe(true);
    expect(can(packing, MODULE.PRODUCTION, ACTION.EDIT)).toBe(false);
  });

  it('gives management read access across the factory', () => {
    const management = { erpRoles: [ROLES.MANAGEMENT] };
    expect(can(management, MODULE.DASHBOARD, ACTION.VIEW)).toBe(true);
    expect(can(management, MODULE.PRODUCTION, ACTION.VIEW)).toBe(true);
    expect(can(management, MODULE.HR, ACTION.VIEW)).toBe(true);
    expect(can(management, MODULE.AUDIT, ACTION.VIEW)).toBe(true);
  });
});

describe('no ERP access', () => {
  it('grants nothing to an account with no ERP role', () => {
    // The legacy app's accounts carry `role: 'admin'` or no roles at all. Those
    // must NOT inherit ERP access, or a legacy manager would see everything.
    expect(can({}, MODULE.DASHBOARD, ACTION.VIEW)).toBe(false);
    expect(can(null, MODULE.ORDERS, ACTION.VIEW)).toBe(false);
    expect(visibleModules({})).toEqual([]);
  });

  it('does not map the legacy admin role onto any ERP role', () => {
    // `role: 'admin'` is a legacy production-manager marker, deliberately not
    // translated. This test locks that decision in.
    expect(collectRoles({ role: 'admin' })).toEqual([]);
    expect(collectRoles({ role: 'manager' })).toEqual([]);
  });

  it('ignores an unrecognised role string', () => {
    expect(collectRoles({ erpRoles: ['wizard', 'superadmin'] })).toEqual([]);
    expect(can({ erpRoles: ['superadmin'] }, MODULE.DASHBOARD, ACTION.VIEW)).toBe(false);
  });

  it('ignores a typo rather than throwing on a role list', () => {
    expect(collectRoles({ erpRoles: 'supervisor' })).toEqual([]);
    expect(collectRoles({ erpRoles: ['supervisor', 'qc'] })).toEqual(['supervisor', 'qc']);
  });
});

describe('multiple roles', () => {
  it('merges the permissions of every role held', () => {
    // Someone who is both QC and Store gets both sets of modules.
    const both = { erpRoles: [ROLES.QC, ROLES.STORE] };
    expect(can(both, MODULE.QUALITY, ACTION.CREATE)).toBe(true);
    expect(can(both, MODULE.INVENTORY, ACTION.CREATE)).toBe(true);
  });

  it('never loses a grant when roles are combined', () => {
    const both = { erpRoles: [ROLES.HR, ROLES.ACCOUNTS] };
    expect(can(both, MODULE.HR, ACTION.APPROVE)).toBe(true);
    expect(can(both, MODULE.ACCOUNTS, ACTION.EDIT)).toBe(true);
  });

  it('lists every module the user can view', () => {
    const visible = visibleModules({ erpRoles: [ROLES.PRODUCTION_MANAGER] });
    expect(visible).toContain(MODULE.PRODUCTION);
    expect(visible).toContain(MODULE.DASHBOARD);
    expect(visible).not.toContain(MODULE.ACCOUNTS);
  });

  it('reports the exact action set for a module', () => {
    const actions = actionsFor({ erpRoles: [ROLES.SUPERVISOR] }, MODULE.PRODUCTION);
    expect(actions).toContain(ACTION.CREATE);
    expect(actions).toContain(ACTION.EDIT);
    expect(actions).not.toContain(ACTION.DELETE);
    expect(actions).not.toContain(ACTION.APPROVE);
  });

  it('accepts the singular erpRole field as well as the array', () => {
    expect(can({ erpRole: ROLES.QC }, MODULE.QUALITY, ACTION.CREATE)).toBe(true);
    expect(can({ erpRole: ROLES.HR }, MODULE.QUALITY, ACTION.CREATE)).toBe(false);
  });
});

describe('new actions are denied until granted', () => {
  it('does not default an unspecified action to allowed', () => {
    // If a future action were implicitly granted, adding it to the enum would
    // silently open it everywhere. Omission must mean denial.
    const store = { erpRoles: [ROLES.STORE] };
    expect(actionsFor(store, MODULE.INVENTORY)).not.toContain('someFutureAction');
    expect(can(store, MODULE.INVENTORY, 'someFutureAction')).toBe(false);
  });
});
import { describe, it, expect } from 'vitest';
import {
  ACTION, MODULE, ROLES, actionsFor, can, visibleModules, visibleModuleKeys, collectRoles,
} from '../erpRoles';

/**
 * View-Only access for general users.
 *
 * The rule these tests pin down:
 *
 *   - READ is the baseline. Every signed-in account — including one holding no ERP
 *     role at all — may view every module, so no page can raise a full-page lock
 *     screen and every table and summary report is reachable.
 *   - WRITE is the role privilege. create / edit / delete / approve remain gated,
 *     and that is what the action buttons (`+ Add Entry`, `+ New Order`, `Edit`,
 *     `Delete`, `Upload`) consult.
 *
 * If a future change re-gates reading, these fail — which is the point.
 */

/** A general user: signed in, no ERP role, not a super admin. */
const GENERAL_USER = { id: 'u1', role: 'viewer', status: 'approved' };

/** A manager: the production_manager role carries write actions. */
const MANAGER = { id: 'u2', role: 'admin', status: 'approved', erpRole: ROLES.PRODUCTION_MANAGER };

/** The built-in approver account. */
const SUPER_ADMIN = { id: 'u3', isSuperAdmin: true };

const ALL_MODULES = Object.values(MODULE);

const WRITE_ACTIONS = [ACTION.CREATE, ACTION.EDIT, ACTION.DELETE, ACTION.APPROVE];

describe('View-Only access for a general user', () => {
  it('may VIEW every module, including Orders and the dashboard', () => {
    ALL_MODULES.forEach((moduleKey) => {
      expect(can(GENERAL_USER, moduleKey, ACTION.VIEW), `cannot view ${moduleKey}`).toBe(true);
    });
    // The two pages the brief names explicitly.
    expect(can(GENERAL_USER, MODULE.ORDERS, ACTION.VIEW)).toBe(true);
    expect(can(GENERAL_USER, MODULE.DASHBOARD, ACTION.VIEW)).toBe(true);
  });

  it('lists every module as visible, so the sidebar and router guard see no denial', () => {
    expect(visibleModules(GENERAL_USER).sort()).toEqual([...ALL_MODULES].sort());
    expect(visibleModuleKeys(GENERAL_USER).size).toBe(ALL_MODULES.length);
  });

  it('holds NO write action anywhere — every action button is hidden', () => {
    ALL_MODULES.forEach((moduleKey) => {
      WRITE_ACTIONS.forEach((action) => {
        expect(can(GENERAL_USER, moduleKey, action), `unexpectedly holds ${action} on ${moduleKey}`).toBe(false);
      });
    });
  });

  it('keeps the read action in the action set for a module it has no roles for', () => {
    expect(actionsFor(GENERAL_USER, MODULE.ORDERS)).toEqual([ACTION.VIEW]);
  });
});

describe('write actions stay with the roles that hold them', () => {
  it('a merchandising user may create and edit orders', () => {
    const merchandiser = { id: 'u4', role: 'admin', status: 'approved', erpRole: ROLES.MERCHANDISING };
    expect(can(merchandiser, MODULE.ORDERS, ACTION.CREATE)).toBe(true);
    expect(can(merchandiser, MODULE.ORDERS, ACTION.EDIT)).toBe(true);
  });

  it('a production manager may create and edit production data', () => {
    expect(can(MANAGER, MODULE.PRODUCTION, ACTION.CREATE)).toBe(true);
    expect(can(MANAGER, MODULE.PRODUCTION, ACTION.EDIT)).toBe(true);
    // …and holds the order master too: Order Input and Process Sheet Upload live there,
    // and a manager must be able to create, edit, delete and upload in that module.
    expect(can(MANAGER, MODULE.ORDERS, ACTION.VIEW)).toBe(true);
    expect(can(MANAGER, MODULE.ORDERS, ACTION.CREATE)).toBe(true);
    expect(can(MANAGER, MODULE.ORDERS, ACTION.EDIT)).toBe(true);
    expect(can(MANAGER, MODULE.ORDERS, ACTION.DELETE)).toBe(true);
    expect(can(MANAGER, MODULE.ORDERS, ACTION.UPLOAD)).toBe(true);
  });

  it('a production manager may still only view a module it has no grant on', () => {
    // Production Manager is not granted Accounts writes — but it can read it.
    expect(can(MANAGER, MODULE.ACCOUNTS, ACTION.VIEW)).toBe(true);
    expect(can(MANAGER, MODULE.ACCOUNTS, ACTION.CREATE)).toBe(false);
  });

  it('a super admin holds every action on every module', () => {
    ALL_MODULES.forEach((moduleKey) => {
      WRITE_ACTIONS.forEach((action) => {
        expect(can(SUPER_ADMIN, moduleKey, action), `super admin lacks ${action} on ${moduleKey}`).toBe(true);
      });
      expect(can(SUPER_ADMIN, moduleKey, ACTION.UPLOAD), `super admin cannot upload on ${moduleKey}`).toBe(true);
    });
  });

  it('an approved manager record (legacy role: manager) holds the manager writes', () => {
    // The account the Manager Access portal creates: `role: 'manager'` + approved, with
    // no `erpRole` naming a matrix role. It must still get create / edit / delete / upload.
    const approvedManager = { id: 'u5', role: 'manager', status: 'approved' };
    expect(collectRoles(approvedManager)).toContain(ROLES.PRODUCTION_MANAGER);
    expect(can(approvedManager, MODULE.ORDERS, ACTION.CREATE)).toBe(true);
    expect(can(approvedManager, MODULE.ORDERS, ACTION.UPLOAD)).toBe(true);
    // A pending manager is not mapped, so approval still gates the rights.
    expect(collectRoles({ id: 'u6', role: 'manager', status: 'pending' })).toEqual([]);
  });
});

describe('the read baseline does not invent ERP roles', () => {
  it('a general user still has no collected roles', () => {
    // Read access must not be modelled as a role grant, or the role editor and the
    // security rules would disagree about who holds what.
    expect(collectRoles(GENERAL_USER)).toEqual([]);
  });

  it('a super admin collects the super_admin role from the flag alone', () => {
    expect(collectRoles(SUPER_ADMIN)).toContain(ROLES.SUPER_ADMIN);
  });
});

describe('no record means no access', () => {
  it('returns nothing when there is no user record to read', () => {
    // A null record is "not signed in", not "view-only": nothing is granted.
    expect(actionsFor(null, MODULE.ORDERS)).toEqual([]);
    expect(can(null, MODULE.ORDERS, ACTION.VIEW)).toBe(false);
    expect(visibleModules(null)).toEqual([]);
  });
});

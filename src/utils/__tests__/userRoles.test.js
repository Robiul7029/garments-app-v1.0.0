import { describe, it, expect } from 'vitest';
import { ROLE_OPTIONS, normalizeRole, roleLabel, isManagerLikeRole, erpRolesFor } from '../userRoles';
import { ROLES, ACTION, MODULE, can, collectRoles } from '../../config/erpRoles';

/**
 * Tests for the dropdown-role -> ERP-role bridge.
 *
 * The bug these guard against: the Employee Management dropdown writes `role` / `roles`,
 * but the permission matrix reads `erpRole` / `erpRoles`. Without the bridge the floor
 * roles carried no permissions at all, so the role the admin picked was not enforced.
 */
describe('the role dropdown', () => {
  it('offers exactly the five garment-floor roles', () => {
    expect(ROLE_OPTIONS.map((o) => o.value)).toEqual([
      'admin', 'manager', 'line_incharge', 'supervisor', 'employee',
    ]);
  });

  it('gives every option a human label', () => {
    ROLE_OPTIONS.forEach((o) => expect(o.label).toBeTruthy());
  });

  it('falls back to Employee for an unknown value', () => {
    expect(normalizeRole('wizard')).toBe('employee');
    expect(normalizeRole('')).toBe('employee');
    expect(normalizeRole(undefined)).toBe('employee');
  });

  it('treats only Admin and Manager as manager-like', () => {
    expect(isManagerLikeRole('admin')).toBe(true);
    expect(isManagerLikeRole('manager')).toBe(true);
    expect(isManagerLikeRole('line_incharge')).toBe(false);
    expect(isManagerLikeRole('supervisor')).toBe(false);
    expect(isManagerLikeRole('employee')).toBe(false);
  });

  it('labels a stored role back to the dropdown text', () => {
    expect(roleLabel('line_incharge')).toBe('Line Incharge');
    expect(roleLabel('nonsense')).toBe('Employee');
  });
});

describe('mapping a dropdown role to ERP roles', () => {
  it('maps Admin to super_admin with full access', () => {
    const record = { erpRoles: erpRolesFor('admin') };
    expect(collectRoles(record)).toContain(ROLES.SUPER_ADMIN);
    expect(can(record, MODULE.USERS, ACTION.APPROVE)).toBe(true);
  });

  it('maps Manager to production_manager', () => {
    const record = { erpRoles: erpRolesFor('manager') };
    expect(collectRoles(record)).toContain(ROLES.PRODUCTION_MANAGER);
    // A manager records production but is not handed the accounts module.
    expect(can(record, MODULE.PRODUCTION, ACTION.CREATE)).toBe(true);
    expect(can(record, MODULE.ACCOUNTS, ACTION.VIEW)).toBe(false);
  });

  it('maps Line Incharge and Supervisor to the supervisor role', () => {
    ['line_incharge', 'supervisor'].forEach((value) => {
      const record = { erpRoles: erpRolesFor(value) };
      expect(collectRoles(record)).toContain(ROLES.SUPERVISOR);
      // May record production, may not delete it or see money.
      expect(can(record, MODULE.PRODUCTION, ACTION.CREATE)).toBe(true);
      expect(can(record, MODULE.PRODUCTION, ACTION.DELETE)).toBe(false);
      expect(can(record, MODULE.ACCOUNTS, ACTION.VIEW)).toBe(false);
    });
  });

  it('gives an Employee no ERP access at all', () => {
    const record = { erpRoles: erpRolesFor('employee') };
    expect(erpRolesFor('employee')).toEqual([]);
    expect(collectRoles(record)).toEqual([]);
    expect(can(record, MODULE.PRODUCTION, ACTION.VIEW)).toBe(false);
    expect(can(record, MODULE.USERS, ACTION.CREATE)).toBe(false);
  });

  it('never returns a role the matrix does not know', () => {
    ['admin', 'manager', 'line_incharge', 'supervisor', 'employee'].forEach((value) => {
      erpRolesFor(value).forEach((role) => {
        // An unknown role would be dropped by collectRoles, i.e. a silent no-op grant.
        expect(collectRoles({ erpRoles: [role] })).toContain(role);
      });
    });
  });
});

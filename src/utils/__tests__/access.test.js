import { describe, it, expect } from 'vitest';
import { isElevatedRecord } from '../access';

/**
 * Tests for the admin-access predicate.
 *
 * This is a privilege check, so the tests are adversarial: they assert who is DENIED, not
 * only who is allowed. The predicate is shared by the admin sign-in and the admin route
 * guard, so a wrong answer here is a hole in the highest-privilege surface of the app.
 */
describe('isElevatedRecord', () => {
  it('admits the explicit super-admin flag', () => {
    expect(isElevatedRecord({ isSuperAdmin: true })).toBe(true);
  });

  it('admits role "admin" in any casing / padding', () => {
    expect(isElevatedRecord({ role: 'admin' })).toBe(true);
    expect(isElevatedRecord({ role: '  ADMIN ' })).toBe(true);
  });

  it('admits an admin entry in the roles array', () => {
    expect(isElevatedRecord({ roles: ['user', 'manager', 'admin'] })).toBe(true);
  });

  it('admits the explicit isAdmin flag', () => {
    expect(isElevatedRecord({ isAdmin: true })).toBe(true);
  });

  it('denies a manager, even though the session role is "admin"', () => {
    // The whole point of this check: an approved manager carries the session role 'admin'
    // for data-entry rights, and must still be refused the admin area.
    expect(isElevatedRecord({ role: 'manager', roles: ['user', 'manager'] })).toBe(false);
  });

  it('denies the floor roles', () => {
    ['line_incharge', 'supervisor', 'employee'].forEach((role) => {
      expect(isElevatedRecord({ role, roles: ['user'] })).toBe(false);
    });
  });

  it('denies a missing / empty / malformed record rather than defaulting open', () => {
    expect(isElevatedRecord(null)).toBe(false);
    expect(isElevatedRecord(undefined)).toBe(false);
    expect(isElevatedRecord({})).toBe(false);
    expect(isElevatedRecord({ role: '' })).toBe(false);
    expect(isElevatedRecord({ roles: null })).toBe(false);
    expect(isElevatedRecord({ roles: 'admin' })).toBe(false);
  });

  it('is not fooled by a non-boolean isAdmin', () => {
    // Only the literal `true` grants; a truthy string must not.
    expect(isElevatedRecord({ isAdmin: 'true' })).toBe(false);
    expect(isElevatedRecord({ isAdmin: 1 })).toBe(false);
  });
});

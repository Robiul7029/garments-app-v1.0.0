import { describe, it, expect } from 'vitest';

/**
 * The login screen routes on the INPUT TYPE alone:
 *   contains '@'  -> Email    -> Admin portal
 *   otherwise     -> Username -> Manager portal
 *
 * The fallback messages are asserted too, because they are the user-facing half of the
 * rule: an unauthorized attempt must be blocked with a clear ENGLISH message that does not
 * reveal whether the account exists.
 */
describe('portal routing by identifier', () => {
  it('treats an address as Email -> Admin portal', async () => {
    const { portalForIdentifier, LOGIN_PORTAL_ADMIN } = await import('../AuthContext');
    expect(portalForIdentifier('admin@email.com')).toBe(LOGIN_PORTAL_ADMIN);
    expect(portalForIdentifier('  boss@factory.co  ')).toBe(LOGIN_PORTAL_ADMIN);
  });

  it('treats a username / User ID as Username -> Manager portal', async () => {
    const { portalForIdentifier, LOGIN_PORTAL_MANAGER } = await import('../AuthContext');
    ['manager01', 'EMP-204', 'robiul', '  super-admin  '].forEach((id) => {
      expect(portalForIdentifier(id)).toBe(LOGIN_PORTAL_MANAGER);
    });
    expect(portalForIdentifier('')).toBe(LOGIN_PORTAL_MANAGER);
    expect(portalForIdentifier(undefined)).toBe(LOGIN_PORTAL_MANAGER);
  });

  it('keeps both fallback messages strictly in English', async () => {
    const { ADMIN_INVALID_MESSAGE, MANAGER_INVALID_MESSAGE } = await import('../AuthContext');
    expect(ADMIN_INVALID_MESSAGE).toBe('Invalid credentials for Admin portal.');
    expect(MANAGER_INVALID_MESSAGE).toBe('Invalid Username for Manager portal.');
    // No non-ASCII characters may creep into either one.
    expect(/^[\x20-\x7E]+$/.test(ADMIN_INVALID_MESSAGE)).toBe(true);
    expect(/^[\x20-\x7E]+$/.test(MANAGER_INVALID_MESSAGE)).toBe(true);
  });

  it('maps the recorded entry to the landing route', async () => {
    const { landingPathFor } = await import('../../utils/access');
    // Email + authorized -> Admin Panel.
    expect(landingPathFor(null, true, true)).toBe('/admin/workers');
    // Username -> Manager Access page, even for an account holding admin rights.
    expect(landingPathFor(null, true, false)).toBe('/');
    // Email without an admin right is not forced into the admin area.
    expect(landingPathFor(null, false, true)).toBe('/admin/workers');
  });
});

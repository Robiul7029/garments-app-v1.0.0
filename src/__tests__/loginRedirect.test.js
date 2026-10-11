import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { landingPathFor, isAdminEntry } from '../App';
import { LOGIN_ENTRY_KEY, LOGIN_ENTRY_STANDARD, LOGIN_ENTRY_ADMIN } from '../context/AuthContext';

/**
 * Tests for the entry-point-driven landing rule.
 *
 * The bug these guard against: `ProductionRoute` used to send ANY account holding admin
 * rights to /admin/workers, so an approver who deliberately signed in at the standard `/`
 * page was silently overridden into the admin dashboard. The landing now depends on which
 * login screen was used, not on the rights the account happens to hold.
 */

// A minimal sessionStorage so the helpers can be exercised outside a browser.
function installSessionStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

describe('landingPathFor — the entry point decides, not the role', () => {
  it('keeps a STANDARD sign-in on the Manager Dashboard even with admin rights', () => {
    // The headline rule: admin rights + standard entry => Manager Dashboard, NOT /admin.
    expect(landingPathFor(null, true, false)).toBe('/');
    expect(landingPathFor(null, true, LOGIN_ENTRY_STANDARD === LOGIN_ENTRY_ADMIN)).toBe('/');
  });

  it('sends an ADMIN sign-in with admin rights to the Admin Dashboard', () => {
    expect(landingPathFor(null, true, true)).toBe('/admin/workers');
  });

  it('never sends a non-elevated account to the admin area, whatever the marker', () => {
    expect(landingPathFor(null, false, true)).toBe('/');
    expect(landingPathFor(null, false, false)).toBe('/');
  });

  it('defaults the marker from the live session when not passed', () => {
    installSessionStorage({ [LOGIN_ENTRY_KEY]: LOGIN_ENTRY_ADMIN });
    expect(landingPathFor(null, true)).toBe('/admin/workers');

    installSessionStorage({ [LOGIN_ENTRY_KEY]: LOGIN_ENTRY_STANDARD });
    expect(landingPathFor(null, true)).toBe('/');
  });
});

describe('isAdminEntry — reads the marker the login paths write', () => {
  afterEach(() => { delete globalThis.sessionStorage; });

  it('is false with no marker, and for the standard marker', () => {
    installSessionStorage();
    expect(isAdminEntry()).toBe(false);

    installSessionStorage({ [LOGIN_ENTRY_KEY]: LOGIN_ENTRY_STANDARD });
    expect(isAdminEntry()).toBe(false);
  });

  it('is true only for the admin marker', () => {
    installSessionStorage({ [LOGIN_ENTRY_KEY]: LOGIN_ENTRY_ADMIN });
    expect(isAdminEntry()).toBe(true);
  });

  it('fails closed when sessionStorage is unavailable (blocked storage)', () => {
    globalThis.sessionStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => {}, removeItem: () => {}, clear: () => {},
    };
    expect(isAdminEntry()).toBe(false);
  });
});

describe('the marker constants', () => {
  it('uses distinct, stable values', () => {
    expect(LOGIN_ENTRY_STANDARD).not.toBe(LOGIN_ENTRY_ADMIN);
    expect(LOGIN_ENTRY_KEY).toBe('loginEntry');
  });
});

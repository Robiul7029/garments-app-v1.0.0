import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ErpNavGroup from '../../components/erp/ErpNavGroup';
import { AuthContext } from '../../context/AuthContext';
import { ErpDataProvider } from '../../context/ErpDataContext';
import { PermissionProvider } from '../../context/PermissionContext';
import { MODULE, PERMISSIONS, ROLES } from '../erpRoles';

/**
 * Renders the REAL ERP navigation group through the real providers — only the
 * session is supplied, by satisfying AuthContext.
 *
 * Why this shape: PermissionContext and ErpDataContext are internal (their
 * providers are exported, the contexts are not), so the sidebar is given the
 * genuine providers rather than a fake context object. That means this exercises
 * `usePermissions` and the role matrix exactly as the app does — which is the
 * part that decides whether a section appears at all.
 */
function renderNav(session) {
  const auth = {
    user: session,
    loading: false,
    authReady: true,
    usersVersion: 0,
    getLiveStatus: () => 'approved',
  };
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/erp/orders']}>
      <AuthContext.Provider value={auth}>
        <ErpDataProvider>
          <PermissionProvider>
            <ErpNavGroup open onToggle={() => {}} />
          </PermissionProvider>
        </ErpDataProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('the ERP sidebar navigation', () => {
  it('renders nothing for a user who holds no ERP role', () => {
    // No uid means PermissionProvider has no record to read roles from, which is
    // exactly the state of a signed-in user holding no ERP role.
    expect(renderNav({ id: '', email: 'viewer@example.com' })).toBe('');
  });

  it('does not throw when there is no signed-in user at all', () => {
    expect(() => renderNav(null)).not.toThrow();
  });
});

describe('the sections the sidebar is built from', () => {
  const NEW_KEYS = [
    ['Order Management', MODULE.ORDERS],
    ['TNA Management', MODULE.PLANNING],
    ['Operator Performance', MODULE.OPERATOR_PERFORMANCE],
    ['Quality Control', MODULE.QUALITY],
    ['Manpower Management', MODULE.MANPOWER],
  ];

  it('grants each new module to at least one role, so it can appear', () => {
    NEW_KEYS.forEach(([label, key]) => {
      const holders = Object.keys(PERMISSIONS).filter((role) => (PERMISSIONS[role]?.[key] || []).includes('view'));
      expect(holders.length, `${label} is granted to nobody and can never be shown`).toBeGreaterThan(0);
    });
  });

  it('gives each new module a distinct key', () => {
    const keys = NEW_KEYS.map(([, k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('grants the expected rights to the owning roles', () => {
    expect(PERMISSIONS[ROLES.SUPERVISOR][MODULE.QUALITY]).toContain('view');
    expect(PERMISSIONS[ROLES.QC][MODULE.QUALITY]).toContain('create');
    expect(PERMISSIONS[ROLES.PLANNING][MODULE.PLANNING]).toContain('edit');
    expect(PERMISSIONS[ROLES.HR][MODULE.MANPOWER]).toContain('delete');
    expect(PERMISSIONS[ROLES.PRODUCTION_MANAGER][MODULE.OPERATOR_PERFORMANCE]).toContain('view');
  });

  it('keeps Operator Performance read-only for QC', () => {
    // QC inspects the product; it does not mark operators. A write right here
    // would be a data-integrity problem, not a convenience.
    expect(PERMISSIONS[ROLES.QC][MODULE.OPERATOR_PERFORMANCE]).toContain('view');
    expect(PERMISSIONS[ROLES.QC][MODULE.OPERATOR_PERFORMANCE]).not.toContain('edit');
    expect(PERMISSIONS[ROLES.QC][MODULE.OPERATOR_PERFORMANCE]).not.toContain('delete');
  });
});

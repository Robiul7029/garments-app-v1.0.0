import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ErpNavGroup from '../../components/erp/ErpNavGroup';
import { PermissionContext } from '../../context/PermissionContext';
import { ErpDataContext } from '../../context/ErpDataContext';
import { MODULE } from '../erpRoles';

/**
 * Renders the real ERP navigation group and asserts the five new sections are
 * actually in the markup a user sees.
 *
 * The sidebar is driven by `permissions.canView`, so this renders it twice: once
 * as a Super Admin (everything visible) and once as a role that holds only one of
 * the new modules, which is what proves the entries are permission-gated rather
 * than merely always-on.
 */
const NOOP_ERP = {
  subscribe: () => () => { },
  rows: () => [],
  isLoading: () => false,
  errorFor: () => '',
};

function permissionsFor(viewable, { isSuperAdmin = false } = {}) {
  const allowed = new Set(viewable);
  return {
    loading: false,
    record: isSuperAdmin ? { isSuperAdmin: true } : { erpRole: 'supervisor' },
    uid: 'qa',
    actorName: 'QA',
    roles: isSuperAdmin ? ['super_admin'] : ['supervisor'],
    unknownRoles: [],
    isSuperAdmin,
    canView: (key) => allowed.has(key),
    can: (key) => allowed.has(key),
    actionsOn: () => new Set(),
    visibleModules: [...allowed],
    hasAnyRole: () => true,
    hasErpAccess: true,
  };
}

function renderNav(viewable, opts) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/erp/orders']}>
      <PermissionContext.Provider value={permissionsFor(viewable, opts)}>
        <ErpDataContext.Provider value={NOOP_ERP}>
          <ErpNavGroup open onToggle={() => { }} />
        </ErpDataContext.Provider>
      </PermissionContext.Provider>
    </MemoryRouter>,
  );
}

const ALL_KEYS = Object.values(MODULE);

describe('the ERP sidebar navigation', () => {
  const html = renderNav(ALL_KEYS, { isSuperAdmin: true });

  it('shows all five requested sections', () => {
    ['Order Management', 'TNA Management', 'Quality Control', 'Operator Performance', 'Manpower Management']
      .forEach((label) => expect(html, `${label} missing from the sidebar`).toContain(label));
  });

  it('still shows the modules that were already there', () => {
    ['Management Dashboard', 'Inventory &amp; Stock', 'Reports', 'Alert Center', 'Audit Log']
      .forEach((label) => expect(html).toContain(label));
  });

  it('renders the Order Management group as an expandable parent', () => {
    // The parent carries the disclosure chevron and aria-expanded.
    expect(html).toContain('sidebar-item-parent');
    expect(html).toContain('aria-expanded');
  });

  it('does not list a module twice', () => {
    const occurrences = (html.match(/TNA Management/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('hides a module the role cannot view', () => {
    // A Supervisor holds Production + Quality, but not TNA or Manpower.
    const supervisorHtml = renderNav([MODULE.DASHBOARD, MODULE.PRODUCTION, MODULE.QUALITY, MODULE.OPERATOR_PERFORMANCE, MODULE.MANPOWER, MODULE.REPORTS]);
    expect(supervisorHtml).toContain('Quality Control');
    expect(supervisorHtml).toContain('Operator Performance');
    expect(supervisorHtml).toContain('Manpower Management');
    // Not granted to a supervisor, so it must be absent rather than merely disabled.
    expect(supervisorHtml).not.toContain('TNA Management');
  });

  it('renders nothing at all for a user with no ERP access', () => {
    const none = renderNav([]);
    expect(none).not.toContain('Order Management');
    expect(none).not.toContain('TNA Management');
  });

  it('keeps the alert badge only on the Alert Center entry', () => {
    // No alerts loaded in this harness, so no badge should be rendered.
    expect(html).not.toContain('erp-nav-badge');
  });
});

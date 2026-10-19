import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { menu, navigableTargets, childTargetsOf } from '../menuConfig';
import Sidebar from '../../components/Sidebar';
import { AuthContext } from '../../context/AuthContext';
import { DataContext } from '../../context/DataContext';
import { RoleProvider } from '../../context/RoleContext';
import ManpowerManagementTabs from '../../pages/ManpowerManagementTabs';

/**
 * Manpower Management in the LEGACY sidebar (menuConfig.js).
 *
 * The drawer used to render it as an accordion with two sub-items (Line
 * Deployment, Absenteeism), so reaching either screen meant opening the drawer,
 * expanding the group and clicking again. It is now ONE entry that opens one
 * page, whose two sections are a horizontal tab bar inside that page.
 *
 * These assertions are on the legacy config, which is the menu a normal user
 * actually sees.
 */
const manpowerCategory = () => menu.find((c) => c.key === 'manpower');

describe('Manpower Management in the sidebar menu', () => {
  it('is a single item, so the drawer shows no sub-menu', () => {
    const items = manpowerCategory().items;
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('Manpower Management');
    expect(items[0].variant).toBe('manpower-management-tabs');
  });

  it('has no nested children, so the accordion branch cannot render', () => {
    expect(childTargetsOf('manpower', 'manpower-management')).toEqual([]);
    manpowerCategory().items.forEach((item) => {
      expect(Array.isArray(item.children) ? item.children : []).toHaveLength(0);
    });
  });

  it('no longer routes the two old sub-screens as separate pages', () => {
    const paths = navigableTargets().map((t) => t.path);
    expect(paths).toContain('/manpower/manpower-management');
    // The accordion's items must be gone from the route set, or the drawer could
    // still be pointed at the old standalone screens.
    expect(paths).not.toContain('/manpower/manpower-deployment');
    expect(paths).not.toContain('/manpower/manpower-absent');
  });

  it('renders the sidebar entry as a plain item with no disclosure control', () => {
    // AdminAccessContext is module-private, but `useAdminAccess()` already falls
    // back to `{ elevated: false }` with no provider — which is the non-admin
    // branch this test wants, so the provider is simply omitted.
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/manpower/manpower-management']}>
        <AuthContext.Provider value={{ user: { id: 'qa', role: 'admin' }, authReady: true }}>
          <Sidebar defaultOpen />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(html).toContain('Manpower Management');
    expect(html).not.toContain('sidebar-subitems');
    // The two old sub-item labels are gone from the drawer itself.
    expect(html).not.toContain('Line Deployment');
    expect(html).not.toContain('Absenteeism');
  });
});

describe('Manpower Management tab host', () => {
  const renderTabs = () => renderToStaticMarkup(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 'qa', role: 'admin' }, authReady: true }}>
        <DataContext.Provider value={{
          getData: () => [], addEntry: () => { }, updateEntry: () => { },
          deleteEntry: () => { }, setRaw: () => { },
        }}
        >
          <RoleProvider>
            <ManpowerManagementTabs />
          </RoleProvider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );

  it('renders both sections as horizontal tabs', () => {
    const html = renderTabs();
    const tabs = [...html.matchAll(/role="tab"/g)];
    expect(tabs).toHaveLength(2);
    expect(html).toContain('Line Deployment');
    expect(html).toContain('Absenteeism');
    // Line Deployment is first and selected on load.
    expect(html.indexOf('Line Deployment')).toBeLessThan(html.indexOf('Absenteeism'));
    expect(html).toMatch(/aria-selected="true"[^>]*>\s*<span[^>]*>👥<\/span> Line Deployment/);
  });

  it('is a real tab control, not two plain buttons', () => {
    const html = renderTabs();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-controls="mp-panel-deployment"');
    expect(html).toContain('aria-controls="mp-panel-absenteeism"');
  });

  it('mounts only the active tab, not the screen behind it', () => {
    const html = renderTabs();
    // The Absenteeism table must not exist while Line Deployment is open.
    expect(html).not.toContain('Absent Count');
  });
});

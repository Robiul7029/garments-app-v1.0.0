import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { menu, navigableTargets, childTargetsOf } from '../menuConfig';
import Sidebar from '../../components/Sidebar';
import { AuthContext } from '../../context/AuthContext';
import OrderManagementTabs from '../../pages/OrderManagementTabs';
import { DataContext } from '../../context/DataContext';
import { RoleProvider } from '../../context/RoleContext';

/**
 * Order Management in the LEGACY sidebar (menuConfig.js).
 *
 * This is the menu the drawer actually renders for a normal user — the ERP
 * section is a separate, additive group. The bug this covers: the ERP registry
 * had already been converted to tabs while the legacy category still declared
 * three items, so the drawer kept showing the old accordion and the tab bar
 * never appeared. The assertions below are on the legacy config, which is the
 * one a user sees.
 */
const ordersCategory = () => menu.find((c) => c.key === 'orders');

describe('Order Management in the sidebar menu', () => {
  it('is a single item, so the drawer shows no sub-menu', () => {
    const items = ordersCategory().items;
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('Order Management');
    expect(items[0].variant).toBe('order-management-tabs');
  });

  it('has no nested children, so the accordion branch cannot render', () => {
    // childTargetsOf drives the nested sub-item list; empty means the sidebar
    // renders a plain navigating button instead of a disclosure control.
    expect(childTargetsOf('orders', 'order-management')).toEqual([]);
    ordersCategory().items.forEach((item) => {
      expect(Array.isArray(item.children) ? item.children : []).toHaveLength(0);
    });
  });

  it('no longer routes the three old sub-screens as separate pages', () => {
    const paths = navigableTargets().map((t) => t.path);
    expect(paths).toContain('/orders/order-management');
    // The accordion's items must be gone from the route set, or the drawer
    // could still be pointed at the old standalone screens.
    expect(paths).not.toContain('/orders/order-list');
    expect(paths).not.toContain('/orders/order-input');
    expect(paths).not.toContain('/orders/process-upload');
  });

  it('renders the sidebar entry as a plain item with no disclosure control', () => {
    // AdminAccessContext is module-private, but `useAdminAccess()` already
    // falls back to `{ elevated: false }` with no provider — which is the
    // non-admin branch this test wants, so the provider is simply omitted.
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/orders/order-management']}>
        <AuthContext.Provider value={{ user: { id: 'qa', role: 'admin' }, authReady: true }}>
          <Sidebar defaultOpen />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(html).toContain('Order Management');
    // No nested group, and none of the old sub-item labels anywhere in the drawer.
    expect(html).not.toContain('sidebar-subitems');
    expect(html).not.toContain('Process Sheet Upload');
  });
});

describe('Order Management tab host', () => {
  const renderTabs = () => renderToStaticMarkup(
    <DataContext.Provider value={{
      getData: () => [], addEntry: () => { }, updateEntry: () => { },
      deleteEntry: () => { }, setRaw: () => { },
    }}
    >
      <RoleProvider>
        <OrderManagementTabs />
      </RoleProvider>
    </DataContext.Provider>,
  );

  it('renders the three tabs in order', () => {
    const html = renderTabs();
    const labels = [...html.matchAll(/role="tab"[^>]*>.*?<\/button>/g)].map((m) => m[0]);
    expect(labels).toHaveLength(3);
    expect(html).toContain('Order List');
    expect(html).toContain('Order Input');
    expect(html).toContain('Process Sheet Upload');
    // Order List is first and marked selected on load.
    expect(html.indexOf('Order List')).toBeLessThan(html.indexOf('Order Input'));
    expect(html).toMatch(/aria-selected="true"[^>]*>\s*<span[^>]*>📋<\/span> Order List/);
  });

  it('mounts only the active tab, not the forms behind it', () => {
    const html = renderTabs();
    // The Order Input form's fields must not exist while the list is open.
    expect(html).not.toContain('oi-buyer');
    expect(html).not.toContain('Save Order');
  });

  it('is a real tab control, not three plain buttons', () => {
    const html = renderTabs();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-controls="om-panel-list"');
  });
});

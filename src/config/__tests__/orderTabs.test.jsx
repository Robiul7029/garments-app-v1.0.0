import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  LIVE_ERP_MODULES, erpRoutes, erpTabPath, erpTabsForPath, erpModulePath,
} from '../erpMenu';
import { PermissionContext } from '../../context/PermissionContext';
import { ErpDataContext } from '../../context/ErpDataContext';
import ErpNavGroup from '../../components/erp/ErpNavGroup';
import { MODULE } from '../erpRoles';

/**
 * Order Management as a TABBED module.
 *
 * The three tabs (Order List / Order Input / Process Sheet Upload) are claims
 * about the registry, the router and the sidebar at once, so they are asserted
 * here rather than eyeballed:
 *
 *   1. the module declares the three tabs, in order, with Order List the index
 *   2. every tab has a real route, and path -> tab resolution round-trips
 *   3. the sidebar shows it as ONE item, not an accordion of sub-items
 *
 * The live screens behind the tabs are not mounted: Order Input and the process
 * upload reach for app-wide data providers, so mounting them would test those
 * providers instead of the tab wiring.
 */
const orders = () => LIVE_ERP_MODULES.find((m) => m.key === MODULE.ORDERS);

const NOOP_ERP = { subscribe: () => () => { }, rows: () => [], isLoading: () => false, errorFor: () => '' };

function permissionsFor(viewable = [MODULE.ORDERS]) {
  const allowed = new Set(viewable);
  return {
    loading: false,
    record: { isSuperAdmin: true },
    uid: 'qa',
    actorName: 'QA',
    roles: ['super_admin'],
    unknownRoles: [],
    isSuperAdmin: true,
    canView: (key) => allowed.has(key),
    can: (key) => allowed.has(key),
    actionsOn: () => new Set(),
    visibleModules: [...allowed],
    hasAnyRole: () => true,
    hasErpAccess: true,
  };
}

function renderNav(path) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <PermissionContext.Provider value={permissionsFor()}>
        <ErpDataContext.Provider value={NOOP_ERP}>
          <ErpNavGroup open onToggle={() => { }} />
        </ErpDataContext.Provider>
      </PermissionContext.Provider>
    </MemoryRouter>,
  );
}

describe('Order Management tabs', () => {
  it('declares the three tabs in order, with Order List as the index', () => {
    const tabs = orders().tabs;
    expect(tabs).toBeTruthy();
    expect(tabs.map((t) => t.label)).toEqual(['Order List', 'Order Input', 'Process Sheet Upload']);
    expect(tabs.map((t) => t.key)).toEqual(['list', 'order-input', 'process-breakdown']);
    expect((tabs.find((t) => t.index) || {}).key).toBe('list');
  });

  it('gives every tab a component and a description', () => {
    orders().tabs.forEach((t) => {
      expect(typeof t.component).toBe('function');
      expect(t.description).toBeTruthy();
    });
  });

  it('is a tabbed module, not an accordion of children', () => {
    // The sidebar renders `children` as expandable sub-items; Order Management
    // must declare tabs instead, so that it collapses to a single entry.
    expect(orders().children).toBeUndefined();
    expect(Array.isArray(orders().tabs)).toBe(true);
  });

  it('routes the index tab at the module path and each later tab below it', () => {
    const paths = erpRoutes().filter((r) => r.moduleKey === MODULE.ORDERS).map((r) => r.path);
    expect(paths).toContain('/erp/orders');
    expect(paths).toContain('/erp/orders/order-input');
    expect(paths).toContain('/erp/orders/process-breakdown');
  });

  it('resolves the active tab from the URL, including the bare module path', () => {
    expect(erpTabsForPath('/erp/orders').activeKey).toBe('list');
    expect(erpTabsForPath('/erp/orders/order-input').activeKey).toBe('order-input');
    expect(erpTabsForPath('/erp/orders/process-breakdown').activeKey).toBe('process-breakdown');
    // An unknown segment lands on the index tab rather than a blank screen, so a
    // stale bookmark still opens something usable.
    expect(erpTabsForPath('/erp/orders/nope').activeKey).toBe('list');
  });

  it('builds the index tab URL without a redundant segment', () => {
    const tabs = orders().tabs;
    expect(erpTabPath(MODULE.ORDERS, tabs[0])).toBe(erpModulePath(MODULE.ORDERS));
    expect(erpTabPath(MODULE.ORDERS, tabs[1])).toBe('/erp/orders/order-input');
    expect(erpTabPath(MODULE.ORDERS, tabs[2])).toBe('/erp/orders/process-breakdown');
  });

  it('reports no tabs for a module that is not tabbed', () => {
    // Order Management, Line Input & WIP and the Cutting Department are all
    // TABBED modules, so they are excluded here; every other live module must
    // resolve to null rather than to a tab set that does not exist.
    const TABBED = [MODULE.ORDERS, MODULE.LINE_INPUT, MODULE.PRODUCTION_CUTTING];
    LIVE_ERP_MODULES
      .filter((m) => !TABBED.includes(m.key) && m.component)
      .forEach((m) => expect(erpTabsForPath(erpModulePath(m.key))).toBeNull());
  });

  it('shows Order Management in the sidebar as ONE item, with no sub-item links', () => {
    const html = renderNav('/erp/orders');
    expect(html).toContain('Order Management');
    // The tab screens must not leak into the drawer as accordion sub-items.
    expect(html).not.toContain('Order Input');
    expect(html).not.toContain('Process Sheet Upload');
    expect(html).not.toContain('sidebar-subitems');
  });

  it('keeps Order Management highlighted while any of its tabs is open', () => {
    ['/erp/orders', '/erp/orders/order-input', '/erp/orders/process-breakdown'].forEach((path) => {
      const html = renderNav(path);
      // Match the one sidebar entry carrying `active` (not `sidebar-cat-link
      // active`, which is the enclosing ERP group button) and read its label.
      const active = [...html.matchAll(/<button class="sidebar-item active"[^>]*>(.*?)<\/button>/g)];
      expect(active, `no active entry at ${path}`).toHaveLength(1);
      expect(active[0][1]).toContain('Order Management');
    });
  });
});

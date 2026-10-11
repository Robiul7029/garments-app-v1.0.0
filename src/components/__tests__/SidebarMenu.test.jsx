import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../Sidebar';
import { AuthContext } from '../../context/AuthContext';
import { menu, modulePath } from '../../config/menuConfig';

/**
 * Renders the REAL main Sidebar and asserts the five new sections are in the
 * markup a signed-in user sees.
 *
 * This is the test that was missing: the five sections were previously only in
 * the separate ERP nav group, which renders nothing for a user with no ERP role —
 * so they never appeared in the main drawer. The assertions below are written
 * against the main drawer specifically.
 */
function renderSidebar() {
  const auth = {
    user: { id: 'qa', email: 'qa@example.com', role: 'admin', status: 'approved' },
    loading: false,
    authReady: true,
    usersVersion: 0,
    getLiveStatus: () => 'approved',
  };
  // Only AuthContext is supplied. The Sidebar reads `authReady` (to enable the
  // drawer button) and `useAdminAccess` — which returns its default when its
  // provider is absent, so the general menu branch renders. Passing the data
  // providers here would drag in Firestore subscriptions that are irrelevant to
  // what is being asserted: which categories the menu array holds.
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/']}>
      <AuthContext.Provider value={auth}>
        <Sidebar />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

/**
 * Renders the drawer in its OPEN state.
 *
 * The Sidebar keeps its panel behind a `panelOpen` flag, so the categories only
 * exist in the markup while it is open. There is no prop to force it, and driving
 * a click needs a DOM the server renderer does not have — so the flag is flipped
 * by rendering the component with its own state already initialised, via a tiny
 * wrapper that calls the same code path the button click would.
 *
 * If the component's internals are ever refactored such that this breaks, the
 * suite fails loudly rather than silently asserting nothing — which is the point.
 */
function renderOpenSidebar() {
  const auth = {
    user: { id: 'qa', email: 'qa@example.com', role: 'admin', status: 'approved' },
    loading: false,
    authReady: true,
    usersVersion: 0,
    getLiveStatus: () => 'approved',
  };
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/']}>
      <AuthContext.Provider value={auth}>
        {/* `defaultOpen` renders the drawer expanded. It is the same branch the ☰
            click takes, so the assertions below run against the real drawer body
            rather than a reconstruction of it. */}
        <Sidebar defaultOpen />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('the main sidebar menu array', () => {
  const NEW_CATEGORIES = [
    { key: 'orders', label: 'Order Management' },
    { key: 'tna', label: 'TNA Management' },
    { key: 'manpower', label: 'Manpower Management' },
    { key: 'operator', label: 'Operator Performance' },
    { key: 'qc', label: 'Quality Control' },
  ];

  it('declares all five as top-level categories', () => {
    NEW_CATEGORIES.forEach(({ key, label }) => {
      const cat = menu.find((c) => c.key === key);
      expect(cat, `${label} is not a category in the sidebar menu`).toBeTruthy();
      expect(cat.label).toBe(label);
      expect(cat.icon).toBeTruthy();
      expect(Array.isArray(cat.items)).toBe(true);
      expect(cat.items.length).toBeGreaterThan(0);
    });
  });

  it('keeps every category that was already there', () => {
    ['production', 'cutting', 'attendance', 'finishing', 'washing', 'delivery', 'leave']
      .forEach((key) => expect(menu.find((c) => c.key === key), `${key} was removed`).toBeTruthy());
  });

  it('gives every new category item a key, a label and an icon', () => {
    NEW_CATEGORIES.forEach(({ key }) => {
      menu.find((c) => c.key === key).items.forEach((item) => {
        expect(item.key, 'an item has no key, so it would render an unusable route').toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(item.icon).toBeTruthy();
      });
    });
  });

  it('builds a distinct path for every new item', () => {
    const paths = [];
    NEW_CATEGORIES.forEach(({ key }) => {
      const cat = menu.find((c) => c.key === key);
      cat.items.forEach((item) => paths.push(modulePath(key, item.key)));
    });
    expect(new Set(paths).size).toBe(paths.length);
    paths.forEach((p) => {
      expect(p.startsWith('/')).toBe(true);
      expect(p).not.toMatch(/undefined/);
    });
  });

  it('gives Order Management the Order Input and Process Sheet Upload submenu', () => {
    const orders = menu.find((c) => c.key === 'orders');
    const labels = orders.items.map((i) => i.label);
    expect(labels).toContain('Order Input');
    expect(labels).toContain('Process Sheet Upload');
    // The upload sits directly under Order Input, as the workflow reads.
    expect(labels.indexOf('Process Sheet Upload')).toBe(labels.indexOf('Order Input') + 1);
  });
});

describe('the rendered sidebar', () => {
  it('renders the drawer bar when closed', () => {
    expect(renderSidebar()).toContain('sidebar-bar');
  });

  it('mounts every category in the drawer once it is open', () => {
    // The drawer body only exists while the panel is open. Rendering it open is
    // what actually proves the five new groups reach the screen — asserting on
    // the menu array alone would pass even if the render loop skipped them.
    const html = renderOpenSidebar();
    ['Dashboard', 'Sewing Department', 'Cutting Department', 'Attendance']
      .forEach((label) => expect(html, `${label} missing`).toContain(label));
  });

  it('shows the five new sections in the open drawer', () => {
    const html = renderOpenSidebar();
    ['Order Management', 'TNA Management', 'Manpower Management', 'Operator Performance', 'Quality Control']
      .forEach((label) => expect(html, `${label} is not in the sidebar`).toContain(label));
  });
});

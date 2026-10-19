import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { menu, navigableTargets, childTargetsOf } from '../menuConfig';
import Sidebar from '../../components/Sidebar';
import { AuthContext } from '../../context/AuthContext';

/**
 * Hourly Production in the LEGACY sidebar (menuConfig.js).
 *
 * The Sewing Department sidebar now shows only the working screens (Daily
 * Production, Worker Production, Quality Control, Line Production, Production
 * Report). Hourly Production is no longer a visible item: it remains a routable
 * target so an existing bookmark to /production/hourly-production keeps working,
 * but it is hidden from the drawer.
 */
const productionCategory = () => menu.find((c) => c.key === 'production');
const hourlyItem = () => productionCategory().items.find((i) => i.key === 'hourly-production');

describe('Hourly Production in the sidebar menu', () => {
  it('is hidden from the visible Sewing Department items', () => {
    // The working screens are all that remain visible.
    expect(productionCategory().items.map((i) => i.key)).toEqual([
      'daily-production',
      'worker-production',
      'quality-control',
      'line-production',
      'production-report',
    ]);
    expect(hourlyItem()).toBeUndefined();
  });

  it('is still reachable as a hidden navigable target', () => {
    const target = navigableTargets().find((t) => t.path === '/production/hourly-production');
    expect(target).toBeTruthy();
    expect(target.sidebarHidden).toBe(true);
    expect(target.item.variant).toBe('hourly-timesheet');
  });

  it('has no nested children, so no sub-menu is rendered', () => {
    expect(childTargetsOf('production', 'hourly-production')).toEqual([]);
  });

  it('is a navigable target in its own right', () => {
    const target = navigableTargets().find((t) => t.path === '/production/hourly-production');
    expect(target).toBeTruthy();
    // Not a parent, so the drawer renders it as a plain navigating button.
    expect(target.isParent).toBe(false);
  });

  it('no longer routes the old nested sub-item', () => {
    const paths = navigableTargets().map((t) => t.path);
    expect(paths).not.toContain('/production/hourly-production/daily-production-entry');
  });

  it('renders the drawer without the removed sub-item label', () => {
    // The Sewing Department is a multi-item group, so it renders collapsed and
    // its items are not in the static markup — what this proves is that the
    // drawer builds cleanly from the config and nowhere contains the nested
    // sub-item that was removed.
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/production/hourly-production']}>
        <AuthContext.Provider value={{ user: { id: 'qa', role: 'admin' }, authReady: true }}>
          <Sidebar defaultOpen />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(html).toContain('Sewing Department');
    expect(html).not.toContain('Daily Production Entry');
    expect(html).not.toContain('sidebar-subitems');
  });
});

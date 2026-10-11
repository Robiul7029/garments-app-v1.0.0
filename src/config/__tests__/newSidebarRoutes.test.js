import { describe, it, expect } from 'vitest';
import { menu, modulePath, navigableTargets } from '../menuConfig';

/**
 * Every item in the five new sidebar categories must have a route, and the route
 * must be the one the sidebar would navigate to.
 *
 * The router (App.jsx) and the sidebar are both generated from `navigableTargets()`
 * / `modulePath()`, so this pins that a new menu item cannot appear in the drawer
 * without a matching route — the failure mode that would send a click to the
 * catch-all and bounce the user back to the Dashboard.
 */
const NEW_CATS = ['orders', 'tna', 'manpower', 'operator', 'qc'];

describe('routes for the five new sidebar sections', () => {
  it('has a navigable target for every item in every new category', () => {
    const targets = navigableTargets();
    const paths = new Set(targets.map((t) => t.path));
    NEW_CATS.forEach((catKey) => {
      const cat = menu.find((c) => c.key === catKey);
      expect(cat, `${catKey} missing from the menu`).toBeTruthy();
      cat.items.forEach((item) => {
        const path = modulePath(catKey, item.key);
        expect(paths.has(path), `${path} has no route`).toBe(true);
      });
    });
  });

  it('routes each item to its own category, so the page can breadcrumb', () => {
    const targets = navigableTargets();
    NEW_CATS.forEach((catKey) => {
      const cat = menu.find((c) => c.key === catKey);
      cat.items.forEach((item) => {
        const target = targets.find((t) => t.path === modulePath(catKey, item.key));
        expect(target.category.key).toBe(catKey);
        expect(target.item.key).toBe(item.key);
      });
    });
  });

  it('lists every new item exactly once', () => {
    const targets = navigableTargets().map((t) => t.path);
    const newPaths = NEW_CATS.flatMap((catKey) => {
      const cat = menu.find((c) => c.key === catKey);
      return cat.items.map((i) => modulePath(catKey, i.key));
    });
    expect(newPaths.length).toBe(new Set(newPaths).size);
    newPaths.forEach((p) => expect(targets.filter((t) => t === p)).toHaveLength(1));
  });

  it('does not collide with an existing department path', () => {
    // e.g. a new 'production/qc-check' must not clash with the Sewing group.
    const all = navigableTargets().map((t) => t.path);
    expect(all.length).toBe(new Set(all).size);
  });

  it('gives the Order Management submenu real, distinct paths', () => {
    expect(modulePath('orders', 'order-input')).toBe('/orders/order-input');
    expect(modulePath('orders', 'process-upload')).toBe('/orders/process-upload');
    expect(modulePath('orders', 'order-list')).toBe('/orders/order-list');
  });
});

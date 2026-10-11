import { describe, it, expect } from 'vitest';
import { menu, modulePath, childModulePath, findModuleItem } from '../menuConfig';

/**
 * The navigation and the router are both generated from `menu`, so a nested
 * entry that exists in one but not the other is a dead link. These tests pin the
 * contract the Sidebar and App.jsx both rely on.
 */
describe('nested navigation', () => {
  const nestedItems = [];
  menu.forEach((cat) => {
    (cat.items || []).forEach((item) => {
      (item.children || []).forEach((child) => {
        nestedItems.push({ cat, parent: item, child });
      });
    });
  });

  it('declares at least the Daily Production Entry nested item', () => {
    const found = nestedItems.find((n) => n.child.key === 'daily-production-entry');
    expect(found).toBeTruthy();
    expect(found.parent.key).toBe('hourly-production');
    expect(found.cat.key).toBe('production');
  });

  it('nests it under Hourly Production, which is inside the Sewing Department', () => {
    const parent = findModuleItem('production', 'hourly-production');
    expect(parent).toBeTruthy();
    expect(Array.isArray(parent.item.children)).toBe(true);
    expect(parent.item.children.map((c) => c.key)).toContain('daily-production-entry');
  });

  it('gives every nested child a key, a label and an icon', () => {
    expect(nestedItems.length).toBeGreaterThan(0);
    nestedItems.forEach(({ child }) => {
      expect(child.key).toBeTruthy();
      expect(child.label).toBeTruthy();
      expect(child.icon).toBeTruthy();
    });
  });

  it('builds a distinct, 3-segment path for each nested item', () => {
    nestedItems.forEach(({ cat, parent, child }) => {
      const parentPath = modulePath(cat.key, parent.key);
      const nestedPath = childModulePath(cat.key, parent.key, child.key);
      expect(nestedPath).toBe(`${parentPath}/${child.key}`);
      // The nested path must not collide with the parent's own route.
      expect(nestedPath).not.toBe(parentPath);
      // Three segments: /category/parent/child.
      expect(nestedPath.split('/').filter(Boolean)).toHaveLength(3);
    });
  });

  it('never lets a child key collide with a sibling in the same category', () => {
    const seen = new Set();
    menu.forEach((cat) => {
      (cat.items || []).forEach((item) => {
        (item.children || []).forEach((child) => {
          const path = childModulePath(cat.key, item.key, child.key);
          expect(seen.has(path)).toBe(false);
          seen.add(path);
        });
      });
    });
  });

  it('keeps the parent reachable at its own route for existing bookmarks', () => {
    // The sidebar uses the parent as a disclosure control, but the menu item is
    // still in the config at its original path — nothing was renamed or moved.
    expect(modulePath('production', 'hourly-production')).toBe('/production/hourly-production');
  });

  it('leaves every other item free of nested children', () => {
    const daily = findModuleItem('production', 'daily-production');
    expect(daily.item.children).toBeUndefined();
    const line = findModuleItem('production', 'production-line');
    expect(line.item.children).toBeUndefined();
  });
});

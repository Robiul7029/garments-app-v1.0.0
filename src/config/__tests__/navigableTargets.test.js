import { describe, it, expect } from 'vitest';
import {
  menu, modulePath, childModulePath, navigableTargets, childTargetsOf,
} from '../menuConfig';

/**
 * `navigableTargets()` is the single flattened path set behind BOTH the router
 * (App.jsx) and the sidebar. If these two ever disagree the user gets a button
 * that navigates nowhere — the exact bug this helper was introduced to prevent —
 * so the contract is pinned here.
 */
describe('navigableTargets', () => {
  const targets = navigableTargets();

  it('emits every top-level menu item', () => {
    const topLevel = targets.filter((t) => t.depth === 0);
    const expected = menu.flatMap((cat) => (cat.items || []).filter((i) => i?.key).map((i) => modulePath(cat.key, i.key)));
    expect(topLevel.map((t) => t.path).sort()).toEqual(expected.sort());
  });

  it('emits a nested target for every declared child', () => {
    menu.forEach((cat) => {
      (cat.items || []).forEach((item) => {
        (item.children || []).forEach((child) => {
          const path = childModulePath(cat.key, item.key, child.key);
          const found = targets.find((t) => t.path === path);
          expect(found, `${path} should be a navigable target`).toBeTruthy();
          expect(found.depth).toBe(1);
          expect(found.item.key).toBe(child.key);
          // The parent travels with the child so the page can breadcrumb back.
          expect(found.parentItem.key).toBe(item.key);
        });
      });
    });
  });

  it('produces no duplicate paths', () => {
    const paths = targets.map((t) => t.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('starts every path with a slash and has no empty segments', () => {
    targets.forEach((t) => {
      expect(t.path.startsWith('/')).toBe(true);
      expect(t.path.split('/').filter(Boolean).length).toBeGreaterThanOrEqual(2);
      expect(t.path).not.toMatch(/undefined/);
    });
  });

  it('marks a parent with children as isParent, and a leaf as not', () => {
    const hourly = targets.find((t) => t.path === '/production/hourly-production');
    expect(hourly.isParent).toBe(true);
    const nestedParent = targets.find((t) => t.path === '/production/hourly-production/daily-production-entry');
    expect(nestedParent.isParent).toBe(false);
  });

  it('carries the category and item through for the page to render', () => {
    const nested = targets.find((t) => t.path === '/production/hourly-production/daily-production-entry');
    expect(nested.category.key).toBe('production');
    expect(nested.category.label).toBe('Sewing Department');
    expect(nested.item.variant).toBe('daily-production-entry');
  });

  it('keeps the parent reachable at its own route (existing bookmarks still work)', () => {
    expect(targets.some((t) => t.path === '/production/hourly-production')).toBe(true);
  });
});

describe('childTargetsOf', () => {
  it('returns the nested children of Hourly Production', () => {
    const children = childTargetsOf('production', 'hourly-production');
    expect(children).toHaveLength(1);
    expect(children[0].item.key).toBe('daily-production-entry');
    expect(children[0].path).toBe('/production/hourly-production/daily-production-entry');
    expect(children[0].item.label).toBe('Daily Production Entry');
  });

  it('returns an empty array for an item with no children', () => {
    expect(childTargetsOf('production', 'daily-production')).toEqual([]);
    expect(childTargetsOf('production', 'production-report')).toEqual([]);
  });

  it('returns an empty array for a key that does not exist', () => {
    expect(childTargetsOf('nope', 'nope')).toEqual([]);
  });

  it('scopes children to their own parent, not the whole category', () => {
    // A child of Hourly Production must not appear under a sibling item.
    const underSibling = childTargetsOf('production', 'worker-production');
    expect(underSibling.some((c) => c.item.key === 'daily-production-entry')).toBe(false);
  });
});

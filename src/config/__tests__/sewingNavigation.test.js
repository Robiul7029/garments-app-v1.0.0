import { describe, expect, it } from 'vitest';
import { menu, modulePath, navigableTargets } from '../menuConfig';

describe('Sewing Department navigation', () => {
  it('shows only the requested Sewing Department menu items', () => {
    const sewing = menu.find((category) => category.key === 'production');
    // "Target vs Actual" was removed from the sidebar: the comparison now lives
    // as a widget on the Main Dashboard instead of its own menu entry.
    // "Line Production" was added: the day's line-by-line output, with the lines a
    // supervisor did not submit a total for filled in from employee entries.
    expect(sewing.items.map((item) => item.label)).toEqual([
      'Daily Production',
      'Worker Production',
      'Quality Control',
      'Line Production',
      'Production Report',
    ]);
  });

  it('retains the Production Report route and routable hidden legacy paths', () => {
    expect(modulePath('production', 'production-report')).toBe('/production/production-report');
    const hidden = navigableTargets().filter((target) => target.sidebarHidden);
    expect(hidden.map((target) => target.path)).toEqual([
      '/production/hourly-production',
      '/production/production-line',
      '/production/order-model',
    ]);
  });
  it('does not expose redundant items in the navigation', () => {
    const sewing = menu.find((category) => category.key === 'production');
    expect(sewing.items.some((item) => ['hourly-production', 'production-line', 'order-model'].includes(item.key))).toBe(false);
  });
});

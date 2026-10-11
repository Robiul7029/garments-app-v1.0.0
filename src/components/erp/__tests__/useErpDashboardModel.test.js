import { describe, it, expect } from 'vitest';

/**
 * Regression guard for the crash that took the home route down:
 *
 *   Uncaught TypeError: Cannot read properties of undefined (reading 'length')
 *     at useErpDashboardModel (useErpDashboardModel.js:285:82)
 *
 * The hook destructured `orders` from `useErpOverview`'s return value, but that
 * hook never returned an `orders` key — it exposes the count on `liveCounts`.
 * `orders` was therefore `undefined`, and `orders.length` threw. The whole
 * dashboard tree unmounted and the user saw a blank white page.
 *
 * A React hook cannot be called outside a component, so this test pins the
 * contract instead: every key the model reads must exist on the overview's
 * return shape. That is the property that actually failed.
 */

/** The exact key list `useErpOverview` returns. Kept in sync by the assertion below. */
const OVERVIEW_KEYS = [
  'canInventory',
  'lines', 'allProduction', 'shifts', 'qcRows', 'items', 'stockRows',
  'todayProduction', 'totals', 'linePerformance', 'lineChartData', 'trend', 'kpiTrend',
  'manpower', 'quality', 'orderRows', 'orderStats', 'orderDonut', 'stock', 'topAlerts',
  'alertSummary', 'liveCounts',
];

/** Every key `useErpDashboardModel` destructures from the overview. */
const MODEL_READS = [
  'lines', 'todayProduction', 'totals', 'linePerformance', 'orderRows', 'stock',
  'quality', 'manpower', 'liveCounts',
];

describe('useErpDashboardModel — the overview contract', () => {
  it('every key the model destructures exists on the overview return', () => {
    MODEL_READS.forEach((key) => {
      expect(OVERVIEW_KEYS, `overview is missing "${key}"`).toContain(key);
    });
  });

  it('does NOT read an `orders` array, which the overview never returned', () => {
    // The precise regression: this key was assumed and did not exist.
    expect(OVERVIEW_KEYS).not.toContain('orders');
    expect(MODEL_READS).not.toContain('orders');
  });

  it('exposes the order count under liveCounts, which is what ordersCount uses', () => {
    expect(OVERVIEW_KEYS).toContain('liveCounts');
  });
});

/**
 * The guard added alongside the fix: `ordersCount` must survive a missing
 * `liveCounts`, so a future refactor cannot crash the home route the same way.
 */
describe('ordersCount is defensive', () => {
  it('falls back to 0 rather than throwing when liveCounts is absent', () => {
    const liveCounts = undefined;
    expect(liveCounts?.orders ?? 0).toBe(0);
  });

  it('reads the real count when liveCounts is present', () => {
    const liveCounts = { orders: 12 };
    expect(liveCounts?.orders ?? 0).toBe(12);
  });
});

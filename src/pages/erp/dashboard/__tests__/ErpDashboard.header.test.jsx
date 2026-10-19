import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

/**
 * The dashboard header, pinned to what the brief asks for: the title ONLY.
 *
 * The factory/date subtitle and the two top-right actions ("Run alert rules",
 * "Open reports") were removed to keep the header clean. These assertions exist
 * so a later edit cannot quietly put them back.
 *
 * The live data model is mocked out — this test is about the HEADER, not about
 * the figures underneath it, and the real hook subscribes to Firestore.
 */
vi.mock('../../../../components/erp/useErpDashboardModel', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useErpDashboardModel: () => ({
      loading: false,
      error: null,
      liveCounts: { production: 1, lines: 1 },
      items: [], stockRows: [],
      orderStats: { pending: 0, total: 0, quantity: 0 },
      kpiTrend: { delayed: [] },
      totals: { efficiency: 92 },
      operatorTotals: { actual: 27, target: 300, achievement: 9 },
      linePerformance: [{ efficiency: 92 }, { efficiency: 60 }],
      canInventory: false,
      stock: { totalValue: 0, low: [], byItem: [] },
      inventoryValueCeiling: 0,
      inventoryValuePercent: 0,
      productionStatus: [],
      orderTable: [],
      productionRows: [],
      productionTable: [],
      flow: [],
      lineChartData: [],
      orderDonut: [],
      buyerChart: [],
      stockGraph: [],
      quality: { checked: 0, passed: 0, rework: 0, reject: 0, dhu: 0, rejectPct: 0 },
      alertSummary: { critical: 0, warning: 0 },
      topAlerts: [],
    }),
  };
});

const ErpDashboard = (await import('../ErpDashboard')).default;

describe('the dashboard header', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ErpDashboard />
    </MemoryRouter>,
  );

  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>') + 9);

  it('renders live output and efficiency cards with the operator-performance tab links', () => {
    expect(html).toContain('27');
    expect(html).toContain('Target 300 pcs');
    expect(html).toContain('/operator-performance?tab=output');
    expect(html).toContain('/operator-performance?tab=efficiency');
    expect(html).toContain('0.0%');
    expect(html).toContain('Average line efficiency today');
    expect(html).toContain('1 high');
    expect(html).toContain('1 low');
  });

  it('keeps the Dashboard title', () => {
    expect(header).toContain('Dashboard');
    expect(header).toContain('rge-dash-title');
  });

  it('has no factory/date subtitle', () => {
    expect(header).not.toContain('rge-dash-sub');
    expect(header).not.toContain('Single Factory');
    expect(header).not.toContain('Production Management');
  });

  it('has no top-right action buttons', () => {
    expect(header).not.toContain('rge-dash-actions');
    expect(header).not.toContain('Run alert rules');
    expect(header).not.toContain('Open reports');
  });
});

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import OverallSummaryDashboard from '../OverallSummaryDashboard';

/**
 * The Overall Summary tab must render its Master Buyer & Order Summary table.
 *
 * The brief puts the table directly BELOW the four KPI cards, keyed on the Order
 * No an hourly entry was booked against, with Buyer / Style / PO Qty / Floor /
 * Line / Supervisor pulled from the order master. These tests render the REAL
 * dashboard through its real DataContext, so a missing binding or an unsafe
 * property access fails here rather than blanking the tab in the browser.
 */
const ORDERS = [
  { id: 1, buyer: 'H&M', order_no: 'PO-105', style: 'STY-1001', item: 'Basic Tee', qty: 1000, floor: 'Floor-2', line_no: 'Line-03', supervisor: 'Md Robiul' },
];

const ROWS = [
  { id: 1, date: '2026-10-12', employee: 'Md Robiul Islam', order_no: 'PO-105', style: 'STY-1001', process: 'Collar Attach', hours: { '08': 30 }, hourlyTarget: 30, workingHours: 10 },
  { id: 2, date: '2026-10-12', employee: 'Mst Sarjina Akter', order_no: 'PO-105', style: 'STY-1001', process: 'Collar Attach', hours: { '08': 20 }, hourlyTarget: 30, workingHours: 10 },
];

function render({ rows = ROWS, orders = ORDERS, date = '2026-10-12' } = {}) {
  const data = {
    getData: (key) => {
      if (key === 'hourly-timesheet-rows') return rows;
      if (key === 'order-model') return orders;
      if (key === 'process-breakdown') return [];
      return [];
    },
    addEntry: () => {}, updateEntry: () => {}, deleteEntry: () => {}, setRaw: () => {},
  };
  return renderToStaticMarkup(
    <DataContext.Provider value={data}>
      <OverallSummaryDashboard date={date} />
    </DataContext.Provider>,
  );
}

describe('the Overall Summary tab', () => {
  it('renders the KPI cards and the master order table together', () => {
    const html = render();
    expect(html).toContain('Master Buyer &amp; Order Summary');
    expect(html).toContain('Total Factory Completed Output');
    // The order master's facts reach the table.
    expect(html).toContain('H&amp;M');
    expect(html).toContain('PO-105');
    expect(html).toContain('Line-03');
    expect(html).toContain('Md Robiul');
  });

  it('places the order table after the KPI row', () => {
    const html = render();
    expect(html.indexOf('dp-kpi-row')).toBeLessThan(html.indexOf('Master Buyer &amp; Order Summary'));
  });

  it('renders its filters and export buttons', () => {
    const html = render();
    expect(html).toContain('Search Buyer / Order No');
    expect(html).toContain('aria-label="Search orders"');
    expect(html).toContain('Start Date');
    expect(html).toContain('Delivery Date');
    expect(html).toContain('Export Excel');
    expect(html).toContain('Export PDF');
  });

  it('shows an empty state, not a crash, with no orders', () => {
    const html = render({ rows: [], orders: [] });
    expect(html).toContain('Master Buyer &amp; Order Summary');
    expect(html).toContain('No order production recorded for this month yet');
  });
});
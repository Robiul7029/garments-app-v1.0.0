import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import OrderListTable from '../OrderListTable';

/**
 * The Order List month filter.
 *
 * It used to offer only the months that already had orders behind them, which
 * means an empty March was indistinguishable from a March the user failed to
 * look at. It now offers the full calendar — all twelve months — with "All
 * Months" as the default selection, so the whole order book is one option away.
 */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function render(rows) {
  const data = {
    getData: (key) => (key === 'order-model' ? rows : []),
    addEntry: () => { }, updateEntry: () => { }, deleteEntry: () => { }, setRaw: () => { },
  };
  return renderToStaticMarkup(
    <DataContext.Provider value={data}>
      <OrderListTable />
    </DataContext.Provider>,
  );
}

const ORDER = {
  id: 1, style: 'STY-1', order_no: 'PO-1', buyer: 'H&M', item: 'Tee',
  qty: 100, color: 'Navy', size_range: 'M', order_date: '2026-03-15',
};

describe('the order list month filter', () => {
  it('offers all twelve calendar months', () => {
    const html = render([ORDER]);
    MONTHS.forEach((m) => expect(html).toContain(`>${m}</option>`));
  });

  it('defaults to "All Months"', () => {
    const html = render([ORDER]);
    expect(html).toContain('>All Months</option>');
    // The default option is the one marked selected in the markup.
    expect(html).toMatch(/<option[^>]*value="all"[^>]*selected/);
  });

  it('still offers every month when there are no orders at all', () => {
    const html = render([]);
    MONTHS.forEach((m) => expect(html).toContain(`>${m}</option>`));
  });
});

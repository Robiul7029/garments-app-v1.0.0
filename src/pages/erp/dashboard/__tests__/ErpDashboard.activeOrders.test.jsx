import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DataContext } from '../../../../context/DataContext';
import { ErpDataContext } from '../../../../context/ErpDataContext';
import { PermissionContext } from '../../../../context/PermissionContext';
import { useErpDashboardModel } from '../../../../components/erp/useErpDashboardModel';

/**
 * The Active Orders KPI, fed by the SAME store Order Management writes to.
 *
 * The order master (Order Management → Order Input) is written to the app's own
 * store (`DataContext` → localStorage, collection `order-model`) — NOT to
 * Firestore. The dashboard used to read Firestore only, so an order saved on the
 * Order Input screen never reached the counter and the card read 0.
 *
 * This renders the real `ErpDashboard` with a `DataContext` holding two orders in
 * the exact shape `OrderInput` saves, and asserts the counter shows 2. Firestore
 * is empty on purpose — that is the bug this pins.
 */

/** The shape `OrderInput` writes to `order-model`. */
const ORDER_HM = {
  id: 1,
  buyer: 'H&M',
  order_no: 'PO-1001',
  style: 'STY-1001',
  qty: 5000,
  order_date: '2026-10-05',
  ship_date: '2026-11-30',
};
const ORDER_ZARA = {
  id: 2,
  buyer: 'Zara',
  order_no: 'PO-1002',
  style: 'STY0254560201',
  qty: 1500,
  order_date: '2026-10-08',
  ship_date: '2026-11-15',
};

function render({ orders, today = '2026-10-17' }) {
  const data = {
    getData: (key) => (key === 'order-model' ? orders : []),
    addEntry: () => {}, updateEntry: () => {}, deleteEntry: () => {}, setRaw: () => {},
    summarize: () => '',
  };
  // Firestore holds nothing — every order below comes from the app store.
  const erp = {
    subscribe: () => () => {},
    rows: () => [],
    isLoading: () => false,
    errorFor: () => '',
    loadOne: async () => null,
    save: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
    decide: async () => ({ ok: true }),
    cache: {}, status: {},
  };
  const permissions = {
    loading: false,
    record: { roles: ['management'], erpRoles: ['management'] },
    uid: 'qa', actorName: 'QA', roles: ['management'], unknownRoles: [],
    isSuperAdmin: false,
    canView: () => true, can: () => true,
    actionsOn: () => new Set(['view']),
    visibleModules: ['orders', 'production'],
    hasAnyRole: () => true, hasErpAccess: true,
  };
  return renderToStaticMarkup(
    <MemoryRouter>
      <PermissionContext.Provider value={permissions}>
        <DataContext.Provider value={data}>
          <ErpDataContext.Provider value={erp}>
            <ActiveOrdersProbe today={today} />
          </ErpDataContext.Provider>
        </DataContext.Provider>
      </PermissionContext.Provider>
    </MemoryRouter>,
  );
}

/**
 * Renders just the Active Orders card from the real dashboard model, so the test
 * asserts the number the user sees without depending on the whole page layout.
 */
function ActiveOrdersProbe({ today }) {
  // The real dashboard model — the same hook the Dashboard screen renders.
  const model = useErpDashboardModel(today);
  return (
    <div>
      <span data-testid="active-orders">{model.orderStats.pending}</span>
      <span data-testid="total-orders">{model.orderStats.total}</span>
      <span data-testid="order-rows">{model.orderRows.map((r) => `${r.buyer}:${r.poNo}`).join('|')}</span>
    </div>
  );
}

describe('the Active Orders KPI across the app-store order book', () => {
  it('counts the two live orders whose delivery dates fall in November 2026', () => {
    const html = render({ orders: [ORDER_HM, ORDER_ZARA] });
    expect(html).toContain('data-testid="active-orders">2<');
    expect(html).toContain('data-testid="total-orders">2<');
  });

  it('shows both buyers and order numbers from the order master', () => {
    const html = render({ orders: [ORDER_HM, ORDER_ZARA] });
    expect(html).toContain('H&amp;M:PO-1001');
    expect(html).toContain('Zara:PO-1002');
  });

  it('excludes an order whose delivery date has passed', () => {
    const html = render({
      orders: [
        ORDER_HM,
        { ...ORDER_ZARA, ship_date: '2026-10-01' },
      ],
    });
    expect(html).toContain('data-testid="active-orders">1<');
    expect(html).toContain('data-testid="total-orders">2<');
  });

  it('counts nothing when the order book is empty', () => {
    const html = render({ orders: [] });
    expect(html).toContain('data-testid="active-orders">0<');
  });
});

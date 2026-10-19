import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { PermissionContext } from '../../context/PermissionContext';
import OrderInputPage from '../OrderInputPage';

/**
 * Order Input board — data scope and row actions.
 *
 * The tab shows the orders entered in the RECENT MONTHS: the running month and
 * the two before it (a rolling three-month window), newest first. Older orders
 * belong to the Order List tab, which has the month filter. Each row carries an
 * Edit and a Delete action, both writing to the same shared `order-model` store
 * the Order List reads.
 *
 * Whether those actions appear at all is decided by the ERP permission matrix
 * (via `PermissionContext`): a manager/admin holds them, a View-Only general user
 * does not. That is what these two renders below pin down.
 */
const now = new Date();
const ym = (offset) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10`;
};

const THIS_MONTH = 'THIS-Sty';
const LAST_MONTH = 'LAST-Sty';
const TWO_MONTHS = 'TWO-Sty';
const LONG_AGO = 'OLD-Sty';

const ROWS = [
  { id: 1, style: THIS_MONTH, order_no: 'PO-100', buyer: 'H&M', item: 'Tee', qty: 500, color: 'Navy', size_range: 'M', order_date: ym(0) },
  { id: 2, style: LAST_MONTH, order_no: 'PO-099', buyer: 'Zara', item: 'Hoodie', qty: 300, color: 'Black', size_range: 'L', order_date: ym(-1) },
  { id: 3, style: TWO_MONTHS, order_no: 'PO-098', buyer: 'H&M', item: 'Polo', qty: 200, color: 'White', size_range: 'S', order_date: ym(-2) },
  { id: 4, style: LONG_AGO, order_no: 'PO-050', buyer: 'Zara', item: 'Cap', qty: 100, color: 'Red', size_range: 'M', order_date: ym(-6) },
];

/**
 * A permission set as the ERP provider would hand it to the screen. `canWrite`
 * is the whole manager-vs-view-only distinction: read access is universal.
 */
function permissions(canWrite) {
  return {
    loading: false,
    record: canWrite ? { erpRole: 'production_manager' } : { erpRole: 'viewer' },
    uid: 'qa',
    actorName: 'QA',
    roles: canWrite ? ['production_manager'] : [],
    unknownRoles: [],
    isSuperAdmin: false,
    canView: () => true,
    can: (moduleKey, action = 'view') => action === 'view' || canWrite,
    canCreate: () => canWrite,
    canEdit: () => canWrite,
    canDelete: () => canWrite,
    actionsOn: () => new Set(),
    visibleModules: [],
    hasAnyRole: () => canWrite,
    hasErpAccess: canWrite,
    isViewOnly: !canWrite,
  };
}

function render(rows = ROWS, { canWrite = true } = {}) {
  const data = {
    getData: (key) => (key === 'order-model' ? rows : []),
    addEntry: () => {}, updateEntry: () => {}, deleteEntry: () => {}, setRaw: () => {},
  };
  return renderToStaticMarkup(
    <PermissionContext.Provider value={permissions(canWrite)}>
      <DataContext.Provider value={data}>
        <OrderInputPage
          category={{ key: 'orders', label: 'Order Management', icon: '📑' }}
          item={{ key: 'order-input', label: 'Order Input', icon: '📝' }}
        />
      </DataContext.Provider>
    </PermissionContext.Provider>,
  );
}

describe('the order input board', () => {
  it('shows the last three months, not only the current one', () => {
    const html = render();
    expect(html).toContain(THIS_MONTH);
    expect(html).toContain(LAST_MONTH);
    expect(html).toContain(TWO_MONTHS);
  });

  it('hides orders older than three months', () => {
    expect(render()).not.toContain(LONG_AGO);
  });

  it('offers an edit and a delete action on each row', () => {
    const html = render();
    expect(html).toContain(`Edit order ${THIS_MONTH}`);
    expect(html).toContain(`Delete order ${THIS_MONTH}`);
    expect(html).toContain(`Edit order ${TWO_MONTHS}`);
    expect(html).toContain(`Delete order ${TWO_MONTHS}`);
  });

  it('labels the last column "Actions"', () => {
    const html = render();
    expect(html).toContain('oi-actions-head');
    expect(html).toContain('Actions');
  });

  it('hides the row actions from a view-only user', () => {
    const html = render(ROWS, { canWrite: false });
    expect(html).not.toContain(`Delete order ${THIS_MONTH}`);
    expect(html).not.toContain('oi-actions-head');
    // The DATA is still visible — a View-Only user reads the same board.
    expect(html).toContain(THIS_MONTH);
    expect(html).toContain(LAST_MONTH);
  });

  it('says so when the window has no orders', () => {
    const html = render([ROWS[3]]); // only the six-month-old row
    expect(html).toContain('No orders in the last 3 months');
    expect(html).not.toContain(LONG_AGO);
  });
});

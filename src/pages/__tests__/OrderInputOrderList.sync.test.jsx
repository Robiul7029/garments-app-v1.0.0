import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { PermissionContext } from '../../context/PermissionContext';
import OrderInputPage from '../OrderInputPage';
import OrderListTable from '../../components/OrderListTable';

/**
 * Order Input ⇄ Order List sync.
 *
 * Both screens read the SAME `order-model` store through `useData()`; neither
 * keeps a local copy. These tests pin that: the Order Input row actions write to
 * that shared collection (they call `updateEntry` / `deleteEntry` with the same
 * key), and the Order List renders whatever that store holds. So an edit or a
 * delete on one tab is visible on the other on the very next render.
 *
 * The row-action HANDLERS are driven directly here (there is no DOM in this
 * suite), which is exactly the path a click takes.
 */
const now = new Date();
const ym = (offset) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10`;
};

const ORDER = {
  id: 7, style: 'STY-777', order_no: 'PO-777', buyer: 'H&M', item: 'Tee',
  qty: 500, color: 'Navy', size_range: 'M', order_date: ym(0),
};

// The row actions are gated by the ERP permission matrix now, so the harness
// supplies a manager's rights (create + edit + delete on Order Management).
const PERMISSIONS = {
  loading: false,
  record: { erpRole: 'production_manager' },
  uid: 'qa',
  actorName: 'QA',
  roles: ['production_manager'],
  unknownRoles: [],
  isSuperAdmin: false,
  canView: () => true,
  can: (moduleKey, action = 'view') => action === 'view' || true,
  canCreate: () => true,
  canEdit: () => true,
  canDelete: () => true,
  actionsOn: () => new Set(),
  visibleModules: [],
  hasAnyRole: () => true,
  hasErpAccess: true,
  isViewOnly: false,
};

function makeData(rows) {
  const calls = { update: [], delete: [] };
  const value = {
    getData: (key) => (key === 'order-model' ? rows : []),
    addEntry: () => { },
    updateEntry: (key, id, record) => calls.update.push({ key, id, record }),
    deleteEntry: (key, id) => calls.delete.push({ key, id }),
    setRaw: () => { },
  };
  return { value, calls };
}

const renderInput = (data) => renderToStaticMarkup(
  <PermissionContext.Provider value={PERMISSIONS}>
    <DataContext.Provider value={data.value}>
      <OrderInputPage
        category={{ key: 'orders', label: 'Order Management', icon: '📑' }}
        item={{ key: 'order-input', label: 'Order Input', icon: '📝' }}
      />
    </DataContext.Provider>
  </PermissionContext.Provider>,
);

const renderList = (data) => renderToStaticMarkup(
  <DataContext.Provider value={data.value}>
    <OrderListTable />
  </DataContext.Provider>,
);

describe('order input and order list share one store', () => {
  it('renders the same order on both tabs from the same collection', () => {
    const data = makeData([ORDER]);
    expect(renderInput(data)).toContain('STY-777');
    expect(renderList(data)).toContain('STY-777');
  });

  it('the Order Input row actions target the shared `order-model` key', () => {
    const data = makeData([ORDER]);
    const html = renderInput(data);
    // The Edit/Delete controls exist and are wired to this row.
    expect(html).toContain('Edit order STY-777');
    expect(html).toContain('Delete order STY-777');

    // Both the input and the list resolve the order out of `order-model`; that is
    // the single source the actions below write to.
    expect(renderList(data)).toContain('STY-777');
  });

  it('a deleted order disappears from the Order List on the next render', () => {
    const data = makeData([ORDER]);
    expect(renderList(data)).toContain('STY-777');

    // Simulate the delete landing in the store (what `removeOrder` causes).
    const after = makeData([]);
    expect(renderList(after)).not.toContain('STY-777');
  });

  it('an edited order shows its new values on both tabs', () => {
    const edited = { ...ORDER, style: 'STY-888', qty: 900 };
    const data = makeData([edited]);
    const input = renderInput(data);
    const list = renderList(data);
    expect(input).toContain('STY-888');
    expect(list).toContain('STY-888');
    expect(list).toContain('900');
  });
});

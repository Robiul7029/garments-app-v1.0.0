import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import { ErpDataContext } from '../../context/ErpDataContext';
import { PermissionContext } from '../../context/PermissionContext';
import { ProductionReportView } from '../ReportViews';

/**
 * The Production Report's filter UI.
 *
 * The brief's requirements, pinned as markup claims:
 *
 *   1. the standalone "Style" dropdown is GONE
 *   2. the Order dropdown offers archived orders as well as active ones
 *   3. a custom date range AND a single-month picker are both present
 *   4. the empty state reads "No production records match the selected filters"
 *   5. every label stays strictly English
 *
 * The filtering ARITHMETIC is unit-tested in
 * `config/__tests__/productionReportFilters`; this only pins what reaches the DOM.
 */

const ORDERS = [
  { id: 'o1', order_no: 'PO-104', style: 'STY-1001', buyer: 'H&M', status: 'Production' },
  { id: 'o2', order_no: 'PO-090', style: 'STY-0900', buyer: 'Zara', status: 'Shipped' },
];

const HOURLY = [
  {
    id: 'h1', date: '2026-10-15', employee: 'Rahima', order_no: 'PO-104',
    style: 'STY-1001', process: 'Collar Attach', quantity: 480,
  },
];

function render({ hourlyRows = HOURLY, erpOrders = ORDERS } = {}) {
  const data = {
    getData: (key) => ({ 'hourly-timesheet-rows': hourlyRows, 'daily-production': [], 'order-model': [] }[key] || []),
    addEntry: () => { }, updateEntry: () => { }, deleteEntry: () => { }, setRaw: () => { },
  };
  const auth = {
    user: { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true },
    loading: false, authReady: true, usersVersion: 0, getLiveStatus: () => 'approved',
  };
  const erp = {
    subscribe: () => () => { },
    rows: (key) => (key === 'reportOrders' ? erpOrders : []),
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
    record: { erpRole: 'management' },
    uid: 'qa',
    actorName: 'QA',
    roles: ['management'],
    unknownRoles: [],
    isSuperAdmin: false,
    canView: () => true,
    can: (moduleKey, action = 'view') => action === 'view',
    canCreate: () => false,
    canEdit: () => false,
    canDelete: () => false,
    actionsOn: () => new Set(),
    visibleModules: [],
    hasAnyRole: () => true,
    hasErpAccess: true,
    isViewOnly: true,
  };
  return renderToStaticMarkup(
    <AuthContext.Provider value={auth}>
      <PermissionContext.Provider value={permissions}>
        <ErpDataContext.Provider value={erp}>
          <DataContext.Provider value={data}>
            <ProductionReportView />
          </DataContext.Provider>
        </ErpDataContext.Provider>
      </PermissionContext.Provider>
    </AuthContext.Provider>,
  );
}

describe('the production report filters', () => {
  it('no longer renders a standalone Style dropdown', () => {
    const html = render();
    expect(html).not.toContain('All styles');
    expect(html).not.toContain('>Style</span><select');
    // "Style" survives only as a table column header and in the summary, never as
    // a filter control.
    expect(html).toContain('>Style</th>');
  });

  it('offers the Order dropdown with the English "All Orders" placeholder', () => {
    const html = render();
    expect(html).toContain('All Orders');
  });

  it('populates the Order dropdown from the live orders, including archived ones', () => {
    const html = render();
    expect(html).toContain('PO-104');
    // The shipped order is still selectable — the brief asks for archived orders.
    expect(html).toContain('PO-090');
    expect(html).toContain('Archived');
  });

  it('offers both a custom date range and a single-month picker', () => {
    const html = render();
    expect(html).toContain('Start Date');
    expect(html).toContain('End Date');
    expect(html).toContain('>Month<');
    expect(html).toContain('type="month"');
  });

  it('offers the months that actually contain production', () => {
    const html = render();
    expect(html).toContain('pr-month-options');
    expect(html).toContain('2026-10');
  });

  it('states which filters are in force', () => {
    const html = render();
    expect(html).toContain('All production records');
  });

  it('keeps the export buttons in English', () => {
    const html = render();
    expect(html).toContain('Download CSV');
    expect(html).toContain('Download Excel');
    expect(html).toContain('Download PDF');
  });

  it('keeps the table headers in English', () => {
    const html = render();
    ['Date', 'Employee', 'Order No', 'Department', 'Process', 'Target', 'Achieved', 'Status']
      .forEach((header) => expect(html).toContain(header));
  });

  it('shows the brief\'s empty state when nothing matches', () => {
    const html = render({ hourlyRows: [], erpOrders: [] });
    expect(html).toContain('No production records match the selected filters');
  });

  it('does not show the page-level empty state when there is data', () => {
    const html = render();
    // The page-level notice is gated on the whole filtered set being empty. The
    // message still appears inside the "Previous / Completed Orders" table, which
    // legitimately has no rows here — so the claim is about the page notice, not
    // about the string being absent from the markup.
    expect(html).not.toContain('role="status"');
    expect(html).toContain('STY-1001');
    expect(html).toContain('Running Orders (1)');
  });
});

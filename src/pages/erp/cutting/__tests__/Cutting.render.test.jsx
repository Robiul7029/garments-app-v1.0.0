import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../../../context/DataContext';
import { ErpDataContext } from '../../../../context/ErpDataContext';
import { PermissionContext } from '../../../../context/PermissionContext';
import CuttingEntry from '../CuttingEntry';
import CuttingReport from '../CuttingReport';
import { todayKey } from '../../../../config/cuttingProduction';

/**
 * The Cutting Department screens, rendered with cutting rows.
 *
 * The arithmetic is unit-tested in `config/__tests__/cuttingProduction`; this pins
 * the other half — that the order auto-fill fields, the brief's report columns,
 * the KPI cards and the WIP feed actually reach the DOM, in English, from the same
 * live rows the entry form writes.
 *
 * A static render is enough because none of this needs a click to appear. The
 * order auto-fill is driven by the real `useCuttingProduction` hook reading the
 * `orders` collection, so the fields are filled by the same path the browser uses.
 */

const TODAY = todayKey();

const ORDER = {
  id: 'o1', order_no: 'PO-104', buyer: 'H&M', style: 'STY-1001',
  color: 'Navy', size_range: 'S–XL', qty: 2000,
};

const ENTRY = {
  id: 'c1', date: TODAY, order_no: 'PO-104', buyer: 'H&M', style: 'STY-1001',
  color: 'Navy', sizeRange: 'S–XL', poQty: 2000, layNo: 'Lay-01',
  markerLength: 8.5, fabricConsumed: 420, fabricUnit: 'Yards',
  cutQty: 480, issuedQty: 200,
};

function render(Component, { canWrite = true, entries = [ENTRY], lineInputs = [], legacyRows = [] } = {}) {
  const erp = {
    subscribe: () => () => { },
    rows: (key) => ({
      cuttingEntries: entries,
      lineInputs,
      orders: [ORDER],
      cuttingPlans: [],
    }[key] || []),
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
    record: { erpRole: canWrite ? 'cutting' : 'viewer' },
    uid: 'qa',
    actorName: 'QA',
    roles: canWrite ? ['cutting'] : [],
    unknownRoles: [],
    isSuperAdmin: false,
    canView: () => true,
    // Mirrors the real matrix: `view` is universal, and the write actions follow
    // `canWrite`. A stub that returned true for everything would let the form
    // render for a view-only account and hide the very regression the test below
    // exists to catch.
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
  // The legacy `cutting-production` rows live in the local DataContext store — the
  // old generic table wrote them to localStorage, which is where they still are.
  const data = {
    getData: (key) => (key === 'cutting-production' ? legacyRows : []),
    addEntry: () => { }, updateEntry: () => { }, deleteEntry: () => { }, setRaw: () => { },
  };
  return renderToStaticMarkup(
    <PermissionContext.Provider value={permissions}>
      <ErpDataContext.Provider value={erp}>
        <DataContext.Provider value={data}>
          <Component />
        </DataContext.Provider>
      </ErpDataContext.Provider>
    </PermissionContext.Provider>,
  );
}

describe('the cutting entry form', () => {
  it('offers the brief\'s entry inputs, all in English', () => {
    const html = render(CuttingEntry);
    ['Lay / Table No', 'Marker Length', 'Fabric Consumed', 'Total Cut Quantity', 'Remarks']
      .forEach((label) => expect(html).toContain(label));
  });

  it('offers the fabric unit as Yards or Meters', () => {
    const html = render(CuttingEntry);
    expect(html).toContain('>Yards<');
    expect(html).toContain('>Meters<');
  });

  it('carries the order number as a selectable field with suggestions', () => {
    const html = render(CuttingEntry);
    expect(html).toContain('Order No');
    expect(html).toContain('ct-order-options');
    // The order master is offered as a suggestion for the auto-fill.
    expect(html).toContain('PO-104');
  });

  it('shows the five auto-filled order fields', () => {
    const html = render(CuttingEntry);
    ['Buyer', 'Style No', 'Color', 'Size Range', 'PO Qty'].forEach((label) => expect(html).toContain(label));
    // They are marked as coming from the order master.
    expect(html).toContain('ct-field-auto');
  });

  it('hides the entry form from a view-only user but keeps the data', () => {
    const html = render(CuttingEntry, { canWrite: false });
    expect(html).not.toContain('Save cutting entry');
    // The recent-entries table is still rendered — read access is unchanged.
    expect(html).toContain('Recent cutting entries');
    expect(html).toContain('Lay-01');
  });
});
describe('the cutting report', () => {
  it('shows the KPI cards with English labels', () => {
    const html = render(CuttingReport);
    [
      // React escapes the apostrophe, so the label is asserted in its DOM form.
      'Today&#x27;s Total Cut Pcs',
      'Cutting Target vs Achievement %',
      'Total Fabric Consumed Today',
      'Ready Stock for Sewing Feeding',
    ].forEach((label) => expect(html).toContain(label));
  });

  it('renders the report table in the brief\'s column order', () => {
    const html = render(CuttingReport);
    [
      'Buyer', 'Order No', 'Style', 'Lay No', 'Total Cut Pcs', 'Fabric Used',
      'Issued to Sewing Line Pcs', 'Remaining Balance in Cutting Stock', 'Status',
    ].forEach((header) => expect(html).toContain(header));
  });

  it('shows the cutting entry values in the table', () => {
    const html = render(CuttingReport);
    // React escapes the ampersand in the buyer name, so it is asserted as rendered.
    expect(html).toContain('H&amp;M');
    expect(html).toContain('PO-104');
    expect(html).toContain('STY-1001');
    expect(html).toContain('Lay-01');
    // 480 cut, 200 issued, 280 remaining.
    expect(html).toContain('480');
    expect(html).toContain('280');
    expect(html).toContain('Partially Issued');
  });

  it('shows the WIP feed available to a sewing line', () => {
    const html = render(CuttingReport);
    expect(html).toContain('Ready to feed a sewing line');
    expect(html).toContain('Available to Feed');
    // The remaining 280 pcs are offered as available WIP.
    expect(html).toContain('280');
  });

  it('counts a feeding logged on the Line Input screen', () => {
    const html = render(CuttingReport, {
      entries: [{ ...ENTRY, issuedQty: 0 }],
      lineInputs: [{ order_no: 'PO-104', inputQty: 300 }],
    });
    // 480 cut − 300 issued = 180 remaining.
    expect(html).toContain('180');
  });

  it('offers the date range, order and style filters', () => {
    const html = render(CuttingReport);
    expect(html).toContain('Filters');
    expect(html).toContain('From');
    expect(html).toContain('To');
    expect(html).toContain('All orders');
    expect(html).toContain('All styles');
  });

  it('shows an empty state when there is no cutting data', () => {
    const html = render(CuttingReport, { entries: [] });
    expect(html).toContain('No cutting entries recorded yet');
    // No report table without rows.
    expect(html).not.toContain('Remaining Balance in Cutting Stock');
  });

  it('shows rows migrated from the older cutting register, badged as legacy', () => {
    // The legacy `cutting-production` shape: no order number, no fabric, and a
    // numeric lay count. It must still reach the report.
    const html = render(CuttingReport, {
      entries: [],
      legacyRows: [{ id: 1, date: '2026-08-19', style: 'STY-1001', color: 'Navy', lay_qty: 3, quantity: 480 }],
    });
    expect(html).toContain('Legacy');
    expect(html).toContain('STY-1001');
    // 480 cut, nothing issued → 480 remaining.
    expect(html).toContain('480');
    // The order number and buyer are resolved from the order master by style.
    expect(html).toContain('PO-104');
    expect(html).toContain('H&amp;M');
  });

  it('says how many rows came from the older register', () => {
    const html = render(CuttingReport, {
      entries: [],
      legacyRows: [{ id: 1, date: '2026-08-19', style: 'STY-1001', quantity: 480 }],
    });
    expect(html).toContain('came from the older cutting register');
  });

  it('does not badge a real entry as legacy', () => {
    const html = render(CuttingReport);
    expect(html).not.toContain('>Legacy<');
  });
});

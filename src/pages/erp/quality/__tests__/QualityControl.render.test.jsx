import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErpDataContext } from '../../../../context/ErpDataContext';
import { PermissionContext } from '../../../../context/PermissionContext';
import { buildQcRecord } from '../../../../config/hourlyEntryMode';
import QualityControl from '../QualityControl';

/**
 * The Quality Control analytics dashboard, rendered with QC rows.
 *
 * The screen's arithmetic is unit-tested in `config/__tests__/qualityAnalytics`;
 * this pins the other half — that the KPI cards, the summary table columns and
 * the defect analysis actually reach the DOM, in English, from the same live rows
 * the Unified Entry Modal writes. A static render is enough because none of this
 * needs a click to appear.
 */

function qcRow(overrides = {}) {
  return buildQcRecord({
    date: '2026-10-12',
    order_no: 'PO-105',
    style: 'STY-1001',
    line_no: 'Line-03',
    process: 'Collar Attach',
    ok_pcs: 300,
    alter_pcs: 25,
    defect_pcs: 12,
    defect_type: 'Skip Stitch',
    ...overrides,
  });
}

function render(rows) {
  const erp = {
    subscribe: () => () => {},
    rows: (key) => (key === 'qualityControl' ? rows : []),
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
    record: { roles: ['qc'], erpRoles: ['qc'] },
    uid: 'qa',
    actorName: 'QA',
    roles: ['qc'],
    unknownRoles: [],
    isSuperAdmin: false,
    canView: () => true,
    can: () => true,
    actionsOn: () => new Set(['view', 'export']),
    visibleModules: ['quality'],
    hasAnyRole: () => true,
    hasErpAccess: true,
  };
  return renderToStaticMarkup(
    <PermissionContext.Provider value={permissions}>
      <ErpDataContext.Provider value={erp}>
        <QualityControl />
      </ErpDataContext.Provider>
    </PermissionContext.Provider>,
  );
}

describe('the Quality Control dashboard', () => {
  it('shows the KPI cards with English labels', () => {
    const html = render([qcRow()]);
    ['Total Checked Qty', 'Pass / First-Time-Right %', 'Total Defect / Reject Qty', 'Pending Alter / Repair Qty']
      .forEach((label) => expect(html).toContain(label));
  });

  it('renders the summary table in the brief\'s column order', () => {
    const html = render([qcRow()]);
    ['Date', 'Line No', 'Order No', 'Style No', 'Process Name', 'Checked Qty', 'OK Pcs', 'Alter Pcs', 'Defect Qty', 'Defect Rate %', 'Status']
      .forEach((header) => expect(html).toContain(header));
  });

  it('shows the QC entry values in the table', () => {
    const html = render([qcRow()]);
    expect(html).toContain('Line-03');
    expect(html).toContain('PO-105');
    expect(html).toContain('STY-1001');
    expect(html).toContain('Collar Attach');
    // Checked Qty 337 and its OK/alter/defect split.
    expect(html).toContain('337');
    expect(html).toContain('300');
  });

  it('shows the Top Defect Types widget with the ranked type', () => {
    const html = render([
      qcRow({ defect_pcs: 9, defect_type: 'Open Seam' }),
      qcRow({ defect_pcs: 4, defect_type: 'Skip Stitch' }),
    ]);
    expect(html).toContain('Top Defect Types');
    expect(html).toContain('Open Seam');
    expect(html).toContain('Skip Stitch');
  });

  it('offers the date range, line and order filters and the export buttons', () => {
    const html = render([qcRow()]);
    expect(html).toContain('Filters');
    expect(html).toContain('From');
    expect(html).toContain('To');
    expect(html).toContain('Line No');
    expect(html).toContain('Order No');
    expect(html).toContain('Export Excel');
    expect(html).toContain('Export PDF');
  });

  it('shows an empty state listing no checks when there is no data', () => {
    const html = render([]);
    expect(html).toContain('No quality checks recorded yet');
    // No table is drawn without rows.
    expect(html).not.toContain('Checked Qty');
  });
});

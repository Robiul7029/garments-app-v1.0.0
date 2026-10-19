import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { PermissionContext } from '../../context/PermissionContext';
import ProcessUploadPage from '../../pages/ProcessUploadPage';

/**
 * The Uploaded Sheets table's Actions column.
 *
 * Each saved sheet gets View / Edit / Delete. View is a read action and is offered
 * to everyone; Edit and Delete change what the whole factory sees in its process
 * dropdowns, so they follow the ERP write actions on Order Management.
 *
 * The flags are supplied through `PermissionContext`, which is the source the
 * screen reads: a manager/admin holds create+edit+delete and sees every control, a
 * View-Only general user holds none of them and sees only View.
 */
const SHEET = {
  id: 10,
  style: 'STY-1001',
  order_no: 'PO-105',
  fileName: 'breakdown.xlsx',
  uploadedAt: '2026-08-19',
  totalSmv: 4.5,
  operations: [
    { operation: 'Collar Attach', machine: 'Overlock', section: 'Front', smv: 1.2 },
    { operation: 'Sleeve Join', machine: 'Overlock', section: 'Sleeve', smv: 1.5 },
  ],
};

function permissions({ canWrite }) {
  return {
    loading: false,
    record: canWrite ? { erpRole: 'production_manager' } : { erpRole: 'viewer' },
    uid: 'qa',
    actorName: 'QA',
    roles: canWrite ? ['production_manager'] : [],
    unknownRoles: [],
    isSuperAdmin: false,
    // Read access is universal under the View-Only model.
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

function render({ canWrite = true, sheets = [SHEET] } = {}) {
  const data = {
    getData: (key) => ({ 'process-breakdown': sheets, 'order-model': [], 'process-capacity': [] }[key] || []),
    addEntry: () => { }, updateEntry: () => { }, deleteEntry: () => { }, setRaw: () => { },
  };
  return renderToStaticMarkup(
    <PermissionContext.Provider value={permissions({ canWrite })}>
      <DataContext.Provider value={data}>
        <ProcessUploadPage
          category={{ key: 'orders', label: 'Order Management', icon: '📑' }}
          item={{ key: 'process-breakdown', label: 'Process Sheet Upload', icon: '📤' }}
        />
      </DataContext.Provider>
    </PermissionContext.Provider>,
  );
}

describe('the uploaded sheets table', () => {
  it('has an Actions column', () => {
    const html = render();
    expect(html).toContain('Uploaded sheets (1)');
    expect(html).toContain('>Actions</');
    expect(html).toContain('ps-row-actions');
  });

  it('offers View, Edit and Delete for a saved sheet', () => {
    const html = render();
    expect(html).toContain('>View</button>');
    expect(html).toContain('>Edit</button>');
    expect(html).toContain('>Delete</button>');
  });

  it('keeps the summary columns it already had', () => {
    const html = render();
    ['STY-1001', 'PO-105', 'breakdown.xlsx', '4.5'].forEach((v) => expect(html).toContain(v));
  });

  it('offers View but not Edit or Delete to a view-only user', () => {
    const html = render({ canWrite: false });
    expect(html).toContain('>View</button>');
    expect(html).not.toContain('>Edit</button>');
    expect(html).not.toContain('>Delete</button>');
  });

  it('says so when there is nothing uploaded', () => {
    const html = render({ sheets: [] });
    expect(html).toContain('No process sheets uploaded yet.');
    // Empty row spans the full uploaded-sheet table, including target and actions columns.
    expect(html).toMatch(/colspan="12"/i);
  });

  it('shows live target metrics and selection affordance for each sheet', () => {
    const html = render();
    expect(html).toContain('Hourly Target');
    expect(html).toContain('Daily Target');
    expect(html).toContain('Available Minutes');
    expect(html).toContain('Select this process sheet for line balancing');
  });

  it('renders one action group per sheet', () => {
    const html = render({
      sheets: [SHEET, { ...SHEET, id: 11, style: 'STY-2002', fileName: 'other.xlsx' }],
    });
    expect(html).toContain('Uploaded sheets (2)');
    expect((html.match(/ps-row-actions/g) || [])).toHaveLength(2);
  });
});

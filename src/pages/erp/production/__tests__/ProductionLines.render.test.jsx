import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PermissionContext } from '../../../../context/PermissionContext';
import { ErpDataContext } from '../../../../context/ErpDataContext';
import { DataContext } from '../../../../context/DataContext';
import ProductionLines from '../ProductionLines';

/**
 * The line master screen.
 *
 * What matters: it renders the master in English, offers the form to a role that
 * may write, hides it from a View-Only role, and says something useful when the
 * collection — the foreign key the hourly mirror needs — is still empty.
 */

const LINES = [
  { id: 'line-1', lineNo: 'Line-01', name: 'Sewing 01', department: 'Sewing', capacityPerHour: 200, active: true },
  { id: 'line-3', lineNo: 'Line-03', name: 'Sewing 03', department: 'Sewing', capacityPerHour: 240, active: false },
];

function render({ lines = LINES, can = true } = {}) {
  const erp = {
    rows: (key) => (key === 'lines' ? lines : []),
    subscribe: () => () => {},
    isLoading: () => false,
    errorFor: () => '',
    save: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
  };
  const permissions = { can: () => can, canView: () => true };
  const data = { getData: () => [] };
  return renderToStaticMarkup(
    <PermissionContext.Provider value={permissions}>
      <DataContext.Provider value={data}>
        <ErpDataContext.Provider value={erp}>
          <ProductionLines />
        </ErpDataContext.Provider>
      </DataContext.Provider>
    </PermissionContext.Provider>,
  );
}

describe('Production Lines', () => {
  it('lists the master in English', () => {
    const html = render();
    ['Production Lines', 'Line No', 'Line Name', 'Department', 'Supervisor', 'Capacity (pcs/hr)', 'Status']
      .forEach((label) => expect(html).toContain(label));
    expect(html).toContain('Line-01');
    expect(html).toContain('Sewing 03');
  });

  it('shows a deactivated line as Inactive rather than hiding it', () => {
    const html = render();
    expect(html).toContain('Inactive');
    // History booked to it must stay readable, so the row is still listed.
    expect(html).toContain('Line-03');
  });

  it('offers the form to a role that may write', () => {
    const html = render({ can: true });
    expect(html).toContain('Add a line');
    expect(html).toContain('Save line');
  });

  it('offers no write controls to a View-Only role', () => {
    const html = render({ can: false });
    expect(html).not.toContain('Add a line');
    expect(html).not.toContain('Save line');
    // The list is still readable.
    expect(html).toContain('Line-01');
  });

  it('explains an empty master, because the hourly mirror depends on it', () => {
    const html = render({ lines: [] });
    expect(html).toContain('No production lines yet');
    expect(html).toContain('mirrored');
  });

  it('uses no non-Latin script', () => {
    expect(/[\u0980-\u09FF\u0600-\u06FF\u0400-\u04FF]/.test(render())).toBe(false);
  });
});

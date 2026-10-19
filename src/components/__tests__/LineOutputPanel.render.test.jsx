import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import LineOutputPanel from '../LineOutputPanel';
import LineOutputOverrideModal from '../LineOutputOverrideModal';

/**
 * The Line Output panel and its override dialog.
 *
 * The panel shows the auto-aggregated figure for the designated process and the
 * per-operator sum behind it; the dialog is the English confirmation that guards
 * a manual override. Both are rendered through their real providers.
 */
const today = new Date().toISOString().slice(0, 10);
const ORDER = { id: 1, style: 'STY-1001', order_no: 'PO-105', buyer: 'H&M' };
const SHEET = {
  id: 10, style: 'STY-1001', order_no: 'PO-105', uploadedAt: today,
  lineOutputProcess: 'Body Complete',
  operations: [{ operation: 'Body Complete', smv: 4 }, { operation: 'Collar Attach', smv: 1.2 }],
};
const ROWS = [
  { id: 1, date: today, style: 'STY-1001', employee: 'Md Robiul', process: 'Body Complete', hours: { '08': 30 } },
  { id: 2, date: today, style: 'STY-1001', employee: 'Mst Sarjina', process: 'Body Complete', hours: { '08': 25 } },
];

function renderPanel({ sheets = [SHEET], overrides = [], isAdmin = true } = {}) {
  const data = {
    getData: (key) => ({
      'hourly-timesheet-rows': ROWS,
      employees: ['Md Robiul', 'Mst Sarjina'],
      'order-model': [ORDER],
      'process-breakdown': sheets,
      'process-capacity': [],
      'line-output-overrides': overrides,
    }[key] || []),
    addEntry: () => {}, updateEntry: () => {}, deleteEntry: () => {}, setRaw: () => {},
  };
  const auth = {
    user: { id: 'qa', role: isAdmin ? 'admin' : 'viewer', status: 'approved', isSuperAdmin: isAdmin },
    loading: false, authReady: true, usersVersion: 0, getLiveStatus: () => 'approved',
  };
  return renderToStaticMarkup(
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <LineOutputPanel date={today} />
      </DataContext.Provider>
    </AuthContext.Provider>,
  );
}

describe('the Line Output panel', () => {
  it('shows the aggregated line output and the process it came from', () => {
    const html = renderPanel();
    expect(html).toContain('Line Output');
    expect(html).toContain('Body Complete');
    // 30 + 25 = 55, auto-aggregated.
    expect(html).toContain('55');
    expect(html).toContain('Auto-aggregated');
  });

  it('itemises the sum per operator', () => {
    const html = renderPanel();
    expect(html).toContain('Md Robiul');
    expect(html).toContain('Mst Sarjina');
    expect(html).toContain('Operator');
  });

  it('offers the manual override to an admin only', () => {
    expect(renderPanel({ isAdmin: true })).toContain('Save Manual Value');
    expect(renderPanel({ isAdmin: false })).not.toContain('Save Manual Value');
  });

  it('shows the manual value and the retained aggregate when overridden', () => {
    const override = { id: `STY-1001__${today}`, style: 'STY-1001', date: today, process: 'Body Complete', value: 60, manual: true, updatedBy: 'Supervisor A' };
    const html = renderPanel({ overrides: [override] });
    expect(html).toContain('Manual override');
    expect(html).toContain('60');
    expect(html).toContain('Restore Auto Value');
    expect(html).toContain('Supervisor A');
  });

  it('prompts for a process when none is designated', () => {
    const html = renderPanel({ sheets: [{ ...SHEET, lineOutputProcess: '' }] });
    expect(html).toContain('No line output process is set');
  });
});

describe('the manual override confirmation dialog', () => {
  it('states the auto figure and the new value, in English, with YES / NO', () => {
    const html = renderToStaticMarkup(
      <LineOutputOverrideModal
        open
        processName="Body Complete"
        autoValue={1240}
        newValue={1300}
        date={today}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('Manual Line Output Override');
    expect(html).toContain('Current auto-aggregated output from operators is');
    expect(html).toContain('1,240');
    expect(html).toContain('1,300');
    expect(html).toContain('YES');
    expect(html).toContain('NO');
  });

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <LineOutputOverrideModal open={false} autoValue={0} newValue={0} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html).toBe('');
  });
});
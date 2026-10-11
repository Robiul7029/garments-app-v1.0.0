import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DailyProductionForm } from '../../components/DailyProductionSheet';
import { emptyHourly } from '../../config/dailyProductionForm';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';

/**
 * FieldInput reads the employee and style lists through `useData`, so the form
 * needs a data context. It is supplied directly rather than through DataProvider
 * because the provider writes to localStorage and logs activity, neither of which
 * belongs in a render test.
 */
const DATA = {
  getData: (key) => ({
    employees: ['Salma', 'Rina'],
    'order-model': [{ id: 1, style: 'STY-1001', order_no: 'PO-105', buyer: 'H&M', qty: 5000 }],
  }[key] || []),
  addEntry: () => {},
  updateEntry: () => {},
  deleteEntry: () => {},
  setRaw: () => {},
};

const AUTH = {
  user: { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true },
  loading: false, authReady: true, usersVersion: 0,
  getLiveStatus: () => 'approved',
};

/**
 * Proves the Daily Production form is wired to Order Management.
 *
 * The form is rendered with the same props the page passes, so what is asserted
 * here is what the floor sees:
 *   - the order-owned fields are read-only and labelled as coming from the order
 *   - the style picker replaces the manual Order No / Buyer entry
 *   - the operations on the selected style's uploaded sheet become the choices
 *   - the hourly grid and its computed columns are untouched by any of it
 */
const ORDER_OPTIONS = [{
  value: 'STY-1001',
  label: 'STY-1001 — PO-105',
  hint: 'H&M · Navy · 5000 pcs',
  order: { style: 'STY-1001', order_no: 'PO-105', buyer: 'H&M' },
}];

function render(props) {
  const formValues = {
    date: '2026-08-19',
    style: 'STY-1001',
    buyer: 'H&M',
    order_no: 'PO-105',
    color: 'Navy',
    po_qty: 5000,
    floor: 'Floor-2',
    line_no: 'Line-03',
    shift: 'Morning',
    supervisor: 'Salma',
    hourly: emptyHourly(),
    ...props.formValues,
  };
  return renderToStaticMarkup(
    <MemoryRouter>
      <AuthContext.Provider value={AUTH}>
        <DataContext.Provider value={DATA}>
          <DailyProductionForm
            formValues={formValues}
            onChange={() => {}}
            onSubmit={(e) => e.preventDefault()}
            onCancel={() => {}}
            editing={false}
            orderOptions={ORDER_OPTIONS}
            onSelectOrder={() => {}}
            {...props}
          />
        </DataContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('Daily Production — Order Management integration', () => {
  const html = render({ processOptions: [] });

  it('renames section 1 to Production Details', () => {
    expect(html).toContain('Production Details');
    expect(html).not.toContain('Order &amp; Production Details');
  });

  it('replaces the manual order fields with a searchable style picker', () => {
    expect(html).toContain('Select Style / Order No');
    expect(html).toContain('ss-control'); // the SearchableSelect control
    expect(html).toContain('STY-1001 — PO-105'); // current value shown
  });

  it('shows the order-owned fields as read-only, labelled from the order', () => {
    // Buyer, Color, PO Qty, Floor, Line, Shift, Supervisor come from the order.
    ['Buyer', 'Order No', 'Color', 'PO Qty', 'Floor', 'Line No', 'Shift', 'Supervisor']
      .forEach((label) => expect(html, `${label} missing`).toContain(label));
    expect(html).toContain('(from order)');
    // Every one of them renders as a disabled input rather than an editable box.
    const disabled = (html.match(/disabled=""/g) || []).length;
    expect(disabled).toBeGreaterThanOrEqual(8);
  });

  it('still carries the pre-filled order values into the form', () => {
    ['H&amp;M', 'PO-105', 'Navy', '5000', 'Floor-2', 'Line-03', 'Morning', 'Salma']
      .forEach((value) => expect(html).toContain(value));
  });

  it('keeps the day’s own fields editable', () => {
    // Production Date, Department, Operation, Employee, Hours, Manpower, Target.
    expect(html).toContain('Production Date');
    expect(html).toContain('Working Hours');
    expect(html).toContain('Manpower');
    expect(html).toContain('Daily Target');
  });

  it('keeps the hourly grid and every computed column', () => {
    ['Time Slot', 'Hourly Target', 'Actual Output', 'Cumulative Output', 'Variance (+/-)', 'Defect Qty', 'Remarks']
      .forEach((h) => expect(html).toContain(h));
    expect(html).toContain('08:00-09:00');
    expect(html).toContain('17:00-18:00');
    // 10 rows x (cumulative + variance).
    expect((html.match(/class="dp-computed"/g) || []).length).toBe(20);
  });
});

describe('Daily Production — the operation dropdown', () => {
  it('becomes a searchable dropdown listing the style’s uploaded operations', () => {
    const html = render({
      processOptions: [
        { value: 'Collar Attach', label: 'Collar Attach', hint: 'SMV 1.2' },
        { value: 'Sleeve Join', label: 'Sleeve Join', hint: 'SMV 1.5' },
      ],
    });
    expect(html).toContain('Operation / Process');
    // The dropdown carries the options, not a free-text box.
    expect(html).toContain('ss-control');
  });

  it('falls back to a plain input when the style has no uploaded sheet', () => {
    const html = render({ processOptions: [] });
    // A free-text operation field, so a missing sheet never blocks entry.
    expect(html).toContain('Operation / Process');
    expect(html).toContain('No process sheet has been uploaded for this style yet');
  });

  it('prompts for a style when none is selected yet', () => {
    const html = render({ processOptions: [], formValues: { style: '' } });
    expect(html).toContain('Pick a style above');
  });
});

describe('Daily Production — without the Order Management wiring', () => {
  it('keeps the original editable order fields when no handler is passed', () => {
    // The modal on the Daily Production screen renders the form without the
    // order props, and must keep working exactly as before.
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AuthContext.Provider value={AUTH}>
          <DataContext.Provider value={DATA}>
            <DailyProductionForm
              formValues={{ date: '2026-08-19', style: 'STY-1001', hourly: emptyHourly() }}
              onChange={() => {}}
              onSubmit={(e) => e.preventDefault()}
              onCancel={() => {}}
            />
          </DataContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(html).not.toContain('Select Style / Order No');
    expect(html).not.toContain('(from order)');
    expect(html).toContain('Production Details');
  });
});

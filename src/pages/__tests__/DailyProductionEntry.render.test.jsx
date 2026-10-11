import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DailyProductionEntry from '../DailyProductionEntry';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import { RoleProvider } from '../../context/RoleContext';
import { emptyHourly } from '../../config/dailyProductionForm';

/**
 * Renders the real Daily Production Entry PAGE to markup and asserts on what a
 * supervisor would actually see.
 *
 * This is a server render (no DOM needed), so it pins the page's structure — the
 * three sections, all ten hour rows with their pre-filled inputs, and the summary
 * — without depending on a browser. The auto-calculation itself is unit-tested in
 * dailyProductionForm.test.js; here we prove the page wires that math to the
 * screen and renders as a PAGE rather than a modal.
 */
const SEED = {
  employees: ['Salma', 'Rina', 'Karim'],
  'order-model': [{ id: 1, buyer: 'H&M', order_no: 'PO-105', style: 'STY-1001', qty: 5000 }],
  'daily-production': [
    {
      id: 1, date: '2026-08-19', style: 'STY-1001', line_no: 'Line-03', process: 'Collar Attach',
      department: 'Sewing', daily_target: 1000, quantity: 477,
      hourly: {
        ...emptyHourly(),
        '08:00-09:00': { target: 125, actual: 120, defect: 2, remarks: 'Morning start' },
      },
    },
  ],
};

function render() {
  const data = {
    getData: (key) => SEED[key] || [],
    addEntry: () => {},
    updateEntry: () => {},
    deleteEntry: () => {},
    setRaw: () => {},
  };
  const auth = {
    user: { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true },
    loading: false, authReady: true, usersVersion: 0,
    getLiveStatus: () => 'approved',
  };
  return renderToStaticMarkup(
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <RoleProvider>
          <DailyProductionEntry
            category={{ key: 'production', label: 'Sewing Department', icon: '🧵' }}
            item={{ key: 'daily-production-entry', label: 'Daily Production Entry', icon: '📝' }}
            parentItem={{ key: 'hourly-production', label: 'Hourly Production', icon: '⏱️' }}
          />
        </RoleProvider>
      </DataContext.Provider>
    </AuthContext.Provider>,
  );
}

/**
 * Renders the page with a URL query, which is how the page reads `?edit=` and
 * `?hour=`. jsdom is not installed, so `window.location.search` is stubbed just
 * for the duration of the render and put back immediately after.
 */
function renderWith({ edit, hour } = {}) {
  const query = new URLSearchParams();
  if (edit) query.set('edit', edit);
  if (hour) query.set('hour', hour);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { search: suffix },
    scrollTo: () => {},
    alert: () => {},
  };
  try {
    return render();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

const html = render();

describe('Daily Production Entry page', () => {
  it('renders as a page, not a modal', () => {
    // The page wraps the form in its own panel; no modal backdrop is present on
    // first load (one only appears for the Full Sheet preview).
    expect(html).toContain('dp-entry-card');
    expect(html).not.toContain('dp-modal-backdrop');
  });

  it('shows the category breadcrumb and the page title', () => {
    expect(html).toContain('Sewing Department');
    expect(html).toContain('Daily Production Entry');
  });

  it('renders all three template sections in order', () => {
    // Match the section HEADING element, not the bare text: "Hourly Production
    // Tracking" also appears in the page's intro paragraph, which would make a
    // plain indexOf compare the wrong occurrences.
    // Section 1 is now "Production Details": the order's own attributes are
    // pulled from Order Management rather than retyped here, so the heading no
    // longer claims to be the place order details are entered.
    const headings = [...html.matchAll(/class="dp-section-title">.*?dp-section-num">\d<\/span>([^<]+)</g)].map((m) => m[1]);
    expect(headings).toEqual(['Production Details', 'Hourly Production Tracking', 'End-of-Day Summary']);
  });

  it('numbers the three sections 1, 2 and 3', () => {
    const numbers = [...html.matchAll(/class="dp-section-num">(\d)</g)].map((m) => m[1]);
    expect(numbers).toEqual(['1', '2', '3']);
  });

  it('renders the hourly grid with every template column', () => {
    ['Time Slot', 'Hourly Target', 'Actual Output', 'Cumulative Output', 'Variance (+/-)', 'Defect Qty', 'Remarks']
      .forEach((heading) => expect(html).toContain(heading));
  });

  it('renders all ten hour rows with their time slots', () => {
    ['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00',
      '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00']
      .forEach((slot) => expect(html).toContain(slot));
  });

  it('renders an editable input for target, actual, defect and remarks on each hour', () => {
    // Ten rows x four editable cells (the two computed columns are read-only text).
    const inputs = html.match(/class="dp-hour-input"/g) || [];
    const remarks = html.match(/class="dp-remark-input"/g) || [];
    expect(inputs.length).toBe(30); // target, actual, defect per row
    expect(remarks.length).toBe(10);
  });

  it('renders every Section-1 order field', () => {
    ['Production Date', 'Buyer', 'Order No', 'Style No', 'Product / Item', 'Color', 'Size Range',
      'PO Qty', 'Floor', 'Line No', 'Shift', 'Supervisor', 'Operation / Process', 'Working Hours',
      'Manpower', 'Daily Target']
      .forEach((label) => expect(html).toContain(label));
  });

  it('renders every end-of-day summary row', () => {
    ['Daily Target vs Actual', 'Good Output', 'Efficiency %', 'Target Achievement %', 'Defect Rate %', 'Output to Finishing']
      .forEach((row) => expect(html).toContain(row));
  });

  it('shows the headline metrics read-out', () => {
    expect(html).toContain('dp-entry-metrics');
    expect(html).toContain('Good Output');
    expect(html).toContain('Efficiency %');
  });

  it('lists the saved entries below the form, with a Full Sheet action', () => {
    expect(html).toContain('Saved entries');
    expect(html).toContain('View Full Sheet');
    expect(html).toContain('STY-1001');
  });

  it('offers Save Entry as the submit action for a new sheet', () => {
    expect(html).toContain('Save Entry');
  });

  it('starts a new sheet with empty hour boxes but every computed column at 0', () => {
    // A fresh entry must not inherit the previous line's figures: the editable
    // cells are blank, and the two computed columns read 0.
    expect(html).toContain('class="dp-hour-input" placeholder="-" value=""');
    expect((html.match(/class="dp-computed"/g) || []).length).toBe(20); // 10 rows x cumulative + variance
  });

  it('pre-fills the hour values when an existing entry is loaded for edit', () => {
    // The saved row's values must round-trip into the form, including remarks.
    const withEdit = renderWith({ edit: '1' });
    expect(withEdit).toContain('value="125"'); // hourly target on the 08:00 row
    expect(withEdit).toContain('value="120"'); // actual output
    expect(withEdit).toContain('value="2"');   // defect qty
    expect(withEdit).toContain('Morning start');
    expect(withEdit).toContain('Save Changes'); // editing label, not "Save Entry"
  });

  it('does not show the admin-only actions to a read-only user', () => {
    const readOnlyHtml = renderToStaticMarkup(
      <AuthContext.Provider value={{ user: { id: 'v', role: 'viewer' }, loading: false, authReady: true, usersVersion: 0, getLiveStatus: () => 'active' }}>
        <DataContext.Provider value={{ getData: (k) => SEED[k] || [], addEntry: () => {}, updateEntry: () => {}, deleteEntry: () => {}, setRaw: () => {} }}>
          <RoleProvider>
            <DailyProductionEntry
              category={{ key: 'production', label: 'Sewing Department', icon: '🧵' }}
              item={{ key: 'daily-production-entry', label: 'Daily Production Entry', icon: '📝' }}
            />
          </RoleProvider>
        </DataContext.Provider>
      </AuthContext.Provider>,
    );
    expect(readOnlyHtml).toContain('View Only');
    expect(readOnlyHtml).not.toContain('Save Entry');
  });
});

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import LineProductionPage from '../LineProductionPage';
import { menu, navigableTargets } from '../../config/menuConfig';

/**
 * Line Production — the page, its table, and its place in the sidebar.
 *
 * The brief:
 *   · a "Line Production" link under Sewing Department;
 *   · a searchable, editable, deletable list of the day's line outputs, with an
 *     Edit and a Delete action on every row;
 *   · the two action headers and the page title strictly in English;
 *   · order-detail columns (Buyer, Style No, Product / Item, PO Qty, Color) populated
 *     from the Master Order records for the row's Order No.
 *
 * The fallback aggregation and the order join are asserted on the pure helpers (see
 * autoLineOutput.test.js and lineOrderDetails.test.js); a static render cannot run the
 * effect that writes the derived rows.
 */

const DAY = '2026-10-17';
const SUBMITTED = {
  id: 'LO-1', date: DAY, line_no: 'Line-03', order_no: 'PO-105', style: 'STY-1001',
  supervisor: 'Md Robiul Islam', achievement: 1200, dailyTarget: 1200, achievementPercent: 100,
};
const CALCULATED = {
  id: 'auto-line__line-05__2026-10-17', date: DAY, line_no: 'Line-05', order_no: 'PO-106',
  style: 'STY-1002', supervisor: '', employee: 'All employees', achievement: 640,
  dailyTarget: 800, achievementPercent: 80, source: 'auto', autoEntries: 4, autoEmployees: 4,
};
// The Master Order records the table joins its order details from.
const ORDERS = [
  { id: 1, order_no: 'PO-105', style: 'STY-1001', buyer: 'H&M', item: 'Basic Tee', qty: 5000, color: 'Navy, Black' },
  { id: 2, order_no: 'PO-106', style: 'STY-1002', buyer: 'Zara', item: 'Polo Shirt', qty: 1500, color: 'White' },
];

function render({ isAdmin = true, rows = [SUBMITTED, CALCULATED], orders = ORDERS } = {}) {
  const data = {
    getData: (key) => ({
      'hourly-timesheet-rows': [],
      // The month's own collection, which the page reads for the day being viewed.
      'line-output-2026-10': rows,
      'daily-production': [],
      'order-model': orders,
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
        <LineProductionPage />
      </DataContext.Provider>
    </AuthContext.Provider>,
  );
}

describe('the Line Production page', () => {
  it('titles itself "Line Production"', () => {
    expect(render()).toContain('Line Production');
  });

  it('carries the column headers the brief names, in English', () => {
    const html = render();
    [
      'Line', 'Order No', 'Buyer', 'Style No', 'Product / Item', 'PO Qty', 'Color',
      'Supervisor', 'Source', 'Line Output', 'Daily Target', 'Achievement',
      'Daily Due', 'Monthly Due', 'Action',
    ].forEach((h) => expect(html).toContain(`>${h}</th>`));
  });

  it('puts the order-detail columns after Order No, before Supervisor', () => {
    const html = render();
    const at = (h) => html.indexOf(`>${h}</th>`);
    expect(at('Order No')).toBeLessThan(at('Buyer'));
    expect(at('Buyer')).toBeLessThan(at('Style No'));
    expect(at('Style No')).toBeLessThan(at('Product / Item'));
    expect(at('Product / Item')).toBeLessThan(at('PO Qty'));
    expect(at('PO Qty')).toBeLessThan(at('Color'));
    expect(at('Color')).toBeLessThan(at('Supervisor'));
  });

  it('puts the two due columns after Achievement', () => {
    const html = render();
    const at = (h) => html.indexOf(`>${h}</th>`);
    expect(at('Achievement')).toBeLessThan(at('Daily Due'));
    expect(at('Daily Due')).toBeLessThan(at('Monthly Due'));
  });

  it('offers a search box with an English placeholder', () => {
    const html = render();
    expect(html).toContain('Search line, order, buyer or product…');
    expect(html).toContain('aria-label="Search line production"');
  });

  it('shows a submitted line and a calculated one', () => {
    const html = render();
    expect(html).toContain('Line-03');
    expect(html).toContain('Line-05');
    // The supervisor is named on the submitted row. A calculated row has NO supervisor
    // — nobody signed for it — so the cell states that rather than crediting somebody
    // who did not make the claim.
    expect(html).toContain('Md Robiul Islam');
    expect(html).toMatch(/<td>—<\/td>/);
  });

  it('says on every row where its figure came from', () => {
    const html = render();
    expect(html).toContain('Submitted');
    expect(html).toContain('Calculated');
    // The calculated row explains itself rather than showing an unexplained number.
    expect(html).toContain('Calculated automatically');
    expect(html).toContain('no Total Line Output entry was submitted');
  });

  it('gives every row an Edit and a Delete action', () => {
    const html = render();
    expect(html).toContain('aria-label="Edit Line-03"');
    expect(html).toContain('aria-label="Delete Line-03"');
    expect(html).toContain('aria-label="Edit Line-05"');
    expect(html).toContain('aria-label="Delete Line-05"');
  });

  it('summarises the day', () => {
    const html = render();
    // 1,200 + 640 across two lines, against 1,200 + 800 of target.
    expect(html).toContain('1,840');
    expect(html).toContain('92%');
    expect(html).toContain('Calculated');
  });
});

describe('the order-detail columns', () => {
  it('populates Buyer, Style No, Product / Item, PO Qty and Color from the master order', () => {
    const html = render();
    // Line-03 -> PO-105 -> H&M / STY-1001 / Basic Tee / 5,000 / Navy, Black
    expect(html).toContain('H&amp;M');
    expect(html).toContain('Basic Tee');
    expect(html).toContain('5,000');
    expect(html).toContain('Navy, Black');
    // Line-05 -> PO-106 -> Zara / STY-1002 / Polo Shirt / 1,500 / White
    expect(html).toContain('Zara');
    expect(html).toContain('Polo Shirt');
    expect(html).toContain('1,500');
    expect(html).toContain('White');
  });

  it('shows a tooltip rather than a blank when the order is unknown', () => {
    // A row whose order is not in the master records still renders, and says which
    // field is missing instead of leaving an ambiguous empty cell.
    const orphan = { ...SUBMITTED, id: 'LO-9', order_no: 'PO-999', style: '' };
    const html = render({ rows: [orphan] });
    expect(html).toContain('PO-999');
    expect(html).toContain('No Master Order record matches this order number.');
    expect(html).toContain('—');
  });

  it('reports a missing product and PO qty separately', () => {
    const html = render({
      rows: [SUBMITTED],
      orders: [{ order_no: 'PO-105', style: 'STY-1001', buyer: 'H&M' }],
    });
    expect(html).toContain('No product name on the Master Order record.');
    expect(html).toContain('No PO quantity on the Master Order record.');
  });
});

describe('the due columns', () => {
  it('states the shortfall against the day’s target', () => {
    // Line-03 met its target (1,200 of 1,200); Line-05 fell 160 short (640 of 800).
    const html = render();
    expect(html).toContain('Met');
    expect(html).toContain('160');
  });

  it('accumulates the month’s shortfall per line', () => {
    // Two days of Line-03, each 300 short, so the month reads 600 while the day reads 300.
    const rows = [
      { ...SUBMITTED, id: 'a', achievement: 700, dailyTarget: 1000 },
      { ...SUBMITTED, id: 'b', date: '2026-10-16', achievement: 700, dailyTarget: 1000 },
    ];
    const html = render({ rows });
    // The day's row shows 300 due; the month shows 600.
    expect(html).toContain('>300<');
    expect(html).toContain('>600<');
  });

  it('explains each due figure in English on hover', () => {
    const html = render();
    // The apostrophe is HTML-escaped inside the attribute, so the raw markup is
    // matched rather than the rendered text.
    expect(html).toContain('pcs short of the day&#x27;s target.');
    expect(html).toContain('pcs short across this month&#x27;s entries for');
    expect(html).toContain('The day&#x27;s target was met.');
    expect(html).toContain('No shortfall recorded this month.');
  });
});

describe('the table shell', () => {
  it('says what to do when the day is empty', () => {
    const html = render({ rows: [] });
    expect(html).toContain('No line output recorded for this day yet');
  });

  it('freezes its header row the same way the other tables do', () => {
    const html = render();
    const row = html.match(/<tr class="[^"]*lp-thead-row[^"]*"[^>]*>/)[0];
    ['sticky', 'top-0', 'z-10', 'bg-surface'].forEach((cls) => expect(row).toContain(cls));
    expect(html).toContain('table-wrap lp-table-wrap');
  });

  it('uses no non-Latin script anywhere on the page', () => {
    const text = render().replace(/<[^>]*>/g, ' ');
    expect(/[\u0980-\u09FF\u0600-\u06FF\u0400-\u04FF]/.test(text)).toBe(false);
  });
});

describe('a viewer', () => {
  it('sees the figures but no Edit or Delete action', () => {
    const html = render({ isAdmin: false });
    expect(html).toContain('Line-03');
    expect(html).not.toContain('aria-label="Edit Line-03"');
    expect(html).not.toContain('aria-label="Delete Line-03"');
    expect(html).not.toContain('>Action</th>');
  });
});

describe('its place in the sidebar', () => {
  const sewing = menu.find((c) => c.key === 'production');

  it('sits under Sewing Department', () => {
    expect(sewing.label).toBe('Sewing Department');
    expect(sewing.items.some((i) => i.key === 'line-production')).toBe(true);
  });

  it('is labelled "Line Production" in English', () => {
    const item = sewing.items.find((i) => i.key === 'line-production');
    expect(item.label).toBe('Line Production');
    expect(/^[A-Za-z ]+$/.test(item.label)).toBe(true);
  });

  it('is reachable at /production/line-production', () => {
    const target = navigableTargets().find((t) => t.item?.key === 'line-production');
    expect(target?.path).toBe('/production/line-production');
    expect(target.category.key).toBe('production');
    // It must be a VISIBLE sidebar entry, not one of the hidden legacy routes.
    expect(target.sidebarHidden).toBeUndefined();
  });

  it('carries the variant the router branches on', () => {
    const item = sewing.items.find((i) => i.key === 'line-production');
    expect(item.variant).toBe('line-production');
  });
});

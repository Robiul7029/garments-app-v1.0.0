import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import MonthlyMatrixSheet from '../MonthlyMatrixSheet';

/**
 * The Monthly Matrix must render on an empty month.
 *
 * It used to crash the whole tab with "Uncaught ReferenceError: monthTotals is not
 * defined": the toolbar read `monthTotals.output` / `monthEfficiency`, but those
 * bindings had been removed when the component moved to `summariseMonth`'s single
 * `totals` object. A ReferenceError during render blanks the screen — there is no
 * error boundary above it — so this is a hard failure, not a cosmetic one.
 *
 * These tests render the REAL component through its real providers, so a missing
 * binding or an unsafe property access fails here rather than in the browser.
 *
 * `useRole()` reads the session from AuthContext (RoleContext is only a pass-through
 * wrapper), so the auth provider is what grants the admin controls.
 */
function render({ rows = [], orders = [], isAdmin = true, openDay = null } = {}) {
  const data = {
    getData: (key) => {
      if (key === 'hourly-timesheet-rows') return rows;
      if (key === 'order-model') return orders;
      return [];
    },
    addEntry: () => {}, updateEntry: () => {}, deleteEntry: () => {}, setRaw: () => {},
  };
  const auth = {
    user: {
      id: 'qa', role: isAdmin ? 'admin' : 'viewer', status: 'approved', isSuperAdmin: isAdmin,
    },
    loading: false,
    authReady: true,
    usersVersion: 0,
    getLiveStatus: () => 'approved',
  };

  return renderToStaticMarkup(
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        {/* `openDay` pre-opens the day modal, which is otherwise opened by a
            click — and a static render cannot click. */}
        <MonthlyMatrixSheet month="2026-10" onMonthChange={() => {}} initialOpenDay={openDay} />
      </DataContext.Provider>
    </AuthContext.Provider>,
  );
}

const ROWS = [
  {
    id: 1, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Collar Attach',
    style: 'STY-1001', hours: { 8: 10, 9: 12 }, hourlyTarget: 30, workingHours: 10,
  },
  {
    id: 2, date: '2026-10-13', employee: 'Mst Sarjina Akter', process: 'Side Seam',
    style: 'STY-1001', hours: { 8: 25 }, hourlyTarget: 30, workingHours: 10,
  },
];

/**
 * A day with the fields the rich cell reads: department, attendance, and two
 * processes worked by the same operator. Robiul makes 380 against a 400 target
 * (95%), so the cell must show a yellow 95% badge, 20 Due, and both processes
 * itemised with their own achievement.
 */
const RICH_ROWS = [
  {
    id: 10, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Collar Attach',
    style: 'STY-1001', department: 'SEWING', attendance: 'Present',
    hours: { 8: 120, 9: 80 }, hourlyTarget: 20, workingHours: 10,
  },
  {
    id: 11, date: '2026-10-12', employee: 'Md Robiul Islam', process: 'Sleeve Join',
    style: 'STY-1001', department: 'SEWING', attendance: 'Present',
    hours: { 10: 100, 11: 80 }, hourlyTarget: 20, workingHours: 10,
  },
];

describe('the monthly matrix renders without crashing', () => {
  it('renders an empty month (the case the ReferenceError hit)', () => {
    const html = render({ rows: [] });
    expect(html).toContain('Monthly Target');
    expect(html).toContain('Overall Monthly Efficiency');
    // Zeros, not blanks and not a crash.
    expect(html).toContain('0%');
    expect(html).toContain('No production recorded for 2026-10');
  });

  it('renders the month-end summary tiles', () => {
    const html = render({ rows: ROWS });
    ['Total Present Days', 'Total Active Hours', 'Monthly Target', 'Achieved Output', 'Total Defects']
      .forEach((label) => expect(html, `${label} missing`).toContain(label));
  });

  it('shows the aggregated figures rather than zeros', () => {
    const html = render({ rows: ROWS });
    // Robiul 22 + Sarjina 25 = 47 pieces.
    expect(html).toContain('47');
    // Both employees worked one day each.
    expect(html).toContain('Md Robiul Islam');
    expect(html).toContain('Mst Sarjina Akter');
  });

  it('uses the same PO-derived monthly target as the Master Buyer summary in the tile, row and footer', () => {
    const rows = [
      { id: 21, date: '2026-10-12', employee: 'Operator One', order_no: 'PO-M', style: 'STYLE-M', process: 'Final Assembly', hours: { 8: 100 }, workingHours: 8 },
      { id: 22, date: '2026-10-13', employee: 'Operator Two', order_no: 'PO-M', style: 'STYLE-M', process: 'Final Assembly', hours: { 8: 50 }, workingHours: 8 },
    ];
    const orders = [{ id: 1, order_no: 'PO-M', style: 'STYLE-M', qty: 1200, order_date: '2026-10-01', ship_date: '2026-12-01' }];
    const html = render({ rows, orders });
    // 1,200 pieces / 2 calendar months. The full target appears in the summary
    // tile and footer; employee rows receive output-proportional shares (400, 200).
    expect(html).toContain('600');
    expect(html).toContain('400');
    expect(html).toContain('200');
  });

  it('reflects changed order dates and PO quantity in the monthly target', () => {
    const rows = [{ id: 31, date: '2026-10-12', employee: 'Operator One', order_no: 'PO-LIVE', style: 'STYLE-LIVE', process: 'Final Assembly', hours: { 8: 100 }, workingHours: 8 }];
    const initial = [{ id: 1, order_no: 'PO-LIVE', style: 'STYLE-LIVE', qty: 1200, order_date: '2026-10-01', ship_date: '2026-12-01' }];
    const updated = [{ ...initial[0], qty: 1800, ship_date: '2027-01-01' }];
    const firstRender = render({ rows, orders: initial });
    const updatedRender = render({ rows, orders: updated });
    expect(firstRender).toContain('600 pcs');
    expect(updatedRender).toContain('600 pcs');
    expect(updatedRender).not.toContain('300 pcs');
  });

  it('renders the whole 1–31 day grid', () => {
    const html = render({ rows: ROWS });
    // The day headers are the numbers 1..31.
    expect((html.match(/class="dp-matrix-day"/g) || []).length).toBe(31);
  });

  it('offers the date-range filters and the export buttons', () => {
    const html = render({ rows: ROWS });
    expect(html).toContain('From');
    expect(html).toContain('To');
    expect(html).toContain('Download Monthly Report (Excel)');
    expect(html).toContain('Export PDF');
  });

  it('names the month-end summary columns', () => {
    const html = render({ rows: ROWS });
    ['Present Days', 'Active Hours', 'Achieved Output', 'Total Defects', 'Efficiency %', 'Variance']
      .forEach((label) => expect(html, `${label} column missing`).toContain(label));
  });
});

/**
 * The rich date cell: department and attendance, the process itemisation, and the
 * day's cumulative totals with a colour-coded efficiency badge.
 *
 * These are the brief's four cell requirements, asserted against the REAL render
 * rather than eyeballed, because the numbers come from `aggregateMonthly` and a
 * regression there would otherwise show up only as a wrong figure on screen.
 */
describe('each date cell carries the day in full', () => {
  it('shows the department and attendance status', () => {
    const html = render({ rows: RICH_ROWS });
    expect(html).toContain('SEWING');
    expect(html).toContain('Present');
  });

  it('itemises every process worked, with its output against its own target', () => {
    const html = render({ rows: RICH_ROWS });
    expect(html).toContain('Collar Attach');
    expect(html).toContain('Sleeve Join');
    // Collar Attach 200 / target 200 (20/hr × 10h) = 100%.
    expect(html).toContain('200/200');
  });

  it('shows the day cumulative totals and the remaining balance', () => {
    const html = render({ rows: RICH_ROWS });
    // 380 output against a 400 target for the day.
    expect(html).toContain('Output / Target');
    expect(html).toContain('380 / 400');
    // 20 pieces short — the brief's "Remaining Balance / Shortage (Due)".
    expect(html).toContain('Shortage (Due)');
    expect(html).toContain('20 pcs');
  });

  it('colour-codes the day efficiency: 95% is the yellow band', () => {
    const html = render({ rows: RICH_ROWS });
    // 380/400 = 95%, which is the brief's 80–99% yellow band.
    expect(html).toContain('95% Efficiency');
    expect(html).toContain('dp-day-eff-warning');
  });

  it('offers the streamlined summary for compact screens', () => {
    const html = render({ rows: RICH_ROWS });
    // The brief's "380 / 400 Pcs | 95%" shape, rendered alongside the full cell
    // and switched on by the stylesheet at phone widths.
    expect(html).toContain('dp-day-compact');
    expect(html).toContain('380 / 400 Pcs');
  });

  it('makes a day with output a button, and a day without one inert', () => {
    const html = render({ rows: RICH_ROWS });
    // Day 12 carries work, so it is clickable and named for a screen reader.
    expect(html).toContain('dp-day-btn');
    expect(html).toContain('Day 12 breakdown for this employee');
    // Day 13 has nothing, so it stays a plain cell rather than promising a dialog.
    expect((html.match(/dp-day-btn/g) || []).length).toBe(1);
  });

  it('renders the day breakdown modal with its English headings', () => {
    const html = render({ rows: RICH_ROWS, openDay: { employee: 'Md Robiul Islam', day: 12 } });
    expect(html).toContain('Daily Production Breakdown');
    expect(html).toContain('Total Daily Output');
    expect(html).toContain('Total Daily Target');
    expect(html).toContain('Remaining Balance (Due)');
    expect(html).toContain('Day Efficiency');
    expect(html).toContain('Process-wise breakdown');
    expect(html).toContain('Achievement');
  });

  it('keeps the whole interface in English', () => {
    const html = render({ rows: RICH_ROWS, openDay: { employee: 'Md Robiul Islam', day: 12 } });
    // No Bengali, CJK, Arabic or Cyrillic anywhere on the screen.
    expect(html).not.toMatch(/[\u0980-\u09FF\u4E00-\u9FFF\u0600-\u06FF\u0400-\u04FF]/);
  });
});
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import HourlyTimesheet from '../HourlyTimesheet';
import { processNamesForStyle } from '../../config/orderWorkflow';

/**
 * Hourly Production.
 *
 * Three things the brief asks for, pinned here:
 *   1. the form records an entry per hour of the day;
 *   2. the process list comes from the uploaded Process Sheet;
 *   3. daily totals per employee are shown, summed from the hourly boxes.
 */
const today = new Date().toISOString().slice(0, 10);

const ORDER = {
  id: 1, style: 'STY-1001', order_no: 'PO-105', buyer: 'H&M', item: 'Tee',
  qty: 5000, order_date: `${today.slice(0, 7)}-05`,
};
// An uploaded process sheet for STY-1001.
const SHEET = {
  id: 10, style: 'STY-1001', order_no: 'PO-105', fileName: 'sheet.xlsx',
  uploadedAt: today, totalSmv: 4.5,
  operations: [
    { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
    { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
    { operation: 'Side Seam', machine: 'Flatlock', smv: 1.8, section: 'Body' },
  ],
};

// Two hourly rows for the day: Robiul on two processes, Sarjina on one.
const HOURLY_ROWS = [
  { id: 1, date: today, employee: 'Md Robiul Islam', process: 'Collar Attach', hours: { '08': 10, '09': 12, '10': 8 } },
  { id: 2, date: today, employee: 'Md Robiul Islam', process: 'Sleeve Join', hours: { '11': 15, '12': 5 } },
  { id: 3, date: today, employee: 'Mst Sarjina Akter', process: 'Side Seam', hours: { '08': 20 } },
];

function render({ isAdmin = true, rows = HOURLY_ROWS } = {}) {
  const data = {
    getData: (key) => ({
      'hourly-timesheet-rows': rows,
      employees: ['Md Robiul Islam', 'Mst Sarjina Akter'],
      'order-model': [ORDER],
      'process-breakdown': [SHEET],
      'process-capacity': [],
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
        <HourlyTimesheet />
      </DataContext.Provider>
    </AuthContext.Provider>,
  );
}

describe('the hourly production screen', () => {
  it('shows a column for every hour of the working day', () => {
    const html = render();
    ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18'].forEach((h) => {
      expect(html).toContain(`${h}:00`);
    });
  });

  it('groups an employee who ran several processes under ONE name cell', () => {
    const html = render();
    // Robiul has two process rows; his name is written once in the TABLE's own
    // employee cell (`hourly-employee-name`), with a rowspan of 2 covering both
    // rows, so it is not repeated down the column.
    const nameCells = html.match(/class="hourly-employee-name">Md Robiul Islam</g) || [];
    expect(nameCells).toHaveLength(1);
    expect(html).toContain('rowspan="2"');
    expect(html).toContain('2 processes');
    // Sarjina has a single row, so her name cell appears once as well.
    expect((html.match(/class="hourly-employee-name">Mst Sarjina Akter</g) || [])).toHaveLength(1);
  });

  it('carries an Actions column with Edit and Delete for each row', () => {
    const html = render();
    expect(html).toContain('Actions');
    // Three rows, so three Edit and three Delete buttons.
    expect((html.match(/title="Edit this row"/g) || []).length).toBe(3);
    expect((html.match(/title="Delete this row"/g) || []).length).toBe(3);
  });

  it('hides the Actions column from a viewer', () => {
    const html = render({ isAdmin: false });
    expect(html).not.toContain('title="Edit this row"');
    expect(html).not.toContain('title="Delete this row"');
  });

  it('sums each row into a Daily Total column', () => {
    const html = render();
    expect(html).toContain('Daily Total');
    // Robiul row 1: 10+12+8 = 30. Robiul row 2: 15+5 = 20. Sarjina: 20.
    expect(html).toContain('>30<');
    expect(html).toContain('>20<');
  });

  it('shows per-employee daily totals, summing across their rows', () => {
    const html = render();
    expect(html).toContain('Daily totals');
    // Robiul's day figure is 30 + 20 = 50 (two rows added together).
    expect(html).toContain('hourly-total-chips');
    expect(html).toContain('50 pcs');
    expect(html).toContain('20 pcs');
    // The grand total across the day is 50 + 20 = 70.
    expect(html).toContain('70 pcs across 2 workers');
  });

  it('offers the entry button to an admin and hides it from a viewer', () => {
    // The button opens the unified entry form, whose type selector offers Hourly,
    // Daily, Total Line Output and QC Product Check.
    expect(render({ isAdmin: true })).toContain('+ New Entry');
    expect(render({ isAdmin: false })).not.toContain('+ New Entry');
  });

  it('tells you there is nothing recorded when the day is empty', () => {
    const html = render({ rows: [] });
    expect(html).toContain('No hourly entries recorded for this day yet');
    expect(html).toContain('No hourly rows for');
  });
});

describe('the process list is driven by the uploaded Process Sheet', () => {
  it('offers the sheet operations as the process source', () => {
    // With a sheet uploaded for STY-1001, its operations are the options. The
    // screen reads them through processNamesForStyle, the same helper the Worker
    // Production page uses — so the two screens can never disagree.
    const html = render();
    expect(processNamesForStyle([SHEET], { style: 'STY-1001', order_no: 'PO-105' }))
      .toEqual(['Collar Attach', 'Sleeve Join', 'Side Seam']);
    expect(html).toContain('Process');
  });

  it('has no operations when the style has no uploaded sheet', () => {
    // processNamesForStyle returns nothing for a style with no sheet, which is
    // what makes the form fall back to a free-text process box.
    expect(processNamesForStyle([SHEET], { style: 'STY-NO-SHEET' })).toEqual([]);
  });
});

/**
 * The Active Hours / Day mode switch.
 *
 * The form logs the same day two ways: an hourly figure per clock slot, or one
 * whole-day figure. These pin the control and the grid that answers it — the
 * inputs themselves are driven by React state, which a static render cannot
 * exercise, so what is asserted here is the structure each mode produces.
 */
describe('the Active Hours / Day control', () => {
  it('no longer shows a "N slots selected" badge', () => {
    // The badge was removed: the boxes below already show which slots are open, so
    // the count only restated what was on screen.
    const html = render();
    expect(html).not.toContain('slots selected');
    expect(html).not.toContain('SLOTS SELECTED');
  });

  it('labels the admin entry button for both modes', () => {
    // The button opens the unified form; the mode is chosen inside it.
    expect(render({ isAdmin: true })).toContain('+ New Entry');
  });
});

/**
 * A row saved in DAY mode carries its whole-day figure under the DAY_MODE key.
 * The table must sum it like any other, and the row must survive a round trip.
 */
describe('a whole-day entry in the table', () => {
  const dayRow = {
    id: 9,
    date: today,
    employee: 'Md Robiul Islam',
    process: 'Collar Attach',
    mode: 'day',
    hours: { __DAY__: 240 },
    hourlyTarget: 30,
    dailyTarget: 300,
    workingHours: 10,
  };

  it('sums the whole-day figure into the Daily Total column', () => {
    const html = render({ rows: [dayRow] });
    // The day's 240 pieces are the row total, read from the same `hours` map.
    expect(html).toContain('>240<');
  });

  it('adds the whole-day figure to the employee daily total', () => {
    const html = render({ rows: [dayRow] });
    expect(html).toContain('240 pcs');
  });
});/**
 * The table is READ-ONLY until a row's Edit button is pressed.
 *
 * The hour boxes used to write to storage on every keystroke, so merely scrolling
 * the table with a stray key could rewrite somebody's output. A static render shows
 * the resting state, which is exactly the state this protects: every box must be
 * disabled and read-only, and no Save/Cancel may exist until an edit is opened.
 */
describe('the table locks its inputs until a row is edited', () => {
  it('renders every hour box disabled and read-only', () => {
    const html = render();
    const boxes = html.match(/class="hour-cell-input"/g) || [];
    expect(boxes.length).toBeGreaterThan(0);
    // Each box must carry BOTH guards: `disabled` blocks typing and focus,
    // `readonly` is the belt-and-braces attribute a screen reader announces.
    expect((html.match(/class="hour-cell-input"[^>]*disabled/g) || []).length).toBe(boxes.length);
    expect((html.match(/class="hour-cell-input"[^>]*readonly/g) || []).length).toBe(boxes.length);
  });

  it('shows no Save or Cancel until an edit is opened', () => {
    const html = render();
    expect(html).not.toContain('Save these hours');
    expect(html).not.toContain('Discard the changes');
    // The resting state offers Edit / Delete instead.
    expect(html).toContain('title="Edit this row"');
  });

  it('tells the admin how to unlock a row', () => {
    const html = render();
    expect(html).toContain('hourly-table-hint');
    expect(html).toContain('Press ✏️ on a row to make its hour boxes editable.');
  });

  it('tells a viewer the boxes are locked', () => {
    const html = render({ isAdmin: false });
    expect(html).toContain('View only — the hour boxes are locked.');
    // A viewer has no way to unlock anything.
    expect(html).not.toContain('title="Edit this row"');
  });

  it('locks the boxes for a viewer as well as an admin', () => {
    const html = render({ isAdmin: false });
    const boxes = html.match(/class="hour-cell-input"/g) || [];
    expect(boxes.length).toBeGreaterThan(0);
    expect((html.match(/class="hour-cell-input"[^>]*disabled/g) || []).length).toBe(boxes.length);
  });

  it('labels each box so a locked figure is still readable', () => {
    const html = render();
    // A disabled control is skipped by some screen readers, so the aria-label is
    // what keeps the figure meaningful when it cannot be typed into.
    expect(html).toContain('aria-label="08:00 output for Md Robiul Islam"');
  });
});
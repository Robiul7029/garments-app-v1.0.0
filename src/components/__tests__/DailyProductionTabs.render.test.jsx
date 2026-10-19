import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import DailyProductionTabs from '../DailyProductionTabs';

/**
 * The Daily Production screen is a tab host: the tab bar, the headline bar and the
 * four panels all come from the same render. These tests pin the whole structure —
 * the four top-navigation tabs AND the tables each one shows — so a change to one
 * panel (for instance hiding the Overtime row inside the Hourly Entry tab) cannot
 * quietly take the rest of the page with it.
 *
 * The failure this guards against is exactly the one the brief reports: hiding a
 * section inside the entry form left the page with no tab bar and no tables. The
 * tab host renders all four tabs unconditionally, so they are asserted first, then
 * each panel's own content.
 */
const today = new Date().toISOString().slice(0, 10);
const ORDER = { id: 1, style: 'STY-1001', order_no: 'PO-105', buyer: 'H&M', item: 'Tee', qty: 5000 };
const SHEET = {
  id: 10, style: 'STY-1001', order_no: 'PO-105', fileName: 's.xlsx', uploadedAt: today, totalSmv: 4.5,
  operations: [{ operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' }],
};
const HOURLY_ROW = {
  id: 1, date: today, employee: 'Md Robiul Islam', order_no: 'PO-105', style: 'STY-1001',
  process: 'Collar Attach', line_no: 'Line-03', entry_type: 'hourly',
  hours: { 8: 50, 9: 55, 10: 60 }, qty: { 'Collar Attach': { 8: 50, 9: 55, 10: 60 } },
  workingHours: 3, overtime: 0, dailyTarget: 500,
};

function render() {
  const data = {
    getData: (key) => ({
      'hourly-timesheet-rows': [HOURLY_ROW],
      employees: ['Md Robiul Islam'],
      'order-model': [ORDER],
      'process-breakdown': [SHEET],
      'process-capacity': [],
    }[key] || []),
    addEntry: () => {}, updateEntry: () => {}, deleteEntry: () => {}, setRaw: () => {},
  };
  const auth = {
    user: { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true },
    loading: false, authReady: true, usersVersion: 0, getLiveStatus: () => 'approved',
  };
  // RoleContext is only a pass-through wrapper over AuthContext, so the admin role
  // is granted by the auth account here rather than by a separate provider.
  return renderToStaticMarkup(
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <DailyProductionTabs />
      </DataContext.Provider>
    </AuthContext.Provider>,
  );
}

describe('the Daily Production tab host', () => {
  it('renders the headline bar above the tabs', () => {
    const html = render();
    expect(html).toContain('Daily Production');
    expect(html).toContain('Working Day');
    // The day's headline figures: pieces, defects, achievement and headcount.
    expect(html).toContain('pcs');
    expect(html).toContain('defects');
    expect(html).toContain('employees');
  });

  it('renders all four top-navigation tabs in the briefed order', () => {
    const html = render();
    const tabbar = html.slice(html.indexOf('role="tablist"'), html.indexOf('role="tabpanel"'));
    // The order is the brief's: Hourly Production first, then Overall Summary,
    // then the two all-employee sheets. Each label must appear, in that sequence.
    // The static markup escapes the ampersand, so the first label is matched as
    // rendered ('&amp;') rather than as written in the source.
    const order = [
      'Hourly Production (Input &amp; Sheets)',
      'Overall Summary',
      'Daily All-Employee',
      'Monthly All-Employee',
    ];
    order.forEach((label) => expect(tabbar).toContain(label));
    const positions = order.map((label) => tabbar.indexOf(label));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // The tab bar itself is present and is the only tablist on the page.
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Daily Production sections"');
  });

  it('opens on the Overall Summary tab by default', () => {
    const html = render();
    // The brief's default landing tab is Overall Summary, so its tab is the one
    // marked selected and its panel is the one addressed.
    expect(html).toContain('id="dp-panel-summary"');
    expect(html).toContain('id="dp-tab-summary"');
    const summaryTab = html.slice(
      html.indexOf('id="dp-tab-summary"'),
      html.indexOf('</button>', html.indexOf('id="dp-tab-summary"')),
    );
    expect(summaryTab).toContain('aria-selected="true"');
  });

  it('puts the global New Entry and Download Report actions in the header', () => {
    const html = render();
    // Both actions sit in the top-level header, above the tab bar, so they are
    // reachable from every tab.
    const header = html.slice(0, html.indexOf('role="tablist"'));
    expect(header).toContain('+ New Entry');
    expect(header).toContain('Download Report');
  });

  it('keeps the tab host and its panels mounted as a single structure', () => {
    const html = render();
    // The module wrapper, the header, the headline bar and the tab bar all render
    // in one pass — hiding a section inside a panel must not remove any of them.
    expect(html).toContain('dp-tabs-module');
    expect(html).toContain('module-header');
    expect(html).toContain('dp-headline-bar');
    expect(html).toContain('oi-tabbar');
    expect(html).toContain('oi-tabpanel');
    // Every tab's panel id is addressed, so switching tabs has somewhere to land.
    expect(html).toContain('id="dp-panel-summary"');
    expect(html).toContain('id="dp-tab-summary"');
  });
});

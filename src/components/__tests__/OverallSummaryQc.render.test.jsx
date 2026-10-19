import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { ErpDataContext } from '../../context/ErpDataContext';
import OverallSummaryDashboard from '../OverallSummaryDashboard';

/**
 * The Overall Summary tab's QC surface.
 *
 * The brief: a QC check saved from the unified entry form must appear on the
 * Overall Summary — its KPI card and its own breakdown table — without a reload,
 * and strictly in English. It must also NOT be folded into the production totals.
 *
 * The arithmetic is unit-tested in `config/__tests__/overallSummaryQcSync`; this
 * pins what reaches the DOM.
 */

const DATE = '2026-10-17';

const HOURLY = {
  id: 1, date: DATE, employee: 'Md Robiul Islam', order_no: 'PO-105',
  style: 'STY-1001', process: 'Collar Attach', line_no: 'Line-03',
  hours: { 8: 50, 9: 55 }, workingHours: 2, dailyTarget: 400,
};

const QC = {
  id: 'q1', date: DATE, line: 'Line-03', process: 'Collar Attach',
  checked: 337, defect_qty: 12, ok_pcs: 300, alter_pcs: 25,
  defect_pcs: 12, total_checked: 337,
};

function render({ hourlyRows = [HOURLY], localQc = [QC], erpQc = [] } = {}) {
  const data = {
    getData: (key) => ({
      'hourly-timesheet-rows': hourlyRows,
      'quality-control': localQc,
      employees: ['Md Robiul Islam'],
      'order-model': [],
      'process-breakdown': [],
      'process-capacity': [],
    }[key] || []),
    addEntry: () => { }, updateEntry: () => { }, deleteEntry: () => { }, setRaw: () => { },
  };
  const erp = {
    subscribe: () => () => { },
    rows: (key) => (key === 'summaryQc' ? erpQc : []),
    isLoading: () => false,
    errorFor: () => '',
    loadOne: async () => null,
    save: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
    decide: async () => ({ ok: true }),
    cache: {}, status: {},
  };
  return renderToStaticMarkup(
    <DataContext.Provider value={data}>
      <ErpDataContext.Provider value={erp}>
        <OverallSummaryDashboard date={DATE} />
      </ErpDataContext.Provider>
    </DataContext.Provider>,
  );
}

describe('the Overall Summary QC surface', () => {
  it('shows a QC KPI card with English labels', () => {
    const html = render();
    expect(html).toContain('QC Checks Today');
    expect(html).toContain('passed');
  });

  it('shows the QC breakdown table with English headers', () => {
    const html = render();
    ['Checks', 'Total Checked', 'OK Pcs', 'Alter Pcs', 'Defect Pcs', 'Pass Rate']
      .forEach((header) => expect(html).toContain(header));
  });

  it('shows the QC figures saved from the unified entry form', () => {
    const html = render();
    // 337 checked, 300 OK, 25 alter, 12 defect.
    expect(html).toContain('337');
    expect(html).toContain('300');
    expect(html).toContain('25');
    expect(html).toContain('12');
  });

  it('says so plainly when no QC check was recorded', () => {
    const html = render({ localQc: [] });
    expect(html).toContain('No QC check recorded today');
  });

  it('counts a QC check saved to the ERP store as well', () => {
    // The mirror write: a check saved in another tab lands in Firestore, and the
    // subscription is what makes it appear here without a reload.
    const html = render({ localQc: [], erpQc: [QC] });
    expect(html).toContain('337');
  });

  it('does not double-count a check present in both stores', () => {
    // The local row and its ERP mirror are the same inspection.
    const html = render({ localQc: [QC], erpQc: [QC] });
    expect(html).toContain('QC Checks Today');
    // One check, so the "Checks" cell reads 1 and the total stays 337, not 674.
    expect(html).toContain('337');
    expect(html).not.toContain('674');
  });

  it('keeps the production KPIs separate from the QC figures', () => {
    const html = render();
    expect(html).toContain('Total Factory Completed Output');
    expect(html).toContain('Target vs Achievement');
    expect(html).toContain('Total Defects');
    expect(html).toContain('Active Employees');
  });

  it('shows no QC row when there is no production and no QC', () => {
    const html = render({ hourlyRows: [], localQc: [], erpQc: [] });
    expect(html).toContain('No QC check recorded today');
    expect(html).toContain('No production recorded today yet.');
  });
});

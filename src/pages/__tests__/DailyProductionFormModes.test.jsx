import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DailyProductionForm } from '../../components/DailyProductionSheet';
import { emptyHourly, buildDailyProductionRecord } from '../../config/dailyProductionForm';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';

/**
 * The Daily Production entry form in its two modes.
 *
 * The brief asks for a clean, streamlined entry flow in the MODAL: no numbered
 * multi-step breakdown and no on-screen End-of-Day Summary. The full three-section
 * paper template must stay available to the page view. These pin both, and the
 * data-linkage contract (a saved row carries the order + derived target).
 */
const DATA = {
  getData: (key) => ({
    employees: ['Salma', 'Rina'],
    'order-model': [{ id: 1, style: 'STY-1001', order_no: 'PO-105', buyer: 'H&M', qty: 5000 }],
  }[key] || []),
  addEntry: () => {}, updateEntry: () => {}, deleteEntry: () => {}, setRaw: () => {},
};

const AUTH = {
  user: { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true },
  loading: false, authReady: true, usersVersion: 0, getLiveStatus: () => 'approved',
};

function renderForm(props = {}) {
  const formValues = { date: '2026-08-19', style: 'STY-1001', hourly: emptyHourly(), ...props.formValues };
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
            {...props}
          />
        </DataContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('Daily Production entry form — compact (modal) mode', () => {
  const html = renderForm({ compact: true, derivedTarget: 280, derivedHourlyTarget: 35 });

  it('drops the numbered multi-step sections', () => {
    // No "1 / 2 / 3" section badges, and none of the three section headings.
    expect(html).not.toContain('dp-section-num');
    expect(html).not.toContain('Hourly Production Tracking');
    expect(html).not.toContain('End-of-Day Summary');
  });

  it('removes the on-screen End-of-Day Summary table entirely', () => {
    expect(html).not.toContain('dp-summary-table');
    ['Good Output', 'Target Achievement %', 'Defect Rate %', 'Output to Finishing']
      .forEach((row) => expect(html, `${row} should not be on the compact form`).not.toContain(row));
  });

  it('keeps a streamlined entry flow with the order details present', () => {
    expect(html).toContain('dp-form-compact');
    expect(html).toContain('Production Date');
    expect(html).toContain('Operation / Process');
  });

  it('asks only for the actual output and the defects', () => {
    expect(html).toContain('Actual Output');
    expect(html).toContain('Defects');
  });

  it('shows the derived daily and hourly targets as auto fields', () => {
    expect(html).toContain('Daily Target');
    expect(html).toContain('Hourly Target');
    expect(html).toContain('(auto)');
  });
});

describe('Daily Production entry form — full (page) mode', () => {
  const html = renderForm({});

  it('keeps all three numbered sections in order', () => {
    const headings = [...html.matchAll(/class="dp-section-num">(\d)<\/span>([^<]+)</g)].map((m) => m[2]);
    expect(headings).toEqual(['Production Details', 'Hourly Production Tracking', 'End-of-Day Summary']);
  });

  it('keeps the hourly grid and the End-of-Day Summary', () => {
    expect(html).toContain('dp-summary-table');
    expect(html).toContain('08:00-09:00');
    expect(html).toContain('Cumulative Output');
  });
});

describe('data linkage — a saved entry carries the order and the derived target', () => {
  it('builds a daily-production record with the target and the figures', () => {
    // This is the shape Worker Production writes and Daily Production reads.
    const record = buildDailyProductionRecord({
      date: '2026-08-19', employee: 'Rina', style: 'STY-1001', process: 'Collar Attach',
      quantity: 300, defect_qty: 5, daily_target: 280, smv: 1.2, hourly: emptyHourly(),
    });
    expect(record.date).toBe('2026-08-19');
    expect(record.employee).toBe('Rina');
    expect(record.process).toBe('Collar Attach');
    // The derived target is carried onto the row, so the record is measured
    // against the same figure the entry screen showed.
    expect(record.daily_target).toBe(280);
    // With no hourly grid the header quantity is kept as the good figure, so the
    // row still reports the pieces the operator produced.
    expect(record.quantity).toBe(300);
    expect(record.summary.dailyTarget).toBe(280);
  });

  it('mirrors the hourly good output into `quantity` when a grid is present', () => {
    const hourly = emptyHourly();
    hourly['08:00-09:00'] = { target: 35, actual: 40, defect: 2 };
    const record = buildDailyProductionRecord({ date: '2026-08-19', employee: 'Rina', hourly });
    // 40 actual − 2 defects = 38 good, which every legacy reader sees as `quantity`.
    expect(record.quantity).toBe(38);
    expect(record.summary.goodOutput).toBe(38);
  });
});

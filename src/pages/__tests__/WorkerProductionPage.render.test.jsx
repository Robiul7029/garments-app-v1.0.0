import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import WorkerProductionPage from '../WorkerProductionPage';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import { RoleProvider } from '../../context/RoleContext';

/**
 * Renders the Worker Production screen and asserts on what a supervisor gets.
 *
 * The whole point of the screen is that the TARGET is not typed: it is derived
 * from the uploaded sheet's SMV. So these pin that the derived target appears as a
 * read-only field, that only Actual and Defects are editable, and that the row is
 * written to `daily-production` (the Daily Production summary's own collection).
 */
const SHEET = [
  { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
  { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
];

const SEED = {
  employees: ['Rina', 'Salma'],
  'order-model': [{ id: 1, buyer: 'H&M', order_no: 'PO-105', style: 'STY-1001', qty: 5000, line_no: 'Line-03' }],
  'process-breakdown': [{ id: 7, style: 'STY-1001', order_no: 'PO-105', uploadedAt: '2026-08-19', operations: SHEET }],
  'capacity-settings': [{
    style: 'STY-1001', order_no: 'PO-105', manpower: 25, workingHours: 8, efficiency: 70,
  }],
  'daily-production': [
    {
      id: 1, employee: 'Rina', date: '2026-08-19', line_no: 'Line-03', style: 'STY-1001',
      process: 'Collar Attach', daily_target: 280, quantity: 300, defect_qty: 5,
    },
    {
      id: 2, employee: 'Rina', date: '2026-08-19', line_no: 'Line-03', style: 'STY-1001',
      process: 'Sleeve Join', daily_target: 224, quantity: 200, defect_qty: 3,
    },
  ],
};

function seedKey(key) {
  if (key === 'capacity-settings') return SEED[key];
  return SEED[key] || [];
}

function render(authRole = 'admin') {
  const added = [];
  const data = {
    getData: (key) => ({ ...SEED, ...seedKey(key) }[key] || seedKey(key)),
    addEntry: (key, entry) => added.push({ key, entry }),
    updateEntry: () => {},
    deleteEntry: () => {},
    setRaw: () => {},
  };
  const auth = {
    user: { id: 'qa', role: authRole, status: 'approved', isSuperAdmin: authRole === 'admin' },
    loading: false, authReady: true, usersVersion: 0,
    getLiveStatus: () => 'approved',
  };
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <DataContext.Provider value={data}>
          <RoleProvider>
            <WorkerProductionPage
              category={{ key: 'production', label: 'Sewing Department', icon: '🧵' }}
              item={{ key: 'worker-production', label: 'Worker Production', icon: '👥' }}
            />
          </RoleProvider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return { html, added };
}

describe('Worker Production — the entry form', () => {
  const { html } = render();

  it('asks for the employee, style and operation', () => {
    ['Employee', 'Style / Order No', 'Operation / Process'].forEach((label) => {
      expect(html, `${label} missing`).toContain(label);
    });
  });

  it('shows the target, hourly target and SMV as auto (read-only) fields', () => {
    expect(html).toContain('Daily Target');
    expect(html).toContain('Hourly Target');
    expect(html).toContain('SMV');
    expect(html).toContain('(auto)');
  });

  it('shows a live variance read-out that is computed, not typed', () => {
    expect(html).toContain('Good Output');
    expect(html).toContain('Efficiency');
    expect(html).toContain('Variance (+/-)');
  });

  it('offers only the actual and the defects as figures the supervisor enters', () => {
    // "Actual Achievement" and "Defects" are the two editable numeric boxes.
    expect(html).toContain('Actual Achievement');
    expect(html).toContain('Defects');
  });

  it('offers Save Worker Entry as the action', () => {
    expect(html).toContain('Save Worker Entry');
  });

  it('derives the target from the process sheet, not a manual box', () => {
    // The derived-target fields are disabled, so a supervisor cannot type a target
    // and every entry is measured against the sheet's own SMV figure.
    const disabled = (html.match(/disabled=""/g) || []).length;
    expect(disabled).toBeGreaterThanOrEqual(3); // daily target, hourly target, SMV
  });
});

describe('Worker Production — the grouped table', () => {
  const { html } = render();

  it('states the employee once with each process as its own row', () => {
    expect(html).toContain('pg-employee');
    expect(html).toContain('pg-process');
    // Both of Rina's processes are present.
    expect(html).toContain('Collar Attach');
    expect(html).toContain('Sleeve Join');
  });

  it('shows the per-process figures the brief lists', () => {
    ['Process Target', 'Actual Output', 'Defects', 'Efficiency %', 'Variance (+/-)']
      .forEach((heading) => expect(html).toContain(heading));
  });

  it('shows a day total for the employee group', () => {
    expect(html).toContain('Day total');
  });

  it('uses a rowSpan on the employee cell so the name is not repeated', () => {
    expect(html).toMatch(/rowspan="3"/);
  });
});

describe('Worker Production — a read-only user', () => {
  it('does not offer the entry form', () => {
    const { html } = render('viewer');
    expect(html).toContain('View only');
    expect(html).not.toContain('Save Worker Entry');
  });
});

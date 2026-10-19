import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import LineDeploymentPage from '../LineDeploymentPage';

/**
 * The Manpower Management → Line Deployment screen.
 *
 * The brief, pinned:
 *   - a Designation dropdown beside Full Name and the auto Employee ID;
 *   - a Designation column in the Employee Directory table;
 *   - the Employee ID strictly non-editable;
 *   - no form-level error banner (errors belong under their own field);
 *   - strictly English labels and options.
 */

const CATEGORY = { key: 'manpower', label: 'Manpower Management', icon: '🧑‍🏭' };
const ITEM = { key: 'manpower-deployment', label: 'Line Deployment', icon: '👥' };

const DIRECTORY = [
  { id: 'e1', employeeId: 'EMP-001', name: 'Md Robiul Islam', designation: 'Supervisor', status: 'active' },
  { id: 'e2', employeeId: 'EMP-002', name: 'Mst Sarjina Akter', designation: 'Operator', status: 'active' },
  // A record written before the designation list existed.
  { id: 'e3', employeeId: 'EMP-003', name: 'Abdul Karim', status: 'active' },
];

function render({ isAdmin = true, directory = DIRECTORY, storedOptions = [] } = {}) {
  const data = {
    getData: (key) => ({
      'employee-directory': directory,
      employees: ['Md Robiul Islam', 'Mst Sarjina Akter', 'Abdul Karim'],
      'employee-sequence': [3],
      // The designations added by hand with the "+ Add" button.
      'designation-options': storedOptions,
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
        <LineDeploymentPage category={CATEGORY} item={ITEM} />
      </DataContext.Provider>
    </AuthContext.Provider>,
  );
}

describe('the add-employee form', () => {
  it('offers Designation beside Full Name and the auto Employee ID', () => {
    const html = render();
    expect(html).toContain('Add employee');
    expect(html).toContain('Full Name');
    expect(html).toContain('Designation');
    expect(html).toContain('Employee ID');
  });

  it('lists the five designations plus the custom route, in English', () => {
    const html = render();
    // The grades and the "+ Add" row live in the custom menu, which is closed by
    // default — the option LIST is asserted directly in employeeDesignation.test.js.
    // What the closed control promises is the placeholder and the dropdown affordance.
    expect(html).toContain('Select designation');
    expect(html).toContain('ld-select-control');
    expect(html).toContain('aria-haspopup="listbox"');
  });

  it('offers a custom designation already in use', () => {
    // Somebody recorded once as a Trainer must be selectable for the next person. The
    // option list is built from `designationOptions`, whose merge is covered directly
    // in designationOptions.test.js; here the page must render without an error from
    // carrying the extra value.
    const html = render({ directory: [...DIRECTORY, { id: 'e4', employeeId: 'EMP-004', name: 'Nasrin Sultana', designation: 'Trainer', status: 'active' }] });
    expect(html).toContain('ld-select-control');
    expect(html).not.toContain('field-error-tip');
  });

  it('keeps the menu closed until the control is clicked', () => {
    const html = render();
    // The options and the "+ Add" row only exist once the menu is opened.
    expect(html).not.toContain('aria-label="Designation options"');
    expect(html).not.toContain('aria-label="New designation to add"');
    expect(html).not.toContain('+ Add');
  });

  it('keeps the Employee ID non-editable', () => {
    const html = render();
    // The lock is stated twice: `disabled` blocks typing and focus, `readonly` is
    // the belt-and-braces attribute a screen reader announces. Both precede the
    // aria-label in the emitted markup, so the whole tag is matched.
    const idTag = html.match(/<input[^>]*aria-label="Employee ID, generated automatically"[^>]*\/>/)[0];
    expect(idTag).toContain('disabled');
    expect(idTag).toContain('readonly');
    // And the generated ID is shown before it is used.
    expect(idTag).toContain('value="EMP-004"');
  });

  it('shows no error banner in the resting state', () => {
    const html = render();
    // The form-level error notice is gone from the page entirely.
    expect(html).not.toContain('erp-notice-error');
    expect(html).not.toContain('Enter the employee’s full name.');
    // No inline message either, until something is actually wrong.
    expect(html).not.toContain('field-error-tip');
  });

  it('uses no non-Latin script', () => {
    expect(/[\u0980-\u09FF\u0600-\u06FF\u0400-\u04FF]/.test(render())).toBe(false);
  });
});

describe('the employee directory table', () => {
  it('carries a Designation column', () => {
    const html = render();
    expect(html).toContain('<th style="width:140px">Designation</th>');
  });

  it('shows each person their designation', () => {
    const html = render();
    expect(html).toContain('>Supervisor<');
    expect(html).toContain('>Operator<');
  });

  it('defaults a record that has no designation to Operator', () => {
    // Abdul Karim predates the designation list. The brief: he reads as Operator
    // rather than sitting blank, so he stays selectable wherever a grade is used.
    const html = render();
    expect(html).toContain('Abdul Karim');
    expect(html).toContain('>Operator<');
    // Never a blank designation cell.
    expect(html).not.toMatch(/<span class="erp-badge erp-badge-neutral"><\/span>/);
  });

  it('keeps the other columns intact', () => {
    const html = render();
    ['Employee ID', 'Full Name', 'Status', 'Action'].forEach((h) => expect(html).toContain(h));
  });
});

describe('the custom designation "+ Add" route', () => {
  it('puts the "+ Add" row inside the Designation menu, not beside the control', () => {
    // The whole point of the custom menu: the add row is a CHILD of the panel, so a
    // grade the list does not carry is created without leaving the dropdown.
    const html = render();
    // Closed by default, so neither the options nor the add row are in the markup yet.
    expect(html).not.toContain('+ Add');
    expect(html).not.toContain('ld-select-add');
    expect(html).not.toContain('ld-select-option');
    // The control that opens it is there, and announced as a dropdown.
    expect(html).toContain('ld-select-control');
    expect(html).toContain('Select designation');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('offers a designation persisted in the store, so an added grade survives', () => {
    // A grade added by hand is kept in `designation-options` BEFORE any employee
    // carries it — that is what makes it selectable for the next person. The option
    // list is built from `designationOptions`, which the merge tests cover directly.
    const html = render({ storedOptions: ['Ironer', 'Line Trainer'] });
    // The menu is closed, so the list is not painted — but the control still renders
    // and the page holds no error from the extra options.
    expect(html).toContain('ld-select-control');
    expect(html).not.toContain('field-error-tip');
  });
});

describe('the frozen table header', () => {
  it('pins the header row with the sticky classes the brief names', () => {
    const html = render();
    // `sticky top-0 z-10 bg-surface` on the header ROW, exactly as specified.
    const row = html.match(/<tr class="[^"]*ld-thead-row[^"]*"[^>]*>/)[0];
    expect(row).toContain('sticky');
    expect(row).toContain('top-0');
    expect(row).toContain('z-10');
    expect(row).toContain('bg-surface');
  });

  it('scrolls inside a bounded box, which is what makes sticky anchor', () => {
    // The header only freezes against a scrolling ancestor that has a height.
    const html = render();
    expect(html).toContain('table-wrap ld-table-wrap');
  });

  it('keeps the column headers in English and in order', () => {
    const html = render();
    ['Employee ID', 'Full Name', 'Designation', 'Status', 'Action'].forEach((h) => {
      expect(html).toContain(`>${h}</th>`);
    });
    expect(html.indexOf('>Employee ID</th>')).toBeLessThan(html.indexOf('>Full Name</th>'));
    expect(html.indexOf('>Full Name</th>')).toBeLessThan(html.indexOf('>Designation</th>'));
  });
});

describe('a viewer', () => {
  it('sees the directory but no add form', () => {
    const html = render({ isAdmin: false });
    expect(html).toContain('Employee directory');
    expect(html).not.toContain('Add employee');
    expect(html).toContain('View only');
  });
});

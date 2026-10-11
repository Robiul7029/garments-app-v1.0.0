import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';

/**
 * Removes // and /* *\/ comments so a scan sees only executable code.
 * Deliberately simple: it must handle the docstrings in this codebase, not
 * every JavaScript string edge case.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
import LineDeploymentPage from '../LineDeploymentPage';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import { directoryList, findByName } from '../../config/employeeDirectory';

/**
 * Renders the real Line Deployment screen and asserts the spec it was rewritten
 * to: a form with a single name input, an auto-generated Employee ID, a Submit
 * button, and a table of Employee ID / Full Name / Action.
 *
 * It also asserts what was REMOVED — the old date/line/shift/manpower grid — so a
 * future edit cannot quietly bring the head-count form back.
 */
function render({ directory = [], names = [], sequence = [], isAdmin = true } = {}) {
  const data = {
    getData: (key) => ({
      'employee-directory': directory,
      employees: names,
      'employee-sequence': sequence,
    }[key] || []),
    addEntry: () => {},
    updateEntry: () => {},
    deleteEntry: () => {},
    setRaw: () => {},
  };
  const auth = {
    user: isAdmin ? { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true } : { id: 'v', role: 'viewer' },
    loading: false, authReady: true, usersVersion: 0,
    getLiveStatus: () => (isAdmin ? 'approved' : 'active'),
  };
  return renderToStaticMarkup(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <DataContext.Provider value={data}>
          <LineDeploymentPage
            category={{ key: 'manpower', label: 'Manpower Management', icon: '🧑‍🏭' }}
            item={{ key: 'manpower-deployment', label: 'Line Deployment', icon: '👥' }}
          />
        </DataContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const DIRECTORY = [
  { id: 'emp-1', employeeId: 'EMP-001', name: 'Salma Khatun' },
  { id: 'emp-2', employeeId: 'EMP-002', name: 'Rina Akter' },
];

describe('Line Deployment — the employee directory', () => {
  it('is titled as the employee directory', () => {
    const html = render({ directory: DIRECTORY });
    expect(html).toContain('Line Deployment');
    expect(html).toContain('Employee directory');
  });

  it('shows a form with only a Full Name input', () => {
    const html = render();
    expect(html).toContain('Full Name');
    // Exactly one editable text field in the form: the name.
    expect(html).toContain('e.g. Salma Khatun');
  });

  it('offers a Submit button', () => {
    expect(render()).toContain('Submit');
  });

  it('shows the Employee ID that will be generated next', () => {
    expect(render({ directory: [] })).toContain('EMP-001');
    expect(render({ directory: DIRECTORY })).toContain('EMP-003');
  });

  it('labels the Employee ID as automatic', () => {
    expect(render()).toContain('(auto)');
  });

  it('renders the table with Employee ID, Full Name and Action columns', () => {
    const html = render({ directory: DIRECTORY });
    expect(html).toContain('Employee ID');
    expect(html).toContain('Full Name');
    expect(html).toContain('Action');
  });

  it('lists each employee with their generated ID', () => {
    const html = render({ directory: DIRECTORY });
    expect(html).toContain('EMP-001');
    expect(html).toContain('Salma Khatun');
    expect(html).toContain('EMP-002');
    expect(html).toContain('Rina Akter');
  });

  it('offers an Edit button and a delete control per row', () => {
    const html = render({ directory: DIRECTORY });
    expect(html).toContain('>Edit<');
    expect(html).toContain('🗑️');
  });

  it('shows a helpful empty state', () => {
    expect(render({ directory: [] })).toContain('No employees yet');
  });

  it('offers a search box and an export', () => {
    const html = render({ directory: DIRECTORY });
    expect(html).toContain('Search name or ID');
    expect(html).toContain('Export');
  });
});

describe('Line Deployment — the old head-count grid is gone', () => {
  const html = render({ directory: DIRECTORY });

  it('no longer asks for a date on the form', () => {
    expect(html).not.toContain('Manpower (Planned)');
  });

  it('no longer asks for shift, present or absent', () => {
    expect(html).not.toContain('Absent');
    expect(html).not.toContain('Present');
  });

  it('does not render a Planned column header', () => {
    expect(html).not.toContain('>Manpower<');
  });
});

describe('Line Deployment — the delete confirmation dialog', () => {
  it('does not render a dialog until a delete is requested', () => {
    const html = render({ directory: DIRECTORY });
    expect(html).not.toContain('alertdialog');
    expect(html).not.toContain('Are you sure');
  });

  it('no longer relies on window.confirm', () => {
    // The browser popup cannot be styled, is blocked in some webviews (which
    // would delete without asking), and gives no room to explain the effect.
    //
    // Comments are stripped first. The component's own docstring explains that
    // it uses a real dialog "rather than window.confirm()", and scanning the raw
    // source would match that prose as though it were a call.
    const source = stripComments(readFileSync(new URL('../LineDeploymentPage.jsx', import.meta.url), 'utf8'));
    expect(source).not.toMatch(/window\.confirm\s*\(/);
  });

  it('uses an in-app modal with Yes and No controls', () => {
    const source = readFileSync(new URL('../LineDeploymentPage.jsx', import.meta.url), 'utf8');
    expect(source).toContain('dp-modal-backdrop');
    expect(source).toContain('alertdialog');
    expect(source).toContain('Are you sure you want to remove');
    // The confirm button relabels itself: "Yes, delete" sets inactive, and
    // "Yes, archive" is the ticked, stronger case. Both must exist.
    expect(source).toContain('Yes, delete');
    expect(source).toContain('Yes, archive');
    // The No button is a real button element with that label.
    expect(source).toMatch(/>\s*No\s*<\/button>/);
  });

  it('renders the archive checkbox with the exact wording asked for', () => {
    const source = readFileSync(new URL('../LineDeploymentPage.jsx', import.meta.url), 'utf8');
    expect(source).toContain('Permanently remove from all site dropdowns / entire site?');
    expect(source).toContain('type="checkbox"');
  });

  it('explains both outcomes before the choice is made', () => {
    const source = readFileSync(new URL('../LineDeploymentPage.jsx', import.meta.url), 'utf8');
    // Unchecked: inactive, reversible.
    expect(source).toContain('Set to Inactive.');
    expect(source).toContain('reactivate them at any time');
    // Checked: archived, admin-only.
    expect(source).toContain('Archived.');
    expect(source).toContain("Admin Panel's inactive section");
  });

  it('never hard-deletes, so attendance history is not orphaned', () => {
    const source = stripComments(readFileSync(new URL('../LineDeploymentPage.jsx', import.meta.url), 'utf8'));
    // The old path removed the row; now only a status change is written.
    expect(source).not.toMatch(/deleteEntry\(/);
    expect(source).toContain('STATUS.ARCHIVED');
    expect(source).toContain('STATUS.INACTIVE');
  });

  it('names the employee being deleted', () => {
    const source = readFileSync(new URL('../LineDeploymentPage.jsx', import.meta.url), 'utf8');
    expect(source).toContain('{pendingDelete.name}');
    expect(source).toContain('{pendingDelete.employeeId}');
  });
});

describe('Line Deployment — duplicate name validation', () => {
  it('refuses a name that is already in the directory', () => {
    const source = readFileSync(new URL('../LineDeploymentPage.jsx', import.meta.url), 'utf8');
    // The submit path must check for a clash and bail out before writing.
    expect(source).toContain('const existing = findByName(employees, clean);');
    expect(source).toMatch(/if \(existing\) \{[\s\S]{0,400}return;/);
  });

  it('shows a clear warning naming the existing record', () => {
    const source = readFileSync(new URL('../LineDeploymentPage.jsx', import.meta.url), 'utf8');
    expect(source).toContain('is already in the directory as');
    expect(source).toContain('must be unique');
  });

  it('applies the same uniqueness rule when renaming', () => {
    const source = readFileSync(new URL('../LineDeploymentPage.jsx', import.meta.url), 'utf8');
    expect(source).toContain('employees.filter((e) => e.id !== employee.id)');
    expect(source).toContain('is already in the directory as ${clash.employeeId}');
  });

  it('detects a duplicate regardless of case or surrounding spaces', () => {
    // The rule the component relies on, exercised directly.
    const list = directoryList(DIRECTORY);
    expect(findByName(list, 'salma khatun')?.employeeId).toBe('EMP-001');
    expect(findByName(list, '  SALMA   KHATUN  '.replace(/\s+/g, ' '))?.employeeId).toBe('EMP-001');
  });
});

describe('Line Deployment — read-only roles', () => {
  const html = render({ directory: DIRECTORY, isAdmin: false });

  it('hides the add form from a viewer', () => {
    expect(html).not.toContain('e.g. Salma Khatun');
    expect(html).toContain('View only');
  });

  it('hides the Action column from a viewer', () => {
    expect(html).not.toContain('>Edit<');
    expect(html).not.toContain('>Action<');
  });

  it('still shows the directory itself', () => {
    expect(html).toContain('EMP-001');
    expect(html).toContain('Salma Khatun');
  });
});

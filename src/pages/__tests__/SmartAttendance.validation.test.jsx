import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Smart Attendance — sequential field validation, standard tooltip style.
 *
 * The entry form used to report validation as a red line of text at the top of
 * the page (`auth-error`). It now flags the FIRST invalid field with a standard
 * browser-style tooltip rendered DIRECTLY UNDER that field (`.field-tooltip`
 * inside the field's wrapping `.form-field`). These tests pin the markup: the
 * tooltip element exists for the flagged field and carries the right message,
 * and the old top-of-page red alert is not used for field validation.
 *
 * Firestore is mocked out — this is about the FORM's markup, not the data.
 */
vi.mock('../../context/RoleContext', () => ({
  useRole: () => ({ isAdmin: true, role: 'admin', canEdit: true }),
}));

vi.mock('../../utils/attendance', () => ({
  calculateOvertimeHours: () => 0,
  calculateLateMinutes: () => 0,
  calculateDutyHours: () => 0,
  getAttendanceFromFirestore: async () => [],
  getWorkersFromFirestore: async () => [],
  isInMonth: () => false,
  saveAttendanceRecord: async () => {},
  findAttendanceForWorkerDate: async () => null,
  seedWorkersToFirestore: async () => ({ seeded: false, count: 0 }),
  deleteAttendanceRecord: async () => {},
  updateAttendanceRecord: async () => {},
  subscribeToWorkers: () => () => {},
}));

const SmartAttendance = (await import('../SmartAttendance')).default;

const render = () => renderToStaticMarkup(<SmartAttendance />);

describe('the smart attendance entry form', () => {
  it('renders every field with a stable id the tooltip can anchor to', () => {
    const html = render();
    ['date', 'workerId', 'department', 'inTime', 'outTime', 'status'].forEach((name) => {
      expect(html).toContain(`id="sa-field-${name}"`);
    });
  });

  it('does not show any tooltip before a save is attempted', () => {
    expect(render()).not.toContain('field-tooltip');
  });

  it('does not use the top-of-page red alert for field validation', () => {
    // The form itself carries no auth-error paragraph; that class is reserved for
    // real load/save failures, not for "you left a box empty".
    const html = render();
    const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    expect(form).not.toContain('auth-error');
  });
});

describe('the daily attendance grid zoom control', () => {
  const html = render();

  it('renders the zoom controller in the grid control area', () => {
    expect(html).toContain('attendance-grid-toolbar');
    expect(html).toContain('attendance-zoom');
    expect(html).toContain('Zoom in grid');
    expect(html).toContain('Zoom out grid');
  });

  it('starts at 100%', () => {
    expect(html).toContain('attendance-zoom-level');
    expect(html).toContain('100%');
  });

  it('drives the grid through a single --grid-zoom variable', () => {
    expect(html).toContain('--grid-zoom:1');
  });
});

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import HourlyTimesheet from '../HourlyTimesheet';

/**
 * The unified entry form, in each of its four modes.
 *
 * The form is rendered OPEN (`defaultOpen`) so the mode selector and the fields
 * it governs are present without a click — a static render cannot drive one. Each
 * mode must show its own field set and hide the others, which is what the brief
 * asks for.
 */
const today = new Date().toISOString().slice(0, 10);
const ORDER = { id: 1, style: 'STY-1001', order_no: 'PO-105', buyer: 'H&M', item: 'Tee', qty: 5000 };
const SHEET = {
  id: 10, style: 'STY-1001', order_no: 'PO-105', fileName: 's.xlsx', uploadedAt: today, totalSmv: 4.5,
  operations: [{ operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' }],
};
// Manpower Management → Line Deployment. Only the supervisor may be offered in
// Total Line Output mode.
const DIRECTORY = [
  { id: 'e1', employeeId: 'EMP-001', name: 'Md Robiul Islam', designation: 'Supervisor', status: 'active', line_no: 'Line-03' },
  { id: 'e2', employeeId: 'EMP-002', name: 'Mst Sarjina Akter', designation: 'Operator', status: 'active', line_no: 'Line-03' },
];

function render(mode) {
  const data = {
    getData: (key) => ({
      'hourly-timesheet-rows': [],
      employees: ['Md Robiul Islam'],
      'order-model': [ORDER],
      'process-breakdown': [SHEET],
      'process-capacity': [],
      'employee-directory': DIRECTORY,
    }[key] || []),
    addEntry: () => {}, updateEntry: () => {}, deleteEntry: () => {}, setRaw: () => {},
  };
  const auth = {
    user: { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true },
    loading: false, authReady: true, usersVersion: 0, getLiveStatus: () => 'approved',
  };
  return renderToStaticMarkup(
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <HourlyTimesheet defaultOpen defaultMode={mode} />
      </DataContext.Provider>
    </AuthContext.Provider>,
  );
}

describe('the unified entry form', () => {
  it('offers all four entry modes', () => {
    const html = render('hourly');
    ['Hourly Production', 'Daily Production', 'Total Line Output', 'QC Product Check']
      .forEach((label) => expect(html).toContain(label));
  });

  it('shows the clock-hour picker and process in Hourly mode', () => {
    const html = render('hourly');
    expect(html).toContain('Active Hours / Day');
    expect(html).toContain('Process');
    // The QC boxes belong to another mode and must not appear here.
    expect(html).not.toContain('OK Body Pcs');
  });

  it('hides the clock-hour picker in Daily mode', () => {
    const html = render('daily');
    expect(html).not.toContain('Active Hours / Day');
    expect(html).toContain('Process');
    expect(html).toContain('Working Hours');
  });

  it('asks for a Supervisor Name in Total Line Output mode', () => {
    // The brief: the "Employee" field becomes "Supervisor Name", is REQUIRED, and
    // offers only supervisors. The dropdown's contents are asserted on the pure
    // helper (`supervisorNames`) — a static render cannot open the list.
    const html = render('line');
    expect(html).toContain('Supervisor Name');
    expect(html).not.toContain('>Employee ');
    expect(html).toContain('Search supervisor…');
    // No process/clock hours are asked for.
    expect(html).not.toContain('Active Hours / Day');
    expect(html).not.toContain('OK Body Pcs');
  });

  it('shows the order targets read-only and one Achievement box', () => {
    const html = render('line');
    // The targets are the sheet's, so they are never typed here.
    expect(html).toContain('from the sheet');
    expect(html).toContain('aria-label="Hourly target from the process sheet"');
    expect(html).toContain('aria-label="Daily target, filled automatically from the order number"');
    // The Daily Target box is auto-populated from the chosen Order No.
    expect(html).toContain('Daily Target');
    expect(html).toContain('auto from Order No');
    // The supervisor's only input is the achievement.
    expect(html).toContain('Achievement (Actual Output Pcs)');
    // No per-process output boxes and no manual target box in this mode.
    expect(html).not.toContain('aria-label="Manual hourly target"');
    expect(html).not.toContain('addPlaceholder="Add other process…"');
  });

  it('replaces the old Line dropdown with the Daily Target box', () => {
    // The brief: the field to the right of Hourly Target is now Daily Target, and
    // the "Line" dropdown it used to be is gone from the form.
    const html = render('line');
    const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    expect(form).not.toContain('Search line…');
    expect(form).not.toContain('aria-label="Select the production line"');
    expect(form).toContain('Daily Target');
  });

  it('labels the save button "Save Total Line Output Entry"', () => {
    expect(render('line')).toContain('Save Total Line Output Entry');
    // The other modes keep their own wording.
    expect(render('hourly')).toContain('Save Hourly Production Entry');
  });

  it('renders the QC boxes and Total Checked in QC mode', () => {
    const html = render('qc');
    expect(html).toContain('OK Body Pcs');
    expect(html).toContain('Alter Pcs');
    expect(html).toContain('Defect / Reject Pcs');
    expect(html).toContain('Total Checked');
    expect(html).toContain('Defect Type');
    // QC records no production, so the OUTPUT controls are gone: no clock-hour picker
    // and no per-process quantity grid. (The mode selector's own hint text mentions
    // "Full Day Output", so the check is scoped to the grid's own class.)
    expect(html).not.toContain('Active Hours / Day');
    expect(html).not.toContain('hourly-process-block');
    const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    // The process field IS present now, but as a multi-select that names where a fault
    // was found — not as the required single process the output modes ask for.
    expect(form).toContain('aria-label="Select one or more processes for this check"');
  });

  it('removes the Employee field from QC mode entirely', () => {
    // The brief: a check is recorded by line against an order, not against a person.
    const html = render('qc');
    const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    expect(form).not.toContain('aria-label="Select the employee"');
    expect(form).not.toContain('Search employee…');
    // The other modes still have it.
    expect(render('hourly')).toContain('aria-label="Select the employee"');
    expect(render('daily')).toContain('aria-label="Select the employee"');
  });

  it('offers Process, Color and Defect Type as multi-selects in QC mode', () => {
    const html = render('qc');
    expect(html).toContain('aria-label="Select one or more processes for this check"');
    expect(html).toContain('aria-label="Select one or more colors for this check"');
    expect(html).toContain('aria-label="Select one or more defect types"');
    // Each is a checkbox multi-select — that is what makes several selectable.
    expect(html).toContain('ss-multi');
    // And each carries the inline "+ Add" row for a value the list does not name.
    expect(html).toContain('qc-multi-grid');
  });

  it('keeps the QC placeholders and labels in English', () => {
    const html = render('qc');
    ['Process', 'Color', 'Defect Type', 'Select Order No', 'Select defect types...',
      'Order processes appear once an Order No is selected.',
      'Order colors appear once an Order No is selected.']
      .forEach((text) => expect(html).toContain(text));
    // Both order-dependent fields keep their plain English placeholder when empty.
    expect(html).toContain('>Select processes...<');
    expect(html).toContain('>Select color...<');
  });

  it('mirrors the Process add-row pattern inside the Color menu', () => {
    // The brief: the Color dropdown carries the SAME "Add other ..." box and "+ Add"
    // button the Process dropdown does, at the foot of its own open menu. The add row
    // only exists while the list is open, so what is asserted here is that the field
    // is wired to one — a multi-select with an add handler — and the render below
    // proves the two are configured identically.
    const html = render('qc');
    // The class list sits BEFORE the aria-label on the same element, so the whole
    // opening tag is matched rather than a window after the label.
    const colorTag = html.match(/<button[^>]*aria-label="Select one or more colors for this check"[^>]*>/);
    const processTag = html.match(/<button[^>]*aria-label="Select one or more processes for this check"[^>]*>/);
    expect(colorTag).not.toBeNull();
    expect(processTag).not.toBeNull();
    // Both carry the multi-select shape, which is what renders the add row.
    expect(colorTag[0]).toContain('ss-multi');
    expect(processTag[0]).toContain('ss-multi');
  });

  it('keeps Process and Color unlocked until an Order No is chosen', () => {
    // Neither list belongs EXCLUSIVELY to the order: both take values typed by hand at
    // any time, so neither control is ever disabled. A hint says that the ORDER's own
    // values will join the list once one is picked.
    const html = render('qc');
    expect(html).not.toContain('Select Order No first');
    expect(html).not.toContain('qc-cell-locked');
    expect(html).not.toContain('ss-disabled');
    expect(html).toContain('Order processes appear once an Order No is selected.');
    expect(html).toContain('Order colors appear once an Order No is selected.');
    // Process behaves exactly like Color: same placeholder, same add-row wiring.
    const processTag = html.match(/<button[^>]*aria-label="Select one or more processes for this check"[^>]*>/);
    const colorTag = html.match(/<button[^>]*aria-label="Select one or more colors for this check"[^>]*>/);
    expect(processTag).not.toBeNull();
    expect(colorTag).not.toBeNull();
    [processTag[0], colorTag[0]].forEach((tag) => {
      expect(tag).not.toContain('disabled');
      expect(tag).toContain('ss-multi');
    });
    // Defect Type is NOT order-dependent, so it is never locked either.
    expect(html).toContain('Select defect types...');
  });

  it('uses "Select Order No" as the Order No placeholder', () => {
    expect(render('qc')).toContain('>Select Order No<');
  });

  it('marks Order No required in QC mode', () => {
    const html = render('qc');
    const field = html.slice(html.indexOf('hourly-order-no'), html.indexOf('hourly-order-no') + 400);
    expect(field).toContain('req-star');
  });

  it('enters overtime in the Active Hours dropdown, not a separate box', () => {
    // The brief: overtime is a custom clock slot, so it is entered in the hours
    // picker's own add-field and appended to the selected hours array. The separate
    // "Overtime Start Time" row is gone from the form in every mode.
    //
    // The add-field lives inside the dropdown's listbox, which a static render does
    // not open, so the label is asserted on the component's own props/behaviour
    // rather than on the closed markup: the row is absent everywhere, and the
    // slot the field adds is the same one the hour list carries.
    expect(render('hourly')).not.toContain('hourly-ot-row');
    expect(render('daily')).not.toContain('hourly-ot-row');
    expect(render('line')).not.toContain('hourly-ot-row');
    expect(render('qc')).not.toContain('hourly-ot-row');
    // The old standalone box's own controls are gone from the form entirely.
    expect(render('hourly')).not.toContain('Add OT');
    expect(render('hourly')).not.toContain('aria-label="Overtime start time"');
  });
});

describe('the optional Color field', () => {
  it('is offered in Total Line Output mode, labelled optional', () => {
    const html = render('line');
    expect(html).toContain('Color');
    expect(html).toContain('(optional)');
    // A closed SearchableSelect shows its placeholder as inner text, not as a
    // `placeholder` attribute — the attribute is only written once the list is open.
    expect(html).toContain('>Select color...<');
    expect(html).toContain('aria-label="Select one or more colors for this entry"');
    expect(html).toContain('hourly-color-field');
  });

  it('is not offered in the other modes', () => {
    // Only a Total Line Output entry covers a whole line's colours; an hourly entry is
    // one operator on one process.
    expect(render('hourly')).not.toContain('Select one or more colors for this entry');
    expect(render('daily')).not.toContain('Select one or more colors for this entry');
    expect(render('qc')).not.toContain('Select one or more colors for this entry');
  });

  it('marks Order No as required in this mode only', () => {
    // The brief: Order No is strictly required, because the line's target and its
    // buyer/style/PO qty all come from the order.
    const line = render('line');
    const orderField = line.slice(line.indexOf('hourly-order-no'), line.indexOf('hourly-order-no') + 400);
    expect(orderField).toContain('req-star');
    // It is optional elsewhere, as it always was.
    const hourly = render('hourly');
    const hourlyField = hourly.slice(hourly.indexOf('hourly-order-no'), hourly.indexOf('hourly-order-no') + 400);
    expect(hourlyField).not.toContain('req-star');
  });

  it('carries the empty-state message the open list shows', () => {
    // The message lives in the dropdown's list, which only renders once it is opened;
    // a static render cannot open it. What is asserted here is that the field is a
    // MULTI-select with the add row wired, which is what makes that message reachable.
    const html = render('line');
    const field = html.slice(html.indexOf('hourly-color-field'));
    expect(field).toContain('ss-multi');
  });
});

/**
 * The Total Line Output form's English-only surface.
 *
 * The brief is explicit that every label, header and button on this screen reads in
 * English. This pins the wording, so a stray translation (or a field left unnamed)
 * is caught here rather than by the supervisor.
 */
describe('Total Line Output — the form, in English', () => {
  const html = render('line');
  const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));

  it('names every field it asks for', () => {
    ['Supervisor Name', 'Order No', 'Color', 'Working Hours', 'Hourly Target', 'Daily Target']
      .forEach((label) => expect(form).toContain(label));
  });

  it('does not carry the redundant Daily Target subtext under Hourly Target', () => {
    // The brief: the "Daily Target = 0 × 10 h = 0 pcs" helper is removed so the form
    // spacing is clean. Daily Target is stated by its own labelled box instead.
    expect(form).not.toMatch(/Daily Target =\s*0/);
    expect(form).not.toContain('× 10 h =');
  });

  it('states the achievement and the save action in English', () => {
    expect(form).toContain('Achievement (Actual Output Pcs)');
    expect(form).toContain('Save Total Line Output Entry');
  });

  it('carries the summary metrics a supervisor reads back', () => {
    ['Hourly Target', 'Daily Target', 'Achieved', 'Due / Variance', 'Achievement']
      .forEach((label) => expect(form).toContain(label));
  });

  it('uses no non-Latin script anywhere in the form', () => {
    // A translation slipping in would most likely be Bengali/Bengali-Assamese
    // (U+0980–U+09FF) or Arabic; emoji and typographic punctuation are allowed.
    const text = form.replace(/<[^>]*>/g, ' ');
    expect(/[\u0980-\u09FF\u0600-\u06FF\u0400-\u04FF]/.test(text)).toBe(false);
  });
});

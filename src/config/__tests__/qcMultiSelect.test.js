import { describe, it, expect } from 'vitest';
import {
  DEFECT_TYPES,
  asList,
  joinList,
  addToList,
  matchingInList,
  defectTypeOptions,
  defectTypesInUse,
  qcMultiValues,
  qcProcessOptions,
  buildQcRecord,
} from '../hourlyEntryMode';

/**
 * QC Product Check form's multi-value fields.
 *
 * The brief: Process, Color and Defect Type are each a checkbox multi-select, because
 * one check routinely covers several of each — a line running three colours can produce
 * a skip stitch on two of them at once. All three are OPTIONAL; only the order and at
 * least one figure are required.
 */

describe('the list helpers', () => {
  it('reads an array, a string or nothing', () => {
    expect(asList(['A', 'B'])).toEqual(['A', 'B']);
    expect(asList('A, B')).toEqual(['A', 'B']);
    expect(asList(undefined)).toEqual([]);
    expect(asList('')).toEqual([]);
  });

  it('accepts every separator the rest of the app accepts', () => {
    expect(asList('A, B; C/D|E')).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('joins back into the stored string form', () => {
    expect(joinList(['Skip Stitch', 'Oil Spot'])).toBe('Skip Stitch, Oil Spot');
    expect(joinList([])).toBe('');
    expect(joinList(undefined)).toBe('');
  });

  it('reads a plain STRING as well as an array, so a legacy value is not dropped', () => {
    // The single-value key on a stored row is a string. A caller passing one straight
    // through — the record builder, or a re-opened row — must keep its value.
    expect(joinList('Skip Stitch')).toBe('Skip Stitch');
    expect(joinList('Skip Stitch, Oil Spot')).toBe('Skip Stitch, Oil Spot');
  });

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(joinList(['Skip Stitch', 'skip stitch', 'SKIP STITCH'])).toBe('Skip Stitch');
    expect(joinList('Navy, navy')).toBe('Navy');
  });

  it('adds a value, or returns null when there is nothing to add', () => {
    expect(addToList(['A'], 'B')).toEqual(['A', 'B']);
    expect(addToList([], 'A')).toEqual(['A']);
    expect(addToList(['A'], 'A')).toBeNull();
    expect(addToList(['Navy'], 'navy')).toBeNull();
    expect(addToList([], '')).toBeNull();
    expect(addToList([], '   ')).toBeNull();
  });

  it('trims and collapses what it adds', () => {
    expect(addToList([], '  Oil   Spot ')).toEqual(['Oil Spot']);
  });

  it('selects the list’s own spelling for a typed value', () => {
    const options = [{ value: 'Skip Stitch' }, { value: 'Oil Spot' }];
    expect(matchingInList(options, 'skip stitch')).toBe('Skip Stitch');
    expect(matchingInList(options, '  OIL SPOT ')).toBe('Oil Spot');
    expect(matchingInList(options, 'Needle Mark')).toBe('Needle Mark');
    expect(matchingInList(options, '   ')).toBe('');
  });
});

describe('the defect type list', () => {
  it('carries the reasons the brief names', () => {
    expect(DEFECT_TYPES).toContain('Skip Stitch');
    expect(DEFECT_TYPES).toContain('Oil Spot');
    expect(DEFECT_TYPES).toContain('Broken Stitch');
  });

  it('is all English', () => {
    DEFECT_TYPES.forEach((d) => expect(/^[A-Za-z ]+$/.test(d)).toBe(true));
  });

  it('offers the presets, with no source hint', () => {
    const options = defectTypeOptions();
    expect(options[0]).toMatchObject({ value: 'Skip Stitch', hint: '' });
  });

  it('appends a reason added by hand, flagged as such', () => {
    const options = defectTypeOptions(['Loose Thread']);
    expect(options.find((o) => o.value === 'Loose Thread')).toMatchObject({ hint: 'Added by you' });
  });

  it('keeps an already-chosen value selectable', () => {
    // Switching orders mid-check must not orphan a chip the list no longer carries.
    const options = defectTypeOptions([], ['Unlisted Fault']);
    expect(options.find((o) => o.value === 'Unlisted Fault')).toMatchObject({ hint: 'Selected' });
  });

  it('never lists a reason twice, whatever its casing', () => {
    const options = defectTypeOptions(['skip stitch', 'SKIP STITCH']);
    expect(options.filter((o) => o.value.toLowerCase() === 'skip stitch')).toHaveLength(1);
  });

  it('exposes the same list as plain names', () => {
    expect(defectTypesInUse(['Loose Thread'])).toEqual([...DEFECT_TYPES, 'Loose Thread']);
  });
});

describe('the process options', () => {
  it('offers the sheet’s operations first', () => {
    const options = qcProcessOptions(['Collar Attach', 'Side Seam']);
    expect(options[0]).toMatchObject({ value: 'Collar Attach', hint: 'On this sheet' });
  });

  it('keeps a chosen process the sheet does not carry', () => {
    // A QC check names where a FAULT was found, which may not be on the sheet at all.
    const options = qcProcessOptions(['Side Seam'], ['Off-Sheet Operation']);
    expect(options.find((o) => o.value === 'Off-Sheet Operation')).toMatchObject({ hint: 'Selected' });
  });

  it('de-duplicates case-insensitively', () => {
    const options = qcProcessOptions(['Side Seam'], ['side seam']);
    expect(options.filter((o) => o.value.toLowerCase() === 'side seam')).toHaveLength(1);
  });

  it('offers nothing when there is no sheet and nothing chosen', () => {
    expect(qcProcessOptions()).toEqual([]);
    expect(qcProcessOptions(null, null)).toEqual([]);
  });
});

describe('re-opening a stored check', () => {
  it('reads the LISTS a multi-value record stores', () => {
    const values = qcMultiValues({
      processes: ['Collar Attach', 'Side Seam'],
      colors: ['Navy', 'Black'],
      defect_types: ['Skip Stitch', 'Oil Spot'],
    });
    expect(values).toEqual({
      processes: ['Collar Attach', 'Side Seam'],
      colors: ['Navy', 'Black'],
      defectTypes: ['Skip Stitch', 'Oil Spot'],
    });
  });

  it('reads a row written BEFORE these fields were multi-value', () => {
    // The old shape stored one joined string per field. It must come back as a
    // one-item list so an old check re-opens with its value still selected.
    const values = qcMultiValues({
      process: 'Collar Attach',
      color: 'Navy',
      defect_type: 'Skip Stitch',
    });
    expect(values).toEqual({
      processes: ['Collar Attach'],
      colors: ['Navy'],
      defectTypes: ['Skip Stitch'],
    });
  });

  it('reads a multi-value row saved with several joined into one string', () => {
    const values = qcMultiValues({ process: 'Collar Attach, Side Seam' });
    expect(values.processes).toEqual(['Collar Attach', 'Side Seam']);
  });

  it('comes back empty for a check with nothing recorded', () => {
    expect(qcMultiValues({})).toEqual({ processes: [], colors: [], defectTypes: [] });
    expect(qcMultiValues(undefined)).toEqual({ processes: [], colors: [], defectTypes: [] });
  });
});

describe('the stored record', () => {
  it('stores each multi-value field as the string the QC screen prints', () => {
    const record = buildQcRecord({
      date: '2026-10-17',
      order_no: 'PO-105',
      processes: ['Collar Attach', 'Side Seam'],
      colors: ['Navy', 'Black'],
      defect_types: ['Skip Stitch', 'Oil Spot'],
      ok_pcs: 100,
      alter_pcs: 5,
      defect_pcs: 3,
    });
    expect(record.process).toBe('Collar Attach, Side Seam');
    expect(record.color).toBe('Navy, Black');
    expect(record.defect_type).toBe('Skip Stitch, Oil Spot');
  });

  it('keeps the lists alongside, so the form can re-open from them', () => {
    const record = buildQcRecord({
      processes: ['Collar Attach'], colors: ['Navy'], defect_types: ['Skip Stitch'],
    });
    expect(record.processes).toEqual(['Collar Attach']);
    expect(record.colors).toEqual(['Navy']);
    expect(record.defect_types).toEqual(['Skip Stitch']);
  });

  it('accepts the SINGLE-value keys a legacy caller passes', () => {
    // The old form passed `process` / `defect_type` as plain strings. That must keep
    // working — the value lands on both the string and the list.
    const record = buildQcRecord({ process: 'Side Seam', defect_type: 'Skip Stitch', ok_pcs: 1 });
    expect(record.process).toBe('Side Seam');
    expect(record.processes).toEqual(['Side Seam']);
    expect(record.defect_type).toBe('Skip Stitch');
    expect(record.defect_types).toEqual(['Skip Stitch']);
  });

  it('stores an empty string when an optional field has nothing chosen', () => {
    // All three are OPTIONAL, so a check with no process, colour or reason is valid.
    const record = buildQcRecord({ order_no: 'PO-105', ok_pcs: 50 });
    expect(record.process).toBe('');
    expect(record.processes).toEqual([]);
    expect(record.color).toBe('');
    expect(record.defect_type).toBe('');
    expect(record.checked).toBe(50);
  });

  it('writes no employee, because the field was removed from the form', () => {
    const record = buildQcRecord({ order_no: 'PO-105', ok_pcs: 1 });
    expect(record.employee).toBe('');
  });

  it('still derives the brief’s Total Checked', () => {
    const record = buildQcRecord({ ok_pcs: 100, alter_pcs: 5, defect_pcs: 3 });
    expect(record.total_checked).toBe(108);
    expect(record.checked).toBe(108);
    expect(record.defect_qty).toBe(3);
  });

  it('de-duplicates a repeated value in the stored string', () => {
    const record = buildQcRecord({ defect_types: ['Skip Stitch', 'skip stitch'] });
    expect(record.defect_type).toBe('Skip Stitch');
    expect(record.defect_types).toEqual(['Skip Stitch']);
  });
});

import { describe, it, expect } from 'vitest';
import { qcFaultProcessOptions, qcOrderColorOptions } from '../hourlyEntryMode';

/**
 * The QC Product Check form's order-dependent dropdowns.
 *
 * The brief:
 *   · Process is populated STRICTLY with the selected order's INPUT and OUTPUT
 *     processes from its Process Sheet;
 *   · Color is populated STRICTLY with the colours assigned to that order in Order
 *     Management;
 *   · both are locked until an order is chosen (that half is asserted in the render
 *     tests, which can see the `disabled` control).
 */

const SHEET = {
  id: 10,
  style: 'STY-1001',
  order_no: 'PO-105',
  lineInputProcess: 'Collar Attach',
  lineOutputProcess: 'Side Seam',
  operations: [
    { operation: 'Collar Attach', smv: 1.2 },
    { operation: 'Sleeve Attach', smv: 1.4 },
    { operation: 'Side Seam', smv: 1.5 },
    { operation: 'Bottom Hem', smv: 1.8 },
  ],
};

describe('the QC process options', () => {
  it('offers STRICTLY the input and output processes the sheet designates', () => {
    const options = qcFaultProcessOptions(SHEET);
    expect(options.map((o) => o.value)).toEqual(['Collar Attach', 'Side Seam']);
  });

  it('says which of the two each one is', () => {
    const options = qcFaultProcessOptions(SHEET);
    expect(options[0]).toMatchObject({ value: 'Collar Attach', hint: 'Input process' });
    expect(options[1]).toMatchObject({ value: 'Side Seam', hint: 'Output process' });
  });

  it('does NOT offer an operation the sheet carries but does not designate', () => {
    // The brief is explicit: input and output only. Sleeve Attach and Bottom Hem are on
    // the sheet but are neither, so they must not appear.
    const values = qcFaultProcessOptions(SHEET).map((o) => o.value);
    expect(values).not.toContain('Sleeve Attach');
    expect(values).not.toContain('Bottom Hem');
  });

  it('reads the older inputProcess / outputProcess spellings', () => {
    const legacy = { inputProcess: 'Overlock', outputProcess: 'Bottom Hem', operations: [] };
    expect(qcFaultProcessOptions(legacy).map((o) => o.value)).toEqual(['Overlock', 'Bottom Hem']);
  });

  it('offers just the one that is designated when the sheet names only one', () => {
    const half = { ...SHEET, lineInputProcess: '', inputProcess: '', lineOutputProcess: 'Side Seam' };
    expect(qcFaultProcessOptions(half).map((o) => o.value)).toEqual(['Side Seam']);
  });

  it('falls back to the sheet’s operations when it designates neither', () => {
    // A sheet uploaded before those fields existed. Offering the full list is better
    // than offering nothing, so the check is not blocked by a gap in the metadata.
    const bare = { operations: [{ operation: 'Collar Attach' }, { operation: 'Side Seam' }] };
    const options = qcFaultProcessOptions(bare);
    expect(options.map((o) => o.value)).toEqual(['Collar Attach', 'Side Seam']);
    expect(options[0].hint).toBe('On this sheet');
  });

  it('keeps anything already chosen, so a chip is never orphaned', () => {
    const options = qcFaultProcessOptions(SHEET, ['Overlock']);
    expect(options.find((o) => o.value === 'Overlock')).toMatchObject({ hint: 'Selected' });
  });

  it('never lists a process twice, whatever its casing', () => {
    const options = qcFaultProcessOptions(SHEET, ['collar attach']);
    expect(options.filter((o) => o.value.toLowerCase() === 'collar attach')).toHaveLength(1);
  });

  it('returns nothing for a missing sheet', () => {
    expect(qcFaultProcessOptions(null)).toEqual([]);
    expect(qcFaultProcessOptions(undefined)).toEqual([]);
    expect(qcFaultProcessOptions({})).toEqual([]);
  });
});

describe('the QC colour options', () => {
  it('offers strictly the colours assigned to the order', () => {
    const options = qcOrderColorOptions({ color: 'Navy, Black' });
    expect(options.map((o) => o.value)).toEqual(['Navy', 'Black']);
    expect(options[0].hint).toBe('On this order');
  });

  it('reads a colour stored as an array', () => {
    expect(qcOrderColorOptions({ colors: ['Red', 'Blue'] }).map((o) => o.value))
      .toEqual(['Red', 'Blue']);
  });

  it('offers NO standard suggestions the order does not carry', () => {
    // Deliberately unlike the Total Line Output field: padding the list with colours
    // the order was never made in is what made a check name an impossible colour.
    const values = qcOrderColorOptions({ color: 'Navy' }).map((o) => o.value);
    expect(values).toEqual(['Navy']);
    expect(values).not.toContain('White');
    expect(values).not.toContain('Mustard');
  });

  it('keeps anything already chosen', () => {
    const options = qcOrderColorOptions({ color: 'Navy' }, ['Bottle Green']);
    expect(options.find((o) => o.value === 'Bottle Green')).toMatchObject({ hint: 'Selected' });
  });

  it('never lists a colour twice, whatever its casing', () => {
    const options = qcOrderColorOptions({ color: 'Navy' }, ['navy']);
    expect(options.filter((o) => o.value.toLowerCase() === 'navy')).toHaveLength(1);
  });

  it('returns nothing for an order with no colours', () => {
    expect(qcOrderColorOptions({})).toEqual([]);
    expect(qcOrderColorOptions(null)).toEqual([]);
    expect(qcOrderColorOptions(undefined)).toEqual([]);
  });

  it('uses only English hints', () => {
    [...qcOrderColorOptions({ color: 'Navy' }), ...qcFaultProcessOptions(SHEET)]
      .map((o) => o.hint)
      .filter(Boolean)
      .forEach((hint) => expect(/^[A-Za-z ]+$/.test(hint)).toBe(true));
  });
});

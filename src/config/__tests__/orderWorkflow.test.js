import { describe, it, expect } from 'vitest';
import {
  ORDER_FIELDS,
  orderValue,
  orderLabel,
  orderPrefill,
  findOrderByStyle,
  selectableOrders,
  headerIndex,
  findHeaderRow,
  parseOperations,
  totalSmvOf,
  buildProcessSheet,
  operationsForStyle,
  processNamesForStyle,
  smvForProcess,
} from '../orderWorkflow';

/**
 * Tests for the Order & Production workflow.
 *
 * The prefill is the part that must not go wrong: if it returns a field the
 * order does not have, or the wrong style's operations, the floor writes a day's
 * production against the wrong order. So these pin the lookup, the prefill and
 * the sheet parsing with worked examples, including the shapes an existing
 * database already contains.
 */
const ORDER = {
  id: 1,
  buyer: 'H&M',
  order_no: 'PO-105',
  style: 'STY-1001',
  item: 'Basic Tee',
  color: 'Navy',
  size_range: 'S-M-L-XL',
  qty: 5000,
  floor: 'Floor-2',
  line_no: 'Line-03',
  shift: 'Morning',
  supervisor: 'Salma',
  ship_date: '2026-09-20',
};

const SHEET = {
  id: 10,
  style: 'STY-1001',
  order_no: 'PO-105',
  fileName: 'breakdown.xlsx',
  uploadedAt: '2026-08-19',
  totalSmv: 12.5,
  operations: [
    { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
    { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
    { operation: 'Side Seam', machine: 'Flatlock', smv: 2.1, section: 'Body' },
  ],
};

describe('order lookup', () => {
  it('finds an order by its style', () => {
    expect(findOrderByStyle([ORDER], 'STY-1001')).toBe(ORDER);
  });

  it('falls back to the order number', () => {
    expect(findOrderByStyle([ORDER], 'PO-105')).toBe(ORDER);
  });

  it('returns null for a style that does not exist', () => {
    expect(findOrderByStyle([ORDER], 'NOPE')).toBeNull();
    expect(findOrderByStyle([ORDER], '')).toBeNull();
    expect(findOrderByStyle([], 'STY-1001')).toBeNull();
  });

  it('offers only orders that can actually be picked', () => {
    const rows = [ORDER, { id: 2, buyer: 'Zara' }, { id: 3, style: 'STY-9' }];
    const selectable = selectableOrders(rows);
    expect(selectable).toHaveLength(2);
    expect(selectable.map((o) => o.id)).toEqual([1, 3]);
  });

  it('builds a readable label from style and order number', () => {
    expect(orderLabel(ORDER)).toBe('STY-1001 — PO-105');
    expect(orderLabel({ style: 'STY-9' })).toBe('STY-9');
    expect(orderLabel(null)).toBe('');
  });
});

describe('order prefill for the production form', () => {
  it('maps every order-owned field the production header needs', () => {
    const prefill = orderPrefill(ORDER);
    expect(prefill).toMatchObject({
      buyer: 'H&M',
      order_no: 'PO-105',
      style: 'STY-1001',
      item: 'Basic Tee',
      color: 'Navy',
      size_range: 'S-M-L-XL',
      po_qty: 5000,          // qty is renamed to the field the form uses
      floor: 'Floor-2',
      line_no: 'Line-03',
      shift: 'Morning',
      supervisor: 'Salma',
    });
  });

  it('omits empty values so a pick never blanks a field', () => {
    const prefill = orderPrefill({ style: 'STY-9', buyer: '', color: undefined, qty: 0 });
    expect(prefill).not.toHaveProperty('buyer');
    expect(prefill).not.toHaveProperty('color');
    // A genuine zero is a value, not an empty one, and must survive.
    expect(prefill.po_qty).toBe(0);
  });

  it('returns nothing for no order', () => {
    expect(orderPrefill(null)).toEqual({});
    expect(orderPrefill(undefined)).toEqual({});
  });

  it('reads a legacy row that used line instead of line_no', () => {
    const legacy = { style: 'STY-OLD', line: 'Line-01' };
    expect(orderValue(legacy, 'line_no')).toBe('Line-01');
    expect(orderPrefill(legacy).line_no).toBe('Line-01');
  });

  it('prefers the new key when both are present', () => {
    const both = { style: 'S', line_no: 'Line-09', line: 'Line-01' };
    expect(orderValue(both, 'line_no')).toBe('Line-09');
  });

  it('declares every field the form renders', () => {
    const names = ORDER_FIELDS.map((f) => f.name);
    ['buyer', 'order_no', 'style', 'item', 'color', 'size_range', 'qty', 'floor', 'line_no', 'shift', 'supervisor']
      .forEach((n) => expect(names).toContain(n));
  });
});

describe('process sheet parsing', () => {
  it('maps header aliases case-insensitively', () => {
    const cols = headerIndex(['Operation Name', 'M/C', 'SMV', 'Section']);
    expect(cols).toMatchObject({ operation: 0, machine: 1, smv: 2, section: 3 });
  });

  it('accepts the shorter spellings a factory sheet uses', () => {
    expect(headerIndex(['OP', 'Machine Type', 'SAM'])).toMatchObject({ operation: 0, machine: 1, smv: 2 });
    expect(headerIndex(['Process', 'Std Minutes'])).toMatchObject({ operation: 0, smv: 1 });
  });

  it('finds the header row below a title band', () => {
    const grid = [
      ['Robiul Garments — Operation Breakdown'],
      [],
      ['Operation', 'Machine', 'SMV'],
      ['Collar Attach', 'Overlock', 1.2],
    ];
    const found = findHeaderRow(grid);
    expect(found.rowIndex).toBe(2);
    expect(found.cols.operation).toBe(0);
  });

  it('parses the operation rows under the header', () => {
    const grid = [
      ['Operation', 'Machine', 'SMV', 'Section'],
      ['Collar Attach', 'Overlock', 1.2, 'Front'],
      ['Sleeve Join', 'Overlock', 1.5, 'Sleeve'],
      ['', '', '', ''],
      ['TOTAL', '', 2.7, ''],
    ];
    const rows = parseOperations(grid);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' });
    expect(rows.map((r) => r.operation)).toEqual(['Collar Attach', 'Sleeve Join']);
  });

  it('skips blank rows and TOTAL rows rather than listing them as operations', () => {
    const grid = [
      ['Operation', 'SMV'],
      ['Collar Attach', 1.2],
      ['Grand Total', 1.2],
      ['   ', 0],
      ['Side Seam', 2.1],
    ];
    expect(parseOperations(grid).map((r) => r.operation)).toEqual(['Collar Attach', 'Side Seam']);
  });

  it('works with an operation-only sheet', () => {
    const rows = parseOperations([['Operation'], ['Collar Attach'], ['Sleeve Join']]);
    expect(rows).toHaveLength(2);
    expect(rows[0].machine).toBe('');
    expect(rows[0].smv).toBe(0);
  });

  it('throws a helpful error when there is no header at all', () => {
    expect(() => parseOperations([['just', 'some', 'text'], [1, 2, 3]])).toThrow(/header row/i);
  });

  it('throws rather than returning nothing when the table is empty', () => {
    expect(() => parseOperations([['Operation', 'SMV']])).toThrow(/No operation rows/i);
  });

  it('totals the SMV, rounded to two decimals', () => {
    // Two decimals is deliberate: an SMV sheet routinely carries values like
    // 0.75 and 1.25, and rounding to one would lose real minutes off a total.
    expect(totalSmvOf([{ smv: 1.2 }, { smv: 1.5 }, { smv: 2.25 }])).toBe(4.95);
    expect(totalSmvOf([{ smv: 1.2 }, { smv: 1.5 }])).toBe(2.7);
    expect(totalSmvOf([])).toBe(0);
  });

  it('avoids a floating-point tail on the total', () => {
    // 0.1 + 0.2 must read 0.3, not 0.30000000000000004.
    expect(totalSmvOf([{ smv: 0.1 }, { smv: 0.2 }])).toBe(0.3);
  });

  it('coerces a non-numeric smv to zero instead of NaN', () => {
    expect(parseOperations([['Operation', 'SMV'], ['Collar', 'n/a']])[0].smv).toBe(0);
  });
});

describe('linking a sheet to a style', () => {
  it('builds a record that carries the style and the operations', () => {
    const record = buildProcessSheet({
      style: 'STY-1001', order_no: 'PO-105', fileName: 'b.xlsx',
      operations: [{ operation: 'Collar Attach', smv: 1.2 }],
      uploadedAt: '2026-08-19',
    });
    expect(record.style).toBe('STY-1001');
    expect(record.order_no).toBe('PO-105');
    expect(record.totalSmv).toBe(1.2);
    expect(record.operations).toHaveLength(1);
  });

  it('returns the operations recorded for a style', () => {
    expect(operationsForStyle([SHEET], { style: 'STY-1001' })).toHaveLength(3);
  });

  it('finds a sheet through the order number when the style is not known', () => {
    expect(operationsForStyle([SHEET], { order_no: 'PO-105' })).toHaveLength(3);
  });

  it('returns nothing for a style with no sheet', () => {
    expect(operationsForStyle([SHEET], { style: 'STY-9999' })).toEqual([]);
    expect(operationsForStyle([], { style: 'STY-1001' })).toEqual([]);
    expect(operationsForStyle([SHEET], {})).toEqual([]);
  });

  it('uses the newest sheet when a style was re-uploaded', () => {
    const older = { ...SHEET, id: 1, uploadedAt: '2026-08-01', operations: [{ operation: 'Old Op', smv: 1 }] };
    const newer = { ...SHEET, id: 2, uploadedAt: '2026-08-19', operations: [{ operation: 'New Op', smv: 2 }] };
    const ops = operationsForStyle([older, newer], { style: 'STY-1001' });
    expect(ops).toHaveLength(1);
    expect(ops[0].operation).toBe('New Op');
  });

  it('breaks a same-day tie by the newer id', () => {
    const first = { ...SHEET, id: 1, operations: [{ operation: 'First', smv: 1 }] };
    const second = { ...SHEET, id: 2, operations: [{ operation: 'Second', smv: 1 }] };
    expect(operationsForStyle([first, second], { style: 'STY-1001' })[0].operation).toBe('Second');
  });

  it('lists operation names for the dropdown, de-duplicated and in sheet order', () => {
    const withDupes = {
      ...SHEET,
      operations: [
        { operation: 'Collar Attach' },
        { operation: 'Sleeve Join' },
        { operation: 'Collar Attach' },
      ],
    };
    expect(processNamesForStyle([withDupes], { style: 'STY-1001' }))
      .toEqual(['Collar Attach', 'Sleeve Join']);
  });

  it('looks up the SMV of one operation', () => {
    expect(smvForProcess([SHEET], { style: 'STY-1001' }, 'Sleeve Join')).toBe(1.5);
    expect(smvForProcess([SHEET], { style: 'STY-1001' }, 'Not On Sheet')).toBe(0);
  });
});

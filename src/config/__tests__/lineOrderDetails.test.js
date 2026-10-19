import { describe, it, expect } from 'vitest';
import {
  findOrderForRow,
  orderDetailsFor,
  dueOf,
  monthlyDueByLine,
  ORDER_DETAIL_COLUMNS,
  EMPTY_CELL,
} from '../monthlyLineOutput';

/**
 * The Line Production table's order-detail join and its two "due" figures.
 *
 * The brief: a row that shows an Order No must populate Buyer, Style No, Product / Item
 * and PO Qty from the saved Master Order records — joined, not copied, so correcting
 * the order is reflected on every line without a back-fill.
 */

const ORDERS = [
  { id: 1, order_no: 'PO-105', style: 'STY-1001', buyer: 'H&M', item: 'Basic Tee', qty: 5000, color: 'Navy, Black' },
  { id: 2, order_no: 'PO-106', style: 'STY-1002', buyer: 'Zara', item: 'Polo Shirt', qty: 1500, color: 'White' },
  // A legacy row that still uses the old alias for the order number and quantity.
  { id: 3, orderNo: 'PO-107', style: 'STY-1003', buyer: 'Primark', item: 'Hoodie', po_qty: 800 },
];

describe('finding the order behind a line row', () => {
  it('matches on the order number', () => {
    expect(findOrderForRow({ order_no: 'PO-105' }, ORDERS).buyer).toBe('H&M');
  });

  it('matches case-insensitively and trims', () => {
    // A hand-typed order number routinely differs in case from the master record.
    expect(findOrderForRow({ order_no: '  po-105 ' }, ORDERS).buyer).toBe('H&M');
  });

  it('falls back to the style when the order number is absent', () => {
    // A row written before the order was registered carries only a style.
    expect(findOrderForRow({ style: 'STY-1002' }, ORDERS).buyer).toBe('Zara');
  });

  it('reads the legacy orderNo alias', () => {
    expect(findOrderForRow({ order_no: 'PO-107' }, ORDERS).item).toBe('Hoodie');
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(findOrderForRow({ order_no: 'PO-999' }, ORDERS)).toBeNull();
    expect(findOrderForRow({}, ORDERS)).toBeNull();
    expect(findOrderForRow({ order_no: 'PO-105' }, [])).toBeNull();
  });
});

describe('the order detail columns', () => {
  it('populates every field from the master record', () => {
    const details = orderDetailsFor({ order_no: 'PO-105', line_no: 'Line-03' }, ORDERS);
    expect(details).toMatchObject({
      buyer: 'H&M',
      style: 'STY-1001',
      item: 'Basic Tee',
      po_qty: 5000,
      color: 'Navy, Black',
      found: true,
    });
  });

  it('reads the PO quantity from whichever key the record uses', () => {
    expect(orderDetailsFor({ order_no: 'PO-107' }, ORDERS).po_qty).toBe(800);
    expect(orderDetailsFor({ order_no: 'PO-105' }, ORDERS).po_qty).toBe(5000);
  });

  it('leaves a field empty rather than inventing a value', () => {
    const details = orderDetailsFor({ order_no: 'PO-999' }, ORDERS);
    expect(details).toMatchObject({ buyer: '', item: '', po_qty: '', color: '', found: false });
  });

  it('falls back to the row’s own style when the order has none', () => {
    // The auto rows copy the style from the employee entries, so it is worth showing.
    const details = orderDetailsFor({ order_no: 'PO-999', style: 'STY-9999' }, ORDERS);
    expect(details.style).toBe('STY-9999');
  });

  it('keeps the row’s style when the order matches but states none', () => {
    const orders = [{ order_no: 'PO-200', buyer: 'B' }];
    expect(orderDetailsFor({ order_no: 'PO-200', style: 'STY-X' }, orders).style).toBe('STY-X');
  });

  it('reports a PO quantity of zero as a real zero, not as missing', () => {
    // 0 is a stated figure; '' is an absent one. The table renders them differently.
    const orders = [{ order_no: 'PO-300', buyer: 'B', qty: 0 }];
    expect(orderDetailsFor({ order_no: 'PO-300' }, orders).po_qty).toBe(0);
  });

  it('tolerates a missing or malformed order list', () => {
    expect(orderDetailsFor({ order_no: 'PO-105' }, null).found).toBe(false);
    expect(orderDetailsFor({ order_no: 'PO-105' }, [null, undefined]).found).toBe(false);
    expect(orderDetailsFor(undefined, ORDERS).found).toBe(false);
  });

  it('declares the five columns the brief names, in English', () => {
    expect(ORDER_DETAIL_COLUMNS.map((c) => c.label)).toEqual([
      'Buyer', 'Style No', 'Product / Item', 'PO Qty', 'Color',
    ]);
    ORDER_DETAIL_COLUMNS.forEach((c) => expect(/^[A-Za-z /]+$/.test(c.label)).toBe(true));
  });
});

describe('what is due on a line', () => {
  it('is the shortfall against the day’s target', () => {
    expect(dueOf({ dailyTarget: 1000, achievement: 700 })).toBe(300);
  });

  it('never reports a surplus as a negative due', () => {
    expect(dueOf({ dailyTarget: 1000, achievement: 1200 })).toBe(0);
    expect(dueOf({ dailyTarget: 1000, achievement: 1000 })).toBe(0);
  });

  it('reads the output from whichever key the row uses', () => {
    expect(dueOf({ dailyTarget: 100, output: 40 })).toBe(60);
    expect(dueOf({ daily_target: 100, quantity: 25 })).toBe(75);
  });

  it('is 0 when there is no target to fall short of', () => {
    expect(dueOf({ achievement: 500 })).toBe(0);
  });
});

describe('the month’s due per line', () => {
  it('accumulates each day’s shortfall for the line', () => {
    const due = monthlyDueByLine([
      { line_no: 'Line-03', dailyTarget: 1000, achievement: 700 },
      { line_no: 'Line-03', dailyTarget: 1000, achievement: 900 },
    ]);
    expect(due.get('line-03')).toBe(400);
  });

  it('keeps each line separate', () => {
    const due = monthlyDueByLine([
      { line_no: 'Line-03', dailyTarget: 1000, achievement: 700 },
      { line_no: 'Line-05', dailyTarget: 500, achievement: 500 },
    ]);
    expect(due.get('line-03')).toBe(300);
    expect(due.get('line-05')).toBe(0);
  });

  it('offsets a surplus against a shortfall on another day', () => {
    // A line that over-produced one day cannot bank it against the plan without
    // somebody agreeing it, so the per-day differences are summed.
    const due = monthlyDueByLine([
      { line_no: 'L-1', dailyTarget: 1000, achievement: 1200 },
      { line_no: 'L-1', dailyTarget: 1000, achievement: 800 },
    ]);
    expect(due.get('l-1')).toBe(200);
  });

  it('ignores a row with no line and tolerates a malformed list', () => {
    expect(monthlyDueByLine([{ dailyTarget: 100, achievement: 0 }]).size).toBe(0);
    expect(monthlyDueByLine(null).size).toBe(0);
    expect(monthlyDueByLine([null]).size).toBe(0);
  });

  it('is case-insensitive on the line name', () => {
    const due = monthlyDueByLine([
      { line_no: 'Line-03', dailyTarget: 100, achievement: 40 },
      { line_no: 'line-03', dailyTarget: 100, achievement: 60 },
    ]);
    expect(due.size).toBe(1);
    expect(due.get('line-03')).toBe(100);
  });
});

describe('the empty-cell marker', () => {
  it('is a dash, so an absent value never reads as an empty screen', () => {
    expect(EMPTY_CELL).toBe('—');
  });
});

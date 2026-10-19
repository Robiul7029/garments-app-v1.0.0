import { describe, expect, it } from 'vitest';
import { ORDER_STATUS } from '../erpSchema';
import { isActiveOrder, resolveOrderStatus } from '../../utils/orderStatus';

describe('automatic purchase-order status', () => {
  const today = '2026-10-17';

  it('completes an active order when cumulative production fulfills PO quantity', () => {
    expect(resolveOrderStatus({ status: 'Active', totalQty: 500, producedQty: 500 }, today)).toMatchObject({
      status: ORDER_STATUS.COMPLETED, autoStatus: ORDER_STATUS.COMPLETED, fullyFulfilled: true,
    });
  });

  it('marks an active order inactive after its delivery date', () => {
    expect(resolveOrderStatus({ status: 'Active', totalQty: 500, producedQty: 200, shipmentDate: '2026-10-16' }, today)).toMatchObject({
      status: ORDER_STATUS.INACTIVE, pastDeliveryDate: true,
    });
  });

  it('does not auto-overwrite a manually closed or archived status', () => {
    expect(resolveOrderStatus({ status: ORDER_STATUS.ARCHIVED, totalQty: 500, producedQty: 500 }, today)).toMatchObject({
      status: ORDER_STATUS.ARCHIVED, manuallyClosed: true,
    });
  });

  it('respects a manual override on an otherwise auto-completable order', () => {
    expect(resolveOrderStatus({ status: 'Active', manualStatusOverride: true, totalQty: 500, producedQty: 500 }, today)).toMatchObject({
      status: 'Active', manualOverride: true, autoStatus: '',
    });
  });

  it('excludes manually closed and archived orders from the active count', () => {
    expect(isActiveOrder({ status: ORDER_STATUS.CLOSED, manualStatusOverride: true, totalQty: 500 }, today)).toBe(false);
    expect(isActiveOrder({ status: ORDER_STATUS.ARCHIVED, manualStatusOverride: true, totalQty: 500 }, today)).toBe(false);
  });

  it('keeps an unfulfilled order with a future delivery date active', () => {
    const row = { status: 'Active', totalQty: 500, producedQty: 200, shipmentDate: '2026-10-20' };
    expect(isActiveOrder(row, today)).toBe(true);
    expect(resolveOrderStatus(row, today).status).toBe('Active');
  });
});

/**
 * The brief's dynamic window: an order is active while TODAY sits between its
 * Start Date and its Delivery Date (inclusive at both ends) and the PO quantity
 * is not yet fully produced. No manual status toggle and no exact-day match.
 */
describe('the dynamic Start–Delivery active window', () => {
  const today = '2026-10-17';

  it('counts an order that is inside its start and delivery window', () => {
    const row = { status: 'Active', totalQty: 500, producedQty: 100, start_date: '2026-10-10', ship_date: '2026-10-25' };
    expect(isActiveOrder(row, today)).toBe(true);
  });

  it('counts an order that starts today (start date is inclusive)', () => {
    const row = { status: 'Active', totalQty: 500, producedQty: 0, order_date: '2026-10-17', ship_date: '2026-10-25' };
    expect(isActiveOrder(row, today)).toBe(true);
  });

  it('counts an order that is due today (delivery date is inclusive)', () => {
    const row = { status: 'Active', totalQty: 500, producedQty: 0, order_date: '2026-10-10', ship_date: '2026-10-17' };
    expect(isActiveOrder(row, today)).toBe(true);
  });

  it('excludes an order whose start date is in the future', () => {
    const row = { status: 'Active', totalQty: 500, producedQty: 0, start_date: '2026-10-20', ship_date: '2026-10-30' };
    expect(isActiveOrder(row, today)).toBe(false);
    expect(resolveOrderStatus(row, today).beforeStartDate).toBe(true);
  });

  it('excludes an order whose delivery date has passed', () => {
    const row = { status: 'Active', totalQty: 500, producedQty: 100, start_date: '2026-10-01', ship_date: '2026-10-16' };
    expect(isActiveOrder(row, today)).toBe(false);
    expect(resolveOrderStatus(row, today).pastDeliveryDate).toBe(true);
  });

  it('excludes an order whose PO quantity is fully produced', () => {
    const row = { status: 'Active', totalQty: 500, producedQty: 500, start_date: '2026-10-01', ship_date: '2026-10-30' };
    expect(isActiveOrder(row, today)).toBe(false);
    expect(resolveOrderStatus(row, today).fullyFulfilled).toBe(true);
  });

  it('reads the window from a purchase order as well as an order master', () => {
    // The PO shape (`poDate` / `shipmentDate`) and the master shape
    // (`order_date` / `ship_date`) must both resolve.
    const po = { status: 'Active', totalQty: 500, producedQty: 0, poDate: '2026-10-12', shipmentDate: '2026-10-22' };
    expect(isActiveOrder(po, today)).toBe(true);
    // Normalised to a plain YYYY-MM-DD key, never a Date that can shift a day.
    expect(resolveOrderStatus(po, today).startDate).toBe('2026-10-12');
    expect(resolveOrderStatus(po, today).dueDate).toBe('2026-10-22');
  });

  it('reads the ERP order-master keys (orderDate / deliveryDate)', () => {
    // This is the shape `OrderInput` actually saves — Order Date and Delivery
    // Date — and the one the two live orders carry.
    const row = { status: 'Active', totalQty: 500, producedQty: 0, orderDate: '2026-10-12', deliveryDate: '2026-11-30' };
    expect(isActiveOrder(row, today)).toBe(true);
    expect(resolveOrderStatus(row, today).dueDate).toBe('2026-11-30');
  });

  it('treats a missing start date as already started', () => {
    // An order without a plan date must still be countable — only a start date
    // genuinely in the FUTURE excludes a row.
    const row = { status: 'Active', totalQty: 500, producedQty: 0, shipmentDate: '2026-10-25' };
    expect(isActiveOrder(row, today)).toBe(true);
  });
});

/**
 * The two failure modes the brief calls out: a row missing its identity fields,
 * and a YYYY-MM-DD date being shifted by a time-zone offset before it is
 * compared with today.
 */
describe('null-safe rows and time-zone-proof date handling', () => {
  const today = '2026-10-17';

  it('does not reject an order that is missing its order number', () => {
    const row = { id: 'po-blank', status: 'Active', totalQty: 500, producedQty: 0, orderDate: '2026-10-01', deliveryDate: '2026-11-30' };
    expect(isActiveOrder(row, today)).toBe(true);
  });

  it('does not reject an order whose optional fields are all empty strings', () => {
    const row = {
      id: 'po-empty', status: 'Active', totalQty: 500, producedQty: 0,
      orderNo: '', poNo: '', styleNo: '', orderDate: '2026-10-01', deliveryDate: '2026-11-30',
    };
    expect(isActiveOrder(row, today)).toBe(true);
  });

  it('never lets a midnight date slip a day across a negative UTC offset', () => {
    // A negative offset (e.g. UTC-5) is where `new Date('2026-11-30')` used to
    // read back as 2026-11-29. The normalised key is compared as text, so the
    // day is exactly the one that was stored, whatever the host time zone.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const row = { id: 'po-1', status: 'Active', totalQty: 1000, producedQty: 0, orderDate: '2026-10-01', deliveryDate: '2026-11-30' };
      expect(resolveOrderStatus(row, '2026-11-30').dueDate).toBe('2026-11-30');
      // Due on the 30th, still active ON the 30th and only drops the next day.
      expect(isActiveOrder(row, '2026-11-30')).toBe(true);
      expect(isActiveOrder(row, '2026-12-01')).toBe(false);
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });

  it('counts the two live orders whose delivery dates fall in November 2026', () => {
    const rows = [
      { id: 'po-hm', orderNo: 'PO-1001', styleNo: 'STY-1001', buyer: 'H&M', status: 'Active', totalQty: 1200, producedQty: 0, orderDate: '2026-10-05', deliveryDate: '2026-11-30' },
      { id: 'po-zara', orderNo: 'PO-1002', styleNo: 'STY0254560201', buyer: 'Zara', status: 'Active', totalQty: 800, producedQty: 0, orderDate: '2026-10-08', deliveryDate: '2026-11-15' },
    ];
    expect(rows.filter((r) => isActiveOrder(r, '2026-10-17'))).toHaveLength(2);
  });
});

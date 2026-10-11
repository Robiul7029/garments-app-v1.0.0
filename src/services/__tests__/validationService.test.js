import { describe, it, expect } from 'vitest';
import { validateRecord, applyDefaults } from '../validationService';
import { C } from '../../config/erpSchema';

/**
 * Tests for the business rules that stand between a mistyped form and a
 * corrupt database. Each rule is checked with both valid and invalid data,
 * because a validation layer that only passes everything is worse than none.
 */
const goodPO = {
  poNo: 'PO-105',
  orderId: 'o1',
  buyerId: 'b1',
  poDate: '2026-08-01',
  shipmentDate: '2026-09-20',
  status: 'New',
  totalQty: 5000,
  shippedQty: 0,
};

describe('field validation', () => {
  it('accepts a valid purchase order', () => {
    const result = validateRecord(C.PURCHASE_ORDERS, goodPO);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('rejects a missing required field', () => {
    const result = validateRecord(C.PURCHASE_ORDERS, { ...goodPO, poNo: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.poNo).toMatch(/required/i);
  });

  it('rejects a non-numeric quantity', () => {
    const result = validateRecord(C.PURCHASE_ORDERS, { ...goodPO, totalQty: 'many' });
    expect(result.valid).toBe(false);
    expect(result.errors.totalQty).toMatch(/number/i);
  });

  it('rejects a negative quantity', () => {
    // `min: 1` fires before the generic negative check, so the message names the
    // actual minimum rather than just "negative".
    const result = validateRecord(C.PURCHASE_ORDERS, { ...goodPO, totalQty: -5 });
    expect(result.valid).toBe(false);
    expect(result.errors.totalQty).toMatch(/cannot be less than 1/i);
  });

  it('names the declared minimum on a field that has one', () => {
    // `costHeads.amount` is declared `min: 0`, so the minimum rule fires — not
    // the generic negative rule — and the message names the bound.
    //
    // This test previously expected /negative/i here, on the belief that
    // `amount` carried no `min`. It does (erpSchema.js, COST_HEADS), so the
    // generic rule was never the one rejecting the value.
    const result = validateRecord(C.COST_HEADS, {
      orderId: 'o1', category: 'Fabric', amount: -100, date: '2026-08-19',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.amount).toMatch(/cannot be less than 0/i);
  });

  it('rejects a negative value on a field with no declared minimum', () => {
    // `items.openingQty` is a `number` with no `min`, which is the only shape
    // that reaches the generic negative guard. Testing it here is what actually
    // covers that guard — the cost-heads case above cannot, because it is
    // caught by its own minimum first.
    const result = validateRecord(C.ITEMS, {
      itemCode: 'ITM-1', name: 'Fabric', category: 'Fabric', unit: 'mtr',
      openingQty: -20,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.openingQty).toMatch(/negative/i);
  });

  it('accepts a zero opening quantity', () => {
    // The guard must reject below zero only: an item that has never been
    // stocked legitimately opens at 0.
    const result = validateRecord(C.ITEMS, {
      itemCode: 'ITM-1', name: 'Fabric', category: 'Fabric', unit: 'mtr',
      openingQty: 0,
    });
    expect(result.errors.openingQty).toBeUndefined();
  });

  it('rejects an invalid date', () => {
    const result = validateRecord(C.ORDERS, {
      orderNo: 'O-1', buyerId: 'b1', orderDate: 'yesterday',
      deliveryDate: '2026-09-20', status: 'New', totalQty: 100,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.orderDate).toMatch(/valid date/i);
  });

  it('rejects an invalid email address', () => {
    const result = validateRecord(C.BUYER_CONTACTS, {
      buyerId: 'b1', name: 'Jane', email: 'not-an-email',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.email).toMatch(/valid email/i);
  });
});

describe('cross-field rules', () => {
  it('rejects a delivery date before the order date', () => {
    const result = validateRecord(C.ORDERS, {
      orderNo: 'O-1', buyerId: 'b1', orderDate: '2026-08-01',
      deliveryDate: '2026-07-01', status: 'New', totalQty: 100,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.deliveryDate).toMatch(/cannot be before/i);
  });

  it('rejects shipped qty exceeding the PO total', () => {
    const result = validateRecord(C.PURCHASE_ORDERS, { ...goodPO, shippedQty: 6000 });
    expect(result.valid).toBe(false);
    expect(result.errors.shippedQty).toMatch(/cannot exceed/i);
  });

  it('rejects present count exceeding total manpower', () => {
    const result = validateRecord(C.LINE_SHIFTS, {
      lineId: 'l1', date: '2026-08-19', shift: 'Morning',
      manpower: 20, presentCount: 25,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.presentCount).toMatch(/cannot exceed/i);
  });

  it('warns when production is more than double the target', () => {
    // A real spike is allowed, but a typing error is flagged for confirmation.
    const result = validateRecord(C.HOURLY_PRODUCTION, {
      lineId: 'l1', date: '2026-08-19', hourSlot: '10:00-11:00',
      target: 500, actual: 5000,
    });
    expect(result.errors.actual).toMatch(/double/i);
  });

  it('allows a modest overrun without complaint', () => {
    const result = validateRecord(C.HOURLY_PRODUCTION, {
      lineId: 'l1', date: '2026-08-19', hourSlot: '10:00-11:00',
      target: 500, actual: 560,
    });
    expect(result.errors.actual).toBeUndefined();
  });

  it('rejects rework plus reject exceeding actual production', () => {
    const result = validateRecord(C.HOURLY_PRODUCTION, {
      lineId: 'l1', date: '2026-08-19', hourSlot: '10:00-11:00',
      target: 500, actual: 470, rework: 400, reject: 200,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.reject).toMatch(/cannot exceed actual/i);
  });

  it('rejects defects exceeding the checked quantity', () => {
    const result = validateRecord(C.INLINE_QC, {
      date: '2026-08-19', lineId: 'l1', checkedQty: 100, defectQty: 150,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.defectQty).toMatch(/cannot exceed/i);
  });

  it('rejects passed plus failed exceeding checked', () => {
    const result = validateRecord(C.END_LINE_QC, {
      date: '2026-08-19', lineId: 'l1', checkedQty: 100, passedQty: 80, failedQty: 40,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.failedQty).toMatch(/cannot exceed/i);
  });

  it('rejects minimum stock above maximum stock', () => {
    const result = validateRecord(C.ITEMS, {
      itemCode: 'ITM-1', name: 'Fabric', category: 'Fabric', unit: 'mtr',
      minQty: 500, maxQty: 100,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.minQty).toMatch(/greater than maximum/i);
  });

  it('rejects a leave end date before its start date', () => {
    const result = validateRecord(C.LEAVE_REQUESTS, {
      employeeId: 'e1', leaveType: 'Sick',
      fromDate: '2026-08-20', toDate: '2026-08-18',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.toDate).toMatch(/cannot be before/i);
  });

  it('rejects packed qty exceeding planned qty', () => {
    const result = validateRecord(C.PACKING_PLANS, {
      poId: 'p1', styleId: 's1', packDate: '2026-08-19',
      plannedQty: 1000, packedQty: 1500,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.packedQty).toMatch(/cannot exceed/i);
  });

  it('requires downtime to be recorded on a completed repair', () => {
    const result = validateRecord(C.MAINTENANCE_REQUESTS, {
      machineId: 'm1', type: 'Breakdown',
      startTime: '2026-08-19T08:00:00', endTime: '2026-08-19T09:30:00',
      downtimeMin: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.downtimeMin).toMatch(/downtime/i);
  });

  it('rejects an end time before the start time', () => {
    const result = validateRecord(C.MAINTENANCE_REQUESTS, {
      machineId: 'm1', type: 'Breakdown',
      startTime: '2026-08-19T10:00:00', endTime: '2026-08-19T09:00:00',
      downtimeMin: 60,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.endTime).toMatch(/cannot be before/i);
  });
});

describe('uniqueness and cross-document limits', () => {
  it('rejects a duplicate PO number', () => {
    // The repository reports which natural keys are already in use.
    const result = validateRecord(C.PURCHASE_ORDERS, goodPO, {
      duplicates: { poNo: { 'PO-105': true } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.poNo).toMatch(/already exists/i);
  });

  it('allows an edit that keeps its own PO number', () => {
    // Re-saving PO-105 unchanged must not collide with itself.
    const result = validateRecord(C.PURCHASE_ORDERS, goodPO, {
      existing: { id: 'po1', poNo: 'PO-105' },
      duplicates: { poNo: { 'PO-105': true } },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a duplicate employee id', () => {
    const result = validateRecord(C.EMPLOYEES, {
      employeeCode: 'EMP-001', name: 'Rahim', department: 'Sewing',
      joiningDate: '2026-01-01',
    }, {
      duplicates: { employeeCode: { 'EMP-001': true } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.employeeCode).toMatch(/already exists/i);
  });

  it('rejects a duplicate carton number', () => {
    const result = validateRecord(C.CARTONS, {
      cartonNo: 'CTN-001', poId: 'p1', styleId: 's1', qty: 50,
    }, {
      duplicates: { cartonNo: { 'CTN-001': true } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.cartonNo).toMatch(/already exists/i);
  });

  it('rejects a store issue that exceeds available stock', () => {
    const result = validateRecord(C.STOCK_LEDGER, {
      itemId: 'i1', storeId: 'st1', type: 'Issue',
      date: '2026-08-19', qtyIn: 0, qtyOut: 900,
    }, { availableQty: { qtyOut: 500 } });
    expect(result.valid).toBe(false);
    expect(result.errors.qtyOut).toMatch(/available: 500/i);
  });

  it('rejects a shipment that exceeds the packed quantity', () => {
    // Packing produced 4000 pcs, so a 5000-pc shipment plan is an over-commit.
    const result = validateRecord(C.SHIPMENT_PLANS, {
      shipmentRef: 'SH-1', orderId: 'o1', buyerId: 'b1',
      shipmentDate: '2026-09-20', totalQty: 5000, shippedQty: 0,
    }, { availableQty: { totalQty: 4000 } });
    expect(result.valid).toBe(false);
    expect(result.errors.totalQty).toMatch(/packed quantity/i);
  });

  it('allows a shipment within the packed quantity', () => {
    const result = validateRecord(C.SHIPMENT_PLANS, {
      shipmentRef: 'SH-1', orderId: 'o1', buyerId: 'b1',
      shipmentDate: '2026-09-20', totalQty: 4000, shippedQty: 0,
    }, { availableQty: { totalQty: 4000 } });
    expect(result.valid).toBe(true);
  });

  it('rejects a shipped figure above the shipment total', () => {
    // The record-level rule covers the second boundary: nothing may be marked as
    // shipped beyond what the shipment itself covers.
    const result = validateRecord(C.SHIPMENT_PLANS, {
      shipmentRef: 'SH-1', orderId: 'o1', buyerId: 'b1',
      shipmentDate: '2026-09-20', totalQty: 4000, shippedQty: 4500,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.shippedQty).toMatch(/cannot exceed/i);
  });

  it('allows an issue within the available stock', () => {
    const result = validateRecord(C.STOCK_LEDGER, {
      itemId: 'i1', storeId: 'st1', type: 'Issue',
      date: '2026-08-19', qtyIn: 0, qtyOut: 300,
    }, { availableQty: { qtyOut: 500 } });
    expect(result.valid).toBe(true);
  });
});

describe('defaults', () => {
  it('applies schema defaults for blank fields', () => {
    const result = applyDefaults(C.PURCHASE_ORDERS, { ...goodPO, shippedQty: undefined });
    expect(result.shippedQty).toBe(0);
  });

  it('normalises a blank number to zero rather than an empty string', () => {
    // Every downstream sum must see a number, never ''.
    const result = applyDefaults(C.ITEMS, {
      itemCode: 'ITM-1', name: 'Fabric', category: 'Fabric', unit: 'mtr', minQty: '',
    });
    expect(result.minQty).toBe(0);
  });

  it('does not overwrite a value the user actually supplied', () => {
    const result = applyDefaults(C.PURCHASE_ORDERS, { ...goodPO, shippedQty: 250 });
    expect(result.shippedQty).toBe(250);
  });

  it('never stores undefined, which Firestore rejects', () => {
    const result = applyDefaults(C.BUYERS, { buyerCode: 'B-1', name: 'H&M' });
    Object.values(result).forEach((v) => expect(v).not.toBeUndefined());
  });
});
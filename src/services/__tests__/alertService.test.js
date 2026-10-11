import { describe, it, expect } from 'vitest';
import {
  ruleLineBelowTarget, ruleQcRejectAboveLimit, ruleStockLow, ruleMachineBreakdown,
  ruleShipmentDelayRisk, ruleTnaDelay, evaluateAllRules, summariseAlerts,
  THRESHOLDS, ALERT_RULE,
} from '../alertService';
import { SEVERITY } from '../../config/erpSchema';

/**
 * Tests for the alert rules — the business rules that decide whether the factory
 * gets told about a problem.
 *
 * Each rule is checked three ways: it fires when it should, it stays silent when
 * it should, and it produces a stable fingerprint so re-running the engine
 * updates an alert instead of raising a duplicate.
 */
const TODAY = new Date('2026-08-19T00:00:00');
const lines = [{ id: 'l1', name: 'Line 01' }, { id: 'l3', name: 'Line 03' }];

describe('production below target', () => {
  it('raises a critical alert for a badly missed line', () => {
    const alerts = ruleLineBelowTarget([
      { lineId: 'l3', date: '2026-08-19', hourSlot: '10:00-11:00', target: 500, actual: 300 },
    ], lines);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe(SEVERITY.CRITICAL);
    expect(alerts[0].title).toContain('Line 03');
    expect(alerts[0].title).toContain('Production Below Target');
  });

  it('raises a warning for a mildly missed line', () => {
    // A warning band runs from 70% up to (not including) 85%, so 75% warns.
    // The original figure here was 450 of 500 — 90% — which is above the 85%
    // warning threshold and correctly raises nothing; that case is the
    // "stays silent" test below, so it is not repeated here.
    const alerts = ruleLineBelowTarget([
      { lineId: 'l1', date: '2026-08-19', hourSlot: '10:00-11:00', target: 500, actual: 375 },
    ], lines);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe(SEVERITY.WARNING);
  });

  it('stays silent at exactly the warning threshold', () => {
    // 85% is the boundary: the rule is "below 85", so 85 itself is green.
    // Pinning the boundary stops a future edit to the comparison turning every
    // on-target line into an alert.
    const alerts = ruleLineBelowTarget([
      { lineId: 'l1', date: '2026-08-19', target: 500, actual: 425 },
    ], lines);
    expect(alerts).toHaveLength(0);
  });

  it('escalates to critical below the critical threshold', () => {
    const alerts = ruleLineBelowTarget([
      { lineId: 'l1', date: '2026-08-19', target: 500, actual: 300 },
    ], lines);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe(SEVERITY.CRITICAL);
  });

  it('stays silent for a line that met its target', () => {
    const alerts = ruleLineBelowTarget([
      { lineId: 'l1', date: '2026-08-19', hourSlot: '10:00-11:00', target: 500, actual: 470 },
    ], lines);
    // 94% is green: a supervisor hitting 470 of 500 should never be alarmed.
    expect(alerts).toHaveLength(0);
  });

  it('groups a day into one alert per line, not one per hour', () => {
    const alerts = ruleLineBelowTarget([
      { lineId: 'l3', date: '2026-08-19', hourSlot: '08:00-09:00', target: 500, actual: 300 },
      { lineId: 'l3', date: '2026-08-19', hourSlot: '09:00-10:00', target: 500, actual: 200 },
      { lineId: 'l3', date: '2026-08-19', hourSlot: '10:00-11:00', target: 500, actual: 400 },
    ], lines);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain('900');   // 300 + 200 + 400
    expect(alerts[0].message).toContain('1500');  // 500 x 3
  });

  it('produces a stable fingerprint so re-running does not duplicate', () => {
    const rows = [{ lineId: 'l3', date: '2026-08-19', target: 500, actual: 300 }];
    const first = ruleLineBelowTarget(rows, lines)[0];
    const second = ruleLineBelowTarget(rows, lines)[0];
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toContain(ALERT_RULE.LINE_BELOW_TARGET);
  });

  it('separates alerts by line and by day', () => {
    const alerts = ruleLineBelowTarget([
      { lineId: 'l1', date: '2026-08-19', target: 500, actual: 100 },
      { lineId: 'l3', date: '2026-08-19', target: 500, actual: 100 },
      { lineId: 'l1', date: '2026-08-20', target: 500, actual: 100 },
    ], lines);
    expect(alerts).toHaveLength(3);
    expect(new Set(alerts.map((a) => a.fingerprint)).size).toBe(3);
  });

  it('handles an empty production day', () => {
    expect(ruleLineBelowTarget([], lines)).toEqual([]);
  });
});

describe('QC reject above limit', () => {
  it('raises an alert when rejects exceed the limit', () => {
    const alerts = ruleQcRejectAboveLimit([
      { date: '2026-08-19', lineId: 'l1', checkedQty: 100, rejectQty: 10 },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe(SEVERITY.WARNING);
    expect(alerts[0].title).toContain('10.0%');
  });

  it('stays silent below the limit', () => {
    expect(ruleQcRejectAboveLimit([
      { date: '2026-08-19', lineId: 'l1', checkedQty: 100, rejectQty: 3 },
    ])).toHaveLength(0);
  });

  it('aggregates across rows before judging', () => {
    // The rule sums first, then takes one percentage: (3 + 4) / (100 + 100)
    // = 3.5%, which is UNDER the 5% limit, so both rows stay silent.
    //
    // This test previously asserted one alert, on the working "3/100 + 4/100
    // = 7%". That arithmetic is wrong: percentages over different denominators
    // do not add, and the rule is right to stay quiet.
    const alerts = ruleQcRejectAboveLimit([
      { date: '2026-08-19', lineId: 'l1', checkedQty: 100, rejectQty: 3 },
      { date: '2026-08-19', lineId: 'l1', checkedQty: 100, rejectQty: 4 },
    ]);
    expect(alerts).toHaveLength(0);
  });

  it('raises once the aggregated rate crosses the limit', () => {
    // The real aggregation case: 12 rejects over 200 checked is 6%, over the
    // limit — while each row alone is also 6%, so what this pins is that the
    // summed denominator is used, not the raw reject count.
    const alerts = ruleQcRejectAboveLimit([
      { date: '2026-08-19', lineId: 'l1', checkedQty: 100, rejectQty: 6 },
      { date: '2026-08-19', lineId: 'l1', checkedQty: 100, rejectQty: 6 },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain('6.0%');
  });

  it('ignores rows where nothing was inspected', () => {
    expect(ruleQcRejectAboveLimit([
      { date: '2026-08-19', lineId: 'l1', checkedQty: 0, rejectQty: 0 },
    ])).toHaveLength(0);
  });
});

describe('stock below minimum', () => {
  it('raises a critical alert at or below the minimum', () => {
    const alerts = ruleStockLow(
      [{ id: 'i1', name: 'Cotton Twill', unit: 'mtr', minQty: 500, maxQty: 2000 }],
      { i1: 400 }
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe(SEVERITY.CRITICAL);
    expect(alerts[0].title).toContain('Cotton Twill');
  });

  it('raises a warning inside the reorder band', () => {
    const alerts = ruleStockLow(
      [{ id: 'i1', name: 'Cotton Twill', unit: 'mtr', minQty: 100, maxQty: 2000 }],
      { i1: 800 }
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe(SEVERITY.WARNING);
  });

  it('stays silent when stock is healthy', () => {
    expect(ruleStockLow(
      [{ id: 'i1', name: 'Cotton Twill', unit: 'mtr', minQty: 100, maxQty: 2000 }],
      { i1: 1800 }
    )).toHaveLength(0);
  });

  it('ignores items with no reorder level configured', () => {
    // Otherwise every item with minQty 0 would alert on zero stock forever.
    expect(ruleStockLow([{ id: 'i1', name: 'Buttons' }], { i1: 0 })).toHaveLength(0);
  });

  it('ignores inactive items', () => {
    const alerts = ruleStockLow(
      [{ id: 'i1', name: 'Discontinued', minQty: 100, maxQty: 500, active: false }],
      { i1: 0 }
    );
    expect(alerts).toHaveLength(0);
  });
});

describe('machine breakdown', () => {
  const machines = [{ id: 'm24', machineCode: 'M-024' }];

  it('raises a critical alert for an open breakdown', () => {
    const alerts = ruleMachineBreakdown([
      { id: 'r1', machineId: 'm24', type: 'Breakdown', status: 'Open', description: 'Needle broke' },
    ], machines);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe(SEVERITY.CRITICAL);
    expect(alerts[0].title).toContain('M-024');
    expect(alerts[0].title).toContain('Breakdown');
  });

  it('also covers a repair already in progress', () => {
    const alerts = ruleMachineBreakdown([
      { id: 'r1', machineId: 'm24', type: 'Breakdown', status: 'In Progress' },
    ], machines);
    expect(alerts).toHaveLength(1);
  });

  it('clears once the repair is completed', () => {
    expect(ruleMachineBreakdown([
      { id: 'r1', machineId: 'm24', type: 'Breakdown', status: 'Completed' },
    ], machines)).toHaveLength(0);
  });

  it('does not alert on preventive maintenance', () => {
    expect(ruleMachineBreakdown([
      { id: 'r1', machineId: 'm24', type: 'Preventive', status: 'Open' },
    ], machines)).toHaveLength(0);
  });
});

describe('shipment delay risk', () => {
  const po = (over) => ({
    id: 'po1', poNo: 'PO-105', status: 'Production',
    shipmentDate: over, totalQty: 5000, shippedQty: 0,
  });

  it('warns for a PO due inside the risk window', () => {
    const alerts = ruleShipmentDelayRisk([po('2026-08-21')], TODAY);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe(SEVERITY.WARNING);
    expect(alerts[0].title).toContain('PO-105');
  });

  it('escalates to critical once the date has passed', () => {
    const alerts = ruleShipmentDelayRisk([po('2026-08-15')], TODAY);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe(SEVERITY.CRITICAL);
    expect(alerts[0].message).toMatch(/passed/i);
  });

  it('stays silent for a PO due further out', () => {
    expect(ruleShipmentDelayRisk([po('2026-09-20')], TODAY)).toHaveLength(0);
  });

  it('stays silent for a fully shipped PO', () => {
    const alerts = ruleShipmentDelayRisk([
      { ...po('2026-08-20'), shippedQty: 5000 },
    ], TODAY);
    expect(alerts).toHaveLength(0);
  });

  it('stays silent for a completed or cancelled PO', () => {
    expect(ruleShipmentDelayRisk([{ ...po('2026-08-20'), status: 'Completed' }], TODAY)).toHaveLength(0);
    expect(ruleShipmentDelayRisk([{ ...po('2026-08-20'), status: 'Cancelled' }], TODAY)).toHaveLength(0);
  });

  it('respects the configured risk window', () => {
    // The default window is 3 days; 2 days out fires, 5 days out does not.
    expect(THRESHOLDS.shipmentRiskDays).toBe(3);
    expect(ruleShipmentDelayRisk([po('2026-08-24')], TODAY)).toHaveLength(0);
  });
});

describe('TNA delay', () => {
  const orders = [{ id: 'o1', orderNo: 'PO-109' }];

  it('warns for a task past its planned date', () => {
    const alerts = ruleTnaDelay([
      { id: 't1', orderId: 'o1', stage: 'Fabric Approval', plannedDate: '2026-08-15', status: 'Pending' },
    ], orders, TODAY);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain('PO-109');
    expect(alerts[0].message).toMatch(/4 day/);
  });

  it('flags a critical-path task even when it is on time', () => {
    const alerts = ruleTnaDelay([
      { id: 't1', orderId: 'o1', stage: 'Cutting', plannedDate: '2026-08-25', status: 'Pending', isCritical: true },
    ], orders, TODAY);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe(SEVERITY.INFO);
    expect(alerts[0].title).toContain('Critical Path');
  });

  it('stays silent for a completed task', () => {
    expect(ruleTnaDelay([
      { id: 't1', orderId: 'o1', stage: 'Fabric Approval', plannedDate: '2026-08-15', status: 'Completed' },
    ], orders, TODAY)).toHaveLength(0);
  });

  it('stays silent for a non-critical task still in the future', () => {
    expect(ruleTnaDelay([
      { id: 't1', orderId: 'o1', stage: 'Cutting', plannedDate: '2026-08-25', status: 'Pending' },
    ], orders, TODAY)).toHaveLength(0);
  });
});

describe('the whole engine', () => {
  it('gathers alerts from every rule at once', () => {
    const alerts = evaluateAllRules({
      productionRows: [{ lineId: 'l3', date: '2026-08-19', target: 500, actual: 200 }],
      lines,
      qcRows: [{ date: '2026-08-19', lineId: 'l1', checkedQty: 100, rejectQty: 20 }],
      items: [{ id: 'i1', name: 'Fabric', minQty: 100, maxQty: 500 }],
      stockByItem: { i1: 10 },
      maintenanceRows: [{ id: 'r1', machineId: 'm24', type: 'Breakdown', status: 'Open' }],
      machines: [{ id: 'm24', machineCode: 'M-024' }],
      purchaseOrders: [{ id: 'po1', poNo: 'PO-105', status: 'Production', shipmentDate: '2026-08-20', totalQty: 100, shippedQty: 0 }],
      tnaTasks: [{ id: 't1', orderId: 'o1', stage: 'Fabric', plannedDate: '2026-08-10', status: 'Pending' }],
      orders: [{ id: 'o1', orderNo: 'PO-109' }],
      today: TODAY,
    });

    const rules = new Set(alerts.map((a) => a.fingerprint.split('|')[0]));
    expect(rules.size).toBe(6);
  });

  it('produces no alerts from no data', () => {
    expect(evaluateAllRules({})).toEqual([]);
  });

  it('gives every alert a unique fingerprint', () => {
    const alerts = evaluateAllRules({
      productionRows: [
        { lineId: 'l1', date: '2026-08-19', target: 500, actual: 100 },
        { lineId: 'l3', date: '2026-08-19', target: 500, actual: 100 },
      ],
      lines, today: TODAY,
    });
    const prints = alerts.map((a) => a.fingerprint);
    expect(new Set(prints).size).toBe(prints.length);
  });

  it('gives every alert a title, message and severity', () => {
    const alerts = evaluateAllRules({
      productionRows: [{ lineId: 'l3', date: '2026-08-19', target: 500, actual: 100 }],
      lines, today: TODAY,
    });
    alerts.forEach((a) => {
      expect(a.title).toBeTruthy();
      expect(a.message).toBeTruthy();
      expect([SEVERITY.CRITICAL, SEVERITY.WARNING, SEVERITY.INFO]).toContain(a.severity);
      expect(a.module).toBeTruthy();
      expect(a.target).toBeTruthy();
    });
  });
});

describe('alert summary', () => {
  it('counts by severity and ignores resolved alerts', () => {
    const summary = summariseAlerts([
      { id: '1', severity: SEVERITY.CRITICAL, active: true, acknowledged: false },
      { id: '2', severity: SEVERITY.CRITICAL, active: true, acknowledged: true },
      { id: '3', severity: SEVERITY.WARNING, active: true, acknowledged: false },
      { id: '4', severity: SEVERITY.CRITICAL, active: false, acknowledged: false },
    ]);
    expect(summary.total).toBe(3);       // the resolved one is excluded
    expect(summary.critical).toBe(2);
    expect(summary.warning).toBe(1);
    expect(summary.unacknowledged).toBe(2);
  });

  it('returns zeroes for an empty list', () => {
    expect(summariseAlerts([])).toEqual({ total: 0, critical: 0, warning: 0, unacknowledged: 0 });
    expect(summariseAlerts(null)).toEqual({ total: 0, critical: 0, warning: 0, unacknowledged: 0 });
  });
});
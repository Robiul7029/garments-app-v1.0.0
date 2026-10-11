/**
 * ROBIUL GARMENTS ERP — alert engine.
 *
 * Alerts are derived from the operational data by business rules, never typed in
 * by hand. Each rule is a pure function of the rows it cares about, so the whole
 * engine is testable and the same rule runs in three places: on dashboard load,
 * after any write that could change its verdict, and (in Phase 6) on a schedule
 * from Cloud Functions.
 *
 * Alerts are stored so they can be acknowledged and deep-linked, and they carry
 * a `fingerprint`: the stable identity of "this exact problem". Re-running the
 * engine therefore updates an existing alert instead of raising a new one every
 * time the page is opened — which is what stops the list filling with duplicates.
 */
import {
  addDoc, collection, doc, getDocs, query, serverTimestamp,
  setDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { C, SEVERITY } from '../config/erpSchema';
import {
  toNumber, LEVEL_DOT, delayDaysAgainst, parseDate,
} from '../utils/erpCalculations';

export const ALERT_RULE = {
  LINE_BELOW_TARGET: 'line_below_target',
  QC_REJECT_ABOVE_LIMIT: 'qc_reject_above_limit',
  FABRIC_STOCK_LOW: 'fabric_stock_low',
  MACHINE_BREAKDOWN: 'machine_breakdown',
  PO_SHIPMENT_DELAY_RISK: 'po_shipment_delay_risk',
  ORDER_TNA_DELAY: 'order_tna_delay',
};

// ---- Rule thresholds -------------------------------------------------------
// Tuned for a mid-size knit/woven factory. Stored in one object so they can be
// changed for a specific factory without touching the logic.
export const THRESHOLDS = {
  lineCriticalPercent: 70,   // 🔴 below this achievement in any hour
  lineWarningPercent: 85,    // 🟠 below this achievement in any hour
  qcRejectLimitPercent: 5,   // QC reject above this % of checked is an alert
  shipmentRiskDays: 3,       // a PO due within N days and not fully shipped
  tnaDelayDays: 2,           // a TNA task this many days past its plan
  stockCriticalRatio: 1.0,   // at or below min qty
  stockWarningRatio: 1.5,    // within 50% of max qty
};

// ---- Rules -----------------------------------------------------------------
// Each returns an array of alert descriptors: { fingerprint, severity, title,
// message, module, target, meta }. Pure; no database access.

/**
 * 🔴 Line 03 — Production Below Target
 * Fires per line per hour when production misses its target. Grouped by day so
 * the dashboard shows one line, not twelve hourly rows.
 */
export function ruleLineBelowTarget(productionRows = [], lines = []) {
  const nameOf = (id) => lines.find((l) => l.id === id)?.name || lines.find((l) => l.id === id)?.lineNo || 'Unknown line';
  const alerts = [];

  const byLineDay = {};
  productionRows.forEach((row) => {
    const key = `${row.lineId}|${row.date}`;
    if (!byLineDay[key]) byLineDay[key] = { lineId: row.lineId, date: row.date, target: 0, actual: 0, worst: Infinity };
    byLineDay[key].target += toNumber(row.target);
    byLineDay[key].actual += toNumber(row.actual);
    const pct = toNumber(row.target) > 0 ? (toNumber(row.actual) / toNumber(row.target)) * 100 : 100;
    if (pct < byLineDay[key].worst) byLineDay[key].worst = pct;
  });

  Object.values(byLineDay).forEach((group) => {
    const pct = group.target > 0 ? (group.actual / group.target) * 100 : 100;
    // The two thresholds are read in order (critical below 70, warning below 85)
    // rather than through performanceLevel, whose good/warning/critical bands are
    // the wrong way round for this rule: here a shortfall escalates as the number
    // falls, and performanceLevel escalates as it rises.
    const level = pct < THRESHOLDS.lineCriticalPercent ? 'critical'
      : pct < THRESHOLDS.lineWarningPercent ? 'warning'
        : 'good';
    if (level === 'good') return;
    const lineName = nameOf(group.lineId);
    alerts.push({
      fingerprint: `${ALERT_RULE.LINE_BELOW_TARGET}|${group.lineId}|${group.date}`,
      severity: level === 'critical' ? SEVERITY.CRITICAL : SEVERITY.WARNING,
      title: `${LEVEL_DOT[level]} ${lineName} — Production Below Target`,
      message: `${group.actual} pcs produced against a target of ${group.target} (${pct.toFixed(1)}%) on ${group.date}.`,
      module: 'production',
      target: `/erp/production/${group.lineId}`,
      meta: { lineId: group.lineId, date: group.date, achievement: Math.round(pct) },
    });
  });

  return alerts;
}

/** 🟠 QC Reject Above Limit */
export function ruleQcRejectAboveLimit(qcRows = []) {
  const totals = {};
  qcRows.forEach((row) => {
    const key = `${row.date}|${row.lineId || 'all'}`;
    if (!totals[key]) totals[key] = { checked: 0, reject: 0, date: row.date, lineId: row.lineId };
    totals[key].checked += toNumber(row.checkedQty);
    totals[key].reject += toNumber(row.rejectQty);
  });

  return Object.values(totals)
    .filter((t) => t.checked > 0 && (t.reject / t.checked) * 100 > THRESHOLDS.qcRejectLimitPercent)
    .map((t) => {
      const pct = ((t.reject / t.checked) * 100).toFixed(1);
      return {
        fingerprint: `${ALERT_RULE.QC_REJECT_ABOVE_LIMIT}|${t.lineId}|${t.date}`,
        severity: SEVERITY.WARNING,
        title: `🟠 QC Reject Above Limit — ${pct}%`,
        message: `${t.reject} rejects out of ${t.checked} inspected on ${t.date} exceeds the ${THRESHOLDS.qcRejectLimitPercent}% limit.`,
        module: 'quality',
        target: '/erp/quality',
        meta: { date: t.date, lineId: t.lineId, rejectPercent: Number(pct) },
      };
    });
}

/**
 * 🔴 Fabric Stock Low
 * `stockByItem` maps itemId → current quantity derived from the ledger.
 */
export function ruleStockLow(items = [], stockByItem = {}) {
  return items
    .filter((item) => item.active !== false)
    .map((item) => {
      const qty = toNumber(stockByItem[item.id]);
      const min = toNumber(item.minQty);
      const max = toNumber(item.maxQty);
      if (min <= 0 && max <= 0) return null;
      let severity = null;
      if (min > 0 && qty <= min) severity = SEVERITY.CRITICAL;
      else if (max > 0 && qty <= max * (THRESHOLDS.stockWarningRatio / 2)) severity = SEVERITY.WARNING;
      if (!severity) return null;
      return {
        fingerprint: `${ALERT_RULE.FABRIC_STOCK_LOW}|${item.id}`,
        severity,
        title: `${severity === SEVERITY.CRITICAL ? '🔴' : '🟠'} ${item.name} — Stock Low`,
        message: `${qty} ${item.unit || 'pcs'} in stock (minimum ${min}, maximum ${max}).`,
        module: 'inventory',
        target: '/erp/inventory',
        meta: { itemId: item.id, currentQty: qty, minQty: min, maxQty: max },
      };
    })
    .filter(Boolean);
}

/** 🔴 Machine M-024 — Breakdown */
export function ruleMachineBreakdown(maintenanceRows = [], machines = []) {
  const machineOf = (id) => machines.find((m) => m.id === id);
  return maintenanceRows
    .filter((r) => r.type === 'Breakdown' && (r.status === 'Open' || r.status === 'In Progress'))
    .map((r) => {
      const machine = machineOf(r.machineId);
      const code = machine?.machineCode || r.machineId;
      return {
        fingerprint: `${ALERT_RULE.MACHINE_BREAKDOWN}|${r.machineId}`,
        severity: SEVERITY.CRITICAL,
        title: `🔴 Machine ${code} — Breakdown`,
        message: `${r.description || 'Breakdown reported'} · reported by ${r.reportedBy || 'unknown'}${r.technician ? ` · technician: ${r.technician}` : ''}.`,
        module: 'maintenance',
        target: `/erp/maintenance/${r.machineId}`,
        meta: { machineId: r.machineId, requestId: r.id, status: r.status },
      };
    });
}

/** 🟠 PO-105 — Shipment Delay Risk */
export function ruleShipmentDelayRisk(purchaseOrders = [], today = new Date(), todayKey) {
  const alerts = [];
  purchaseOrders.forEach((po) => {
    if (po.status === 'Completed' || po.status === 'Cancelled' || po.status === 'Shipped') return;
    const due = parseDate(po.shipmentDate);
    const now = parseDate(today);
    if (!due || !now) return;
    const daysLeft = Math.round((due - now) / 86400000);
    if (daysLeft > THRESHOLDS.shipmentRiskDays) return;
    if (toNumber(po.shippedQty) >= toNumber(po.totalQty) && toNumber(po.totalQty) > 0) return;
    const overdue = daysLeft < 0;
    alerts.push({
      fingerprint: `${ALERT_RULE.PO_SHIPMENT_DELAY_RISK}|${po.id}`,
      severity: overdue ? SEVERITY.CRITICAL : SEVERITY.WARNING,
      title: `${overdue ? '🔴' : '🟠'} ${po.poNo} — Shipment Delay Risk`,
      message: overdue
        ? `Shipment date passed ${Math.abs(daysLeft)} day(s) ago. ${toNumber(po.shippedQty)} of ${toNumber(po.totalQty)} pcs shipped.`
        : `Shipment due in ${daysLeft} day(s). ${toNumber(po.shippedQty)} of ${toNumber(po.totalQty)} pcs shipped.`,
      module: 'orders',
      target: `/erp/orders/${po.id}`,
      meta: { poId: po.id, poNo: po.poNo, daysLeft, shipmentDate: todayKey ? todayKey(po.shipmentDate) : '' },
    });
  });
  return alerts;
}

/** 🟠 Order PO-109 — TNA Delay */
export function ruleTnaDelay(tnaTasks = [], orders = [], today = new Date()) {
  const orderNo = (id) => {
    const order = orders.find((o) => o.id === id);
    return order?.orderNo || order?.id || 'Order';
  };
  return tnaTasks
    // The delay is computed from the planned date below, not read from a stored
    // `delayDays` field: a task that has slipped since it was last written has no
    // delayDays value yet, and filtering on that field here silently dropped
    // exactly the overdue tasks this rule exists to report.
    .filter((t) => t.status !== 'Completed')
    .map((t) => {
      const daysLate = delayDaysAgainst(t.plannedDate, today);
      if (daysLate <= 0 && !t.isCritical) return null;
      const late = daysLate > THRESHOLDS.tnaDelayDays || t.status === 'Delayed';
      return {
        fingerprint: `${ALERT_RULE.ORDER_TNA_DELAY}|${t.id}`,
        severity: late ? SEVERITY.WARNING : SEVERITY.INFO,
        title: `${late ? '🟠' : '🟢'} ${orderNo(t.orderId)} — ${t.stage}${t.isCritical ? ' (Critical Path)' : ''}`,
        message: daysLate > 0
          ? `${t.stage} is ${daysLate} day(s) past its planned date of ${t.plannedDate}.`
          : `${t.stage} is on the critical path.`,
        module: 'planning',
        target: `/erp/planning/${t.orderId}`,
        meta: { taskId: t.id, orderId: t.orderId, daysLate },
      };
    })
    .filter(Boolean);
}

export const ALL_RULES = [
  ruleLineBelowTarget,
  ruleQcRejectAboveLimit,
  ruleStockLow,
  ruleMachineBreakdown,
  ruleShipmentDelayRisk,
  ruleTnaDelay,
];

/**
 * Runs every rule over a snapshot of operational data and returns the alert
 * descriptors. The caller decides when to persist them.
 */
export function evaluateAllRules(snapshot = {}) {
  const {
    productionRows = [], lines = [], qcRows = [], items = [],
    stockByItem = {}, maintenanceRows = [], machines = [], purchaseOrders = [],
    tnaTasks = [], orders = [], today = new Date(),
  } = snapshot;

  return [
    ...ruleLineBelowTarget(productionRows, lines),
    ...ruleQcRejectAboveLimit(qcRows),
    ...ruleStockLow(items, stockByItem),
    ...ruleMachineBreakdown(maintenanceRows, machines),
    ...ruleShipmentDelayRisk(purchaseOrders, today),
    ...ruleTnaDelay(tnaTasks, orders, today),
  ];
}

// ---- Persistence -----------------------------------------------------------

/**
 * Writes the evaluated alerts, updating existing ones by fingerprint and
 * removing any that are no longer raised. This is what makes the alert list
 * self-cleaning: fix the line and the alert disappears on its own.
 *
 * @returns {Promise<{ raised:number, resolved:number, error:string }>}
 */
export async function syncAlerts(descriptors = []) {
  try {
    const existingSnap = await getDocs(query(collection(db, C.ALERTS)));
    const existingByPrint = {};
    existingSnap.docs.forEach((d) => {
      const fingerprint = d.data()?.fingerprint;
      if (fingerprint) existingByPrint[fingerprint] = { id: d.id, data: d.data() };
    });

    const incoming = new Set(descriptors.map((d) => d.fingerprint));
    let raised = 0;

    for (const d of descriptors) {
      const current = existingByPrint[d.fingerprint];
      const base = {
        fingerprint: d.fingerprint,
        rule: d.fingerprint.split('|')[0],
        severity: d.severity,
        title: d.title,
        message: d.message,
        module: d.module,
        target: d.target,
        meta: d.meta || {},
        active: true,
      };
      if (current) {
        // Only rewrite when something a user sees actually changed, so the
        // "raisedAt" stamp stays meaningful instead of resetting on every load.
        const changed = current.data.severity !== d.severity
          || current.data.message !== d.message
          || current.data.active === false;
        if (changed) {
          await setDoc(doc(db, C.ALERTS, current.id), { ...base, acknowledged: current.data.acknowledged || false, updatedAt: serverTimestamp() }, { merge: true });
        } else if (current.data.active === false) {
          await updateDoc(doc(db, C.ALERTS, current.id), { active: true, updatedAt: serverTimestamp() });
        }
      } else {
        await addDoc(collection(db, C.ALERTS), {
          ...base,
          active: true,
          acknowledged: false,
          raisedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        raised += 1;
      }
    }

    let resolved = 0;
    for (const [fingerprint, entry] of Object.entries(existingByPrint)) {
      if (incoming.has(fingerprint) || entry.data.active === false) continue;
      await updateDoc(doc(db, C.ALERTS, entry.id), { active: false, resolvedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      resolved += 1;
    }

    return { raised, resolved, error: '' };
  } catch (error) {
    console.error('[Alerts] sync failed:', error?.message || error);
    return { raised: 0, resolved: 0, error: error?.message || 'Alert sync failed.' };
  }
}

/** Marks an alert as seen/acknowledged by a user. */
export async function acknowledgeAlert(alertId, userName = '') {
  try {
    await updateDoc(doc(db, C.ALERTS, alertId), {
      acknowledged: true,
      acknowledgedBy: userName,
      acknowledgedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error('[Alerts] acknowledge failed:', error?.message || error);
    return false;
  }
}

/** Alert summary counts for the dashboard badge. */
export function summariseAlerts(alerts = []) {
  const active = (Array.isArray(alerts) ? alerts : []).filter((a) => a.active !== false);
  return {
    total: active.length,
    critical: active.filter((a) => a.severity === SEVERITY.CRITICAL).length,
    warning: active.filter((a) => a.severity === SEVERITY.WARNING).length,
    unacknowledged: active.filter((a) => !a.acknowledged).length,
  };
}
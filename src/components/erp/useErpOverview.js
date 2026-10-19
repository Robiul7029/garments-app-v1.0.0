import { useEffect, useMemo, useState } from 'react';
import { MODULE } from '../../config/erpRoles';
import { C, ORDER_STATUS } from '../../config/erpSchema';
import { COLLECTIONS } from '../../config/orderWorkflow';
import { usePermissions } from '../../context/PermissionContext';
import { useErpData } from '../../context/ErpDataContext';
import { useData } from '../../context/DataContext';
import {
  summariseProductionDay, performanceLevel, toNumber, toDateKey, efficiencyPercent,
} from '../../utils/erpCalculations';
import { summariseStock, daysUntil } from '../../utils/erpDashboard';
import { isActiveOrder, isEligibleForAutomaticStatus, resolveOrderStatus } from '../../utils/orderStatus';
import { rowOutput } from '../../config/productionAggregation';

/**
 * ROBIUL GARMENTS ERP — overview aggregation.
 *
 * One hook, used by the Dashboard, Order Management and Inventory screens, so
 * the three of them can never disagree about a number. Everything is derived
 * from live `onSnapshot` rows; nothing is recomputed in a screen.
 *
 * The window is bounded on purpose — 500 production rows, 200 ledger rows — and
 * every trend is folded out of those rows rather than issued as another query.
 * A factory that produces for a year still opens this in the same time.
 */

/** Statuses that mean a purchase order is finished, whatever the date says. */
const CLOSED_STATUSES = ['Cancelled', 'Completed', 'Shipped'];

/** Shared status switch: only subscribe to what the role may actually read. */
export function useErpSources() {
  const permissions = usePermissions();
  const erp = useErpData();

  const sources = useMemo(() => ([
    { key: 'lines', collection: C.PRODUCTION_LINES, pageSize: 100, needs: MODULE.PRODUCTION },
    { key: 'production', collection: C.HOURLY_PRODUCTION, pageSize: 500, needs: MODULE.PRODUCTION },
    { key: 'dailyProduction', collection: C.DAILY_PRODUCTION, pageSize: 500, needs: MODULE.PRODUCTION },
    { key: 'shifts', collection: C.LINE_SHIFTS, pageSize: 200, needs: MODULE.PRODUCTION },
    { key: 'purchaseOrders', collection: C.PURCHASE_ORDERS, pageSize: 200, needs: MODULE.ORDERS },
    { key: 'orders', collection: C.ORDERS, pageSize: 200, needs: MODULE.ORDERS },
    { key: 'buyers', collection: C.BUYERS, pageSize: 200, needs: MODULE.ORDERS },
    { key: 'endLineQc', collection: C.END_LINE_QC, pageSize: 200, needs: MODULE.QUALITY },
    { key: 'items', collection: C.ITEMS, pageSize: 300, needs: MODULE.INVENTORY },
    { key: 'stock', collection: C.STOCK_LEDGER, pageSize: 500, needs: MODULE.INVENTORY },
    { key: 'stores', collection: C.STORES, pageSize: 50, needs: MODULE.INVENTORY },
    { key: 'alerts', collection: C.ALERTS, pageSize: 200, needs: MODULE.ALERTS },
  ].filter((s) => permissions.can(s.needs))), [permissions]);

  useEffect(() => {
    const subs = sources.map((s) => erp.subscribe(s.key, s));
    return () => subs.forEach((off) => off());
  }, [sources, erp.subscribe]);

  const loading = sources.some((s) => erp.isLoading(s.key));
  const error = sources.map((s) => erp.errorFor(s.key)).find(Boolean) || '';

  return { permissions, erp, sources, loading, error };
}

/** The current day as YYYY-MM-DD, re-evaluated so a screen open at midnight rolls over. */
export function useToday() {
  const [today, setToday] = useState(() => toDateKey(new Date()));
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = toDateKey(new Date());
      setToday((prev) => (prev === now ? prev : now));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return today;
}

/** Local YYYY-MM-DD, tolerant of Firestore Timestamps, ISO strings and Date. */
export function toDatePart(value) {
  if (!value) return '';
  return toDateKey(value);
}

/**
 * Every derived figure the overview screens need, from the live rows.
 *
 * Returns today's production totals, per-line performance, a 7-day trend, the
 * order pipeline, the stock position and the alert summary. All memos.
 */
export function useErpOverview(today) {
  const erp = useErpData();
  const permissions = usePermissions();
  // The order master (Order Management → Order Input) is written to the app's
  // own store (`DataContext` → localStorage, collection `order-model`), NOT to
  // Firestore. Reading it here is what lets the Management Dashboard and Order
  // Management share ONE order book: a PO raised on the Order Input screen shows
  // on the dashboard without a second, parallel order list to reconcile. The
  // provider sits ABOVE this one in App.jsx, so this hook can always read it.
  const legacyData = useData();

  const canInventory = permissions.canView(MODULE.INVENTORY);

  const lines = erp.rows('lines');
  const allProduction = erp.rows('production');
  const dailyProduction = erp.rows('dailyProduction');
  const shifts = erp.rows('shifts');
  const purchaseOrders = erp.rows('purchaseOrders');
  // Order master rows come from the app's own store; guard the reader so a screen
  // rendered outside the DataProvider (a unit test, a deep link) still works.
  const orders = useMemo(
    () => (legacyData?.getData ? legacyData.getData(COLLECTIONS.ORDERS) : []),
    [legacyData],
  );
  const buyers = erp.rows('buyers');
  const qcRows = erp.rows('endLineQc');
  const items = erp.rows('items');
  const stockRows = erp.rows('stock');
  const alerts = erp.rows('alerts');

  const todayProduction = useMemo(
    () => allProduction.filter((r) => toDatePart(r.date) === today),
    [allProduction, today]
  );
  const todayDailyProduction = useMemo(
    () => dailyProduction.filter((r) => toDatePart(r.date) === today),
    [dailyProduction, today],
  );
  const standaloneDailyProduction = useMemo(
    () => todayDailyProduction.filter((row) => row.source !== 'hourly'),
    [todayDailyProduction],
  );
  // Hourly-derived daily copies are excluded to avoid duplicate totals; standalone
  // daily log entries supplement the hourly records.
  const productionForTotals = [...todayProduction, ...standaloneDailyProduction];

  // ---- Production ---------------------------------------------------------
  const totals = useMemo(() => summariseProductionDay(productionForTotals), [productionForTotals]);

  const linePerformance = useMemo(() => {
    const byLine = {};
    productionForTotals.forEach((row) => {
      const id = row.lineId || 'unassigned';
      (byLine[id] = byLine[id] || []).push(row);
    });
    return Object.entries(byLine).map(([lineId, rows]) => {
      const line = lines.find((l) => l.id === lineId);
      return {
        lineId,
        name: line?.name || line?.lineNo || 'Unassigned line',
        ...summariseProductionDay(rows),
      };
    }).sort((a, b) => a.achievement - b.achievement); // worst first: the line to walk to
  }, [productionForTotals, lines]);

  const lineChartData = useMemo(
    () => linePerformance.slice(0, 8).map((line) => ({
      id: line.lineId,
      label: line.name,
      target: line.target,
      actual: line.actual,
      level: line.level,
    })),
    [linePerformance]
  );

  /**
   * Seven days ending today, built from the production window already held.
   * Every KPI sparkline on every screen draws from this one pass.
   */
  const trend = useMemo(() => {
    const days = [];
    const base = new Date(`${today}T00:00:00`);
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      days.push(toDateKey(d));
    }
    const blank = () => days.map(() => 0);
    const target = blank();
    const actual = blank();
    const downtime = blank();
    const manpower = blank();
    const smv = blank();
    const rowsPerDay = blank();
    const checked = blank();
    const defects = blank();

    allProduction.forEach((row) => {
      const i = days.indexOf(toDatePart(row.date));
      if (i < 0) return;
      rowsPerDay[i] += 1;
      target[i] += toNumber(row.target);
      actual[i] += toNumber(row.actual);
      downtime[i] += toNumber(row.downtimeMin);
      // Manpower and SMV are headcounts, not hourly totals: take the day's peak,
      // exactly as summariseProductionDay does, so the two never diverge.
      manpower[i] = Math.max(manpower[i], toNumber(row.manpower));
      smv[i] = Math.max(smv[i], toNumber(row.smv));
    });

    qcRows.forEach((row) => {
      const i = days.indexOf(toDatePart(row.date));
      if (i < 0) return;
      checked[i] += toNumber(row.checkedQty);
      defects[i] += toNumber(row.reworkQty) + toNumber(row.rejectQty);
    });

    return {
      days,
      target,
      actual,
      downtime,
      achievement: days.map((_, i) => (target[i] > 0 ? Math.round((actual[i] / target[i]) * 1000) / 10 : 0)),
      efficiency: days.map((_, i) => efficiencyPercent({
        actual: actual[i], smv: smv[i], manpower: manpower[i], availableMinutes: rowsPerDay[i] * 60,
      })),
      dhu: days.map((_, i) => (checked[i] > 0 ? Math.round((defects[i] / checked[i]) * 10000) / 100 : 0)),
    };
  }, [allProduction, qcRows, today]);

  // ---- Manpower -----------------------------------------------------------
  const manpower = useMemo(() => {
    const todayShifts = shifts.filter((s) => toDatePart(s.date) === today);
    const total = todayShifts.reduce((s, r) => s + toNumber(r.manpower), 0);
    const present = todayShifts.reduce((s, r) => s + toNumber(r.presentCount), 0);
    return { total, present, absent: Math.max(0, total - present) };
  }, [shifts, today]);

  const presentTrend = useMemo(() => trend.days.map((day) => (
    shifts
      .filter((s) => toDatePart(s.date) === day)
      .reduce((sum, s) => sum + toNumber(s.presentCount), 0)
  )), [trend.days, shifts]);

  // ---- Quality ------------------------------------------------------------
  const quality = useMemo(() => {
    const todayQc = qcRows.filter((r) => toDatePart(r.date) === today);
    const checked = todayQc.reduce((s, r) => s + toNumber(r.checkedQty), 0);
    const passed = todayQc.reduce((s, r) => s + toNumber(r.passedQty), 0);
    const failed = todayQc.reduce((s, r) => s + toNumber(r.failedQty), 0);
    const rework = todayQc.reduce((s, r) => s + toNumber(r.reworkQty), 0);
    const reject = todayQc.reduce((s, r) => s + toNumber(r.rejectQty), 0);
    return {
      checked, passed, failed, rework, reject,
      dhu: checked > 0 ? Math.round(((rework + reject) / checked) * 10000) / 100 : 0,
      rejectPct: checked > 0 ? (reject / checked) * 100 : 0,
    };
  }, [qcRows, today]);

  // ---- Orders -------------------------------------------------------------
  //
  // The order book is built from BOTH collections Order Management writes to:
  //
  //   purchaseOrders  the shipping side — `totalQty`, `shippedQty`, `shipmentDate`
  //   orders          the order master  — `orderNo`, `orderDate`, `deliveryDate`,
  //                   `totalQty`, `status`
  //
  // A PO that links to a master is merged into one row; a master with no PO of its
  // own is still listed (that is the common case on a deployment where the plan is
  // entered before the PO is raised). Building from POs alone silently dropped any
  // order that only existed in the master — which is what made the Active Orders
  // counter read zero while the Order Management list showed two.
  const orderRows = useMemo(() => {
    const orderById = {};
    orders.forEach((o) => { orderById[o.id] = o; });
    const buyerNames = {};
    buyers.forEach((b) => { buyerNames[b.id] = b.name || b.buyerCode || b.id; });

    const cumulativeProduction = [
      ...allProduction,
      ...dailyProduction.filter((row) => row.source !== 'hourly'),
    ];

    /** Production recorded against one identity set (PO ids + order numbers). */
    const producedFor = (linkedIds, linkedNumbers) => cumulativeProduction
      .filter((row) => (
        linkedIds.has(String(row.purchaseOrderId || row.poId || row.orderId || ''))
        || linkedNumbers.has(String(row.poNo || row.order_no || ''))
      ))
      .reduce((sum, row) => sum + rowOutput(row), 0);

    /** One unified row, from either source. */
    const buildRow = (source, master) => {
      const order = master || {};
      const buyerId = source.buyerId || order.buyerId;
      // Quantity: the ERP purchase order's `totalQty`, or the order master's own
      // `qty` (the key `OrderInput` writes). Either is the PO quantity.
      const total = toNumber(
        source.totalQty ?? source.poQty ?? order.totalQty ?? order.qty ?? source.qty,
      );
      const shipped = toNumber(source.shippedQty ?? order.shippedQty);

      const linkedOrderIds = new Set([source.id, source.orderId, order.id].filter(Boolean).map(String));
      const relatedOrders = orders.filter((candidate) => (
        String(candidate.id) === String(source.orderId)
        || (source.orderNo && String(candidate.orderNo) === String(source.orderNo))
        || (source.order_no && String(candidate.order_no) === String(source.order_no))
      ));
      const linkedOrderNumbers = new Set([
        source.poNo, source.orderNo, source.order_no,
        ...relatedOrders.map((candidate) => candidate.poNo || candidate.orderNo || candidate.order_no),
      ].filter(Boolean).map(String));
      const produced = producedFor(linkedOrderIds, linkedOrderNumbers);
      const fulfilled = Math.max(shipped, produced);

      // The window. The order master's own keys first (both the ERP schema's
      // `orderDate` / `deliveryDate` and the app store's `start_date` / `ship_date`),
      // then the PO spellings, so EVERY write shape is understood. Read from the
      // source itself as well as the joined master, because an order-master row
      // with no PO is its own source. A missing bound is open, never a rejection.
      const start = order.orderDate || order.start_date || order.order_date
        || source.orderDate || source.start_date || source.order_date || source.poDate || '';
      const due = order.deliveryDate || order.ship_date || order.delivery_date
        || source.deliveryDate || source.ship_date || source.delivery_date || source.shipmentDate || '';

      // The status is resolved against the SAME window the active rule uses, so
      // the badge and the counter can never disagree.
      const statusState = resolveOrderStatus(
        { ...source, startDate: start, shipmentDate: due, producedQty: fulfilled },
        today,
      );
      const eligibleForAuto = isEligibleForAutomaticStatus(source.status || ORDER_STATUS.NEW);
      const effectiveStatus = source.manualStatusOverride
        ? (source.status || ORDER_STATUS.NEW)
        : (eligibleForAuto ? statusState.status : (source.status || ORDER_STATUS.NEW));
      const progress = total > 0 ? Math.min(100, Math.round((Math.max(shipped, fulfilled) / total) * 100)) : 0;
      const status = effectiveStatus;
      const daysLeft = daysUntil(due, today);
      const open = isActiveOrder(
        { ...source, startDate: start, shipmentDate: due, producedQty: fulfilled, status: effectiveStatus },
        today,
      );
      const overdue = open && daysLeft !== null && daysLeft < 0;
      const dueSoon = open && daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
      // Identity is resolved defensively: a row missing `poNo` / `orderNo` falls
      // back to the style, then the document id, so the table and the count never
      // lose an order to a blank label.
      const orderNo = source.poNo || source.orderNo || source.order_no || order.orderNo
        || order.styleNo || order.style || source.styleNo || source.style || source.id || '—';
      return {
        id: source.id ?? order.id,
        poNo: orderNo,
        orderNo,
        styleNo: order.styleNo || order.style || source.styleNo || source.style || '',
        buyer: buyerNames[buyerId] || order.buyer || source.buyer || buyerId || '—',
        start,
        due,
        daysLeft,
        total,
        shipped,
        fulfilled,
        produced,
        progress,
        status,
        rawStatus: source.status || ORDER_STATUS.NEW,
        overdue,
        dueSoon,
        open,
        autoStatus: !source.manualStatusOverride && eligibleForAuto ? statusState.autoStatus : '',
        level: overdue ? 'critical' : dueSoon ? 'warning' : progress >= 100 ? 'good' : 'info',
      };
    };

    const rows = purchaseOrders.map((po) => buildRow(po, orderById[po.orderId]));

    // Every order-master row is listed too. A row already represented by a PO (by
    // linked id or by order number) is skipped so the same order is never counted
    // twice; everything else — the common case, a plan entered before its PO — is
    // added on its own. This is what makes the count reflect the Order Management
    // list even when no purchase order exists yet.
    const claimedOrderIds = new Set(
      purchaseOrders.map((po) => String(po.orderId || '')).filter(Boolean),
    );
    const claimedOrderNos = new Set(
      purchaseOrders.flatMap((po) => [po.poNo, po.orderNo, po.order_no])
        .filter(Boolean).map(String),
    );
    orders.forEach((order) => {
      if (claimedOrderIds.has(String(order.id))) return;
      const orderKeys = [order.orderNo, order.order_no].filter(Boolean).map(String);
      if (orderKeys.some((k) => claimedOrderNos.has(k))) return;
      rows.push(buildRow(order, order));
    });

    return rows.sort((a, b) => {
      const rank = (r) => (r.overdue ? 0 : r.dueSoon ? 1 : r.level === 'good' ? 3 : 2);
      return rank(a) - rank(b) || String(a.due || '9999').localeCompare(String(b.due || '9999'));
    });
  }, [purchaseOrders, orders, buyers, today, allProduction, dailyProduction]);

  const orderStats = useMemo(() => ({
    total: orderRows.length,
    delayed: orderRows.filter((r) => r.overdue).length,
    dueSoon: orderRows.filter((r) => r.dueSoon).length,
    pending: orderRows.filter((r) => r.open).length,
    quantity: orderRows.reduce((s, r) => s + r.total, 0),
  }), [orderRows]);

  const orderDonut = useMemo(() => {
    const buckets = {
      Overdue: { value: 0, color: '#f87171' },
      'Due within 7 days': { value: 0, color: '#fbbf24' },
      'On schedule': { value: 0, color: '#38bdf8' },
      Completed: { value: 0, color: '#34d399' },
    };
    orderRows.forEach((r) => {
      const key = r.overdue ? 'Overdue' : r.dueSoon ? 'Due within 7 days' : r.level === 'good' ? 'Completed' : 'On schedule';
      buckets[key].value += 1;
    });
    return Object.entries(buckets).map(([label, b]) => ({ label, ...b }));
  }, [orderRows]);

  const delayedTrend = useMemo(() => trend.days.map((day) => (
    orderRows.filter((r) => r.due && daysUntil(r.due, day) < 0).length
  )), [trend.days, orderRows]);

  // ---- Inventory ----------------------------------------------------------
  // Never computed for a role that may not read the store: empty rows are empty
  // anyway, and a stock graph pretending to be real data is worse than none.
  const stock = useMemo(
    () => (canInventory ? summariseStock(items, stockRows) : { byItem: [], low: [], totalQty: 0, totalValue: 0 }),
    [canInventory, items, stockRows]
  );

  /**
   * Items below minimum, per day, replayed from the ledger's own history.
   * Only counts are needed for the sparkline, so this walks each movement
   * forward once rather than re-joining the whole ledger for every day.
   */
  const lowStockTrend = useMemo(() => {
    if (!canInventory) return trend.days.map(() => 0);
    const minByItem = new Map();
    items.forEach((item) => minByItem.set(item.id, toNumber(item.minQty)));
    const balance = new Map();
    const sorted = [...stockRows].sort((a, b) => toDatePart(a.date).localeCompare(toDatePart(b.date)));
    return trend.days.map((day) => {
      sorted.forEach((entry) => {
        if (!entry?.itemId || toDatePart(entry.date) > day) return;
        const next = (balance.get(entry.itemId) || 0) + toNumber(entry.qtyIn) - toNumber(entry.qtyOut);
        balance.set(entry.itemId, Math.max(0, next));
      });
      let low = 0;
      balance.forEach((qty, itemId) => {
        const min = minByItem.get(itemId) || 0;
        if (min > 0 && qty <= min) low += 1;
      });
      return low;
    });
  }, [canInventory, items, stockRows, trend.days]);

  // ---- Alerts -------------------------------------------------------------
  const activeAlerts = useMemo(
    () => alerts.filter((a) => a.active !== false),
    [alerts]
  );

  const topAlerts = useMemo(() => [...activeAlerts].sort((a, b) => (
    severityRank(a.severity) - severityRank(b.severity)
    || String(b.raisedAt || '').localeCompare(String(a.raisedAt || ''))
  )).slice(0, 6), [activeAlerts]);

  const alertSummary = useMemo(() => ({
    total: activeAlerts.length,
    critical: activeAlerts.filter((a) => a.severity === 'critical').length,
    warning: activeAlerts.filter((a) => a.severity === 'warning').length,
  }), [activeAlerts]);

  // The KPI grid reads one object, so a card never reaches into three sources.
  const kpiTrend = useMemo(() => ({
    ...trend,
    present: presentTrend,
    delayed: delayedTrend,
    lowStock: lowStockTrend,
  }), [trend, presentTrend, delayedTrend, lowStockTrend]);

  return {
    canInventory,
    lines, allProduction, dailyProduction, shifts, qcRows, items, stockRows,
    todayProduction: productionForTotals, totals, linePerformance, lineChartData, trend, kpiTrend,
    manpower, quality, orderRows, orderStats, orderDonut, stock, topAlerts, alertSummary,
    liveCounts: {
      lines: lines.length,
      production: productionForTotals.length,
      hourlyProduction: allProduction.length,
      dailyProduction: dailyProduction.length,
      shifts: shifts.length,
      purchaseOrders: purchaseOrders.length,
      orders: orders.length,
      buyers: buyers.length,
      endLineQc: qcRows.length,
      items: items.length,
      stock: stockRows.length,
      alerts: alerts.length,
    },
  };
}

/** 🔴 before 🟠 before 🔵. */
export function severityRank(severity) {
  return severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2;
}

/** The level word for a line, never the colour alone. */
export function statusWord(level) {
  return level === 'good' ? 'On target' : level === 'warning' ? 'Below target' : 'Critical';
}

export { performanceLevel };

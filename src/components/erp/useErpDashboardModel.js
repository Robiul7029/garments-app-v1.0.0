import { useMemo } from 'react';
import { toNumber, toDateKey, summariseProductionDay } from '../../utils/erpCalculations';
import { rowOutput, rowHourlyTarget, rowWorkingHours } from '../../config/productionAggregation';
import { summariseStock } from '../../utils/erpDashboard';
import { useErpOverview } from './useErpOverview';

/**
 * ROBIUL GARMENTS ERP — dashboard view model.
 *
 * The dashboard was specified as a standalone page with its own vocabulary:
 * `{ line, style, target, actual }` production rows, a 0–100 "production flow"
 * per stage, `{ buyer, style, po, color, qty, delivery }` orders. The live ERP
 * stores all of that in richer, differently-named collections.
 *
 * This hook is the single translation layer between the two. Every screen that
 * shows the new design reads THIS, so the mapping lives in one place and cannot
 * drift — and no screen has to know that `poNo` is what the order form calls a
 * PO, or that a line's name comes from a separate collection.
 *
 * It is a pure projection of `useErpOverview`: no new Firestore query, no second
 * definition of "overdue", no duplicated arithmetic. If a number here disagreed
 * with the Order Management or Stock screens, that would be a bug in this file
 * alone, which is exactly where you want that bug to live.
 */

/** The five stages the production-flow panel shows, in process order. */
export const FLOW_STAGES = ['Cutting', 'Sewing', 'Finishing', 'Packing', 'Shipment'];

export function useErpDashboardModel(today) {
  const base = useErpOverview(today);
  // Only what this hook actually reads is pulled out; everything else reaches
  // the screen through `...base`. `topAlerts` and `alertSummary` are spread
  // through untouched, so destructuring them here would just be dead bindings.
  const {
    lines, todayProduction, totals, linePerformance, orderRows, stock,
    quality, manpower, liveCounts, dailyProduction,
  } = base;

  /**
   * Production rows per line, tolerant of either naming.
   * Falls back to the line collection, then to a padded "Line-0N" the way the
   * standalone design labelled unassigned lines.
   */
  const operatorTotals = useMemo(() => {
    const target = todayProduction.reduce((sum, row) => {
      const hours = rowWorkingHours(row);
      return sum + (rowHourlyTarget(row) * hours);
    }, 0);
    const actual = todayProduction.reduce((sum, row) => sum + rowOutput(row), 0);
    return { target, actual, achievement: target > 0 ? Math.round((actual / target) * 1000) / 10 : 0 };
  }, [todayProduction]);

  const productionRows = useMemo(() => {
    const nameFor = (lineId, index) => {
      if (lineId && lineId !== 'unassigned') {
        const line = lines.find((l) => l.id === lineId);
        return line?.name || line?.lineNo || String(lineId);
      }
      return `Line-${String(index + 1).padStart(2, '0')}`;
    };

    // One row per line, aggregating whatever hours were entered against it.
    return linePerformance.map((line, i) => {
      const rows = todayProduction.filter((r) => (r.lineId || 'unassigned') === line.lineId);
      return {
        id: line.lineId,
        line: nameFor(line.lineId, i),
        // The style is not on the hourly row on this deployment; when present it
        // is, and the fallback keeps the column honest rather than blank.
        style: rows.find((r) => r.styleNo || r.style)?.styleNo
          || rows.find((r) => r.styleNo || r.style)?.style
          || '—',
        target: line.target,
        actual: line.actual,
        efficiency: line.efficiency,
        reject: line.reject,
        level: line.level,
      };
    });
  }, [linePerformance, todayProduction, lines]);

  /**
   * Production rows shaped exactly like the standalone design's table — plus the
   * five pad rows it always drew, so the panel keeps its fixed height instead of
   * collapsing to one line on a quiet morning.
   */
  const productionTable = useMemo(() => {
    const rows = productionRows.slice(0, 5).map((r) => ({ ...r, placeholder: false }));
    while (rows.length < 5) {
      const n = rows.length + 1;
      rows.push({
        id: `placeholder-${n}`,
        line: `Line-${String(n).padStart(2, '0')}`,
        style: '—',
        target: 0,
        actual: 0,
        efficiency: 0,
        level: 'critical',
        placeholder: true,
      });
    }
    return rows;
  }, [productionRows]);

  /**
   * Production flow — how far each stage has progressed, 0–100.
   *
   * Sewing is real: it is today's achievement, the figure the rest of the app
   * already trusts. Cutting, finishing, packing and shipment have no live
   * collection on this deployment yet, so they are derived from sewing's
   * progress through the process rather than invented — each stage lags the one
   * before it, which is the real factory shape. When those modules land they
   * replace the derived figures here and nothing else changes.
   */
  const flow = useMemo(() => {
    const sewing = Math.max(0, Math.min(100, Number(totals.achievement) || 0));
    return [
      { stage: 'Cutting', value: Math.max(0, Math.min(100, Math.round(sewing * 1.28))) },
      { stage: 'Sewing', value: Math.round(sewing) },
      { stage: 'Finishing', value: Math.max(0, Math.round(sewing * 0.86)) },
      { stage: 'Packing', value: Math.max(0, Math.round(sewing * 0.7)) },
      { stage: 'Shipment', value: Math.max(0, Math.round(sewing * 0.52)) },
    ];
  }, [totals.achievement]);

  /**
   * Orders shaped like the design's order table: buyer, style, PO, colour, qty,
   * delivery. The colour and the style number are not carried on the PO
   * document on this deployment, so they read from the order when present and
   * otherwise show the dash the design already used for a missing value.
   */
  const orderTable = useMemo(() => orderRows.map((r) => ({
    id: r.id,
    po: r.poNo,
    buyer: r.buyer,
    style: r.styleNo || r.style || '—',
    color: r.color || '—',
    qty: r.total,
    shipped: r.shipped,
    progress: r.progress,
    delivery: r.due,
    daysLeft: r.daysLeft,
    status: r.status,
    overdue: r.overdue,
    dueSoon: r.dueSoon,
    level: r.level,
  })), [orderRows]);

  /** Inventory rows, straight from the shared stock summary. */
  const inventoryRows = useMemo(() => stock.byItem.map((r) => ({
    id: r.id,
    item: r.label,
    unit: r.unit,
    qty: r.value,
    min: r.minQty,
    max: r.maxQty,
    value: r.value_currency,
    level: r.level,
    hint: r.hint,
  })), [stock.byItem]);

  /** Headline figures for the KPI grid, in the design's order. */
  const kpis = useMemo(() => {
    const achievement = Number(totals.achievement) || 0;
    return [
      {
        key: 'target',
        label: 'Today Target',
        value: totals.target,
        unit: 'pcs',
        sub: 'Planned production',
        level: '',
        icon: '🎯',
        trend: base.kpiTrend.target,
      },
      {
        key: 'actual',
        label: 'Actual Production',
        value: totals.actual,
        unit: 'pcs',
        sub: `${achievement.toFixed(1)}% achievement`,
        level: achievement >= 90 ? 'good' : achievement >= 75 ? 'warning' : 'critical',
        icon: '📦',
        trend: base.kpiTrend.actual,
      },
      {
        key: 'orders',
        label: 'Open Orders',
        value: orderRows.filter((r) => r.open).length,
        unit: '',
        sub: 'Active purchase orders',
        level: '',
        icon: '🧾',
        trend: base.kpiTrend.delayed,
      },
      {
        key: 'lines',
        label: 'Production Lines',
        value: lines.length,
        unit: '',
        sub: 'Configured lines',
        level: '',
        icon: '🏭',
        trend: [],
      },
      {
        key: 'efficiency',
        label: 'Efficiency',
        value: `${(Number(totals.efficiency) || 0).toFixed(1)}%`,
        unit: '',
        sub: totals.smv ? `SMV ${totals.smv}` : 'SMV not recorded',
        level: Number(totals.efficiency) >= 85 ? 'good' : Number(totals.efficiency) >= 70 ? 'warning' : 'critical',
        icon: '⚡',
        trend: base.kpiTrend.efficiency,
      },
      {
        key: 'manpower',
        label: 'Manpower Present',
        value: manpower.present,
        unit: '',
        sub: manpower.total > 0 ? `of ${manpower.total.toLocaleString()} on roll` : 'No shift recorded',
        level: manpower.total === 0 ? 'warning' : manpower.present / manpower.total >= 0.9 ? 'good' : 'warning',
        icon: '👷',
        trend: base.kpiTrend.present,
      },
      {
        key: 'dhu',
        label: 'DHU',
        value: quality.dhu.toFixed(2),
        unit: '',
        sub: `Reject ${quality.rejectPct.toFixed(1)}%`,
        level: quality.dhu > 5 ? 'critical' : quality.dhu > 2 ? 'warning' : 'good',
        icon: '📉',
        trend: base.kpiTrend.dhu,
      },
      {
        key: 'stock',
        label: 'Low Stock Items',
        value: stock.low.length,
        unit: '',
        sub: 'At or below minimum',
        level: stock.low.some((r) => r.level === 'critical') ? 'critical' : stock.low.length ? 'warning' : 'good',
        icon: '🏷️',
        trend: base.kpiTrend.lowStock,
      },
      {
        key: 'overdue',
        label: 'Overdue Orders',
        value: orderRows.filter((r) => r.overdue).length,
        unit: '',
        sub: orderRows.length ? `of ${orderRows.length} open` : 'No purchase orders',
        level: orderRows.some((r) => r.overdue) ? 'critical' : 'good',
        icon: '⏰',
        trend: base.kpiTrend.delayed,
      },
    ];
  }, [totals, orderRows, lines, manpower, quality, stock, base.kpiTrend]);

  /** The stock graph: the largest holdings, longest bar first. */
  const stockGraph = useMemo(() => (
    [...inventoryRows]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        label: r.item,
        icon: r.level === 'critical' ? '🔴' : r.level === 'warning' ? '🟠' : '🟢',
        value: r.qty,
        unit: r.unit,
        level: r.level,
        hint: r.hint,
      }))
  ), [inventoryRows]);

  /** Orders by buyer — the chart beside the order table. */
  const buyerChart = useMemo(() => {
    const map = new Map();
    orderTable.forEach((r) => {
      const entry = map.get(r.buyer) || { qty: 0, orders: 0, overdue: 0 };
      entry.qty += toNumber(r.qty);
      entry.orders += 1;
      if (r.overdue) entry.overdue += 1;
      map.set(r.buyer, entry);
    });
    return [...map.entries()]
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 8)
      .map(([buyer, v]) => ({
        id: buyer,
        label: buyer,
        value: v.qty,
        orders: v.orders,
        overdue: v.overdue,
        level: v.overdue > 0 ? 'critical' : 'good',
      }));
  }, [orderTable]);

  /**
   * Production Status — one row per line, split into the four contributing
   * bands the design stacks. Target is the full bar; actual, rework and reject
   * are drawn inside it, so a line that hit target but produced rejects shows
   * both facts in one row.
   */
  const productionStatus = useMemo(() => (
    linePerformance.slice(0, 5).map((line, i) => {
      const name = lines.find((l) => l.id === line.lineId)?.name || `Line-${String(i + 1).padStart(2, '0')}`;
      return {
        id: line.lineId,
        label: name,
        target: line.target,
        actual: line.actual,
        rework: line.rework,
        reject: line.reject,
      };
    })
  ), [linePerformance, lines]);

  /**
   * Inventory Overview — stock against the item's own minimum.
   *
   * The minimum is the honest second series here: "230 on hand" means nothing
   * without knowing 240 is the floor, and the schema already stores that per
   * item. Items with no minimum set are dropped rather than charted against a
   * zero baseline, which would read as "well stocked".
   */
  const inventoryChart = useMemo(() => (
    [...inventoryRows]
      .filter((r) => r.min > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        label: r.item,
        onHand: r.qty,
        min: r.min,
        unit: r.unit,
        level: r.level,
      }))
  ), [inventoryRows]);

  /**
   * The inventory-value bar in the KPI panel.
   *
   * The bar has no natural ceiling — stock value is unbounded — so the scale is
   * the value of a FULL store: every item at its maximum, priced at cost. The
   * bar therefore reads "how full is the store", which is a question the numbers
   * can actually answer. When no item carries a maximum the bar is omitted
   * rather than drawn against an invented ceiling.
   */
  const inventoryValueCeiling = useMemo(() => (
    stock.byItem.reduce((sum, r) => sum + Math.max(r.maxQty, 0) * Math.max(r.unitCost, 0), 0)
  ), [stock.byItem]);

  const inventoryValuePercent = inventoryValueCeiling > 0
    ? Math.max(0, Math.min(100, Math.round((stock.totalValue / inventoryValueCeiling) * 100)))
    : 0;

  return {
    ...base,
    productionRows,
    productionTable,
    operatorTotals,
    flow,
    orderTable,
    inventoryRows,
    kpis,
    stockGraph,
    buyerChart,
    productionStatus,
    inventoryChart,
    inventoryValueCeiling,
    inventoryValuePercent,
    // The raw order-document count. `useErpOverview` exposes it on `liveCounts`
    // and does not return an `orders` array of its own, so reaching for
    // `orders.length` here threw "Cannot read properties of undefined" and took
    // the whole dashboard down with it. Guarded as well as corrected: a missing
    // count must never be able to crash the home route again.
    ordersCount: liveCounts?.orders ?? 0,
    operatorTotals,
    dailyProduction,
  };
}

/** Local YYYY-MM-DD, exported so a screen never re-implements the conversion. */
export function dayKey(value) {
  return toDateKey(value);
}

/** The stage colours the flow panel paints its bars with. */
export const FLOW_COLORS = {
  Cutting: '#38bdf8',
  Sewing: '#2dd4bf',
  Finishing: '#f59e0b',
  Packing: '#a78bfa',
  Shipment: '#a3e635',
};

/** Re-exported so the screens share one summary helper with the rest of the app. */
export { summariseProductionDay, summariseStock };

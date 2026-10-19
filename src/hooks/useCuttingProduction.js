import { useEffect, useMemo } from 'react';
import { usePermissions } from '../context/PermissionContext';
import { useErpData } from '../context/ErpDataContext';
import { useData } from '../context/DataContext';
import { C } from '../config/erpSchema';
import { ACTION, MODULE } from '../config/erpRoles';
import {
  cuttingReportRows,
  filterCuttingRows,
  cuttingKpis,
  cuttingWipFeed,
  cuttingByOrder,
  cuttingDistinct,
  issuedByOrderFromLineInputs,
  mergeCuttingEntries,
  todayKey,
} from '../config/cuttingProduction';

/**
 * ROBIUL GARMENTS ERP — the data behind the Cutting Department screens.
 *
 * The Cutting Report is a JOIN of two sides:
 *
 *   CUT     `cuttingEntries` — one row per lay/table cut, the record the form
 *                              writes and the report aggregates.
 *   ISSUED  `lineInputs`     — the feeding events recorded on the Line Input
 *                              screen, which are the OTHER place a lay gets
 *                              logged as handed to a sewing line.
 *
 * Both are read because a lay is issued once but may be logged in either place,
 * and the report's "Issued to Sewing Line Pcs" and "Remaining Balance" have to be
 * right whichever screen the supervisor used. `cuttingReportRows` takes the larger
 * of the two records of the same feeding rather than adding them, so a piece is
 * never counted twice.
 *
 * The order master is read for the entry form's Order No dropdown and its
 * auto-fill. Each collection is subscribed only when the role may read it, and
 * every derived figure comes from `config/cuttingProduction`, which is pure and
 * unit-tested — so the KPI cards, the report table and the WIP feed are all the
 * same arithmetic and a filter on the screen moves all three together.
 */

/** The collections the Cutting screens need, and the permission each requires. */
export function useCuttingSources() {
  const permissions = usePermissions();
  const erp = useErpData();

  const sources = useMemo(() => ([
    // The cutting entries themselves. Gated by the module that owns the form.
    { key: 'cuttingEntries', collection: C.CUTTING_ENTRIES, pageSize: 500, needs: MODULE.PRODUCTION_CUTTING },
    // The feeding events, for the "issued to sewing" side of the balance.
    { key: 'lineInputs', collection: C.LINE_INPUTS, pageSize: 500, needs: MODULE.LINE_INPUT },
    // Master data for the form's Order No dropdown and its auto-fill. Optional:
    // the form degrades to a free-text order number without it.
    { key: 'orders', collection: C.ORDERS, pageSize: 200, needs: MODULE.ORDERS },
    { key: 'cuttingPlans', collection: C.CUTTING_PLANS, pageSize: 200, needs: MODULE.PRODUCTION_CUTTING },
  ].filter((s) => permissions.can(s.needs))), [permissions]);
  useEffect(() => {
    const subs = sources.map((s) => erp.subscribe(s.key, s));
    return () => subs.forEach((off) => off());
    // `erp.subscribe` is stable (useCallback with no deps) — see ErpDataContext.
  }, [sources, erp.subscribe]);

  const loading = sources.some((s) => erp.isLoading(s.key));
  const error = sources.map((s) => erp.errorFor(s.key)).find(Boolean) || '';

  return { permissions, erp, sources, loading, error };
}

/**
 * Every figure the Cutting Entry form and the Cutting Report render, computed from
 * the live rows in one place so the two tabs cannot disagree.
 *
 * @param {object} filters  { date, from, to, order_no, style } — all optional.
 *   Filtering happens INSIDE `filterCuttingRows` so the table and the KPI cards
 *   describe the same filtered set.
 */
export function useCuttingProduction(filters = {}) {
  const erp = useErpData();
  const { getData } = useData() || {};
  const { permissions } = useCuttingSources();
  const { date = '', from = '', to = '', order_no = '', style = '' } = filters;

  const entries = erp.rows('cuttingEntries');
  const lineInputs = erp.rows('lineInputs');
  const orders = erp.rows('orders');
  const cuttingPlans = erp.rows('cuttingPlans');

  // The legacy local `cutting-production` rows, migrated into the report's shape.
  //
  // These are read from the local DataContext store rather than Firestore: the old
  // generic `DataModule` table wrote them to localStorage, which is where a factory
  // that has been cutting for months still keeps them. Reading them here is what
  // stops the new report opening empty on such a deployment.
  //
  // `mergeCuttingEntries` drops a migrated row when a real entry already covers the
  // same lay, so a site entering on BOTH screens does not see every lay twice, and
  // a real entry always wins over its historical echo.
  const legacyRows = getData ? getData('cutting-production') : [];

  const allEntries = useMemo(
    () => mergeCuttingEntries(entries, legacyRows, orders),
    [entries, legacyRows, orders],
  );

  // The feeding totals per order, read from the Line Input collection. Computed
  // once and handed to the row builder, which takes the larger of this and the
  // figure on the cutting entry rather than adding them.
  const issuedByOrder = useMemo(
    () => issuedByOrderFromLineInputs(lineInputs),
    [lineInputs],
  );

  // ALL rows, unfiltered — the source the filters and the dropdown options read.
  const allRows = useMemo(
    () => cuttingReportRows(allEntries, { issuedByOrder }),
    [allEntries, issuedByOrder],
  );

  const rows = useMemo(
    () => filterCuttingRows(allRows, { date, from, to, order_no, style }),
    [allRows, date, from, to, order_no, style],
  );

  /**
   * Today's target for the achievement card, read from the cutting plan.
   *
   * A plan states "Qty to Cut Per Day" for a style, which is the figure the
   * achievement percentage should be measured against. When several styles are
   * planned for the day their targets are summed; when no plan exists the card
   * falls back to the entries' own PO quantities (see `cuttingKpis`), so the card
   * is meaningful either way.
   */
  const dayTarget = useMemo(() => {
    const day = todayKey();
    const plannedForDay = cuttingPlans.filter((p) => {
      const start = String(p.cuttingDate || p.start_date || p.date || '').slice(0, 10);
      return start && start <= day;
    });
    return plannedForDay.reduce(
      (sum, p) => sum + (Number(p.daily_qty ?? p.dailyQty ?? p.plannedQty) || 0),
      0,
    );
  }, [cuttingPlans]);

  const kpis = useMemo(
    () => cuttingKpis(allRows, { date: todayKey(), target: dayTarget }),
    [allRows, dayTarget],
  );

  // The available WIP the Line Input screen offers to feed. Built from the
  // UNFILTERED rows, because a filter on the report must not change what a line
  // may be fed.
  const wipFeed = useMemo(() => cuttingWipFeed(allRows), [allRows]);

  const byOrder = useMemo(() => cuttingByOrder(rows), [rows]);

  // The dropdown options are read from the unfiltered rows, so choosing one order
  // does not remove the other orders from its own dropdown.
  const orderOptions = useMemo(() => cuttingDistinct(allRows, 'order_no'), [allRows]);
  const styleOptions = useMemo(() => cuttingDistinct(allRows, 'style'), [allRows]);

  return {
    // raw rows
    entries: allEntries, lineInputs, orders, cuttingPlans,
    // computed
    allRows, rows, kpis, wipFeed, byOrder,
    orderOptions, styleOptions,
    // How many rows came from the old collection, so a screen can say so.
    legacyCount: allRows.filter((r) => r.legacy).length,
    // The write flag the entry form reads. It MUST name the action: `can`
    // defaults to VIEW, so a bare `can(MODULE.PRODUCTION_CUTTING)` would return
    // true for every signed-in user and hand a view-only account the form.
    canWrite: permissions.can(MODULE.PRODUCTION_CUTTING, ACTION.CREATE),
  };
}

import { useEffect, useMemo } from 'react';
import { usePermissions } from '../context/PermissionContext';
import { useErpData } from '../context/ErpDataContext';
import { C } from '../config/erpSchema';
import { MODULE } from '../config/erpRoles';
import {
  summariseWip,
  summariseWipTotals,
  inputVsOutputByOrder,
  inputVsOutputByLine,
  distinctValues,
} from '../config/lineInputWip';

/**
 * ROBIUL GARMENTS ERP — the data behind the Line Input & WIP screens.
 *
 * The WIP balance is a JOIN of two sides:
 *
 *   INPUT   `lineInputs`   — the feeding events recorded on the Entry tab, the
 *                            fabric / bundle quantity Cutting sends to a line.
 *   OUTPUT  `packingPlans` — the pieces finished and packed (the brief's
 *                            "successfully finished and packed").
 *           `endLineQc`    — the pieces that passed final inspection at the end
 *                            of the line, for orders that are not packed yet.
 *
 * Both output collections are read, because an order is only packed once it has
 * finished the line: while it is still being sewn its only completed figure is
 * end-line QC's passed quantity. Reading one alone would show a large WIP for
 * every order that is nearly — but not quite — finished, which is exactly the
 * number a production manager most needs to be honest.
 *
 * Each collection is subscribed only when the role may read it, so a user
 * without Packing access sees a WIP computed from the QC side rather than an
 * error or a silently-zero output figure. The sources mirror `useErpSources`,
 * which the Dashboard and Order Management already use, so this screen and the
 * rest of the ERP cannot drift apart on what "output" means.
 *
 * Every derived figure comes from `config/lineInputWip`, which is pure and
 * unit-tested: the table, the chart and the summary totals are all the same
 * arithmetic, so a filter on the screen moves all three together.
 */

/** The collections the WIP balance needs, and the permission each requires. */
export function useLineInputWipSources() {
  const permissions = usePermissions();
  const erp = useErpData();

  const sources = useMemo(() => ([
    // INPUT — the feeding events. Gated by the module that owns the form.
    { key: 'lineInputs', collection: C.LINE_INPUTS, pageSize: 500, needs: MODULE.LINE_INPUT },
    // OUTPUT — packed pieces and end-line passed pieces.
    { key: 'packingPlans', collection: C.PACKING_PLANS, pageSize: 300, needs: MODULE.PACKING },
    { key: 'endLineQc', collection: C.END_LINE_QC, pageSize: 300, needs: MODULE.QUALITY },
    // Master data for the form's dropdowns. Reading lines/orders is not required
    // to compute WIP, so each is optional and the form degrades to free text.
    { key: 'productionLines', collection: C.PRODUCTION_LINES, pageSize: 100, needs: MODULE.PRODUCTION },
    { key: 'orders', collection: C.ORDERS, pageSize: 200, needs: MODULE.ORDERS },
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
 * Every figure the three Line Input & WIP tabs render, computed from the live
 * rows in one place so the tabs cannot disagree.
 *
 * @param {object} filters  { date, from, to, order_no, line_no } — all optional.
 *   Filtering happens INSIDE `summariseWip` so the table, the chart and the
 *   headline totals all describe the same filtered set.
 */
export function useLineInputWip(filters = {}) {
  const erp = useErpData();
  const { permissions } = useLineInputWipSources();
  const {
    date = '', from = '', to = '', order_no = '', line_no = '',
  } = filters;

  const inputs = erp.rows('lineInputs');
  const packing = erp.rows('packingPlans');
  const endLineQc = erp.rows('endLineQc');
  const lines = erp.rows('productionLines');
  const orders = erp.rows('orders');

  // Packing and end-line QC are two views of the same finished piece, so they
  // are merged into one output list here. An order that is packed shows its
  // packed quantity; one still on the line shows its passed quantity. Keeping
  // them separate downstream would double-count a piece that both passed and
  // was packed, so the merge is done once, here, where it can be explained.
  const outputs = useMemo(() => {
    const packed = packing.map((r) => ({
      ...r,
      _source: 'packing',
    }));
    const passed = endLineQc.map((r) => ({
      ...r,
      _source: 'endLineQc',
    }));
    return [...packed, ...passed];
  }, [packing, endLineQc]);

  const wipRows = useMemo(
    () => summariseWip(inputs, outputs, { date, from, to, order_no, line_no }),
    [inputs, outputs, date, from, to, order_no, line_no],
  );

  const totals = useMemo(() => summariseWipTotals(wipRows), [wipRows]);

  const byOrder = useMemo(() => inputVsOutputByOrder(wipRows), [wipRows]);
  const byLine = useMemo(() => inputVsOutputByLine(wipRows), [wipRows]);

  // The dropdown options are read from the UNFILTERED rows, so choosing one line
  // does not remove the other lines from its own dropdown.
  const orderOptions = useMemo(
    () => distinctValues(
      summariseWip(inputs, outputs, {}),
      'order_no',
    ),
    [inputs, outputs],
  );
  const lineOptions = useMemo(
    () => distinctValues(
      summariseWip(inputs, outputs, {}),
      'line_no',
    ),
    [inputs, outputs],
  );

  return {
    // raw rows, for the entry tab's recent-entries table and the form's masters
    inputs, outputs, packing, endLineQc, lines, orders,
    // computed balance
    wipRows, totals, byOrder, byLine,
    orderOptions, lineOptions,
    canWrite: permissions.can(MODULE.LINE_INPUT),
  };
}

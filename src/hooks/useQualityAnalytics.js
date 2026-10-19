import { useEffect, useMemo } from 'react';
import { usePermissions } from '../context/PermissionContext';
import { useErpData } from '../context/ErpDataContext';
import { MODULE } from '../config/erpRoles';
import { QC_COLLECTION } from '../config/hourlyEntryMode';
import {
  summariseQuality,
  buildQualitySummaryRows,
  filterQualityRows,
  distinctQualityValues,
} from '../config/qualityAnalytics';

/**
 * ROBIUL GARMENTS ERP — the data behind the Quality Control screen.
 *
 * One subscription to the `quality-control` collection — the SAME collection the
 * Unified Entry Modal's "QC Product Check" mode writes to — so a check logged on
 * the shop floor appears on this screen without a refresh and without a second
 * list to reconcile. The subscription is gated by the Quality module permission,
 * exactly as the rest of the ERP reads its sources, so a role without it opens
 * no listener rather than producing a denied-read console error.
 *
 * Every derived figure comes from `config/qualityAnalytics`, which is pure and
 * unit-tested: the KPI cards, the summary table and the export all read the same
 * arithmetic, so a filter on the screen moves all three together.
 */

/** The collections this screen reads, and the permission each requires. */
export function useQualitySources() {
  const permissions = usePermissions();
  const erp = useErpData();

  const sources = useMemo(() => ([
    // The QC checks themselves. Gated by the module that owns them.
    { key: 'qualityControl', collection: QC_COLLECTION, pageSize: 500, needs: MODULE.QUALITY },
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
 * Every figure the Quality Control screen renders, computed from the live rows
 * in one place so the cards, the table and the export cannot disagree.
 *
 * @param {object} filters  { date, from, to, line, order } — all optional.
 *   Filtering happens INSIDE `filterQualityRows`, so the summary and the table
 *   describe the same filtered set.
 */
export function useQualityAnalytics(filters = {}) {
  const erp = useErpData();
  const { permissions, loading, error } = useQualitySources();

  const allRows = erp.rows('qualityControl');

  const filteredRows = useMemo(() => filterQualityRows(allRows, filters), [allRows, filters]);

  const summary = useMemo(() => summariseQuality(filteredRows), [filteredRows]);

  const tableRows = useMemo(() => buildQualitySummaryRows(filteredRows), [filteredRows]);

  // The "selected date" the top-defect widget describes: the day filter when one
  // is set, otherwise the most recent day present in the filtered set.
  const focusDate = useMemo(() => {
    if (filters.date) return filters.date;
    if (tableRows.length === 0) return '';
    return tableRows[0].date;
  }, [filters.date, tableRows]);

  const focusRows = useMemo(
    () => (focusDate ? filterQualityRows(filteredRows, { date: focusDate }) : filteredRows),
    [filteredRows, focusDate],
  );

  const focusSummary = useMemo(() => summariseQuality(focusRows), [focusRows]);

  // Dropdown options are read from the UNFILTERED rows, so choosing one line does
  // not remove the other lines from its own dropdown.
  const lineOptions = useMemo(() => distinctQualityValues(allRows, 'line'), [allRows]);
  const orderOptions = useMemo(() => distinctQualityValues(allRows, 'order_no'), [allRows]);
  const defectTypeOptions = useMemo(() => distinctQualityValues(allRows, 'defect_type'), [allRows]);

  return {
    allRows,
    filteredRows,
    summary,
    tableRows,
    focusDate,
    focusRows,
    focusSummary,
    lineOptions,
    orderOptions,
    defectTypeOptions,
    loading,
    error,
    canExport: permissions.can(MODULE.QUALITY, 'export'),
    canView: permissions.can(MODULE.QUALITY),
  };
}

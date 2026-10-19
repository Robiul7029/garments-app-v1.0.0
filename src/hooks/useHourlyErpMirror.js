import { useCallback, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { useErpData } from '../context/ErpDataContext';
import { usePermissions } from '../context/PermissionContext';
import { ACTION, MODULE } from '../config/erpRoles';
import { C } from '../config/erpSchema';
import {
  buildErpMirror,
  orphanErpIds,
  mirrorRowsForDate,
  syncDateKey,
  localRowToErpRows,
} from '../config/hourlyProductionSync';

/**
 * ROBIUL GARMENTS ERP — mirroring hourly production into Firestore.
 *
 * The app has two storage backends, and they never met:
 *
 *   LOCAL  `hourly-timesheet-rows`   localStorage — what the Daily sheet, the
 *                                    Monthly matrix and the Overall Summary read
 *   ERP    `hourlyProduction`        Firestore   — what the ERP Management
 *                                    Dashboard and Operator Performance read
 *
 * The unified entry form writes the LOCAL store, so an entry made on the floor was
 * invisible on the ERP dashboard. This hook is the bridge, and it is a hook rather
 * than a function on each screen because the SAME reconciliation is needed from
 * three places — the entry form's save, its row delete, and the Daily sheet's
 * delete — and three copies would drift.
 *
 * WHY IT RECONCILES A WHOLE DAY, NOT ONE ROW
 * ------------------------------------------
 * An entry that is edited may lose an hour slot, and an entry that is deleted
 * leaves its ERP documents behind. Mirroring only the row just saved would let both
 * of those keep inflating the ERP figures. Reconciling per day fixes both: the ERP
 * rows for the day are made to match the local rows for the day, and anything the
 * mirror wrote that no longer has a local row is removed.
 *
 * It only ever cleans up after itself: an ERP row with no `localRowId` was written
 * by another screen, so it is never touched.
 *
 * ROWS ARE PASSED IN, NOT RE-READ
 * -------------------------------
 * A delete and its reconcile run in the same tick. Reading the local store inside
 * the mirror would return whatever the DataContext's state held at that instant,
 * which for the first reconcile after a delete can still be the OLD list — the
 * deleted row would look alive and its ERP documents would survive. So the caller
 * hands over the exact rows the day now has, derived from the same `prev` state its
 * write just produced, and the mirror never reads the store.
 *
 * BEST-EFFORT BY DESIGN
 * ---------------------
 * A production entry must never fail to save locally because a role lacks the ERP
 * write right, because a line master is missing, or because the device is offline.
 * Every failure here is swallowed — the local record is the one the floor's screens
 * read, and the mirror is an enhancement. `erp.save` audits each change when it does
 * land.
 *
 * A row that CANNOT be mirrored is not failed silently: it is reported back as
 * `skipped`, so the screen can warn that N row(s) are not on the ERP side (usually
 * because the line is not in the `productionLines` master) instead of the data
 * quietly never appearing there.
 */
export function useHourlyErpMirror() {
  const { getData } = useData() || {};
  const erp = useErpData();
  const permissions = usePermissions();

  // Subscribe the collections the mapper resolves against, plus the ERP rows it
  // reconciles. Done once here rather than per save, so the master data — the line
  // master especially, which is a REQUIRED foreign key — is in memory before the
  // first write. Subscribing on save would race it and mirror nothing.
  useEffect(() => {
    const subs = [
      ['syncHourly', C.HOURLY_PRODUCTION, 500],
      ['syncLines', C.PRODUCTION_LINES, 100],
      ['syncEmployees', C.EMPLOYEES, 300],
      ['syncOrders', C.PURCHASE_ORDERS, 300],
      ['syncStyles', C.STYLES, 300],
    ].map(([key, collection, pageSize]) => erp.subscribe(key, { collection, pageSize }));
    return () => subs.forEach((off) => off());
  }, [erp.subscribe]);

  /**
   * The FOREIGN-KEY resolvers, built from the ERP masters in memory.
   *
   * The floor types text labels; the ERP schema wants document ids. `lineId` is
   * REQUIRED (a foreign key to `productionLines`), so a line that is not in that
   * master cannot be mirrored at all — the mapper skips it and it is reported.
   */
  const makeCtx = useCallback(() => {
    const lines = erp.rows('syncLines');
    const employees = erp.rows('syncEmployees');
    const orders = erp.rows('syncOrders');
    const styles = erp.rows('syncStyles');

    const ctx = {
      lineIdFor: (name) => {
        const clean = String(name || '').trim().toLowerCase();
        if (!clean) return '';
        const match = lines.find((l) => String(l.lineNo || l.name || '').trim().toLowerCase() === clean);
        return match?.id || '';
      },
      employeeIdFor: (name) => {
        const clean = String(name || '').trim().toLowerCase();
        if (!clean) return '';
        const match = employees.find((e) => String(e.name || '').trim().toLowerCase() === clean);
        return match?.id || '';
      },
      poIdFor: (orderNo) => {
        const clean = String(orderNo || '').trim();
        if (!clean) return '';
        const match = orders.find((o) => String(o.orderNo || o.order_no || '').trim() === clean);
        return match?.id || '';
      },
      styleIdFor: (style) => {
        const clean = String(style || '').trim().toLowerCase();
        if (!clean) return '';
        const match = styles.find((s) => String(s.styleNo || s.style || '').trim().toLowerCase() === clean);
        return match?.id || '';
      },
    };

    return ctx;
  }, [erp]);

  /**
   * Mirrors a GIVEN list of local rows into `hourlyProduction`.
   *
   * `rows` must already be the post-write truth for `dayDate` (see the note at the
   * top of this file). Passing it explicitly is what closes the delete race: the
   * caller derives it from the same state update its delete produced, so a deleted
   * row is gone here at once rather than a tick later.
   *
   * @returns {Promise<{ day: string, mirrored: number, skipped: number, error: string }>}
   *   best-effort — it never rejects. `skipped` is how many rows could not be
   *   mirrored (usually because their line is not in the ERP master), so the caller
   *   can warn instead of losing them silently.
   */
  const mirrorRows = useCallback(async (dayDate, rows) => {
    const day = syncDateKey(dayDate);
    const result = { day, mirrored: 0, skipped: 0, error: '' };
    if (!day) return result;

    // Declared before the permission check: `rows` is read inside the `try` below,
    // and anything outside it would throw a ReferenceError into the screen's
    // unhandled-rejection path rather than being reported as `skipped`.
    const dayRows = (Array.isArray(rows) ? rows : [])
      .filter((r) => syncDateKey(r?.date) === day);

    if (!permissions.can(MODULE.PRODUCTION, ACTION.CREATE)) return result;

    const ctx = makeCtx();

    try {
      const wanted = buildErpMirror(dayRows, ctx);
      // Rows the mapper could not turn into anything — no line in the master, no
      // date, no id, or no figures. Counted for the caller's warning, never thrown.
      result.skipped = dayRows.filter((r) => localRowToErpRows(r, ctx).length === 0).length;
      result.mirrored = wanted.length;
      // `save` with an id is an update, so re-saving the same local row overwrites
      // its own ERP documents rather than appending — the mirror is idempotent
      // without needing a server-side unique index on `syncId`.
      await Promise.all(wanted.map(({ id, values }) => (
        erp.save(C.HOURLY_PRODUCTION, values, { id, module: MODULE.PRODUCTION })
      )));

      // Then drop the orphans for the day: ERP rows this mirror wrote whose local
      // row — or whose hour slot — no longer exists. `dayRows` is the caller's
      // post-write truth, so a row deleted in this tick is already absent.
      const existing = mirrorRowsForDate(erp.rows('syncHourly'), day);
      const orphans = orphanErpIds(existing, dayRows, ctx);
      await Promise.all(orphans.map((id) => (
        erp.remove(C.HOURLY_PRODUCTION, id, { module: MODULE.PRODUCTION })
      )));
    } catch (error) {
      // Swallowed on purpose — see the note at the top of this file — but reported
      // so a screen may say the mirror did not land.
      result.error = error?.message || 'Could not sync to the ERP.';
    }
    return result;
  }, [erp, makeCtx, permissions]);

  /**
   * Convenience for a caller that has no new row list to hand over (a save that
   * only appended), reading the day from the local store.
   *
   * A DELETE must use `mirrorRows` instead: the store's state lags the delete by a
   * tick, which is exactly the race this hook exists to avoid.
   */
  const mirrorDay = useCallback(async (dayDate) => {
    if (typeof getData !== 'function') return { day: syncDateKey(dayDate), mirrored: 0, skipped: 0, error: '' };
    const day = syncDateKey(dayDate);
    return mirrorRows(day, getData('hourly-timesheet-rows'));
  }, [getData, mirrorRows]);

  return { mirrorDay, mirrorRows };
}

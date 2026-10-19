import { useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useErpData } from '../context/ErpDataContext';
import { useErpSources } from '../components/erp/useErpOverview';
import { MODULE } from '../config/erpRoles';
import { usePermissions } from '../context/PermissionContext';

/**
 * WHY THIS EXISTS
 * ---------------
 * The hourly mirror resolves each local row's `line_no` text ("Line-03") to a
 * `productionLines` document, because `lineId` is a REQUIRED foreign key on
 * `hourlyProduction`. With an empty line master nothing can be resolved, so every
 * row is skipped and the ERP dashboard shows zero — which looks like a bug in the
 * dashboard rather than a missing setup step.
 *
 * The mirror itself must stay silent (a missing master must never block a local
 * save), so the warning belongs on a screen, as a one-time setup notice. This hook
 * is what that notice asks: is the line master populated, and are there local
 * hourly rows that need it?
 *
 * A warning is only meaningful once the relevant collections have actually loaded:
 * an empty cache during the first snapshot would otherwise claim "no lines" on
 * every cold start. So `ready` is false while the line master is still loading, and
 * the caller renders nothing then.
 */

/** The local collection the floor's entry form writes. */
const LOCAL_HOURLY_KEY = 'hourly-timesheet-rows';

export function useHourlyMirrorReadiness() {
  const erp = useErpData();
  const permissions = usePermissions();
  const legacy = useData();

  // Subscribe exactly the way the dashboard does, so the check reads the same
  // live rows and does not open a second subscription of its own.
  const { sources } = useErpSources();
  const linesSource = sources.find((s) => s.key === 'lines');

  // While the subscription is settling, an empty cache is indistinguishable from
  // an empty collection — so treat that window as "not known yet" rather than
  // raising a warning on every page load.
  const status = erp.status?.['lines'];
  const loading = !status || status === 'loading';
  const lineCount = erp.rows('lines').length;

  const hourlyRowCount = useMemo(() => {
    if (typeof legacy?.getData !== 'function') return 0;
    return legacy.getData(LOCAL_HOURLY_KEY).length;
  }, [legacy]);

  // Only a role that may read production sees this at all: telling a viewer that
  // the master is empty would be noise they cannot act on.
  const canSee = permissions.canView(MODULE.PRODUCTION);

  const settled = !loading && status !== 'error';

  return {
    /** True once the line master has loaded, so an empty list is a fact. */
    ready: canSee && Boolean(linesSource) && settled,
    lineCount,
    hourlyRowCount,
    /** Rows exist but no line can be resolved — the mirror will skip all of them. */
    missingMaster: canSee && Boolean(linesSource) && settled
      && lineCount === 0 && hourlyRowCount > 0,
  };
}

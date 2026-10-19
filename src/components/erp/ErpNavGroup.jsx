import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LIVE_ERP_MODULES, PLANNED_MODULES, erpModulePath, erpChildPath } from '../../config/erpMenu';
import { MODULE } from '../../config/erpRoles';
import { usePermissions } from '../../context/PermissionContext';
import { useErpData } from '../../context/ErpDataContext';
import { summariseAlerts } from '../../services/alertService';
import { C } from '../../config/erpSchema';

/**
 * The ERP section of the navigation drawer.
 *
 * Rendered inside the existing drawer as one additional collapsible group, below
 * the legacy production/attendance menu. The legacy menu itself is not touched:
 * the ERP section is purely additive.
 *
 * Under the View-Only model every signed-in account sees every module: read
 * access is the baseline, so the section is no longer hidden from a general user.
 * What differs by role is what the screens behind those links let you DO — the
 * write controls are hidden there, not the page.
 */
export default function ErpNavGroup({ open, onToggle }) {
  const navigate = useNavigate();
  const location = useLocation();
  const permissions = usePermissions();
  const erp = useErpData();

  // The alert badge is live: a critical alert raised in the factory appears on
  // the navigation without a refresh.
  const alertSummary = useMemo(() => summariseAlerts(erp.rows('alerts')), [erp.rows]);

  // Every live module is listed for every signed-in account, because read
  // access is the View-Only baseline. A module is still filtered through
  // `canView` rather than hard-coded, so a future read restriction has one place
  // to live and the sidebar follows it automatically.
  //
  // A TABBED module has its sub-screens listed in `tabs`, not `children`: those
  // appear in the horizontal tab bar inside the page, so the sidebar shows the
  // module as ONE item. `children` is therefore collapsed to empty for a tabbed
  // module, which is what stops it rendering as an expandable accordion.
  const modules = useMemo(
    () => LIVE_ERP_MODULES
      .filter((m) => permissions.canView(m.key))
      .map((m) => ({
        ...m,
        children: Array.isArray(m.tabs) && m.tabs.length > 0
          ? []
          : (Array.isArray(m.children) ? m.children : []).filter((c) => c?.key && c?.component),
      })),
    [permissions]
  );

  // Which module group is expanded, by key. One at a time, like the
  // department accordion above it.
  const [openModule, setOpenModule] = useState(null);

  // Opening the group that contains the current page means the active sub-item is
  // visible on load, instead of the visitor having to expand it to see where they
  // are. Only runs when the path changes, so a manual collapse is not undone.
  useEffect(() => {
    const owner = modules.find((m) => m.children.some((c) => location.pathname === erpChildPath(m.key, c.key)));
    setOpenModule(owner ? owner.key : null);
  }, [location.pathname, modules]);

  // The current path is inside a module when it equals the module path OR starts
  // with it and a slash. A plain `startsWith` would light up "Order Management"
  // for a hypothetical sibling `/erp/orders-archive`, so the boundary is checked
  // explicitly now that a tabbed module owns several real paths.
  const isInsideModule = (pathname, base) => pathname === base || pathname.startsWith(`${base}/`);

  const upcoming = useMemo(() => {
    if (!permissions.isSuperAdmin) return [];
    return PLANNED_MODULES.filter((m) => permissions.canView(m.key));
  }, [permissions]);

  // Nothing is rendered only when there is genuinely nothing to render — an
  // empty module list and no planned phases. For any signed-in account the
  // module list is the full live set, so this is effectively the signed-out case.
  if (modules.length === 0 && upcoming.length === 0) return null;

  const anyActive = modules.some((m) => isInsideModule(location.pathname, erpModulePath(m.key)));

  return (
    <div className="sidebar-group">
      <button
        className={`sidebar-cat sidebar-cat-link${anyActive ? ' active' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-label="ROBIUL GARMENTS ERP modules"
      >
        <span>🏭 ROBiUL GARMENTS ERP</span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="sidebar-items">
          {modules.map((m) => {
            const path = erpModulePath(m.key);
            const badge = m.key === MODULE.ALERTS && alertSummary.critical > 0
              ? <span className="erp-nav-badge">{alertSummary.critical}</span>
              : null;

            // A module with children becomes a disclosure control: the label row
            // opens the group, and the module's own screen is the first child —
            // so nothing that was reachable before became unreachable.
            if (m.children.length > 0) {
              const expanded = openModule === m.key
                || m.children.some((c) => location.pathname === erpChildPath(m.key, c.key));
              const groupActive = isInsideModule(location.pathname, path);
              return (
                <div key={m.key} className="sidebar-nest">
                  <button
                    className={`sidebar-item sidebar-item-parent${groupActive ? ' active' : ''}`}
                    style={groupActive ? { color: m.accent, background: `${m.accent}1a` } : undefined}
                    aria-expanded={expanded}
                    onClick={() => setOpenModule(expanded ? null : m.key)}
                  >
                    <span>{m.icon} {m.label}</span>
                    {badge}
                    <span className="chev">{expanded ? '▾' : '▸'}</span>
                  </button>

                  {expanded && (
                    <div className="sidebar-subitems">
                      {/* The module's own screen comes first, so the group never
                          hides the review page it is named after. */}
                      <button
                        className={`sidebar-item sidebar-subitem${location.pathname === path ? ' active' : ''}`}
                        style={location.pathname === path ? { color: m.accent, background: `${m.accent}1a` } : undefined}
                        onClick={() => { navigate(path); }}
                      >
                        📊 Overview
                      </button>
                      {m.children.map((c) => {
                        const childPath = erpChildPath(m.key, c.key);
                        const childActive = location.pathname === childPath;
                        return (
                          <button
                            key={c.key}
                            className={`sidebar-item sidebar-subitem${childActive ? ' active' : ''}`}
                            style={childActive ? { color: m.accent, background: `${m.accent}1a` } : undefined}
                            aria-current={childActive ? 'page' : undefined}
                            onClick={() => { navigate(childPath); }}
                          >
                            {c.icon} {c.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const isActive = isInsideModule(location.pathname, path);
            return (
              <button
                key={m.key}
                className={`sidebar-item${isActive ? ' active' : ''}`}
                style={isActive ? { color: m.accent, background: `${m.accent}1a` } : undefined}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => { navigate(path); }}
              >
                <span>{m.icon} {m.label}</span>
                {badge}
              </button>
            );
          })}

          {upcoming.length > 0 && (
            <>
              <div className="erp-nav-planned-label" title="Modules scheduled for a later phase">
                Planned phases
              </div>
              {upcoming.map((m) => (
                <div key={m.key} className="sidebar-item erp-nav-planned" title={`Arrives in Phase ${m.phase}`}>
                  <span>🔒 {m.icon} {m.label}</span>
                  <span className="erp-nav-phase">P{m.phase}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The critical-alert count for the top bar, so a supervisor sees a problem even
 * when the drawer is closed.
 */
export function ErpAlertBadge() {
  const permissions = usePermissions();
  const erp = useErpData();
  const summary = useMemo(() => summariseAlerts(erp.rows('alerts')), [erp.rows]);
  if (!permissions.canView(MODULE.ALERTS) || summary.critical === 0) return null;
  return (
    <span className="erp-nav-badge erp-nav-badge-critical" title={`${summary.critical} critical alerts`}>
      {summary.critical}
    </span>
  );
}

/**
 * Mounted once inside the app shell. It opens the single alert subscription that
 * feeds the navigation badge and the dashboard, so the alert count is live
 * everywhere without each screen subscribing to it separately.
 */
export function ErpAlertWatcher() {
  const permissions = usePermissions();
  const erp = useErpData();
  const allowed = permissions.canView(MODULE.ALERTS);

  useEffect(() => {
    if (!allowed) return undefined;
    return erp.subscribe('alerts', {
      collection: C.ALERTS,
      pageSize: 200,
      orderBy: [{ field: 'createdAt', dir: 'desc' }],
    });
  }, [allowed, erp.subscribe]);

  return null;
}
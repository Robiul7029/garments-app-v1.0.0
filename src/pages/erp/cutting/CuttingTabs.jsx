import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LIVE_ERP_MODULES, erpTabPath, erpModulePath } from '../../../config/erpMenu';
import { MODULE } from '../../../config/erpRoles';

/**
 * ROBIUL GARMENTS ERP — Cutting Department, as one tabbed screen.
 *
 * The two things the cutting floor does with its own record are the two tabs:
 *
 *   1. Cutting Entry   — record one lay / table cut, with the order auto-filled
 *   2. Cutting Report  — the cutting book, the KPI cards and the WIP feed
 *
 * They are tabs rather than two sidebar sub-items for the same reason Line Input
 * & WIP is tabbed: they are two views of one task, and the entry a supervisor
 * makes is read back on the report. Switching is a client-side change — no reload
 * and no trip back to the sidebar.
 *
 * Each tab is still a real URL (`/erp/cutting` and `/erp/cutting/report`), so a tab
 * can be linked, bookmarked and refreshed, and the browser Back button moves
 * between them. The active tab is derived from the path rather than held in state,
 * so the tab bar and the address bar can never disagree.
 *
 * Only the active tab's component is mounted, so opening the report does not
 * construct the entry form behind it and each tab's subscriptions are opened only
 * while that tab is on screen.
 */
export default function CuttingTabs() {
  const location = useLocation();
  const navigate = useNavigate();

  // Resolved from the same module registry the sidebar and the router read, so a
  // tab can never be shown that has no route behind it.
  const config = useMemo(() => {
    const module = LIVE_ERP_MODULES.find(
      (m) => m.key === MODULE.PRODUCTION_CUTTING && Array.isArray(m.tabs) && m.tabs.length > 0,
    );
    if (!module) return null;
    const base = erpModulePath(module.key);
    const rest = location.pathname.slice(base.length).replace(/^\//, '');
    const indexTab = module.tabs.find((t) => t.index) || module.tabs[0];
    const active = module.tabs.find((t) => t.key === rest) || indexTab;
    return { module, tabs: module.tabs, active, indexTab };
  }, [location.pathname]);

  if (!config) return null;
  const { module, tabs, active } = config;
  const ActiveScreen = active.component;

  /** Switching tabs is a navigate, so the URL, the bar and Back stay in step. */
  function go(tab) {
    if (tab.key === active.key) return;
    navigate(erpTabPath(module.key, tab));
  }

  return (
    <div className="erp-page">
      <header className="erp-page-header">
        <div>
          <h1 className="erp-page-title">{module.icon} {module.label}</h1>
          <p className="erp-page-description">{active.description || module.description}</p>
        </div>
      </header>

      {/* `role="tablist"` with roving arrow keys, so this is a real tab control to
          a screen reader rather than two styled buttons. */}
      <div className="erp-tabbar" role="tablist" aria-label="Cutting Department sections">
        {tabs.map((tab, i) => {
          const on = tab.key === active.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`ct-tab-${tab.key}`}
              aria-selected={on}
              aria-controls={`ct-panel-${tab.key}`}
              // Only the active tab is in the tab order; the arrow keys move
              // between them, which is the expected keyboard behaviour.
              tabIndex={on ? 0 : -1}
              className={`erp-tab${on ? ' active' : ''}`}
              onClick={() => go(tab)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                go(next);
                document.getElementById(`ct-tab-${next.key}`)?.focus();
              }}
            >
              <span aria-hidden="true">{tab.icon}</span> {tab.label}
            </button>
          );
        })}
      </div>

      <div
        className="erp-tabpanel"
        role="tabpanel"
        id={`ct-panel-${active.key}`}
        aria-labelledby={`ct-tab-${active.key}`}
      >
        {ActiveScreen ? <ActiveScreen /> : null}
      </div>
    </div>
  );
}

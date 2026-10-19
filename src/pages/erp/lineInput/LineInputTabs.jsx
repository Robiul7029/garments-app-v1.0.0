import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LIVE_ERP_MODULES, erpTabPath, erpModulePath } from '../../../config/erpMenu';
import { MODULE } from '../../../config/erpRoles';

/**
 * ROBIUL GARMENTS ERP — Line Input & WIP, as one tabbed screen.
 *
 * The three things a supervisor or production manager does with line input are
 * the three tabs:
 *
 *   1. Line Input Entry  — record fabric / bundle fed from Cutting into a line
 *   2. WIP & Balance     — what is still sitting on each order and line
 *   3. Input vs Output   — how far each order's material has actually got
 *
 * They are tabs rather than three sidebar sub-items because they are three views
 * of one task — the same reason Order Management is tabbed. Switching is a
 * client-side change: no reload and no trip back to the sidebar.
 *
 * Each tab is still a real URL (`/erp/lineInput`, `/erp/lineInput/wip-balance`,
 * `/erp/lineInput/input-vs-output`), so a tab can be linked, bookmarked and
 * refreshed, and the browser Back button moves between them. The active tab is
 * derived from the path rather than held in state, so the tab bar and the address
 * bar can never disagree.
 *
 * Only the active tab's component is mounted. Opening the WIP table therefore
 * does not construct the entry form behind it, and each tab's data
 * subscriptions are opened only while that tab is on screen.
 */
export default function LineInputTabs() {
  const location = useLocation();
  const navigate = useNavigate();

  // Resolved from the same module registry the sidebar and the router read, so a
  // tab can never be shown that has no route behind it.
  const config = useMemo(() => {
    const module = LIVE_ERP_MODULES.find(
      (m) => m.key === MODULE.LINE_INPUT && Array.isArray(m.tabs) && m.tabs.length > 0,
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
          a screen reader rather than three styled buttons. */}
      <div className="erp-tabbar" role="tablist" aria-label="Line Input and WIP sections">
        {tabs.map((tab, i) => {
          const on = tab.key === active.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`li-tab-${tab.key}`}
              aria-selected={on}
              aria-controls={`li-panel-${tab.key}`}
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
                document.getElementById(`li-tab-${next.key}`)?.focus();
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
        id={`li-panel-${active.key}`}
        aria-labelledby={`li-tab-${active.key}`}
      >
        {ActiveScreen ? <ActiveScreen /> : null}
      </div>
    </div>
  );
}

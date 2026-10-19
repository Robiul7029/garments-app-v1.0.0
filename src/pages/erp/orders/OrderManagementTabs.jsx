import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LIVE_ERP_MODULES, erpTabPath, erpModulePath } from '../../../config/erpMenu';
import { MODULE } from '../../../config/erpRoles';

/**
 * ROBIUL GARMENTS ERP — Order Management, as one tabbed screen.
 *
 * The three things a merchandiser does with an order are the three tabs:
 *
 *   1. Order List          — the order book: status, delivery, progress
 *   2. Order Input         — raise a buyer order
 *   3. Process Sheet Upload — the operation list the floor works from
 *
 * They are tabs rather than three sidebar sub-items because they are three
 * VIEWS OF ONE TASK, not three destinations. Switching is a client-side state
 * change: no reload, and no trip back to the sidebar accordion.
 *
 * Each tab is still a real URL (`/erp/orders`, `/erp/orders/order-input`,
 * `/erp/orders/process-breakdown`), so a tab can be linked, bookmarked and
 * refreshed, and the browser Back button moves between tabs. This component
 * derives the active tab from the path rather than holding it in state — the
 * URL is the single source of truth, so the bar and the address bar can never
 * disagree.
 *
 * The tab a user is not looking at is NOT mounted: only the active tab's
 * component is rendered, so opening the list does not construct the entry form
 * behind it (and does not open that screen's data subscriptions either).
 */
export default function OrderManagementTabs() {
  const location = useLocation();
  const navigate = useNavigate();

  // Resolved from the same module registry the sidebar and the router use, so a
  // tab can never be shown that has no route behind it.
  const config = useMemo(() => {
    const module = LIVE_ERP_MODULES.find(
      (m) => m.key === MODULE.ORDERS && Array.isArray(m.tabs) && m.tabs.length > 0,
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
  // Mounted only for the active tab — see the note above on why the other two
  // screens are deliberately not constructed.
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

      {/* The tab bar. `role="tablist"` + roving arrow keys, so it is a real tab
          control to a screen reader rather than three styled buttons. */}
      <div className="erp-tabbar" role="tablist" aria-label="Order Management sections">
        {tabs.map((tab, i) => {
          const on = tab.key === active.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`oi-tab-${tab.key}`}
              aria-selected={on}
              aria-controls={`oi-panel-${tab.key}`}
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
                document.getElementById(`oi-tab-${next.key}`)?.focus();
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
        id={`oi-panel-${active.key}`}
        aria-labelledby={`oi-tab-${active.key}`}
      >
        {ActiveScreen ? <ActiveScreen /> : null}
      </div>
    </div>
  );
}

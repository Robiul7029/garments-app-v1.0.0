import { useMemo, useState } from 'react';
import LineDeploymentPage from './LineDeploymentPage';
import DataModule from '../components/DataModule';

/**
 * Manpower Management — one screen with a horizontal tab bar.
 *
 * The two things a manpower supervisor does are the two tabs:
 *
 *   1. Line Deployment — the employee directory: a name in, a generated
 *                        Employee ID out, and the list every other form in the
 *                        app selects its employees from
 *   2. Absenteeism     — the day's absent count per line
 *
 * This replaces the sidebar accordion that used to sit under "Manpower
 * Management". The two sub-items were never two destinations so much as two
 * views of one subject, and reaching either meant reopening the drawer and
 * expanding a group. They are now a tab bar on the page itself, so switching is
 * a click where the user is already looking — exactly the change Order
 * Management and Operator Performance already had.
 *
 * WHY STATE AND NOT THE URL: the legacy menu's routes are generated from
 * `navigableTargets()` in menuConfig.js, which flattens each item into its own
 * path. Giving each tab its own route here would mean re-listing the tabs in a
 * second place, and the two lists could drift. The tab lives in component state
 * instead, so the sidebar has exactly one Manpower Management entry pointing at
 * one path — which is the whole point of removing the accordion.
 *
 * The Absenteeism tab is the SAME `DataModule` the generic menu items render, so
 * the app keeps one table renderer and one entry form for it rather than a
 * second copy here. Only the ACTIVE tab is mounted.
 */

/** The category the two screens breadcrumb against. */
const MANPOWER_CATEGORY = { key: 'manpower', label: 'Manpower Management', icon: '🧑‍🏭' };

/**
 * The Absenteeism tab's definition.
 *
 * Held here rather than in `menuConfig` because it is no longer a sidebar entry:
 * the drawer lists one Manpower Management button, and this is what that page's
 * second tab renders. The field list is unchanged from the old sub-item, so the
 * recorded `manpower-absent` rows and any CSV export of them are unaffected.
 */
const ABSENTEEISM_ITEM = {
  key: 'manpower-absent',
  label: 'Absenteeism',
  icon: '🚫',
  variant: 'table',
  userCanAdd: false,
  downloadable: true,
  fields: [
    { name: 'date', label: 'Date', type: 'date' },
    { name: 'line', label: 'Line', type: 'text' },
    { name: 'absent', label: 'Absent Count', type: 'number' },
    { name: 'note', label: 'Note', type: 'text' },
  ],
};

export default function ManpowerManagementTabs() {
  const [active, setActive] = useState('deployment');

  // Label, icon and key only. The tab bar already names the two views, so a
  // sentence underneath would only restate the label; the accent fill marks the
  // active tab and the screen opens straight on its content.
  const tabs = useMemo(() => ([
    { key: 'deployment', label: 'Line Deployment', icon: '👥' },
    { key: 'absenteeism', label: 'Absenteeism', icon: '🚫' },
  ]), []);

  const current = tabs.find((t) => t.key === active) || tabs[0];

  return (
    <div className="module oi-tabs-module">
      <div className="module-header">
        <h2 style={{ margin: 0 }}>🧑‍🏭 Manpower Management</h2>
      </div>

      {/* The tab bar. `role="tablist"` and roving arrow keys, so it is a real tab
          control to a screen reader rather than two styled buttons. */}
      <div className="oi-tabbar" role="tablist" aria-label="Manpower Management sections">
        {tabs.map((tab, i) => {
          const on = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`mp-tab-${tab.key}`}
              aria-selected={on}
              aria-controls={`mp-panel-${tab.key}`}
              // Only the active tab is in the tab order; the arrow keys move
              // between them, which is the expected keyboard behaviour.
              tabIndex={on ? 0 : -1}
              className={`oi-tab${on ? ' active' : ''}`}
              onClick={() => setActive(tab.key)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                setActive(next.key);
                document.getElementById(`mp-tab-${next.key}`)?.focus();
              }}
            >
              <span aria-hidden="true">{tab.icon}</span> {tab.label}
            </button>
          );
        })}
      </div>

      <div
        className="oi-tabpanel"
        role="tabpanel"
        id={`mp-panel-${current.key}`}
        aria-labelledby={`mp-tab-${current.key}`}
      >
        {current.key === 'deployment' && (
          <LineDeploymentPage category={MANPOWER_CATEGORY} item={tabs[0]} />
        )}
        {current.key === 'absenteeism' && (
          <DataModule category={MANPOWER_CATEGORY} item={ABSENTEEISM_ITEM} />
        )}
      </div>
    </div>
  );
}

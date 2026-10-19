import { useMemo, useState } from 'react';
import OrderListTable from '../components/OrderListTable';
import OrderInputPage from './OrderInputPage';
import ProcessUploadPage from './ProcessUploadPage';

/**
 * Order Management — one screen with a horizontal tab bar.
 *
 * The three things a merchandiser does with an order are the three tabs:
 *
 *   1. Order List           — the order book, editable and exportable
 *   2. Order Input          — raise a buyer order
 *   3. Process Sheet Upload — the operation sheet the floor works from
 *
 * This replaces the sidebar accordion that used to sit under "Order Management".
 * The three sub-items were never three destinations so much as three views of
 * one task, and reaching any of them meant reopening the drawer and expanding a
 * group. They are now a tab bar on the page itself, so switching is a click
 * where the user is already looking.
 *
 * WHY STATE AND NOT THE URL: the legacy menu's routes are generated from
 * `navigableTargets()` in menuConfig.js, which flattens each item into its own
 * path. Giving each tab its own route here would mean re-listing the tabs in a
 * second place, and the two lists could drift. The tab lives in component state
 * instead, so the sidebar has exactly one Order Management entry pointing at one
 * path — which is the whole point of removing the accordion.
 *
 * The two capture screens are the SAME components the ERP Order Management tabs
 * use, so the app has one order-entry form and one process-sheet uploader, not
 * one per menu. Only the ACTIVE tab is mounted: opening the list does not build
 * the entry form behind it.
 */

/** The three tabs, in order. `category`/`item` match what the screens expect. */
const ORDER_CATEGORY = { key: 'orders', label: 'Order Management', icon: '📑' };

export default function OrderManagementTabs() {
  const [active, setActive] = useState('list');

  // Label, icon and key only. There is deliberately no description/hint text:
  // the tab bar already names the three views, and a sentence underneath simply
  // restated the tab label. The active tab is marked by the accent fill, so the
  // area below the bar is left clean and the screen opens on its content.
  const tabs = useMemo(() => ([
    { key: 'list', label: 'Order List', icon: '📋' },
    { key: 'order-input', label: 'Order Input', icon: '📝' },
    { key: 'process-upload', label: 'Process Sheet Upload', icon: '📤' },
  ]), []);

  const current = tabs.find((t) => t.key === active) || tabs[0];

  return (
    <div className="module oi-tabs-module">
      <div className="module-header">
        <h2 style={{ margin: 0 }}>📑 Order Management</h2>
      </div>

      {/* The tab bar. `role="tablist"` and roving arrow keys, so it is a real
          tab control to a screen reader rather than three styled buttons. */}
      <div className="oi-tabbar" role="tablist" aria-label="Order Management sections">
        {tabs.map((tab, i) => {
          const on = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`om-tab-${tab.key}`}
              aria-selected={on}
              aria-controls={`om-panel-${tab.key}`}
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
                document.getElementById(`om-tab-${next.key}`)?.focus();
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
        id={`om-panel-${current.key}`}
        aria-labelledby={`om-tab-${current.key}`}
      >
        {/* The list reads the store directly and needs no category/item props. */}
        {current.key === 'list' && <OrderListTable />}
        {current.key === 'order-input' && (
          <OrderInputPage
            category={ORDER_CATEGORY}
            item={{ key: 'order-input', label: 'Order Input', icon: '📝' }}
          />
        )}
        {current.key === 'process-upload' && (
          <ProcessUploadPage
            category={ORDER_CATEGORY}
            item={{ key: 'process-upload', label: 'Process Sheet Upload', icon: '📤' }}
          />
        )}
      </div>
    </div>
  );
}

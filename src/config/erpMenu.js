/**
 * ROBIUL GARMENTS ERP — module registry.
 *
 * The ERP sidebar and the ERP router are both generated from this array, so a
 * link can never appear in the drawer without a matching route (the exact bug
 * the legacy menu had). Each entry is purely declarative: it names a screen
 * component and lets the shared ErpPage shell handle permissions, filters,
 * loading, empty and error states.
 *
 * This is additive. The legacy production/attendance menu in menuConfig.js is
 * untouched and still renders its own groups.
 */
import { MODULE } from './erpRoles';

/**
 * The sub-navigation tabs for the Cutting Department.
 *
 * Two views of one task: the form a cutting supervisor fills in for a lay, and the
 * report that reads the same records back. They are tabs rather than two sidebar
 * sub-items for the same reason Line Input & WIP is tabbed — recording a lay and
 * reading the cutting book are the same job, and splitting them across two drawer
 * entries made the drawer longer without making either screen easier to reach.
 *
 * Each tab is a real, shareable, refreshable URL (`/erp/cutting`,
 * `/erp/cutting/report`) and the browser Back button moves between them.
 *
 * Each tab names its `component` rather than holding a JSX element: this file is a
 * plain `.js` module (it is the registry both the router and the sidebar read), so
 * it cannot carry JSX. The tab host mounts ONLY the active one.
 */
export const CUTTING_TABS = [
  {
    key: 'entry',
    label: 'Cutting Entry',
    icon: '✂️',
    description: 'Record one lay / table cut — the order auto-fills the buyer, style, colour, size range and PO quantity',
    // The module's own index route (`/erp/cutting`).
    index: true,
    component: CuttingEntry,
  },
  {
    key: 'report',
    label: 'Cutting Report',
    icon: '📄',
    description: 'Cutting production report, KPI cards and the cut pieces available to feed a sewing line',
    component: CuttingReport,
  },
];

/**
 * The sub-navigation tabs for a module that declares `tabs`.
 *
 * A tabbed module is ONE sidebar item that opens a screen which switches its
 * own content, rather than an accordion of sub-items. The keys are URL
 * segments, so each tab is still a real, shareable, refreshable URL
 * (`/erp/orders/order-input`) and the browser Back button moves between tabs.
 *
 * Each tab names its `component` rather than holding a JSX element: this file
 * is a plain `.js` module (it is the registry both the router and the sidebar
 * read), so it cannot carry JSX. The tab host is what mounts the component, and
 * it mounts ONLY the active one — opening Order Management does not construct
 * the order-entry form behind the list.
 */
export const LINE_INPUT_TABS = [
  {
    key: 'entry',
    label: 'Line Input Entry',
    icon: '🧺',
    description: 'Record fabric or bundle input from Cutting into the Sewing line',
    // The module's own index route (`/erp/lineInput`).
    index: true,
    component: LineInputEntry,
  },
  {
    key: 'wip-balance',
    label: 'WIP & Balance',
    icon: '⚖️',
    description: 'Work in progress per order and line — input minus completed output',
    component: WipBalance,
  },
  {
    key: 'input-vs-output',
    label: 'Input vs Output',
    icon: '📊',
    description: 'How much was fed into the line against how much was finished and packed',
    component: InputVsOutput,
  },
];

export const ORDER_TABS = [
  {
    key: 'list',
    label: 'Order List',
    icon: '📑',
    description: 'Purchase orders with delivery status and progress',
    // The module's own index route (`/erp/orders`) — see the route builder.
    index: true,
    component: OrderManagement,
  },
  {
    key: 'order-input',
    label: 'Order Input',
    icon: '📝',
    description: 'Raise a buyer order — buyer, style, colour, size and quantity',
    component: OrderInput,
  },
  {
    key: 'process-breakdown',
    label: 'Process Sheet Upload',
    icon: '📤',
    description: 'Upload the operation sheet — SMV and machine type, per style',
    component: ProcessBreakdown,
  },
];

import ErpDashboard from '../pages/erp/dashboard/ErpDashboard';
// The tab host is the module's screen; the three tabs it switches between are
// imported separately below, because the host renders them one at a time.
import OrderManagementTabs from '../pages/erp/orders/OrderManagementTabs';
import OrderManagement from '../pages/erp/orders/OrderManagement';
import OrderInput from '../pages/erp/orders/OrderInput';
import ProcessBreakdown from '../pages/erp/orders/ProcessBreakdown';
// Line Input & WIP tracking — its own tab host, because the three screens answer
// three different questions and a supervisor opens one of them, not all three.
import LineInputTabs from '../pages/erp/lineInput/LineInputTabs';
import LineInputEntry from '../pages/erp/lineInput/LineInputEntry';
import WipBalance from '../pages/erp/lineInput/WipBalance';
import InputVsOutput from '../pages/erp/lineInput/InputVsOutput';
// The Cutting Department's own entry form and report, plus the tab host that
// switches between them.
import CuttingTabs from '../pages/erp/cutting/CuttingTabs';
import CuttingEntry from '../pages/erp/cutting/CuttingEntry';
import CuttingReport from '../pages/erp/cutting/CuttingReport';
import TnaManagement from '../pages/erp/planning/TnaManagement';
import OperatorPerformance from '../pages/erp/production/OperatorPerformance';
// The line master. It is a sibling screen rather than a tab of Operator
// Performance: one is a report, the other is setup data, and they are edited by
// different people.
import ProductionLines from '../pages/erp/production/ProductionLines';
import QualityControl from '../pages/erp/quality/QualityControl';
import ManpowerManagement from '../pages/erp/hr/ManpowerManagement';
import InventoryStock from '../pages/erp/inventory/InventoryStock';
import ReportHub from '../pages/erp/reports/ReportHub';
import AlertCenter from '../pages/erp/alerts/AlertCenter';
import AuditLogScreen from '../pages/erp/audit/AuditLogScreen';

export const ERP_MODULES = [
  {
    key: MODULE.DASHBOARD,
    label: 'Management Dashboard',
    icon: '📊',
    accent: '#38bdf8',
    description: 'KPI cards, production chart, orders and stock on one screen',
    component: ErpDashboard,
    // The dashboard assembles several modules, so it needs read on all of them.
    reads: [
      MODULE.ORDERS, MODULE.PRODUCTION, MODULE.QUALITY, MODULE.INVENTORY,
      MODULE.HR, MODULE.MAINTENANCE, MODULE.PACKING, MODULE.SHIPMENT, MODULE.ALERTS,
    ],
  },
  {
    // Order Management is a TABBED module: one sidebar item that opens a
    // unified screen whose tab bar switches between the order book, the entry
    // form and the process-sheet upload — no accordion, no page reload.
    //
    // It declares `tabs` instead of `children`. The distinction matters:
    // `children` renders as expandable sidebar sub-items, `tabs` renders as a
    // horizontal bar inside the page. A tabbed module still gets one ROUTE per
    // tab from this same array (see erpRoutes), so each tab is a real URL and
    // the browser Back button works — the sidebar just stops listing them.
    key: MODULE.ORDERS,
    label: 'Order Management',
    icon: '📑',
    accent: '#f59e0b',
    description: 'Purchase orders with delivery status and progress',
    reads: [MODULE.ORDERS, MODULE.PRODUCTION],
    tabs: ORDER_TABS,
    // The screen the tab host renders: header + tab bar + the active tab.
    component: OrderManagementTabs,
  },
  {
    key: MODULE.PLANNING,
    label: 'TNA Management',
    icon: '🗓️',
    accent: '#fb923c',
    description: 'Time & Action calendar — milestones from order to shipment',
    component: TnaManagement,
    reads: [MODULE.PLANNING, MODULE.ORDERS],
  },
  {
    key: MODULE.QUALITY,
    label: 'Quality Control',
    icon: '🔍',
    accent: '#22d3ee',
    description: 'Inline, end-line and final inspection with defect tracking',
    component: QualityControl,
    reads: [MODULE.QUALITY, MODULE.PRODUCTION],
  },
  {
    key: MODULE.OPERATOR_PERFORMANCE,
    label: 'Operator Performance',
    icon: '👷',
    accent: '#a855f7',
    description: 'Operator output and individual efficiency against allowed minutes',
    component: OperatorPerformance,
    reads: [MODULE.OPERATOR_PERFORMANCE, MODULE.PRODUCTION],
  },
  {
    // The `productionLines` master — the foreign key the hourly mirror, Line Shift
    // and Line Input & WIP all resolve against. Read on the same right as
    // Operator Performance, because it is production master data.
    key: 'production-lines',
    label: 'Production Lines',
    icon: '🏗️',
    accent: '#38bdf8',
    description: 'The line master — line number, department, supervisor and hourly capacity',
    component: ProductionLines,
    reads: [MODULE.PRODUCTION],
  },
  {
    key: MODULE.PRODUCTION_CUTTING,
    label: 'Cutting Department',
    icon: '✂️',
    accent: '#22d3ee',
    description: 'Lay/table cutting entry and the cutting production report with its WIP feed to sewing',
    reads: [MODULE.PRODUCTION_CUTTING, MODULE.PRODUCTION, MODULE.ORDERS, MODULE.LINE_INPUT],
    tabs: CUTTING_TABS,
    component: CuttingTabs,
  },
  {
    // Line Input & WIP tracking — a TABBED module: one sidebar item whose tab bar
    // switches between the feeding form, the WIP balance table and the
    // input-vs-output comparison. Each tab is its own URL and the Back button
    // moves between them, exactly as Order Management behaves.
    key: MODULE.LINE_INPUT,
    label: 'Line Input & WIP',
    icon: '🧺',
    accent: '#22c55e',
    description: 'Cutting-to-sewing input feeding and the work-in-progress balance',
    reads: [MODULE.LINE_INPUT, MODULE.PRODUCTION, MODULE.PACKING],
    tabs: LINE_INPUT_TABS,
    component: LineInputTabs,
  },
  {
    key: MODULE.MANPOWER,
    label: 'Manpower Management',
    icon: '🧑‍🏭',
    accent: '#f472b6',
    description: 'Line manpower planned against present, shift by shift',
    component: ManpowerManagement,
    reads: [MODULE.MANPOWER, MODULE.HR, MODULE.PRODUCTION],
  },
  {
    key: MODULE.INVENTORY,
    label: 'Inventory & Stock',
    icon: '🏬',
    accent: '#2dd4bf',
    description: 'Live stock balance, minimum-stock alerts and the movement ledger',
    component: InventoryStock,
    reads: [MODULE.INVENTORY, MODULE.PRODUCTION],
  },
  {
    key: MODULE.REPORTS,
    label: 'Reports',
    icon: '📄',
    accent: '#60a5fa',
    description: 'Production, quality, order and stock reports with CSV export',
    component: ReportHub,
    reads: [MODULE.REPORTS, MODULE.PRODUCTION, MODULE.ORDERS, MODULE.INVENTORY],
  },
  {
    key: MODULE.ALERTS,
    label: 'Alert Center',
    icon: '🔔',
    accent: '#f43f5e',
    description: 'Automated business-rule alerts',
    component: AlertCenter,
    reads: [],
  },
  {
    key: MODULE.AUDIT,
    label: 'Audit Log',
    icon: '🗂️',
    accent: '#a78bfa',
    description: 'Every change, with actor and before/after',
    component: AuditLogScreen,
    reads: [],
  },
];

export const ERP_MODULES_BY_KEY = ERP_MODULES.reduce((acc, m) => {
  acc[m.key] = m;
  return acc;
}, {});

/**
 * Modules whose screen does not exist yet (Phase 2-6). They are declared here so
 * the roadmap is data, not prose, and so the dashboard can link to them. They
 * are filtered out of the sidebar by `isLive` rather than being silently absent.
 */
export const PLANNED_MODULES = [
  // Orders / TNA / Quality are no longer listed here: they are LIVE modules in
  // ERP_MODULES above, each with a routed, permission-gated screen. A module
  // listed in both arrays would appear twice in the sidebar.
  { key: MODULE.BUYERS, label: 'Buyers', icon: '🏬', accent: '#f59e0b', phase: 2 },
  { key: MODULE.PROCUREMENT, label: 'Procurement', icon: '📝', accent: '#2dd4bf', phase: 3 },
  { key: MODULE.HR, label: 'HR & Employee', icon: '🧑‍💼', accent: '#a78bfa', phase: 4 },
  { key: MODULE.MAINTENANCE, label: 'Machine & Maintenance', icon: '⚙️', accent: '#fb7185', phase: 4 },
  { key: MODULE.PACKING, label: 'Packing', icon: '📦', accent: '#fb7185', phase: 5 },
  { key: MODULE.SHIPMENT, label: 'Shipment', icon: '🚢', accent: '#a3e635', phase: 5 },
  { key: MODULE.ACCOUNTS, label: 'Accounts & Costing', icon: '💰', accent: '#e879f9', phase: 5 },
  { key: MODULE.USERS, label: 'User Management', icon: '🔐', accent: '#60a5fa', phase: 6 },
];

/** Only the modules whose screen is actually implemented. */
export const LIVE_ERP_MODULES = ERP_MODULES.filter((m) => Boolean(m.component));

export function erpModulePath(key, tab) {
  const base = `/erp/${key}`;
  return tab ? `${base}/${tab}` : base;
}

/**
 * The URL of a nested sub-screen, e.g. /erp/orders/order-input.
 *
 * Built in this file for the same reason `modulePath` is: the sidebar's click
 * target and the router's path are spelled out in one place, so a sub-item can
 * never navigate to a URL no route matches.
 */
export function erpChildPath(moduleKey, childKey) {
  return `${erpModulePath(moduleKey)}/${childKey}`;
}

/**
 * The URL of one tab on a tabbed module.
 *
 * The index tab points at the module path itself rather than `/erp/orders/list`,
 * so the common landing URL stays short and `/erp/orders/list` is not a second
 * URL for the same screen.
 */
export function erpTabPath(moduleKey, tab) {
  if (!tab) return erpModulePath(moduleKey);
  if (tab.index) return erpModulePath(moduleKey);
  return erpChildPath(moduleKey, tab.key);
}

/**
 * Every routed ERP screen, parents and nested children alike, as data.
 *
 * App.jsx maps over this to build its routes and ErpNavGroup maps over the same
 * array to build its links, so the two cannot disagree. A child carries its
 * parent's permission key, because a sub-screen is gated by the module it
 * belongs to rather than by a permission of its own.
 */
export function erpRoutes() {
  const routes = [];
  LIVE_ERP_MODULES.forEach((m) => {
    // A tabbed module mounts its tab HOST at the module path and at every tab
    // path below it, rather than one separate screen per URL. The host reads the
    // URL itself to decide which tab is open, so every tab stays a real route
    // (deep-linkable, Back-button friendly) while the tab bar lives in one
    // component and cannot drift out of step with the sidebar.
    if (Array.isArray(m.tabs) && m.tabs.length > 0 && !m.children?.length) {
      routes.push({
        path: erpModulePath(m.key),
        moduleKey: m.key,
        component: m.component,
        label: m.label,
        icon: m.icon,
        tabs: m.tabs,
        // The first tab that declares itself the index owns `/erp/orders`.
        indexTab: (m.tabs.find((t) => t.index) || m.tabs[0]).key,
      });
      m.tabs.forEach((t) => {
        routes.push({
          path: erpChildPath(m.key, t.key),
          moduleKey: m.key,
          component: m.component,
          label: t.label,
          icon: t.icon,
          parentLabel: m.label,
          tabs: m.tabs,
          activeTab: t.key,
        });
      });
      return;
    }

    routes.push({ path: erpModulePath(m.key), moduleKey: m.key, component: m.component, label: m.label, icon: m.icon });
    (Array.isArray(m.children) ? m.children : [])
      .filter((c) => c?.key && c?.component)
      .forEach((c) => {
        routes.push({
          path: erpChildPath(m.key, c.key),
          moduleKey: m.key,
          component: c.component,
          label: c.label,
          icon: c.icon,
          parentLabel: m.label,
        });
      });
  });
  return routes;
}

/**
 * The tabs of a tabbed module, resolved from the CURRENT path.
 *
 * Returns null for a module that is not tabbed, so the host can simply render
 * its default screen. `activeKey` falls back to the index tab when the path is
 * the bare module path (`/erp/orders`).
 */
export function erpTabsForPath(pathname) {
  const module = LIVE_ERP_MODULES.find(
    (m) => Array.isArray(m.tabs) && m.tabs.length > 0 && pathname.startsWith(erpModulePath(m.key)),
  );
  if (!module) return null;
  const rest = pathname.slice(erpModulePath(module.key).length).replace(/^\//, '');
  const match = module.tabs.find((t) => t.key === rest);
  const indexKey = (module.tabs.find((t) => t.index) || module.tabs[0]).key;
  return { module, tabs: module.tabs, activeKey: match ? match.key : indexKey };
}
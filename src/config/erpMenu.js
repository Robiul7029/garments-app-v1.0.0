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

import ErpDashboard from '../pages/erp/dashboard/ErpDashboard';
import OrderManagement from '../pages/erp/orders/OrderManagement';
import OrderInput from '../pages/erp/orders/OrderInput';
import ProcessBreakdown from '../pages/erp/orders/ProcessBreakdown';
import TnaManagement from '../pages/erp/planning/TnaManagement';
import OperatorPerformance from '../pages/erp/production/OperatorPerformance';
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
    // Order Management is a PARENT: it keeps its own review screen at /erp/orders
    // and nests the two capture screens underneath. A module that declares
    // `children` is rendered by the sidebar as an expandable group and gets one
    // route per child from this same array — see ErpNavGroup and App.jsx.
    key: MODULE.ORDERS,
    label: 'Order Management',
    icon: '📑',
    accent: '#f59e0b',
    description: 'Purchase orders with delivery status and progress',
    component: OrderManagement,
    reads: [MODULE.ORDERS, MODULE.PRODUCTION],
    children: [
      {
        key: 'order-input',
        label: 'Order Input',
        icon: '📝',
        description: 'Raise a buyer order and attach the process breakdown',
        component: OrderInput,
      },
      {
        key: 'process-breakdown',
        label: 'Process Breakdown',
        icon: '🧩',
        description: 'Operation list with SMV and machine type, per style',
        component: ProcessBreakdown,
      },
    ],
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
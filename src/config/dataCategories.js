/**
 * ROBIUL GARMENTS ERP — data categories.
 *
 * WHAT THIS IS
 * ------------
 * Every saved row lives in a collection (`order-model`, `daily-production`, …). This file
 * says WHICH MODULE owns each collection, so the database is filed by category instead of
 * one flat pile:
 *
 *   appData/{category}/{collectionId}/{rowId}
 *   appData/orders/order-model/17
 *   appData/production/daily-production/4921
 *   appData/production/cuttingEntries/88
 *
 * Before this file, `appData/{collectionId}/{rowId}` held every collection side by side at
 * the root. Nothing was lost — the rows were always separate — but the tree gave no clue
 * which module a collection belonged to, and a cutting entry was filed next to an order as
 * if the two were the same kind of thing.
 *
 * ONE SOURCE OF TRUTH
 * -------------------
 * A collection may be named in exactly ONE category. `categoryOf()` therefore needs no
 * priority rules, and the storage layer can build the path without asking a screen which
 * module it is on. The screens did not change: they still call `addEntry('order-model', …)`.
 *
 * FOLDERS vs ROWS
 * ---------------
 * A category document also exists at `appData/{category}` (an empty document created by
 * `ensureCategories`). That is what makes the category a real "folder" in the Firestore
 * console — a bucket with only sub-collections would not be listed under `appData`.
 */
import { MODULE } from './erpRoles';

/** The category ("folder") each module files its rows under. */
export const CATEGORY = {
  ORDERS: 'orders',
  PRODUCTION: 'production',
  QUALITY: 'quality',
  MANPOWER: 'manpower',
  INVENTORY: 'inventory',
  PROCUREMENT: 'procurement',
  HR: 'hr',
  MAINTENANCE: 'maintenance',
  PACKING: 'packing',
  SHIPMENT: 'shipment',
  ACCOUNTS: 'accounts',
  BUYERS: 'buyers',
  PLANNING: 'planning',
};

export const CATEGORY_LABELS = {
  [CATEGORY.ORDERS]: 'Order Management',
  [CATEGORY.PRODUCTION]: 'Daily Production',
  [CATEGORY.QUALITY]: 'Quality Control',
  [CATEGORY.MANPOWER]: 'Manpower Management',
  [CATEGORY.INVENTORY]: 'Store & Inventory',
  [CATEGORY.PROCUREMENT]: 'Procurement',
  [CATEGORY.HR]: 'HR & Employee',
  [CATEGORY.MAINTENANCE]: 'Machine & Maintenance',
  [CATEGORY.PACKING]: 'Packing',
  [CATEGORY.SHIPMENT]: 'Shipment',
  [CATEGORY.ACCOUNTS]: 'Accounts & Costing',
  [CATEGORY.BUYERS]: 'Buyers',
  [CATEGORY.PLANNING]: 'TNA Management',
};

/**
 * Collection key -> category.
 *
 * Keys are the `appData` collection ids the screens already write (see DataContext and
 * config/orderWorkflow.js). The ERP collections are listed too, so a collection that is
 * mirrored into `appData` later is filed sensibly from day one.
 */
export const COLLECTION_CATEGORY = {
  // ---- Order Management ----
  'order-model': CATEGORY.ORDERS,
  'process-breakdown': CATEGORY.ORDERS,
  'process-sheets': CATEGORY.ORDERS,
  orders: CATEGORY.ORDERS,
  purchaseOrders: CATEGORY.ORDERS,
  poLines: CATEGORY.ORDERS,
  styles: CATEGORY.ORDERS,
  colors: CATEGORY.ORDERS,
  sizes: CATEGORY.ORDERS,

  // ---- Production (the Daily Production area and the lines behind it) ----
  'daily-production': CATEGORY.PRODUCTION,
  'worker-production': CATEGORY.PRODUCTION,
  'hourly-timesheet-rows': CATEGORY.PRODUCTION,
  'cutting-plan': CATEGORY.PRODUCTION,
  'cutting-production': CATEGORY.PRODUCTION,
  'finishing-production': CATEGORY.PRODUCTION,
  'line-inputs': CATEGORY.PRODUCTION,
  'line-deployment': CATEGORY.PRODUCTION,
  'operator-performance': CATEGORY.PRODUCTION,
  cuttingEntries: CATEGORY.PRODUCTION,
  lineInputs: CATEGORY.PRODUCTION,
  dailyProduction: CATEGORY.PRODUCTION,
  hourlyProduction: CATEGORY.PRODUCTION,
  lineShifts: CATEGORY.PRODUCTION,
  productionLines: CATEGORY.PRODUCTION,
  cuttingPlans: CATEGORY.PRODUCTION,
  cuttingBatches: CATEGORY.PRODUCTION,

  // ---- Quality ----
  'quality-control': CATEGORY.QUALITY,
  'quality-check': CATEGORY.QUALITY,
  'quality-check-items': CATEGORY.QUALITY,
  defectCategories: CATEGORY.QUALITY,
  inlineQc: CATEGORY.QUALITY,
  endLineQc: CATEGORY.QUALITY,
  finalInspections: CATEGORY.QUALITY,

  // ---- Manpower / HR / attendance / payroll ----
  'employee-directory': CATEGORY.MANPOWER,
  'line-roster': CATEGORY.MANPOWER,
  'designation-options': CATEGORY.MANPOWER,
  'manpower-plan': CATEGORY.MANPOWER,
  'daily-attendance': CATEGORY.MANPOWER,
  'attendance-leave': CATEGORY.MANPOWER,
  late: CATEGORY.MANPOWER,
  salary: CATEGORY.HR,
  employees: CATEGORY.MANPOWER,
  'leave-requests': CATEGORY.HR,
  employeesErp: CATEGORY.HR,
  leaveRequests: CATEGORY.HR,
  overtimeRequests: CATEGORY.HR,
  workers: CATEGORY.HR,
  attendance: CATEGORY.HR,

  // ---- Store, procurement, buyers, planning ----
  'fabric-material': CATEGORY.INVENTORY,
  stores: CATEGORY.INVENTORY,
  items: CATEGORY.INVENTORY,
  stockLedger: CATEGORY.INVENTORY,
  suppliers: CATEGORY.PROCUREMENT,
  purchaseRequests: CATEGORY.PROCUREMENT,
  grns: CATEGORY.PROCUREMENT,
  buyers: CATEGORY.BUYERS,
  buyerContacts: CATEGORY.BUYERS,
  tnaTasks: CATEGORY.PLANNING,
  shipmentPlans: CATEGORY.SHIPMENT,

  // ---- Maintenance, packing, shipment, accounts ----
  machines: CATEGORY.MAINTENANCE,
  maintenanceRequests: CATEGORY.MAINTENANCE,
  'packing-plan': CATEGORY.PACKING,
  packingPlans: CATEGORY.PACKING,
  cartons: CATEGORY.PACKING,
  'washing-plan': CATEGORY.PACKING,
  'send-to-washing': CATEGORY.PACKING,
  'received-from-washing': CATEGORY.PACKING,
  'washing-status': CATEGORY.PACKING,
  'delivery-plan': CATEGORY.SHIPMENT,
  'ready-for-delivery': CATEGORY.SHIPMENT,
  delivered: CATEGORY.SHIPMENT,
  'pending-delivery': CATEGORY.SHIPMENT,
  costHeads: CATEGORY.ACCOUNTS,
  expenses: CATEGORY.ACCOUNTS,
};

/**
 * Where a collection is filed. An unknown key (a new screen added later) falls back to
 * `uncategorized` rather than failing the save: a record saved in the wrong folder is far
 * better than a record that could not be saved at all — and the fallback is a visible
 * folder in the console, so it is easy to find and name.
 */
export const UNCATEGORIZED = 'uncategorized';

export function categoryOf(collectionId) {
  const key = String(collectionId || '');
  return COLLECTION_CATEGORY[key] || UNCATEGORIZED;
}

/** The category a MODULE writes under (used by screens that save through the ERP). */
export function categoryForModule(moduleKey) {
  const map = {
    [MODULE.ORDERS]: CATEGORY.ORDERS,
    [MODULE.BUYERS]: CATEGORY.BUYERS,
    [MODULE.PLANNING]: CATEGORY.PLANNING,
    [MODULE.PRODUCTION]: CATEGORY.PRODUCTION,
    [MODULE.OPERATOR_PERFORMANCE]: CATEGORY.PRODUCTION,
    [MODULE.PRODUCTION_CUTTING]: CATEGORY.PRODUCTION,
    [MODULE.LINE_INPUT]: CATEGORY.PRODUCTION,
    [MODULE.QUALITY]: CATEGORY.QUALITY,
    [MODULE.MANPOWER]: CATEGORY.MANPOWER,
    [MODULE.HR]: CATEGORY.HR,
    [MODULE.INVENTORY]: CATEGORY.INVENTORY,
    [MODULE.PROCUREMENT]: CATEGORY.PROCUREMENT,
    [MODULE.MAINTENANCE]: CATEGORY.MAINTENANCE,
    [MODULE.PACKING]: CATEGORY.PACKING,
    [MODULE.SHIPMENT]: CATEGORY.SHIPMENT,
    [MODULE.ACCOUNTS]: CATEGORY.ACCOUNTS,
  };
  return map[moduleKey] || categoryOf(null);
}

/** Every category id, for creating the folder documents at startup. */
export const ALL_CATEGORIES = Object.values(CATEGORY);

/** The collections filed under one category, for a category view. */
export function collectionsIn(category) {
  return Object.entries(COLLECTION_CATEGORY)
    .filter(([, value]) => value === category)
    .map(([key]) => key);
}

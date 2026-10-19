/**
 * ROBIUL GARMENTS ERP — Data Dictionary
 *
 * Every Firestore collection the ERP owns, its fields, its relationships and
 * the composite indexes it needs. Documents reference other documents by id
 * (the equivalent of a foreign key) and this file is the single place those
 * references are spelled out, so a rename cannot happen in one module only.
 *
 * Firestore has no server-side constraints, so uniqueness (no duplicate PO
 * number, no duplicate employee id) is enforced by validationService against a
 * dedicated natural-key index document, written inside a transaction.
 *
 * FILE STRUCTURE (categories)
 * ---------------------------
 * A collection is also filed under the module that owns it, so the database tree reads
 * as modules rather than one flat list:
 *
 *   appData/{category}/{collection}/{row}     category path — where new rows are written
 *   appData/{collection}/{row}                legacy flat path — still read while migrating
 *
 * `config/dataCategories.js` owns that mapping; `SIGNED_IN_COLLECTIONS` below is the
 * exception, spelled out here because those paths are built by the repository itself.
 */

// ---- Collections -----------------------------------------------------------
export const C = {
  // Buyer / order chain
  BUYERS: 'buyers',
  BUYER_CONTACTS: 'buyerContacts',
  ORDERS: 'orders',
  PURCHASE_ORDERS: 'purchaseOrders',
  PO_LINES: 'poLines',
  STYLES: 'styles',
  COLORS: 'colors',
  SIZES: 'sizes',
  TNA_TASKS: 'tnaTasks',
  SHIPMENT_PLANS: 'shipmentPlans',

  // Production
  PRODUCTION_LINES: 'productionLines',
  LINE_SHIFTS: 'lineShifts',
  HOURLY_PRODUCTION: 'hourlyProduction',
  DAILY_PRODUCTION: 'dailyProduction',
  CUTTING_PLANS: 'cuttingPlans',
  CUTTING_BATCHES: 'cuttingBatches',
  // The Cutting Department's own daily entry: one document per lay/table cut.
  // This is the record the Cutting Report aggregates and the figure the sewing
  // line's WIP is fed from.
  CUTTING_ENTRIES: 'cuttingEntries',
  // Cutting → Sewing feeding: the fabric / bundle quantity a line receives.
  LINE_INPUTS: 'lineInputs',

  // Quality
  DEFECT_CATEGORIES: 'defectCategories',
  INLINE_QC: 'inlineQc',
  END_LINE_QC: 'endLineQc',
  FINAL_INSPECTIONS: 'finalInspections',

  // Inventory / procurement
  STORES: 'stores',
  ITEMS: 'items',
  STOCK_LEDGER: 'stockLedger',
  SUPPLIERS: 'suppliers',
  PURCHASE_REQUESTS: 'purchaseRequests',
  GRNS: 'grns',

  // HR
  EMPLOYEES: 'employeesErp',
  LEAVE_REQUESTS: 'leaveRequests',
  OVERTIME_REQUESTS: 'overtimeRequests',

  // Maintenance
  MACHINES: 'machines',
  MAINTENANCE_REQUESTS: 'maintenanceRequests',

  // Logistics
  PACKING_PLANS: 'packingPlans',
  CARTONS: 'cartons',

  // Finance
  COST_HEADS: 'costHeads',
  EXPENSES: 'expenses',

  // Platform
  AUDIT_LOGS: 'auditLogs',
  ALERTS: 'erpAlerts',
  APPROVALS: 'erpApprovals',
  UNIQUE_KEYS: 'uniqueKeys',
  SETTINGS: 'erpSettings',
};

// ---- Enumerations ----------------------------------------------------------
export const ORDER_STATUS = {
  NEW: 'New',
  CONFIRMED: 'Confirmed',
  PRODUCTION: 'Production',
  PARTIALLY_COMPLETED: 'Partially Completed',
  READY_TO_SHIP: 'Ready to Ship',
  SHIPPED: 'Shipped',
  COMPLETED: 'Completed',
  INACTIVE: 'Inactive',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
  CANCELLED: 'Cancelled',
  DELAYED: 'Delayed',
};

export const SHIPMENT_STATUS = {
  PLANNED: 'Planned',
  READY: 'Ready',
  PARTIAL: 'Partial Shipment',
  SHIPPED: 'Shipped',
  COMPLETED: 'Completed',
  DELAYED: 'Delayed',
};

export const TNA_STATUS = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  DELAYED: 'Delayed',
};

export const SEVERITY = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
};

// Visual indicator used everywhere: 🟢 good, 🟠 warning, 🔴 critical.
export const SEVERITY_DOT = {
  critical: '🔴',
  warning: '🟠',
  info: '🟢',
};

export const QC_RESULT = {
  PASS: 'Pass',
  FAIL: 'Fail',
  PENDING: 'Pending',
};

export const STOCK_MOVE_TYPE = {
  OPENING: 'Opening',
  GRN: 'GRN',
  ISSUE: 'Issue',
  RETURN: 'Return',
  ADJUSTMENT: 'Adjustment',
  TRANSFER: 'Transfer',
};

export const MAINTENANCE_STATUS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  PREVENTIVE: 'Preventive',
};

export const APPROVAL_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

/**
 * How a line input reached the sewing line. The brief records "fabric or bundle
 * inputs coming from the Cutting section", so the type distinguishes a loose
 * fabric issue from a numbered bundle — the two behave differently on the floor
 * (a bundle has a bundle number, fabric is weighed or measured).
 */
export const LINE_INPUT_TYPE = {
  BUNDLE: 'Bundle',
  FABRIC: 'Fabric',
  PANEL: 'Panel',
  SAMPLE: 'Sample',
  REJECT_REWORK: 'Reject Rework',
};

/** The unit fabric consumption is measured in, on the cutting entry form. */
export const FABRIC_UNIT = {
  YARDS: 'Yards',
  METERS: 'Meters',
};

/**
 * Where a cutting entry's cut pieces have got to. Drives the report's status
 * badge and the "Ready Stock for Sewing Feeding" KPI.
 */
export const CUTTING_STATUS = {
  READY: 'Ready',
  PARTIAL: 'Partially Issued',
  ISSUED: 'Issued to Sewing',
};

/**
 * The stage an input is feeding. Cutting → Sewing is the brief's default, but the
 * same collection also records a re-feed after rework, which is why the stage is
 * a field rather than being assumed.
 */
export const LINE_INPUT_STAGE = {
  CUTTING_TO_SEWING: 'Cutting to Sewing',
  SEWING_TO_FINISHING: 'Sewing to Finishing',
  REWORK: 'Rework',
};

/** The shift an input was fed on. Kept beside LINE_SHIFTS' options for consistency. */
export const INPUT_SHIFT = {
  MORNING: 'Morning',
  EVENING: 'Evening',
  NIGHT: 'Night',
};

/** Cost heads roll up into these buckets; the list is the costing report order. */
export const COST_CATEGORIES = [
  'Fabric',
  'Accessories',
  'Cutting',
  'Sewing',
  'Finishing',
  'Packing',
  'Labour',
  'Salary',
  'Overhead',
  'Other',
];

// ---- Foreign-key map -------------------------------------------------------
// `from` collection references `to` collection through `field`.
export const RELATIONS = [
  { from: C.BUYERS, field: 'buyerId', to: C.ORDERS },
  { from: C.ORDERS, field: 'orderId', to: C.PURCHASE_ORDERS },
  { from: C.ORDERS, field: 'orderId', to: C.TNA_TASKS },
  { from: C.ORDERS, field: 'orderId', to: C.SHIPMENT_PLANS },
  { from: C.PURCHASE_ORDERS, field: 'poId', to: C.PO_LINES },
  { from: C.STYLES, field: 'styleId', to: C.PO_LINES },
  { from: C.ORDERS, field: 'orderId', to: C.COST_HEADS },
  { from: C.PRODUCTION_LINES, field: 'lineId', to: C.LINE_SHIFTS },
  { from: C.PRODUCTION_LINES, field: 'lineId', to: C.HOURLY_PRODUCTION },
  { from: C.PRODUCTION_LINES, field: 'lineId', to: C.INLINE_QC },
  { from: C.PRODUCTION_LINES, field: 'lineId', to: C.END_LINE_QC },
  { from: C.PRODUCTION_LINES, field: 'lineId', to: C.CUTTING_PLANS },
  { from: C.PRODUCTION_LINES, field: 'lineId', to: C.LINE_INPUTS },
  { from: C.STYLES, field: 'styleId', to: C.LINE_INPUTS },
  { from: C.COLORS, field: 'colorId', to: C.LINE_INPUTS },
  { from: C.ORDERS, field: 'orderId', to: C.LINE_INPUTS },
  { from: C.STYLES, field: 'styleId', to: C.CUTTING_BATCHES },
  { from: C.COLORS, field: 'colorId', to: C.CUTTING_BATCHES },
  { from: C.PRODUCTION_LINES, field: 'lineId', to: C.MACHINES },
  { from: C.MACHINES, field: 'machineId', to: C.MAINTENANCE_REQUESTS },
  { from: C.ITEMS, field: 'itemId', to: C.STOCK_LEDGER },
  { from: C.STORES, field: 'storeId', to: C.STOCK_LEDGER },
  { from: C.SUPPLIERS, field: 'supplierId', to: C.PURCHASE_REQUESTS },
  { from: C.PURCHASE_REQUESTS, field: 'requestId', to: C.GRNS },
  { from: C.SUPPLIERS, field: 'supplierId', to: C.ITEMS },
  { from: C.EMPLOYEES, field: 'employeeId', to: C.LEAVE_REQUESTS },
  { from: C.EMPLOYEES, field: 'employeeId', to: C.OVERTIME_REQUESTS },
  { from: C.PACKING_PLANS, field: 'planId', to: C.CARTONS },
  { from: C.STYLES, field: 'styleId', to: C.CARTONS },
  { from: C.COLORS, field: 'colorId', to: C.CARTONS },
  { from: C.SHIPMENT_PLANS, field: 'shipmentId', to: C.CARTONS },
  { from: C.ORDERS, field: 'orderId', to: C.CARTONS },
  { from: C.EMPLOYEES, field: 'employeeId', to: C.HOURLY_PRODUCTION },
];

// ---- Field definitions -----------------------------------------------------
// `type` drives validation and form rendering. `required` is enforced on save.
// Fields marked `sys` are written by the system (createdAt, createdBy) and are
// never rendered in a form.
const F = (name, label, type, opts = {}) => ({ name, label, type, ...opts });

export const SCHEMA = {
  [C.BUYERS]: {
    label: 'Buyer',
    icon: '🏬',
    uniqueKey: 'buyerCode',
    fields: [
      F('buyerCode', 'Buyer Code', 'text', { required: true, unique: true }),
      F('name', 'Buyer Name', 'text', { required: true }),
      F('country', 'Country', 'text'),
      F('address', 'Address', 'textarea'),
      F('paymentTerms', 'Payment Terms', 'text'),
      F('merchandiser', 'Merchandiser', 'text'),
      F('active', 'Active', 'boolean', { default: true }),
    ],
  },

  [C.BUYER_CONTACTS]: {
    label: 'Buyer Contact',
    icon: '📇',
    fields: [
      F('buyerId', 'Buyer', 'ref:BUYERS', { required: true }),
      F('name', 'Contact Name', 'text', { required: true }),
      F('designation', 'Designation', 'text'),
      F('email', 'Email', 'email'),
      F('phone', 'Phone', 'text'),
    ],
  },

  [C.ORDERS]: {
    label: 'Order',
    icon: '📑',
    uniqueKey: 'orderNo',
    fields: [
      F('orderNo', 'Order No', 'text', { required: true, unique: true }),
      F('buyerId', 'Buyer', 'ref:BUYERS', { required: true }),
      F('orderDate', 'Order Date', 'date', { required: true }),
      F('deliveryDate', 'Delivery Date', 'date', { required: true }),
      F('season', 'Season', 'text'),
      F('status', 'Status', 'select', {
        required: true,
        options: Object.values(ORDER_STATUS),
        default: ORDER_STATUS.NEW,
      }),
      F('totalQty', 'Total Qty', 'number', { required: true, min: 1 }),
      F('totalValue', 'Total Value', 'number', { min: 0 }),
      F('currency', 'Currency', 'text', { default: 'USD' }),
      F('remarks', 'Remarks', 'textarea'),
    ],
  },

  [C.PURCHASE_ORDERS]: {
    label: 'Purchase Order',
    icon: '🧾',
    uniqueKey: 'poNo',
    fields: [
      F('poNo', 'PO No', 'text', { required: true, unique: true }),
      F('orderId', 'Order', 'ref:ORDERS', { required: true }),
      F('buyerId', 'Buyer', 'ref:BUYERS', { required: true }),
      F('poDate', 'PO Date', 'date', { required: true }),
      F('shipmentDate', 'Shipment Date', 'date', { required: true }),
      F('status', 'Status', 'select', {
        options: Object.values(ORDER_STATUS),
        default: ORDER_STATUS.NEW,
      }),
      F('totalQty', 'Total Qty', 'number', { required: true, min: 1 }),
      F('shippedQty', 'Shipped Qty', 'number', { default: 0, min: 0 }),
      F('remarks', 'Remarks', 'textarea'),
    ],
  },

  [C.PO_LINES]: {
    label: 'PO Line',
    icon: '▪️',
    fields: [
      F('poId', 'PO', 'ref:PURCHASE_ORDERS', { required: true }),
      F('styleId', 'Style', 'ref:STYLES', { required: true }),
      F('colorId', 'Color', 'ref:COLORS'),
      F('sizeId', 'Size', 'ref:SIZES'),
      F('qty', 'Qty', 'number', { required: true, min: 1 }),
      F('shippedQty', 'Shipped Qty', 'number', { default: 0, min: 0 }),
      F('rate', 'Rate', 'number', { min: 0 }),
    ],
  },

  [C.STYLES]: {
    label: 'Style',
    icon: '👕',
    uniqueKey: 'styleNo',
    fields: [
      F('styleNo', 'Style No', 'text', { required: true, unique: true }),
      F('name', 'Style Name', 'text', { required: true }),
      F('buyerId', 'Buyer', 'ref:BUYERS', { required: true }),
      F('fabric', 'Fabric', 'text'),
      F('smv', 'SMV', 'number', { min: 0 }),
      F('imageUrl', 'Image URL', 'text'),
      F('active', 'Active', 'boolean', { default: true }),
    ],
  },

  [C.COLORS]: {
    label: 'Color',
    icon: '🎨',
    uniqueKey: 'code',
    fields: [
      F('name', 'Color Name', 'text', { required: true }),
      F('code', 'Color Code', 'text', { required: true, unique: true }),
    ],
  },

  [C.SIZES]: {
    label: 'Size',
    icon: '📏',
    uniqueKey: 'name',
    fields: [
      F('name', 'Size', 'text', { required: true }),
      F('sortOrder', 'Sort Order', 'number', { default: 1 }),
    ],
  },

  [C.TNA_TASKS]: {
    label: 'TNA Task',
    icon: '🗓️',
    fields: [
      F('orderId', 'Order', 'ref:ORDERS', { required: true }),
      F('poId', 'PO', 'ref:PURCHASE_ORDERS'),
      F('stage', 'Stage', 'text', { required: true }),
      F('responsible', 'Responsible', 'text'),
      F('plannedDate', 'Planned Date', 'date', { required: true }),
      F('actualDate', 'Actual Date', 'date'),
      F('isCritical', 'Critical Path', 'boolean', { default: false }),
      F('status', 'Status', 'select', {
        options: Object.values(TNA_STATUS),
        default: TNA_STATUS.PENDING,
      }),
      F('delayDays', 'Delay (days)', 'number', { default: 0 }),
    ],
  },

  [C.PRODUCTION_LINES]: {
    label: 'Production Line',
    icon: '🏗️',
    uniqueKey: 'lineNo',
    fields: [
      F('lineNo', 'Line No', 'text', { required: true, unique: true }),
      F('name', 'Line Name', 'text', { required: true }),
      F('department', 'Department', 'text', { required: true }),
      F('supervisorId', 'Supervisor', 'ref:EMPLOYEES'),
      F('capacityPerHour', 'Capacity (pcs/hr)', 'number', { default: 0, min: 0 }),
      F('active', 'Active', 'boolean', { default: true }),
    ],
  },

  [C.LINE_SHIFTS]: {
    label: 'Line Shift',
    icon: '👷',
    fields: [
      F('lineId', 'Line', 'ref:PRODUCTION_LINES', { required: true }),
      F('date', 'Date', 'date', { required: true }),
      F('shift', 'Shift', 'select', { options: ['Morning', 'Evening', 'Night'], required: true }),
      F('supervisorId', 'Supervisor', 'ref:EMPLOYEES'),
      F('manpower', 'Manpower', 'number', { required: true, min: 0 }),
      F('presentCount', 'Present', 'number', { min: 0 }),
      F('smv', 'SMV', 'number', { min: 0 }),
    ],
  },

  [C.HOURLY_PRODUCTION]: {
    label: 'Hourly Production',
    icon: '⏱️',
    fields: [
      F('lineId', 'Line', 'ref:PRODUCTION_LINES', { required: true }),
      F('date', 'Date', 'date', { required: true }),
      F('hourSlot', 'Hour Slot', 'text', { required: true }),
      F('poId', 'PO', 'ref:PURCHASE_ORDERS'),
      F('styleId', 'Style', 'ref:STYLES'),
      F('target', 'Target', 'number', { required: true, min: 0 }),
      F('actual', 'Actual', 'number', { required: true, min: 0 }),
      F('rework', 'Rework', 'number', { default: 0, min: 0 }),
      F('reject', 'Reject', 'number', { default: 0, min: 0 }),
      F('downtimeMin', 'Downtime (min)', 'number', { default: 0, min: 0 }),
      F('employeeId', 'Entered By', 'ref:EMPLOYEES'),
      F('syncId', 'Sync Idempotency Key', 'text', { sys: true }),
    ],
  },

  [C.CUTTING_PLANS]: {
    label: 'Cutting Plan',
    icon: '✂️',
    fields: [
      F('styleId', 'Style', 'ref:STYLES', { required: true }),
      F('poId', 'PO', 'ref:PURCHASE_ORDERS'),
      F('cuttingDate', 'Cutting Date', 'date', { required: true }),
      F('plannedQty', 'Planned Qty', 'number', { required: true, min: 1 }),
      F('cutQty', 'Cut Qty', 'number', { default: 0, min: 0 }),
      F('remarks', 'Remarks', 'textarea'),
    ],
  },

  [C.CUTTING_BATCHES]: {
    label: 'Cutting Batch',
    icon: '🧵',
    fields: [
      F('planId', 'Cutting Plan', 'ref:CUTTING_PLANS'),
      F('styleId', 'Style', 'ref:STYLES', { required: true }),
      F('colorId', 'Color', 'ref:COLORS'),
      F('layQty', 'No. of Lay', 'number', { min: 0 }),
      F('date', 'Date', 'date', { required: true }),
      F('cutQty', 'Cut Qty', 'number', { required: true, min: 0 }),
      F('shortfallReason', 'Shortfall Reason', 'text'),
    ],
  },

  // The Cutting Department's dedicated daily entry.
  //
  // One document per lay/table cut. The buyer / style / colour / size range / PO
  // quantity are COPIED onto the row from the selected order rather than only
  // referenced by id: the cutting book is a floor document that has to print and
  // export without a join, and an order amended later must not silently rewrite
  // what was actually cut against it. The order reference is kept alongside so a
  // report can still group by order.
  [C.CUTTING_ENTRIES]: {
    label: 'Cutting Entry',
    icon: '✂️',
    fields: [
      // ---- Order selection (auto-fills the five fields below it) ----
      F('order_no', 'Order No', 'text', { required: true }),
      F('buyer', 'Buyer', 'text', { required: true }),
      F('style', 'Style No', 'text', { required: true }),
      F('color', 'Color', 'text', { required: true }),
      F('sizeRange', 'Size Range', 'text', { required: true }),
      F('poQty', 'PO Qty', 'number', { min: 0 }),
      // ---- The cutting inputs ----
      F('date', 'Date', 'date', { required: true }),
      // "Lay / Table No" — the cutting table a lay was spread on. A factory may run
      // several lays of the same order, so this is what makes one entry distinct
      // from the next on the same day.
      F('layNo', 'Lay / Table No', 'text', { required: true }),
      F('markerLength', 'Marker Length', 'number', { min: 0 }),
      F('fabricConsumed', 'Fabric Consumed', 'number', { required: true, min: 0 }),
      F('fabricUnit', 'Fabric Unit', 'select', {
        options: Object.values(FABRIC_UNIT),
        default: FABRIC_UNIT.YARDS,
      }),
      F('cutQty', 'Total Cut Quantity', 'number', { required: true, min: 1 }),
      // How much of the cut quantity has been handed to a sewing line. Written by
      // the feeding action (or entered here when the issue happens at the table),
      // and what the report's "Remaining Balance in Cutting Stock" subtracts.
      F('issuedQty', 'Issued to Sewing Line', 'number', { default: 0, min: 0 }),
      F('supervisor', 'Cutting Supervisor', 'text'),
      F('remarks', 'Remarks', 'textarea'),
      // ---- Relationships (foreign keys) ----
      F('orderId', 'Order', 'ref:ORDERS'),
      F('styleId', 'Style Ref', 'ref:STYLES'),
      F('colorId', 'Color Ref', 'ref:COLORS'),
      F('syncId', 'Sync Idempotency Key', 'text', { sys: true }),
    ],
  },

  [C.LINE_INPUTS]: {
    label: 'Line Input',
    icon: '🧺',
    fields: [
      // ---- Identity of the input (the brief's required fields) ----
      // The order number is the thread that ties an input to its order, the same
      // way a production row is keyed on `order_no` elsewhere in the app. It is
      // required because an input with no order cannot be balanced against output.
      F('order_no', 'Order No', 'text', { required: true }),
      F('style', 'Style', 'text', { required: true }),
      F('color', 'Color', 'text', { required: true }),
      F('sizeRange', 'Size Range', 'text', { required: true }),
      F('inputQty', 'Input Quantity', 'number', { required: true, min: 1 }),
      F('line_no', 'Line No', 'text', { required: true }),
      // The moment the input was fed. A supervisor records several inputs in a
      // shift, so the timestamp (not just the date) is what orders them.
      F('timestamp', 'Timestamp', 'datetime', { required: true }),
      // ---- Classification ----
      F('inputType', 'Input Type', 'select', {
        options: Object.values(LINE_INPUT_TYPE),
        default: LINE_INPUT_TYPE.BUNDLE,
      }),
      F('stage', 'Stage', 'select', {
        options: Object.values(LINE_INPUT_STAGE),
        default: LINE_INPUT_STAGE.CUTTING_TO_SEWING,
      }),
      F('shift', 'Shift', 'select', { options: Object.values(INPUT_SHIFT), default: INPUT_SHIFT.MORNING }),
      // The cut bundle / lot number this input came from, so a bundle can be
      // traced back to its cutting batch. Optional: loose fabric has no bundle.
      F('bundleNo', 'Bundle / Lot No', 'text'),
      F('cuttingBatchId', 'Cutting Batch', 'ref:CUTTING_BATCHES'),
      // ---- Relationships (foreign keys) ----
      // Kept alongside the free-text order_no/style/line_no so the screen works
      // with either the ERP master ids or the floor's own names, exactly as the
      // production rows do.
      F('orderId', 'Order', 'ref:ORDERS'),
      F('poId', 'PO', 'ref:PURCHASE_ORDERS'),
      F('styleId', 'Style Ref', 'ref:STYLES'),
      F('colorId', 'Color Ref', 'ref:COLORS'),
      F('lineId', 'Line Ref', 'ref:PRODUCTION_LINES'),
      F('receivedBy', 'Received By', 'text'),
      F('remarks', 'Remarks', 'textarea'),
      F('syncId', 'Sync Idempotency Key', 'text', { sys: true }),
    ],
  },

  [C.DEFECT_CATEGORIES]: {
    label: 'Defect Category',
    icon: '🐞',
    fields: [
      F('name', 'Defect', 'text', { required: true }),
      F('category', 'Category', 'select', {
        options: ['Stitching', 'Measurement', 'Fabric', 'Accessory', 'Color', 'Finishing', 'Packing', 'Other'],
        default: 'Stitching',
      }),
      F('severity', 'Severity', 'select', { options: ['Minor', 'Major', 'Critical'], default: 'Major' }),
      F('dhUnit', 'DHU Weight', 'number', { default: 1, min: 0 }),
      F('active', 'Active', 'boolean', { default: true }),
    ],
  },

  [C.INLINE_QC]: {
    label: 'Inline QC',
    icon: '🔍',
    fields: [
      F('date', 'Date', 'date', { required: true }),
      F('lineId', 'Line', 'ref:PRODUCTION_LINES', { required: true }),
      F('poId', 'PO', 'ref:PURCHASE_ORDERS'),
      F('styleId', 'Style', 'ref:STYLES'),
      F('inspectorId', 'Inspector', 'ref:EMPLOYEES'),
      F('checkedQty', 'Checked Qty', 'number', { required: true, min: 1 }),
      F('defectQty', 'Defect Qty', 'number', { default: 0, min: 0 }),
      F('reworkQty', 'Rework', 'number', { default: 0, min: 0 }),
      F('rejectQty', 'Reject', 'number', { default: 0, min: 0 }),
      F('defectType', 'Defect Type', 'ref:DEFECT_CATEGORIES'),
      F('remarks', 'Remarks', 'textarea'),
    ],
  },

  [C.END_LINE_QC]: {
    label: 'End Line QC',
    icon: '🔎',
    fields: [
      F('date', 'Date', 'date', { required: true }),
      F('lineId', 'Line', 'ref:PRODUCTION_LINES', { required: true }),
      F('poId', 'PO', 'ref:PURCHASE_ORDERS'),
      F('inspectorId', 'Inspector', 'ref:EMPLOYEES'),
      F('checkedQty', 'Checked Qty', 'number', { required: true, min: 1 }),
      F('passedQty', 'Passed Qty', 'number', { default: 0, min: 0 }),
      F('failedQty', 'Failed Qty', 'number', { default: 0, min: 0 }),
      F('reworkQty', 'Rework', 'number', { default: 0, min: 0 }),
      F('rejectQty', 'Reject', 'number', { default: 0, min: 0 }),
    ],
  },

  [C.FINAL_INSPECTIONS]: {
    label: 'Final Inspection',
    icon: '✅',
    fields: [
      F('date', 'Date', 'date', { required: true }),
      F('poId', 'PO', 'ref:PURCHASE_ORDERS', { required: true }),
      F('inspectorId', 'Inspector', 'ref:EMPLOYEES'),
      F('aql', 'AQL', 'text', { required: true }),
      F('sampleSize', 'Sample Size', 'number', { required: true, min: 1 }),
      F('result', 'Result', 'select', { options: Object.values(QC_RESULT), required: true }),
      F('defectsFound', 'Defects Found', 'number', { default: 0, min: 0 }),
      F('comments', 'Comments', 'textarea'),
    ],
  },

  [C.STORES]: {
    label: 'Store',
    icon: '🏬',
    fields: [
      F('name', 'Store Name', 'text', { required: true }),
      F('type', 'Store Type', 'select', {
        options: ['Fabric Store', 'Accessories Store', 'Finished Goods Store', 'Spare Parts Store'],
        required: true,
      }),
      F('location', 'Location', 'text'),
    ],
  },

  [C.ITEMS]: {
    label: 'Item',
    icon: '📦',
    uniqueKey: 'itemCode',
    fields: [
      F('itemCode', 'Item Code', 'text', { required: true, unique: true }),
      F('name', 'Item Name', 'text', { required: true }),
      F('category', 'Category', 'text', { required: true }),
      F('unit', 'Unit', 'select', { options: ['pcs', 'mtr', 'kg', 'roll', 'box', 'set'], required: true }),
      F('supplierId', 'Supplier', 'ref:SUPPLIERS'),
      F('storeId', 'Store', 'ref:STORES'),
      F('minQty', 'Minimum Stock', 'number', { default: 0, min: 0 }),
      F('maxQty', 'Maximum Stock', 'number', { default: 0, min: 0 }),
      F('openingQty', 'Opening Stock', 'number', { default: 0 }),
      F('unitCost', 'Unit Cost', 'number', { default: 0, min: 0 }),
      F('barcode', 'Barcode / QR', 'text'),
    ],
  },

  [C.STOCK_LEDGER]: {
    label: 'Stock Ledger Entry',
    icon: '📒',
    fields: [
      F('itemId', 'Item', 'ref:ITEMS', { required: true }),
      F('storeId', 'Store', 'ref:STORES', { required: true }),
      F('type', 'Move Type', 'select', { options: Object.values(STOCK_MOVE_TYPE), required: true }),
      F('date', 'Date', 'date', { required: true }),
      F('qtyIn', 'Qty In', 'number', { default: 0, min: 0 }),
      F('qtyOut', 'Qty Out', 'number', { default: 0, min: 0 }),
      F('balanceQty', 'Balance', 'number', { default: 0 }),
      F('reference', 'Reference', 'text'),
      F('remarks', 'Remarks', 'textarea'),
    ],
  },

  [C.SUPPLIERS]: {
    label: 'Supplier',
    icon: '🚚',
    uniqueKey: 'supplierCode',
    fields: [
      F('supplierCode', 'Supplier Code', 'text', { required: true, unique: true }),
      F('name', 'Supplier Name', 'text', { required: true }),
      F('contactPerson', 'Contact Person', 'text'),
      F('phone', 'Phone', 'text'),
      F('address', 'Address', 'textarea'),
      F('active', 'Active', 'boolean', { default: true }),
    ],
  },

  [C.PURCHASE_REQUESTS]: {
    label: 'Purchase Request',
    icon: '📝',
    fields: [
      F('requestNo', 'Request No', 'text', { required: true, unique: true }),
      F('itemId', 'Item', 'ref:ITEMS', { required: true }),
      F('supplierId', 'Supplier', 'ref:SUPPLIERS'),
      F('qty', 'Qty', 'number', { required: true, min: 1 }),
      F('requiredDate', 'Required Date', 'date', { required: true }),
      F('requestedBy', 'Requested By', 'text'),
      F('approvalStatus', 'Approval Status', 'select', {
        options: Object.values(APPROVAL_STATUS),
        default: APPROVAL_STATUS.PENDING,
      }),
    ],
  },

  [C.GRNS]: {
    label: 'Goods Receipt Note',
    icon: '📥',
    fields: [
      F('grnNo', 'GRN No', 'text', { required: true, unique: true }),
      F('itemId', 'Item', 'ref:ITEMS', { required: true }),
      F('storeId', 'Store', 'ref:STORES', { required: true }),
      F('supplierId', 'Supplier', 'ref:SUPPLIERS'),
      F('requestId', 'Purchase Request', 'ref:PURCHASE_REQUESTS'),
      F('qty', 'Received Qty', 'number', { required: true, min: 1 }),
      F('date', 'Date', 'date', { required: true }),
      F('lotNo', 'Lot No', 'text'),
    ],
  },

  [C.EMPLOYEES]: {
    label: 'Employee',
    icon: '🧑‍💼',
    uniqueKey: 'employeeCode',
    fields: [
      F('employeeCode', 'Employee ID', 'text', { required: true, unique: true }),
      F('name', 'Name', 'text', { required: true }),
      F('photoUrl', 'Photo URL', 'text'),
      F('department', 'Department', 'text', { required: true }),
      F('designation', 'Designation', 'text'),
      F('joiningDate', 'Joining Date', 'date', { required: true }),
      F('phone', 'Phone', 'text'),
      F('address', 'Address', 'textarea'),
      F('shift', 'Shift', 'select', { options: ['Morning', 'Evening', 'Night'], default: 'Morning' }),
      F('status', 'Status', 'select', { options: ['Active', 'Resigned', 'On Leave'], default: 'Active' }),
      F('basicSalary', 'Basic Salary', 'number', { default: 0, min: 0 }),
    ],
  },

  [C.LEAVE_REQUESTS]: {
    label: 'Leave Request',
    icon: '🏖️',
    fields: [
      F('employeeId', 'Employee', 'ref:EMPLOYEES', { required: true }),
      F('leaveType', 'Leave Type', 'select', { options: ['Sick', 'Casual', 'Earned', 'Emergency', 'Annual'], required: true }),
      F('fromDate', 'From', 'date', { required: true }),
      F('toDate', 'To', 'date', { required: true }),
      F('status', 'Status', 'select', { options: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING }),
      F('comments', 'Comments', 'textarea'),
    ],
  },

  [C.OVERTIME_REQUESTS]: {
    label: 'Overtime Request',
    icon: '⏰',
    fields: [
      F('employeeId', 'Employee', 'ref:EMPLOYEES', { required: true }),
      F('date', 'Date', 'date', { required: true }),
      F('hours', 'Hours', 'number', { required: true, min: 0.5 }),
      F('reason', 'Reason', 'text'),
      F('status', 'Status', 'select', { options: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING }),
    ],
  },

  [C.MACHINES]: {
    label: 'Machine',
    icon: '⚙️',
    uniqueKey: 'machineCode',
    fields: [
      F('machineCode', 'Machine ID', 'text', { required: true, unique: true }),
      F('name', 'Machine Name', 'text', { required: true }),
      F('machineType', 'Machine Type', 'text', { required: true }),
      F('brand', 'Brand', 'text'),
      F('model', 'Model', 'text'),
      F('serialNo', 'Serial Number', 'text'),
      F('department', 'Department', 'text'),
      F('lineId', 'Line', 'ref:PRODUCTION_LINES'),
      F('purchaseDate', 'Purchase Date', 'date'),
      F('status', 'Status', 'select', { options: ['Running', 'Idle', 'Under Repair', 'Retired'], default: 'Running' }),
      F('lastServiceDate', 'Last Service Date', 'date'),
      F('serviceIntervalDays', 'Service Interval (days)', 'number', { default: 90, min: 1 }),
    ],
  },

  [C.MAINTENANCE_REQUESTS]: {
    label: 'Maintenance Request',
    icon: '🔧',
    fields: [
      F('machineId', 'Machine', 'ref:MACHINES', { required: true }),
      F('type', 'Request Type', 'select', { options: ['Breakdown', 'Preventive', 'Repair'], required: true }),
      F('reportedBy', 'Reported By', 'text'),
      F('technician', 'Technician', 'text'),
      F('startTime', 'Start Time', 'datetime', { required: true }),
      F('endTime', 'End Time', 'datetime'),
      F('downtimeMin', 'Downtime (min)', 'number', { default: 0, min: 0 }),
      F('repairCost', 'Repair Cost', 'number', { default: 0, min: 0 }),
      F('spareParts', 'Spare Parts Used', 'textarea'),
      F('status', 'Status', 'select', { options: Object.values(MAINTENANCE_STATUS), default: MAINTENANCE_STATUS.OPEN }),
      F('description', 'Description', 'textarea'),
    ],
  },

  [C.PACKING_PLANS]: {
    label: 'Packing Plan',
    icon: '📦',
    fields: [
      F('poId', 'PO', 'ref:PURCHASE_ORDERS', { required: true }),
      F('styleId', 'Style', 'ref:STYLES', { required: true }),
      F('packDate', 'Packing Date', 'date', { required: true }),
      F('plannedQty', 'Planned Qty', 'number', { required: true, min: 1 }),
      F('packedQty', 'Packed Qty', 'number', { default: 0, min: 0 }),
      F('status', 'Status', 'select', { options: ['Planned', 'In Progress', 'Completed'], default: 'Planned' }),
    ],
  },

  [C.CARTONS]: {
    label: 'Carton',
    icon: '🧊',
    uniqueKey: 'cartonNo',
    fields: [
      F('cartonNo', 'Carton No', 'text', { required: true, unique: true }),
      F('planId', 'Packing Plan', 'ref:PACKING_PLANS'),
      F('poId', 'PO', 'ref:PURCHASE_ORDERS', { required: true }),
      F('orderId', 'Order', 'ref:ORDERS'),
      F('styleId', 'Style', 'ref:STYLES', { required: true }),
      F('colorId', 'Color', 'ref:COLORS'),
      F('sizeId', 'Size', 'ref:SIZES'),
      F('qty', 'Quantity', 'number', { required: true, min: 1 }),
      F('shipmentId', 'Shipment', 'ref:SHIPMENT_PLANS'),
      F('shippedQty', 'Shipped Qty', 'number', { default: 0, min: 0 }),
      F('barcode', 'Barcode / QR', 'text'),
    ],
  },

  [C.SHIPMENT_PLANS]: {
    label: 'Shipment',
    icon: '🚢',
    uniqueKey: 'shipmentRef',
    fields: [
      F('shipmentRef', 'Shipment Ref', 'text', { required: true, unique: true }),
      F('orderId', 'Order', 'ref:ORDERS', { required: true }),
      F('poId', 'PO', 'ref:PURCHASE_ORDERS'),
      F('buyerId', 'Buyer', 'ref:BUYERS', { required: true }),
      F('shipmentDate', 'Shipment Date', 'date', { required: true }),
      F('invoiceNo', 'Invoice No', 'text'),
      F('totalQty', 'Total Qty', 'number', { required: true, min: 1 }),
      F('shippedQty', 'Shipped Qty', 'number', { default: 0, min: 0 }),
      F('status', 'Status', 'select', { options: Object.values(SHIPMENT_STATUS), default: SHIPMENT_STATUS.PLANNED }),
    ],
  },

  [C.COST_HEADS]: {
    label: 'Order Cost Head',
    icon: '💰',
    fields: [
      F('orderId', 'Order', 'ref:ORDERS', { required: true }),
      F('poId', 'PO', 'ref:PURCHASE_ORDERS'),
      F('category', 'Cost Category', 'select', { options: COST_CATEGORIES, required: true }),
      F('amount', 'Amount', 'number', { required: true, min: 0 }),
      F('date', 'Date', 'date', { required: true }),
      F('remarks', 'Remarks', 'textarea'),
    ],
  },

  [C.EXPENSES]: {
    label: 'Expense',
    icon: '🧾',
    fields: [
      F('expenseNo', 'Expense No', 'text', { required: true, unique: true }),
      F('category', 'Category', 'select', { options: COST_CATEGORIES, required: true }),
      F('orderId', 'Order', 'ref:ORDERS'),
      F('amount', 'Amount', 'number', { required: true, min: 0 }),
      F('date', 'Date', 'date', { required: true }),
      F('paidTo', 'Paid To', 'text'),
      F('status', 'Status', 'select', { options: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING }),
      F('remarks', 'Remarks', 'textarea'),
    ],
  },

  [C.AUDIT_LOGS]: {
    label: 'Audit Log',
    icon: '🗂️',
    fields: [], // written by auditService only
  },

  [C.ALERTS]: {
    label: 'Alert',
    icon: '🔔',
    fields: [], // written by alertService only
  },
};

// ---- Composite indexes required (Firebase console → Firestore → Indexes) ----
// Firestore creates single-field indexes automatically. Only these combinations
// need to be created manually, and each one is used by a specific query.
export const REQUIRED_INDEXES = [
  { collection: C.HOURLY_PRODUCTION, fields: [['date', 'ASC'], ['lineId', 'ASC']] },
  { collection: C.HOURLY_PRODUCTION, fields: [['date', 'DESC']] },
  { collection: C.CUTTING_ENTRIES, fields: [['date', 'DESC']] },
  { collection: C.CUTTING_ENTRIES, fields: [['order_no', 'ASC'], ['date', 'DESC']] },
  { collection: C.CUTTING_ENTRIES, fields: [['layNo', 'ASC'], ['date', 'DESC']] },
  { collection: C.LINE_INPUTS, fields: [['timestamp', 'DESC']] },
  { collection: C.LINE_INPUTS, fields: [['line_no', 'ASC'], ['timestamp', 'DESC']] },
  { collection: C.LINE_INPUTS, fields: [['order_no', 'ASC'], ['timestamp', 'DESC']] },
  { collection: C.LINE_SHIFTS, fields: [['date', 'ASC'], ['lineId', 'ASC']] },
  { collection: C.INLINE_QC, fields: [['date', 'ASC'], ['lineId', 'ASC']] },
  { collection: C.END_LINE_QC, fields: [['date', 'ASC'], ['lineId', 'ASC']] },
  { collection: C.FINAL_INSPECTIONS, fields: [['date', 'ASC'], ['poId', 'ASC']] },
  { collection: C.TNA_TASKS, fields: [['orderId', 'ASC'], ['plannedDate', 'ASC']] },
  { collection: C.CARTONS, fields: [['poId', 'ASC'], ['cartonNo', 'ASC']] },
  { collection: C.STOCK_LEDGER, fields: [['itemId', 'ASC'], ['date', 'DESC']] },
  { collection: C.STOCK_LEDGER, fields: [['storeId', 'ASC'], ['date', 'DESC']] },
  { collection: C.ALERTS, fields: [['active', 'ASC'], ['createdAt', 'DESC']] },
  { collection: C.AUDIT_LOGS, fields: [['createdAt', 'DESC']] },
  { collection: C.APPROVALS, fields: [['status', 'ASC'], ['createdAt', 'DESC']] },
];

/** Fields of a collection that must not appear in a form (system-managed). */
export function editableFields(collection) {
  return (SCHEMA[collection]?.fields || []).filter((f) => !f.sys);
}

/** Fields marked unique on a collection — these drive duplicate prevention. */
export function uniqueFieldsOf(collection) {
  return (SCHEMA[collection]?.fields || []).filter((f) => f.unique).map((f) => f.name);
}

/** Converts 'ref:STYLES' into the collection id 'STYLES'. */
export function refCollection(type) {
  return String(type || '').replace(/^ref:/, '');
}
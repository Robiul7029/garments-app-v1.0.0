/**
 * ROBIUL GARMENTS ERP — Role Based Access Control
 *
 * Single source of truth for "who may see and do what". The same matrix is
 * mirrored in firestore.rules (see rulesErpRoles) so the UI hides a control and
 * the server enforces it — neither one alone is trusted.
 *
 * The legacy three-way model (isSuperAdmin / manager / viewer) is untouched;
 * a user with no ERP role simply has an empty ERP role list and therefore no
 * access to any ERP module. Nothing in the old app breaks because of this file.
 */

// ---- Permission actions ----------------------------------------------------
export const ACTION = {
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  DELETE: 'delete',
  APPROVE: 'approve',
  EXPORT: 'export',
};

// ---- ERP modules -----------------------------------------------------------
// Every module the ERP knows about. `key` is also the sidebar group key and
// the first segment of its routes, so adding a module means adding it here and
// in erpMenu.js — nowhere else.
export const MODULE = {
  DASHBOARD: 'dashboard',
  ALERTS: 'alerts',
  AUDIT: 'audit',
  BUYERS: 'buyers',
  ORDERS: 'orders',
  PLANNING: 'planning',
  PRODUCTION: 'production',
  // Two of the five sidebar sections are finer-grained than the existing modules,
  // so they get their own keys rather than being folded into PRODUCTION/HR. That
  // keeps a role's grant readable (“may see operator performance” is not the same
  // statement as “may see production”) and keeps each sidebar entry independently
  // hideable.
  OPERATOR_PERFORMANCE: 'operatorPerformance',
  QUALITY: 'quality',
  INVENTORY: 'inventory',
  PROCUREMENT: 'procurement',
  HR: 'hr',
  MANPOWER: 'manpower',
  MAINTENANCE: 'maintenance',
  PACKING: 'packing',
  SHIPMENT: 'shipment',
  ACCOUNTS: 'accounts',
  REPORTS: 'reports',
  USERS: 'users',
};

export const MODULE_LABELS = {
  dashboard: 'Management Dashboard',
  alerts: 'Alert Center',
  audit: 'Audit Log',
  buyers: 'Buyers',
  orders: 'Order & Merchandising',
  planning: 'TNA Management',
  production: 'Production',
  operatorPerformance: 'Operator Performance',
  quality: 'Quality Control',
  inventory: 'Store & Inventory',
  procurement: 'Procurement',
  hr: 'HR & Employee',
  manpower: 'Manpower Management',
  maintenance: 'Machine & Maintenance',
  packing: 'Packing',
  shipment: 'Shipment',
  accounts: 'Accounts & Costing',
  reports: 'Reports',
  users: 'User Management',
};

// ---- The 15 roles ----------------------------------------------------------
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MANAGEMENT: 'management',
  GM: 'gm',
  MERCHANDISING: 'merchandising',
  PLANNING: 'planning',
  PRODUCTION_MANAGER: 'production_manager',
  SUPERVISOR: 'supervisor',
  QC: 'qc',
  STORE: 'store',
  HR: 'hr',
  ACCOUNTS: 'accounts',
  MAINTENANCE: 'maintenance',
  CUTTING: 'cutting',
  FINISHING: 'finishing',
  PACKING: 'packing',
  SHIPMENT: 'shipment',
};

export const ROLE_LIST = Object.values(ROLES);

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  management: 'Management',
  gm: 'GM',
  merchandising: 'Merchandising',
  planning: 'Planning',
  production_manager: 'Production Manager',
  supervisor: 'Supervisor',
  qc: 'QC',
  store: 'Store',
  hr: 'HR',
  accounts: 'Accounts',
  maintenance: 'Maintenance',
  cutting: 'Cutting',
  finishing: 'Finishing',
  packing: 'Packing',
  shipment: 'Shipment',
};

// A human-readable module list used by the role editor screen.
const V = ACTION.VIEW;
const C = ACTION.CREATE;
const E = ACTION.EDIT;
const D = ACTION.DELETE;
const A = ACTION.APPROVE;
const X = ACTION.EXPORT;

/**
 * Per-role grants. Omitted actions mean "not granted" — never "granted by
 * default", so a new action added later is denied everywhere until a role is
 * given it explicitly.
 */
export const PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: allModulesAllActions(),

  [ROLES.MANAGEMENT]: {
    [MODULE.DASHBOARD]: [V, X],
    [MODULE.ALERTS]: [V],
    [MODULE.AUDIT]: [V, X],
    [MODULE.BUYERS]: [V],
    [MODULE.ORDERS]: [V, C, E, A, X],
    [MODULE.PLANNING]: [V, E, A, X],
    [MODULE.PRODUCTION]: [V, X],
    [MODULE.OPERATOR_PERFORMANCE]: [V, X],
    [MODULE.QUALITY]: [V, X],
    [MODULE.INVENTORY]: [V, X],
    [MODULE.REPORTS]: [V, X],
    [MODULE.PROCUREMENT]: [V, A, X],
    [MODULE.HR]: [V, X],
    [MODULE.MANPOWER]: [V, X],
    [MODULE.MAINTENANCE]: [V, X],
    [MODULE.PACKING]: [V, X],
    [MODULE.SHIPMENT]: [V, X],
    [MODULE.ACCOUNTS]: [V, X],
    [MODULE.USERS]: [C, E, A],
  },

  [ROLES.GM]: {
    [MODULE.DASHBOARD]: [V, X],
    [MODULE.ALERTS]: [V, A],
    [MODULE.AUDIT]: [V, X],
    [MODULE.BUYERS]: [V],
    [MODULE.ORDERS]: [V, E, X],
    [MODULE.PLANNING]: [V, E, X],
    [MODULE.REPORTS]: [V, X],
    [MODULE.PRODUCTION]: [V, X],
    [MODULE.OPERATOR_PERFORMANCE]: [V, X],
    [MODULE.QUALITY]: [V, X],
    [MODULE.INVENTORY]: [V, X],
    [MODULE.PROCUREMENT]: [V, A, X],
    [MODULE.HR]: [V, X],
    [MODULE.MANPOWER]: [V, X],
    [MODULE.MAINTENANCE]: [V, X],
    [MODULE.PACKING]: [V, X],
    [MODULE.SHIPMENT]: [V, X],
    [MODULE.ACCOUNTS]: [V, X],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.MERCHANDISING]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.BUYERS]: [V, C, E, D, X],
    [MODULE.ORDERS]: [V, C, E, A, X],
    [MODULE.PLANNING]: [V, C, E, X],
    [MODULE.PRODUCTION]: [V],
    [MODULE.QUALITY]: [V],
    [MODULE.INVENTORY]: [V],
    [MODULE.PROCUREMENT]: [V, C, X],
    [MODULE.PACKING]: [V],
    [MODULE.SHIPMENT]: [V, C, E, X],
    [MODULE.ACCOUNTS]: [V],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.PLANNING]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.BUYERS]: [V],
    [MODULE.ORDERS]: [V, C, E, X],
    [MODULE.PLANNING]: [V, C, E, D, A, X],
    [MODULE.PRODUCTION]: [V],
    [MODULE.QUALITY]: [V],
    [MODULE.INVENTORY]: [V],
    [MODULE.PROCUREMENT]: [V, C, X],
    [MODULE.PACKING]: [V],
    [MODULE.SHIPMENT]: [V],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.PRODUCTION_MANAGER]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.ORDERS]: [V],
    [MODULE.PLANNING]: [V],
    [MODULE.PRODUCTION]: [V, C, E, D, A, X],
    [MODULE.OPERATOR_PERFORMANCE]: [V, C, E, X],
    [MODULE.QUALITY]: [V, X],
    [MODULE.HR]: [V],
    [MODULE.MANPOWER]: [V, C, E, X],
    [MODULE.MAINTENANCE]: [V, C, X],
    [MODULE.PACKING]: [V],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.SUPERVISOR]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.PRODUCTION]: [V, C, E],
    [MODULE.OPERATOR_PERFORMANCE]: [V],
    [MODULE.QUALITY]: [V, C],
    [MODULE.MANPOWER]: [V],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.QC]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.PRODUCTION]: [V],
    // The QC role checks the product, but the fix is usually an operator — so it
    // reads operator performance without being able to edit it.
    [MODULE.OPERATOR_PERFORMANCE]: [V],
    [MODULE.QUALITY]: [V, C, E, D, X],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.STORE]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.INVENTORY]: [V, C, E, D, X],
    [MODULE.PROCUREMENT]: [V, C, X],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.HR]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.HR]: [V, C, E, D, A, X],
    [MODULE.MANPOWER]: [V, C, E, D, A, X],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.ACCOUNTS]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.ACCOUNTS]: [V, C, E, D, A, X],
    [MODULE.PROCUREMENT]: [V, A, X],
    [MODULE.SHIPMENT]: [V, X],
    [MODULE.REPORTS]: [V, X],
    [MODULE.AUDIT]: [V],
  },

  [ROLES.MAINTENANCE]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.MAINTENANCE]: [V, C, E, D, A, X],
    [MODULE.INVENTORY]: [V],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.CUTTING]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.PRODUCTION]: [V, C, E],
    [MODULE.OPERATOR_PERFORMANCE]: [V],
    [MODULE.MANPOWER]: [V],
    [MODULE.INVENTORY]: [V, C],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.FINISHING]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.PRODUCTION]: [V, C, E],
    [MODULE.OPERATOR_PERFORMANCE]: [V],
    [MODULE.QUALITY]: [V, C],
    [MODULE.MANPOWER]: [V],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.PACKING]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.PACKING]: [V, C, E, D, X],
    [MODULE.INVENTORY]: [V, X],
    [MODULE.SHIPMENT]: [V],
    [MODULE.REPORTS]: [V, X],
  },

  [ROLES.SHIPMENT]: {
    [MODULE.DASHBOARD]: [V],
    [MODULE.ALERTS]: [V],
    [MODULE.ORDERS]: [V],
    [MODULE.PLANNING]: [V],
    [MODULE.PACKING]: [V, E],
    [MODULE.SHIPMENT]: [V, C, E, D, A, X],
    [MODULE.INVENTORY]: [V, X],
    [MODULE.REPORTS]: [V, X],
  },
};

function allModulesAllActions() {
  const out = {};
  Object.values(MODULE).forEach((m) => {
    out[m] = [V, C, E, D, A, X];
  });
  return out;
}

// ---- Lookup helpers --------------------------------------------------------

/**
 * Actions a user holds on a module.
 * `record` is the users/{uid} document: { roles: [...], isSuperAdmin: bool }.
 */
export function actionsFor(record, moduleKey) {
  if (!record) return [];
  const held = collectRoles(record);
  if (held.length === 0) return [];
  const merged = new Set();
  held.forEach((role) => {
    (PERMISSIONS[role]?.[moduleKey] || []).forEach((a) => merged.add(a));
  });
  return [...merged];
}

/** True when the user holds `action` on `moduleKey`. */
export function can(record, moduleKey, action = ACTION.VIEW) {
  return actionsFor(record, moduleKey).includes(action);
}

/** Every module the user may at least view. */
export function visibleModules(record) {
  return Object.values(MODULE).filter((m) => can(record, m, ACTION.VIEW));
}

/** Every module key the user may see, used by the router guard. */
export function visibleModuleKeys(record) {
  return new Set(visibleModules(record));
}

/** Roles held by a user record, normalised. `isSuperAdmin` implies super_admin. */
export function collectRoles(record) {
  if (!record) return [];
  const out = new Set();
  if (record.isSuperAdmin === true) out.add(ROLES.SUPER_ADMIN);
  const add = (value) => {
    const key = String(value || '').trim().toLowerCase();
    if (ROLE_LIST.includes(key)) out.add(key);
  };
  add(record.erpRole);
  if (Array.isArray(record.erpRoles)) record.erpRoles.forEach(add);
  // The legacy `role` field is NOT mapped here on purpose: a legacy 'admin' is a
  // production manager in the old model and must not silently gain ERP rights.
  return [...out];
}

/** Roles missing from the 15-role list but present on a user record (data hygiene). */
export function unknownRoles(record) {
  if (!record) return [];
  const held = [];
  if (record.erpRole) held.push(record.erpRole);
  if (Array.isArray(record.erpRoles)) held.push(...record.erpRoles);
  return held.filter((r) => !ROLE_LIST.includes(String(r || '').trim().toLowerCase()));
}

export { V as VIEW, C as CREATE, E as EDIT, D as DELETE, A as APPROVE, X as EXPORT };
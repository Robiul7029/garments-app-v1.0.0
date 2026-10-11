/**
 * ROBIUL GARMENTS ERP — validation.
 *
 * Firestore enforces no constraints, so every integrity rule in the factory is
 * enforced here, in one place, before a write reaches the database. Three
 * layers, deliberately ordered cheapest-first:
 *
 *   1. FIELD   — type, required, min/max, date sanity          (sync, no I/O)
 *   2. RECORD  — cross-field consistency within one document    (sync, no I/O)
 *   3. CONTEXT — uniqueness and balance against other documents (needs a lookup)
 *
 * Layer 3 receives a `ctx` of already-loaded lookup data so the caller controls
 * how it is fetched (and can reuse a single read across a whole form).
 */
import {
  C, editableFields, uniqueFieldsOf,
  ORDER_STATUS, SHIPMENT_STATUS, TNA_STATUS, APPROVAL_STATUS,
} from '../config/erpSchema';
import { toNumber, parseDate, toDateKey } from '../utils/erpCalculations';

// ---- Shape of the result ---------------------------------------------------
export function ok() {
  return { valid: true, errors: {} };
}

export function fail(errors) {
  return { valid: false, errors };
}

function addError(errors, field, message) {
  // First message wins per field: the earliest, most specific rule explains the
  // problem best, and stacking messages makes a form unreadable.
  if (!errors[field]) errors[field] = message;
  return errors;
}

// ---- Layer 1: field-level --------------------------------------------------
function validateField(field, rawValue, errors) {
  const { name, label, type, required, min } = field;
  const value = rawValue === undefined || rawValue === null ? '' : rawValue;
  const empty = value === '' || (Array.isArray(value) && value.length === 0);

  if (required && empty) {
    return addError(errors, name, `${label} is required.`);
  }
  if (empty) return errors;

  switch (type) {
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return addError(errors, name, `${label} must be a number.`);
      if (min !== undefined && n < min) return addError(errors, name, `${label} cannot be less than ${min}.`);
      if (n < 0) return addError(errors, name, `${label} cannot be negative.`);
      return errors;
    }
    case 'email': {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
        return addError(errors, name, `${label} must be a valid email address.`);
      }
      return errors;
    }
    case 'date': {
      if (parseDate(value) === null) return addError(errors, name, `${label} must be a valid date.`);
      return errors;
    }
    case 'datetime': {
      if (parseDate(value) === null) return addError(errors, name, `${label} must be a valid date and time.`);
      return errors;
    }
    case 'boolean':
      return errors;
    default:
      if (typeof value === 'string' && value.length > 2000) {
        return addError(errors, name, `${label} is too long (2000 characters maximum).`);
      }
      return errors;
  }
}

// ---- Layer 2: record-level -------------------------------------------------
const RECORD_RULES = {
  [C.ORDERS]: (values, errors) => {
    if (parseDate(values.orderDate) && parseDate(values.deliveryDate)) {
      if (new Date(values.deliveryDate) < new Date(values.orderDate)) {
        addError(errors, 'deliveryDate', 'Delivery date cannot be before the order date.');
      }
    }
  },

  [C.PURCHASE_ORDERS]: (values, errors) => {
    if (toNumber(values.shippedQty) > toNumber(values.totalQty)) {
      addError(errors, 'shippedQty', 'Shipped qty cannot exceed the total PO qty.');
    }
  },

  [C.PO_LINES]: (values, errors) => {
    if (toNumber(values.shippedQty) > toNumber(values.qty)) {
      addError(errors, 'shippedQty', 'Shipped qty cannot exceed the PO line qty.');
    }
  },

  [C.LINE_SHIFTS]: (values, errors) => {
    if (toNumber(values.presentCount) > toNumber(values.manpower)) {
      addError(errors, 'presentCount', 'Present count cannot exceed total manpower.');
    }
  },

  [C.HOURLY_PRODUCTION]: (values, errors) => {
    const actual = toNumber(values.actual);
    const target = toNumber(values.target);
    const rework = toNumber(values.rework);
    const reject = toNumber(values.reject);
    // A 200% overrun is almost always a typing error rather than a real result,
    // so it is warned about rather than rejected — production genuinely spikes.
    if (target > 0 && actual > target * 2) {
      addError(errors, 'actual', `Actual production (${actual}) is more than double the target (${target}). Please confirm this is correct.`);
    }
    // Rework and reject come out of the same units that were produced.
    if (actual > 0 && rework + reject > actual) {
      addError(errors, 'reject', 'Rework + Reject cannot exceed actual production.');
    }
  },

  [C.INLINE_QC]: (values, errors) => {
    const checked = toNumber(values.checkedQty);
    const defect = toNumber(values.defectQty);
    if (defect > checked) addError(errors, 'defectQty', 'Defect qty cannot exceed checked qty.');
    if (toNumber(values.reworkQty) + toNumber(values.rejectQty) > defect) {
      addError(errors, 'rejectQty', 'Rework + Reject cannot exceed the defect qty.');
    }
  },

  [C.END_LINE_QC]: (values, errors) => {
    const checked = toNumber(values.checkedQty);
    if (toNumber(values.passedQty) + toNumber(values.failedQty) > checked) {
      addError(errors, 'failedQty', 'Passed + Failed cannot exceed checked qty.');
    }
  },

  [C.FINAL_INSPECTIONS]: (values, errors) => {
    if (parseDate(values.date) && values.result === 'Pass' && toNumber(values.defectsFound) > 0) {
      // Not an error — a pass can carry non-critical observations — but flagged.
      addError(errors, 'result', 'Result is marked Pass but defects were found. Confirm before saving.');
    }
  },

  [C.ITEMS]: (values, errors) => {
    if (toNumber(values.maxQty) > 0 && toNumber(values.minQty) > toNumber(values.maxQty)) {
      addError(errors, 'minQty', 'Minimum stock cannot be greater than maximum stock.');
    }
  },

  [C.LEAVE_REQUESTS]: (values, errors) => {
    if (parseDate(values.fromDate) && parseDate(values.toDate) && new Date(values.toDate) < new Date(values.fromDate)) {
      addError(errors, 'toDate', 'Leave end date cannot be before the start date.');
    }
  },

  [C.PACKING_PLANS]: (values, errors) => {
    if (toNumber(values.packedQty) > toNumber(values.plannedQty)) {
      addError(errors, 'packedQty', 'Packed qty cannot exceed planned qty.');
    }
  },

  [C.SHIPMENT_PLANS]: (values, errors) => {
    if (toNumber(values.shippedQty) > toNumber(values.totalQty)) {
      addError(errors, 'shippedQty', 'Shipped qty cannot exceed total shipment qty.');
    }
  },

  [C.CARTONS]: (values, errors) => {
    if (toNumber(values.shippedQty) > toNumber(values.qty)) {
      addError(errors, 'shippedQty', 'Shipped qty cannot exceed the carton qty.');
    }
  },

  [C.MAINTENANCE_REQUESTS]: (values, errors) => {
    if (values.endTime && values.startTime) {
      const start = parseDate(values.startTime);
      const end = parseDate(values.endTime);
      if (start && end && end < start) {
        addError(errors, 'endTime', 'End time cannot be before the start time.');
      }
    }
    if (values.endTime && toNumber(values.downtimeMin) === 0) {
      addError(errors, 'downtimeMin', 'A completed repair must record its downtime in minutes.');
    }
  },
};

// ---- Layer 3: cross-document ----------------------------------------------
// `ctx` supplies already-fetched siblings:
//   ctx.existing        — the document being edited, for unchanged-unique checks
//   ctx.duplicates      — { collection: { fieldValue: true } } natural keys in use
//   ctx.availableQty    — stock / packed / produced quantity that may be consumed
function validateContext(collection, values, errors, ctx = {}) {
  const existing = ctx.existing || null;

  // Uniqueness. A key already present is a conflict unless it is this very
  // document being edited with its key left unchanged.
  const dupes = ctx.duplicates || {};
  uniqueFieldsOf(collection).forEach((field) => {
    const value = String(values[field] ?? '').trim();
    if (!value) return;
    const bucket = dupes[field];
    if (!bucket || !bucket[value]) return;
    if (existing && String(existing[field] ?? '').trim() === value) return;
    const label = editableFields(collection).find((f) => f.name === field)?.label || field;
    addError(errors, field, `${label} "${value}" already exists.`);
  });

  // Quantities that may not exceed an upstream balance. Each entry names the
  // field on THIS document that is bounded, and which collection owns the rule.
  // For a shipment the bounded figure is the total being planned (it can never
  // plan more cartons than packing produced); `shippedQty` is already bounded
  // against `totalQty` by the record-level rule above.
  const available = ctx.availableQty || {};
  const checks = [
    [C.STOCK_LEDGER, 'qtyOut', 'Store issue cannot exceed available stock'],
    [C.CARTONS, 'qty', 'Carton qty cannot exceed the packed quantity'],
    [C.SHIPMENT_PLANS, 'totalQty', 'Shipment cannot exceed the packed quantity'],
    [C.PACKING_PLANS, 'packedQty', 'Packing cannot exceed the available production'],
    [C.CUTTING_PLANS, 'cutQty', 'Cut qty cannot exceed the planned qty'],
  ];
  checks.forEach(([coll, field, message]) => {
    if (coll !== collection) return;
    const limit = available[field];
    if (limit === undefined || limit === null) return;
    if (toNumber(values[field]) > toNumber(limit)) {
      const label = editableFields(collection).find((f) => f.name === field)?.label || field;
      addError(errors, field, `${message} (available: ${limit}).`);
    }
  });

  return errors;
}

// ---- Public API ------------------------------------------------------------

/**
 * Validates one document.
 *
 * @param {string} collection  collection id from erpSchema
 * @param {object} values      the form values, before defaults are applied
 * @param {object} ctx         { existing, duplicates, availableQty }
 * @returns {{ valid: boolean, errors: Record<string,string> }}
 */
export function validateRecord(collection, values, ctx = {}) {
  const fields = editableFields(collection);
  if (fields.length === 0) return ok();

  const errors = {};
  fields.forEach((field) => validateField(field, values[field.name], errors));

  const recordRule = RECORD_RULES[collection];
  if (recordRule) recordRule(values, errors);

  validateContext(collection, values, errors, ctx);

  return Object.keys(errors).length === 0 ? ok() : fail(errors);
}

/**
 * Fills in schema defaults for fields the form left blank, so a stored document
 * always has the same shape regardless of how it was created.
 */
export function applyDefaults(collection, values) {
  const out = { ...values };
  editableFields(collection).forEach((field) => {
    if (out[field.name] === undefined && field.default !== undefined) {
      out[field.name] = field.default;
    }
    // Normalise an empty numeric input to 0 rather than '' or null, so every
    // downstream sum and comparison sees a number.
    if (field.type === 'number' && (out[field.name] === '' || out[field.name] === null)) {
      out[field.name] = 0;
    }
    // Empty text is stored as '' (Firestore cannot store undefined).
    if (field.type === 'text' && out[field.name] === null) out[field.name] = '';
  });
  return out;
}

/** Convenience: the enum options of a given field, for a select input. */
export function optionsFor(collection, fieldName) {
  const field = editableFields(collection).find((f) => f.name === fieldName);
  return field?.options || [];
}

/**
 * Checks whether an order or PO is at risk on its ship date. Shared by the
 * form (inline warning) and the alert engine (scheduled alert).
 */
export function delayRisk(shipmentDate, today, shippedQty, totalQty) {
  const due = parseDate(shipmentDate);
  const now = parseDate(today);
  if (!due || !now) return null;
  const remaining = Math.round((due - now) / 86400000);
  const complete = toNumber(totalQty) > 0 && toNumber(shippedQty) >= toNumber(totalQty);
  if (complete) return null;
  if (remaining < 0) return { days: remaining, level: 'critical', message: `Overdue by ${Math.abs(remaining)} day(s).` };
  if (remaining <= 3) return { days: remaining, level: 'warning', message: `Shipment due in ${remaining} day(s).` };
  return null;
}

export { ORDER_STATUS, SHIPMENT_STATUS, TNA_STATUS, APPROVAL_STATUS, toDateKey };
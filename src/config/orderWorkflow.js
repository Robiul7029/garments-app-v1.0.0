/**
 * ROBIUL GARMENTS ERP — the Order & Production workflow, as one module.
 *
 * This is the single source of truth that ties three screens together:
 *
 *   Order Input         writes an order       → `order-model`
 *   Process Sheet Upload writes operations    → `process-breakdown`
 *   Daily Production    reads both            → prefills itself
 *
 * Keeping the shapes here (rather than in the three components) is what makes
 * the prefill trustworthy: the Daily Production form can only show a field the
 * order actually stores, and the process dropdown can only list operations the
 * upload actually parsed. If a field is renamed below, both ends move together.
 *
 * STORAGE CONTRACT — unchanged from what already shipped
 * -----------------------------------------------------
 * `order-model` rows keep the keys the rest of the app already reads
 * (`buyer`, `style`, `qty`, `order_no`, `start_date`, `ship_date`). The fields
 * added for the fuller order form (color, size range, floor, line, shift,
 * supervisor, item) are additive, so Delivery, Washing, Line Status and the old
 * Order / Model screen all keep working untouched.
 *
 * `process-breakdown` rows are one document per uploaded sheet:
 *   { id, style, order_no, fileName, uploadedAt, totalSmv, operations: [...] }
 * and each operation is { operation, machine, smv, section }. The Daily
 * Production process dropdown reads exactly this list for the selected style.
 */

// ---- Collections -----------------------------------------------------------
export const COLLECTIONS = {
  ORDERS: 'order-model',
  PROCESS_SHEETS: 'process-breakdown',
};

// ---- Order field definitions ----------------------------------------------
// `key` is the stored property. `aliases` are the other names an older row may
// already use for the same thing, so a record saved before this form existed is
// still read correctly rather than showing blank.
export const ORDER_FIELDS = [
  { name: 'buyer', label: 'Buyer', type: 'text', placeholder: 'H&M', group: 'order', required: true },
  { name: 'order_no', label: 'Order No', type: 'text', placeholder: 'PO-108', group: 'order', required: true },
  { name: 'style', label: 'Style No', type: 'text', placeholder: 'STY-1003', group: 'order', required: true },
  { name: 'item', label: 'Product / Item', type: 'text', placeholder: 'Basic Tee', group: 'order', required: true },
  // Color and Size Range both hold SEVERAL values, so each gets a purpose-built
  // control (see COLOR/SIZE handling below). The stored value stays a plain
  // comma-separated STRING in both cases — that is the contract every existing
  // reader relies on (`row.color` printed in a table, a CSV cell, a dropdown
  // label), so widening the input must not widen the column's type.
  { name: 'color', label: 'Color', type: 'color-tags', placeholder: 'Navy, Black, Red…', group: 'order', required: true },
  { name: 'size_range', label: 'Size Range', type: 'size-multi', placeholder: 'XS, S, M, L, XL…', group: 'order', required: true },
  { name: 'qty', label: 'PO Qty', type: 'number', placeholder: '5000', group: 'order', required: true },
  { name: 'order_date', label: 'Order Date', type: 'date', group: 'dates', alias: 'start_date' },
  { name: 'ship_date', label: 'Delivery Date', type: 'date', group: 'dates' },
  { name: 'floor', label: 'Floor', type: 'text', placeholder: 'Floor-2', group: 'floor' },
  { name: 'line_no', label: 'Line', type: 'text', placeholder: 'Line-03', group: 'floor', alias: 'line' },
  { name: 'shift', label: 'Shift', type: 'select', options: ['Morning', 'Evening', 'Night', 'General'], group: 'floor' },
  { name: 'supervisor', label: 'Supervisor', type: 'employee-select', group: 'floor' },
];

/** The fields the order form shows, in the order it shows them. */
export const ORDER_FORM_GROUPS = [
  { key: 'order', title: 'Order & Style' },
  { key: 'dates', title: 'Dates' },
  { key: 'floor', title: 'Floor & Supervision' },
];

/** Read a stored order field, following its legacy alias if the new key is empty. */
export function orderValue(order, fieldName) {
  if (!order) return '';
  const field = ORDER_FIELDS.find((f) => f.name === fieldName);
  const direct = order[fieldName];
  if (direct !== undefined && direct !== null && direct !== '') return direct;
  if (field?.alias) {
    const viaAlias = order[field.alias];
    if (viaAlias !== undefined && viaAlias !== null) return viaAlias;
  }
  return '';
}

/** A short label for one order, used in the searchable picker. */
export function orderLabel(order) {
  if (!order) return '';
  const style = order.style || '(no style)';
  const orderNo = order.order_no || order.orderNo || '';
  return orderNo ? `${style} — ${orderNo}` : style;
}

/** A stable identity for an order, so a picker can match on either key. */
export function orderIdentity(order) {
  return String(order?.style || order?.order_no || order?.id || '');
}

// ---- Multi-value colour and size -------------------------------------------

/**
 * Splits a stored colour/size value into its parts.
 *
 * Accepts every separator a supervisor is likely to type — comma, semicolon,
 * slash, pipe, or just spaces — because the field is free text and refusing a
 * format would mean retyping. "Navy, Black" and "Navy/Black" both give two
 * entries. Already-clean single values pass through as one.
 *
 * An ARRAY is also accepted, so a record written by a future editor that stores
 * a real list reads correctly here without a migration.
 */
export function splitValues(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (value === undefined || value === null) return [];
  return String(value)
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Joins parts back into the stored string form.
 *
 * Always ", " — the format the rest of the app prints and the CSV export writes —
 * so the storage shape does not vary with how the user happened to type it.
 * Duplicates are removed case-insensitively while keeping the first casing.
 */
export function joinValues(values) {
  const seen = new Set();
  const out = [];
  (values || []).forEach((value) => {
    const clean = String(value || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out.join(', ');
}

/** The colours on an order, as a list. */
export function colorsOf(order) {
  return splitValues(order?.color ?? order?.colors);
}

/** The sizes on an order, as a list. */
export function sizesOf(order) {
  return splitValues(order?.size_range ?? order?.sizes);
}

/**
 * The standard size ladder, offered as one-tap chips on the size field.
 * Ordered smallest to largest, with the plus sizes last — the order a size
 * range is actually written in on a tech pack.
 */
export const SIZE_PRESETS = [
  'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL',
];

/** The full ladder for a garment, used by the "all sizes" shortcut. */
export const FULL_SIZE_RANGE = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];

/** Common colours, offered as suggestions. Free text is still accepted. */
export const COLOR_SUGGESTIONS = [
  'Navy', 'Black', 'White', 'Red', 'Grey Melange', 'Charcoal',
  'Maroon', 'Olive', 'Beige', 'Sky Blue', 'Bottle Green', 'Mustard',
];

/**
 * Counts the colours and sizes on an order, for the summary row that tells the
 * user at a glance whether a multi-value field was filled properly.
 */
export function variantsOf(order) {
  const colors = colorsOf(order);
  const sizes = sizesOf(order);
  return { colors: colors.length, sizes: sizes.length, combinations: colors.length * sizes.length };
}

// ---- Order lookup ----------------------------------------------------------

/**
 * Every order, newest first, with the buyer and style resolved for display.
 * Rows with neither a style nor an order number are dropped: they cannot be
 * selected in a picker and would only add noise.
 */
export function findOrderByStyle(orders = [], style) {
  if (!style) return null;
  const wanted = String(style);
  return orders.find((o) => String(o.style || '') === wanted)
    || orders.find((o) => String(o.order_no || o.orderNo || '') === wanted)
    || null;
}

/** Orders that can actually be picked — they carry a style. */
export function selectableOrders(orders = []) {
  return orders.filter((o) => o && (o.style || o.order_no || o.orderNo));
}

/**
 * The values the Daily Production header takes from a selected order.
 * Only non-empty values are returned, so prefilling never blanks a field the
 * supervisor has already typed.
 */
export function orderPrefill(order) {
  if (!order) return {};
  const out = {};
  const take = (from, to) => {
    const value = orderValue(order, from);
    if (value !== '' && value !== undefined && value !== null) out[to || from] = value;
  };
  take('buyer');
  take('order_no');
  take('style');
  take('item');
  take('color');
  take('size_range');
  take('qty', 'po_qty');
  take('floor');
  take('line_no');
  take('shift');
  take('supervisor');
  return out;
}

// ---- Process sheet parsing -------------------------------------------------

/**
 * Header aliases for the breakdown sheet. An operation sheet from any factory
 * names its columns slightly differently, so each logical column is matched
 * against a small set rather than one exact spelling.
 */
export const COLUMN_ALIASES = {
  operation: ['operation', 'operation name', 'op', 'process', 'process name', 'operation/process'],
  machine: ['machine', 'machine type', 'm/c', 'mc', 'machine name'],
  smv: ['smv', 'sam', 'minutes', 'standard minutes', 'std minutes'],
  section: ['section', 'part', 'area', 'sub-section'],
};

/** Map each logical column to its index, from a candidate header row. */
export function headerIndex(headerRow = []) {
  const map = {};
  headerRow.forEach((raw, i) => {
    const key = String(raw || '').trim().toLowerCase();
    Object.entries(COLUMN_ALIASES).forEach(([field, aliases]) => {
      if (aliases.includes(key) && map[field] === undefined) map[field] = i;
    });
  });
  return map;
}

/**
 * Finds the header row: the first row that names at least two columns we need.
 * A sheet with a title band above the table is common, so row 1 cannot be
 * assumed — the search is bounded to the first 15 rows and stops at the first
 * row that looks like a table head.
 */
export function findHeaderRow(grid = [], limit = 15) {
  for (let i = 0; i < Math.min(grid.length, limit); i += 1) {
    const cols = headerIndex(grid[i] || []);
    if (cols.operation !== undefined && Object.keys(cols).length >= 2) return { rowIndex: i, cols };
  }
  // Fall back to an operation-only sheet, which is still usable.
  for (let i = 0; i < Math.min(grid.length, limit); i += 1) {
    const cols = headerIndex(grid[i] || []);
    if (cols.operation !== undefined) return { rowIndex: i, cols };
  }
  return null;
}

/**
 * Turns a sheet grid into operation rows. Blank rows and total rows (which carry
 * a number but no operation text) are skipped, because they are not operations
 * and would otherwise appear in the process dropdown.
 */
export function parseOperations(grid = []) {
  const header = findHeaderRow(grid);
  if (!header) {
    throw new Error('Could not find a header row. The sheet needs an "Operation" column (and ideally Machine and SMV).');
  }
  const { rowIndex, cols } = header;
  const rows = [];
  for (let i = rowIndex + 1; i < grid.length; i += 1) {
    const line = grid[i] || [];
    const operation = String(line[cols.operation] ?? '').trim();
    if (!operation) continue;
    // A "TOTAL" row is a summary, not an operation.
    if (/^(total|grand total|sum)$/i.test(operation)) continue;
    rows.push({
      operation,
      machine: cols.machine !== undefined ? String(line[cols.machine] ?? '').trim() : '',
      smv: cols.smv !== undefined ? Number(line[cols.smv]) || 0 : 0,
      section: cols.section !== undefined ? String(line[cols.section] ?? '').trim() : '',
    });
  }
  if (rows.length === 0) throw new Error('No operation rows found below the header.');
  return rows;
}

/** Total SMV of a parsed sheet, one decimal place. */
export function totalSmvOf(operations = []) {
  const total = operations.reduce((sum, r) => sum + (Number(r.smv) || 0), 0);
  return Math.round(total * 100) / 100;
}

/** Build the record saved for one uploaded sheet. */
export function buildProcessSheet({ style, order_no, fileName, operations, uploadedAt }) {
  return {
    id: Date.now(),
    style: style || 'Unassigned',
    order_no: order_no || '',
    fileName: fileName || '',
    uploadedAt: uploadedAt || new Date().toISOString().slice(0, 10),
    totalSmv: totalSmvOf(operations),
    operations: operations || [],
  };
}

/**
 * The operations recorded for a style, newest sheet first.
 *
 * A style may have been re-uploaded; the latest sheet wins because a breakdown
 * is superseded, not accumulated. Falls back to the order number so a sheet
 * uploaded before the style was set is still found.
 */
export function operationsForStyle(sheets = [], { style, order_no } = {}) {
  if (!style && !order_no) return [];
  const matches = sheets.filter((s) => {
    if (style && String(s.style || '') === String(style)) return true;
    if (order_no && String(s.order_no || '') === String(order_no)) return true;
    return false;
  });
  if (matches.length === 0) return [];
  // Newest by upload date, then by id, so two uploads on the same day still order.
  const latest = [...matches].sort((a, b) => {
    const byDate = String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''));
    if (byDate !== 0) return byDate;
    return Number(b.id || 0) - Number(a.id || 0);
  })[0];
  return Array.isArray(latest.operations) ? latest.operations : [];
}

/** Just the operation names, de-duplicated and in sheet order. */
export function processNamesForStyle(sheets = [], order = {}) {
  const ops = operationsForStyle(sheets, order);
  const seen = new Set();
  const names = [];
  ops.forEach((o) => {
    const name = String(o?.operation || '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  });
  return names;
}

/** SMV for one operation on a style, or 0 when the sheet does not list it. */
export function smvForProcess(sheets = [], order = {}, processName) {
  const ops = operationsForStyle(sheets, order);
  const found = ops.find((o) => String(o?.operation || '').trim() === String(processName || '').trim());
  return Number(found?.smv) || 0;
}

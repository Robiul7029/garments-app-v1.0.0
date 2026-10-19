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

// The per-process target formula lives in the SMV engine and is applied here when a
// sheet is SAVED, so the figures the preview table showed are the figures that reach
// the database — not figures each screen re-derives for itself and might get wrong.
// `smvTargetEngine` imports nothing, so this is not a cycle.
import { autoTargetForProcess } from './smvTargetEngine';

// ---- Collections -----------------------------------------------------------
export const COLLECTIONS = {
  ORDERS: 'order-model',
  PROCESS_SHEETS: 'process-breakdown',
};

// The shift length a Daily Production entry opens on when no capacity has been
// agreed for the style yet. 10 hours matches the brief and the paper form.
export const DEFAULT_WORKING_HOURS = 10;

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
  // PO Qty sits BEFORE the two multi-value fields so that, in the six-column
  // Order & Style grid, it lands on the four-column row under Style No and
  // Product / Item. Placing it after them dropped it onto a row of its own
  // with three empty cells and no obvious relation to the fields around it.
  { name: 'qty', label: 'PO Qty', type: 'number', placeholder: '5000', group: 'order', required: true },
  { name: 'color', label: 'Color', type: 'color-tags', placeholder: 'Navy, Black, Red…', group: 'order', required: true },
  { name: 'size_range', label: 'Size Range', type: 'size-multi', placeholder: 'XS, S, M, L, XL…', group: 'order', required: true },
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

/**
 * The order the save check walks the required fields in.
 *
 * Deliberately NOT the config order above: the user is asked for the things
 * they were told by the buyer first (Buyer → Order No → Style → …) and only
 * then for shop-floor assignments, so the first prompt is always the one they
 * expected. `errorMessage` is the specific sentence shown on the floating
 * tooltip; the label is dropped in as a fallback so a field added below still
 * gets a sensible prompt without touching this list's shape.
 *
 * Messages are ENGLISH ONLY. They used to carry a Bengali translation after a
 * slash, but the tooltip is a single line under a narrow field, so the pair
 * wrapped to four rows and buried the one sentence the user needed to read.
 */
export const ORDER_REQUIRED_SEQUENCE = [
  { name: 'buyer', errorMessage: 'Please fill in the Buyer name' },
  { name: 'order_no', errorMessage: 'Please fill in the Order No' },
  { name: 'style', errorMessage: 'Please fill in the Style number' },
  { name: 'item', errorMessage: 'Please fill in the Product name' },
  { name: 'color', errorMessage: 'Please select at least one Color' },
  { name: 'size_range', errorMessage: 'Please select at least one Size' },
  { name: 'qty', errorMessage: 'Please fill in the PO Qty' },
  { name: 'order_date', errorMessage: 'Please fill in the Order Date' },
  { name: 'ship_date', errorMessage: 'Please fill in the Delivery Date' },
  { name: 'floor', errorMessage: 'Please fill in the Floor' },
  { name: 'line_no', errorMessage: 'Please fill in the Line' },
  { name: 'shift', errorMessage: 'Please fill in the Shift' },
];

/**
 * Required fields, in the order the save check should walk them.
 *
 * Driven by ORDER_FIELDS' own `required` flag, so adding `required: true` to a
 * field is enough to have it checked — the sequence above only decides where it
 * sits and what it says. A required field missing from the sequence keeps the
 * declared order and falls back to a label-based prompt.
 */
export const ORDER_REQUIRED_FIELDS = ORDER_REQUIRED_SEQUENCE
  .map((step) => {
    const field = ORDER_FIELDS.find((f) => f.name === step.name);
    if (!field || !field.required) return null;
    return { ...field, errorMessage: step.errorMessage };
  })
  .filter(Boolean)
  .concat(
    ORDER_FIELDS
      .filter((f) => f.required && !ORDER_REQUIRED_SEQUENCE.some((s) => s.name === f.name))
      .map((f) => ({ ...f, errorMessage: `Please fill in the ${f.label}` })),
  );

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

/**
 * The colour options a line entry's Color dropdown offers.
 *
 * The order's OWN assigned colours come first — those are the ones the entry is
 * actually about, and a supervisor should not have to hunt for "Navy" among a
 * hundred suggestions. The standard suggestion list follows as a convenience, and
 * any colour ADDED by hand on a previous entry is carried in so it is selectable for
 * the next one (see `addedColors`).
 *
 * De-duplicated case-insensitively, keeping the first casing seen — which is the
 * order's, so the spelling the merchandiser typed is the one offered.
 *
 * TWO STATES, decided by whether an order is given:
 *   - no order   → NO order colour and NO suggestion is pre-loaded. The list is empty
 *                  until something is added by hand, so a form with no Order No never
 *                  offers a colour that belongs to some other order. The dropdown's own
 *                  "Type custom color..." + "+ Add" row is what fills it.
 *   - order set  → that order's assigned colours are auto-mapped to the top, followed
 *                  by the colours added by hand and the standard suggestions.
 *
 * @param {object|null} order  the selected Master Order record, or null/undefined
 * @param {Array}       added  colours created by hand on earlier entries
 * @param {object}      options
 * @param {boolean}     [options.includeSuggestions=true]  set false to omit the standard
 *   list even when an order is selected.
 * @returns {Array<{ value: string, label: string, hint: string }>}
 *   `hint` says where the colour came from, so a suggestion is never mistaken for one
 *   of the order's own assigned colours.
 */
export function colorOptionsFor(order, added = [], { includeSuggestions = true } = {}) {
  const seen = new Set();
  const out = [];
  const add = (value, hint) => {
    const clean = String(value || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value: clean, label: clean, hint });
  };

  // NO order: nothing order-specific and no suggestion list is pre-loaded — only the
  // colours typed by hand. The dropdown's own "+ Add" row is what fills the list.
  if (!order) {
    splitValues(added).forEach((c) => add(c, 'Added by you'));
    return out;
  }

  colorsOf(order).forEach((c) => add(c, 'On this order'));
  splitValues(added).forEach((c) => add(c, 'Added by you'));
  if (includeSuggestions) COLOR_SUGGESTIONS.forEach((c) => add(c, ''));
  return out;
}

/**
 * The colour list after adding `value`, or `null` when there is nothing to add.
 *
 * Returns `null` — rather than an unchanged array — for a blank value or one that is
 * already carried (in any casing), so the caller can tell "this was new" from "this
 * was already there" without comparing lists, and so a redundant write is avoided.
 *
 * The new colour is PREPENDED: a colour just created by hand is the one most likely
 * to be picked again, and leaving it at the foot of the list would bury it.
 */
export function addColorOption(added = [], value, existingOptions = []) {
  const clean = String(value || '').trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  const key = clean.toLowerCase();
  const carried = splitValues(added).some((c) => c.toLowerCase() === key)
    || (Array.isArray(existingOptions) ? existingOptions : []).some(
      (o) => String(typeof o === 'string' ? o : o?.value || '').trim().toLowerCase() === key,
    );
  if (carried) return null;
  return [clean, ...splitValues(added)];
}

/**
 * The colour spelling to SELECT for a typed value: the list's own casing when the
 * colour is already carried, otherwise the cleaned value as typed.
 *
 * Keeps the dropdown on one canonical spelling, so adding "navy" selects the existing
 * "Navy" instead of creating a second, differently-cased chip.
 */
export function matchingColor(value, options = []) {
  const clean = String(value || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const key = clean.toLowerCase();
  const hit = (Array.isArray(options) ? options : []).find(
    (o) => String(typeof o === 'string' ? o : o?.value || '').trim().toLowerCase() === key,
  );
  return hit ? String(typeof hit === 'string' ? hit : hit.value) : clean;
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
 * `capacity` is the manpower/hours agreed for the style in the Process Sheet
 * module. Passing it in is what makes Working Hours and Manpower fill themselves
 * instead of being retyped every day: the planning figures agreed for the line are
 * exactly the ones a daily entry should open on. Working Hours defaults to 10 when
 * nothing has been agreed yet, because that is the shift length the form assumes.
 */
export function orderPrefill(order, { capacity, today } = {}) {
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

  // The day's own defaults. The production date is today unless the order carries
  // its own start date; hours and manpower come from the saved capacity, falling
  // back to the shift length the form is built around.
  if (today) out.date = today;
  out.working_hours = capacity?.workingHours > 0 ? capacity.workingHours : DEFAULT_WORKING_HOURS;
  if (capacity?.manpower > 0) out.manpower = capacity.manpower;

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
  // `seconds` is first-class, not a nicety: many breakdown sheets state the
  // standard time in seconds (e.g. a total of 4320 s), and reading that column as
  // minutes would overstate every operation's SMV by 60× and make every target
  // look 60× too low.
  smv: ['smv', 'sam', 'minutes', 'standard minutes', 'std minutes'],
  seconds: ['seconds', 'second', 'sec', 'secs', 'second value', 'time in seconds', 'standard seconds', 'std seconds'],
  section: ['section', 'part', 'area', 'sub-section'],
  // The optional Weight % column. When a sheet states the garment's total SMV but
  // leaves the individual operation times blank, the split is driven by this
  // percentage instead — see `distributeSmvByWeight` in `smvTargetEngine`. A sheet
  // that omits the column entirely still works: predefined complexity weights are
  // used, which is why the column is optional rather than required.
  weight: ['weight', 'weight %', 'weight%', 'weightage', 'weight percent', 'smv weight', 'smv %', 'smv%', 'share %', 'share%'],
  // A column that FLAGS which operation is the line's total output (the brief's
  // "Line Output" designation). A sheet may carry it as a dedicated column whose
  // value is a tick / "Yes" / the operation's own name; either way it marks the
  // one operation whose summed operator output IS the line's output.
  lineOutput: ['line output', 'lineoutput', 'line output?', 'lineout', 'is line output', 'line output process'],
};

/**
 * The standard time in MINUTES — the only unit the rest of the app computes in.
 *
 * Every target in this app divides minutes available by SMV, so SMV has to be
 * minutes. Sheets arrive in both units, so everything is normalised here once at
 * the edge rather than by each screen guessing.
 *
 * A seconds value of 60 or more is unambiguous (no operation takes 60 minutes);
 * anything smaller is ambiguous and is read as minutes, which is the unit an SMV
 * column has always meant. Passing the unit explicitly overrides the guess.
 */
export function normaliseToMinutes(value, unit) {
  const n = Number(value) || 0;
  if (unit === 'seconds') return roundSmv(n / 60);
  if (unit === 'minutes') return roundSmv(n);
  // Unknown unit: >60 cannot be minutes, so it is seconds.
  return roundSmv(n >= 60 ? n / 60 : n);
}

/** Four decimals — enough that a 4320 s sheet does not lose its tail when ÷60. */
function roundSmv(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

/**
 * Reads one sheet row's standard time into minutes, whichever column it came from.
 *
 * Prefers the seconds column when the sheet has one, because a sheet that states
 * both is stating the same fact twice in different units.
 */
export function readOperationSmv(line, cols) {
  if (cols.seconds !== undefined) {
    return normaliseToMinutes(line[cols.seconds], 'seconds');
  }
  if (cols.smv !== undefined) {
    return normaliseToMinutes(line[cols.smv]);
  }
  return 0;
}

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
    // The Line Output flag, read from the dedicated column when the sheet has
    // one. `readLineOutputFlag` decides whether the cell marks THIS operation as
    // the line's total output — see its own notes for the accepted forms.
    const lineOutput = cols.lineOutput !== undefined
      ? readLineOutputFlag(line[cols.lineOutput], operation)
      : false;
    rows.push({
      operation,
      machine: cols.machine !== undefined ? String(line[cols.machine] ?? '').trim() : '',
      // Normalised to MINUTES here, at the one point a sheet is read, so no
      // downstream screen has to know the sheet was written in seconds.
      smv: readOperationSmv(line, cols),
      section: cols.section !== undefined ? String(line[cols.section] ?? '').trim() : '',
      // The operation's share of the garment's total time, as a percentage. Blank
      // when the sheet has no weight column — the distribution step then falls back
      // to the predefined complexity weights rather than treating the blank as 0,
      // which would silently drop the operation from the split.
      weight: cols.weight !== undefined ? readWeightPercent(line[cols.weight]) : null,
      // Carried on the row so the sheet remembers WHICH operation the file
      // designated as the line output, without a second lookup.
      lineOutput,
    });
  }
  if (rows.length === 0) throw new Error('No operation rows found below the header.');
  return rows;
}

/**
 * Whether one cell of a sheet's "Line Output" column marks its operation as the
 * line's total output.
 *
 * Sheets write this flag in several ways, all of which a factory actually uses:
 *
 *   a tick / "Yes" / "Y" / "True" / "1"   a dedicated flag column, ticked once
 *   the operation's own name                the cell repeats the operation it marks
 *   anything non-empty otherwise            a sheet that fills only the one row
 *
 * A blank cell, or an explicit "No" / "N" / "False" / "0", is NOT a designation —
 * so a sheet that ticks every row (a common export quirk) does not mark them all;
 * only the truthy forms count. When a sheet carries NO flag column at all this is
 * never called, and the designation falls back to the in-app dropdown.
 */
export function readWeightPercent(cell) {
  if (cell === undefined || cell === null || cell === '') return null;
  // A "25%" or "0.25"-style cell is read as the percentage it states. A bare 25
  // is 25% — the column is named "Weight %", so a value is already a percentage.
  const raw = String(cell).trim().replace('%', '');
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // A fraction between 0 and 1 exclusive is read as a fraction of the whole
  // (0.25 → 25%), which is how spreadsheets often store a percentage cell.
  if (n > 0 && n < 1) return Math.round(n * 10000) / 100;
  return n;
}

/**
 * Whether one cell of a sheet's "Line Output" column marks its operation as the
 * line's total output.
 *
 * Sheets write this flag in several ways, all of which a factory actually uses:
 *
 *   a tick / "Yes" / "Y" / "True" / "1"   a dedicated flag column, ticked once
 *   the operation's own name                the cell repeats the operation it marks
 *   anything non-empty otherwise            a sheet that fills only the one row
 *
 * A blank cell, or an explicit "No" / "N" / "False" / "0", is NOT a designation —
 * so a sheet that ticks every row (a common export quirk) does not mark them all;
 * only the truthy forms count. When a sheet carries NO flag column at all this is
 * never called, and the designation falls back to the in-app dropdown.
 */
export function readLineOutputFlag(cell, operation = '') {
  if (cell === undefined || cell === null) return false;
  const raw = String(cell).trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  // An explicit negative is never a designation.
  if (['no', 'n', 'false', '0', '-', 'na', 'n/a', 'none'].includes(lower)) return false;
  // A truthy flag.
  if (['yes', 'y', 'true', '1', '✓', '✔', 'x', 'line', 'line output'].includes(lower)) return true;
  // A cell that repeats the operation's own name marks that operation.
  if (operation && lower === String(operation).trim().toLowerCase()) return true;
  // Any other non-empty value (a tick glyph, a note) is taken as a designation —
  // the column exists to mark a row, and a row with text in it is marked.
  return true;
}

/**
 * Total SMV of a parsed sheet, in minutes, one decimal place.
 *
 * Rows are stored with `smv` already in minutes, so this is a plain sum — but any
 * row that somehow carries only a seconds figure is converted rather than added
 * raw, which is what stops one stray seconds row from inflating the line total.
 */
export function totalSmvOf(operations = []) {
  const total = operations.reduce(
    (sum, r) => sum + (Number(r.smv) || normaliseToSecondsColumn(r)),
    0,
  );
  return Math.round(total * 100) / 100;
}

/** A row carrying only seconds (an older or hand-built record) read as minutes. */
function normaliseToSecondsColumn(row) {
  const secs = Number(row?.seconds ?? row?.smv_seconds);
  return Number.isFinite(secs) && secs > 0 ? secs / 60 : 0;
}

/**
 * Build the record saved for one uploaded sheet.
 *
 * The stored contract is unchanged — `operations[].smv` and `totalSmv` are both in
 * MINUTES, which is what every screen already reads. Two extra fields are added
 * alongside them so the sheet's own unit is not lost once it is stored:
 *
 *   smvUnit         the unit the sheet was written in ('seconds' | 'minutes')
 *   totalSmvSeconds the same total restated in seconds (4320 for a 72-minute sheet)
 *
 * The seconds figure is a convenience for display, never a second source of truth:
 * all arithmetic reads `totalSmv` in minutes, so a seconds-valued sheet cannot
 * quietly produce minute-scale targets.
 */
export function buildProcessSheet({ style, order_no, fileName, operations, uploadedAt, smvUnit, targetBuffer, totalGarmentSmv, manpower, inputProcess, outputProcess, lineInputProcess, lineOutputProcess, workingHours, efficiency }) {
  const rows = operations || [];
  const minutes = totalSmvOf(rows);
  const statedInSeconds = smvUnit === 'seconds'
    || rows.some((r) => Number(r?.seconds) > 0);
  // The percentage buffer agreed for this sheet, normalised to a non-negative
  // number. Stored as 0 when nothing was set, so the auto-target formula multiplies
  // by exactly 1 and derives the plain SMV figure.
  const buffer = Number(targetBuffer) > 0 ? Number(targetBuffer) : 0;
  // OPTION A — the sheet's own designation. If the uploaded file carried a
  // "Line Output" column that marked one operation, that operation is recorded on
  // the sheet here so the app does not ask for it again. A sheet with no such
  // column stores an empty string, and the in-app dropdown (Option B) sets it.
  const designated = detectLineOutputProcess(rows);
  // Every operation is stamped with its derived figures at SAVE time, so the row the
  // preview table showed and the row in the database carry the same numbers. Without
  // this, each reader would have to re-derive the targets, and one of them would
  // eventually derive them differently.
  const hasTargetCapacity = Number(manpower) > 0;
  const targetSettings = hasTargetCapacity
    ? { manpower: Number(manpower) > 0 ? manpower : 1, workingHours: Number(workingHours) > 0 ? workingHours : 10, efficiency: Number(efficiency) > 0 ? efficiency : 100 }
    : {};
  const withTargets = rows.map((op) => {
    const smv = Number(op?.smv) || 0;
    const auto = autoTargetForProcess(smv, buffer, targetSettings);
    return {
      ...op,
      smv,
      // The auto figures the brief asks for, stored per row:
      //   baseHourlyCapacity = 60 / SMV
      //   autoHourlyTarget   = baseHourlyCapacity × (1 + buffer/100)
      //   autoDailyTarget    = autoHourlyTarget × 10
      baseHourlyCapacity: auto.baseHourlyCapacity,
      autoHourlyTarget: auto.hourlyTarget,
      autoDailyTarget: auto.dailyTarget,
      autoMonthlyTarget: auto.monthlyTarget,
      // The row's own manual override, when the user typed one in the preview's
      // Manual Target column. Kept as 0 when untouched, so a reader can tell
      // "no override" from "override of 0" — the auto figure is the fallback.
      target: Number(op?.target) > 0 ? Number(op.target) : 0,
    };
  });
  return {
    id: Date.now(),
    style: style || 'Unassigned',
    order_no: order_no || '',
    fileName: fileName || '',
    uploadedAt: uploadedAt || new Date().toISOString().slice(0, 10),
    totalSmv: minutes,
    // The garment's TOTAL standard time the user supplied when uploading — the
    // figure the per-operation SMVs were distributed from. Stored alongside the
    // summed total so a sheet can be RE-DISTRIBUTED later (a corrected garment time,
    // a different weight split) without the original file. 0 when the uploader did
    // not state one, in which case each row's SMV is whatever the sheet carried.
    totalGarmentSmv: Number(totalGarmentSmv) > 0 ? Number(totalGarmentSmv) : 0,
    smvUnit: statedInSeconds ? 'seconds' : 'minutes',
    totalSmvSeconds: Math.round(minutes * 60 * 100) / 100,
    // The buffer rides on the SHEET as well as on the capacity record, so a sheet
    // read on its own (Hourly Production, Daily Production, the review grid) can
    // apply the same percentage without looking the capacity up first.
    targetBuffer: buffer,
    manpower: Number(manpower) || 0,
    inputProcess: String(lineInputProcess ?? inputProcess ?? '').trim(),
    outputProcess: String(lineOutputProcess ?? outputProcess ?? designated ?? '').trim(),
    lineInputProcess: String(lineInputProcess ?? inputProcess ?? '').trim(),
    lineOutputProcess: String(lineOutputProcess ?? outputProcess ?? designated ?? '').trim(),
    workingHours: Number(workingHours) || 10,
    efficiency: Number(efficiency) || 70,
    operations: withTargets,
  };
}

/**
 * The operation a sheet's rows designated as the line output, or ''.
 *
 * This is Option A of the brief: a sheet that carries a "Line Output" column (or
 * a value naming the operation) is read here, at parse time, and its designation
 * rides on the sheet — no in-app selection needed. When several rows are marked
 * the FIRST one wins, because a line has one total-output operation; a sheet that
 * marks several is taken at its word rather than guessed at.
 */
export function detectLineOutputProcess(operations = []) {
  const rows = Array.isArray(operations) ? operations : [];
  const marked = rows.find((r) => r && r.lineOutput && String(r.operation || '').trim());
  return marked ? String(marked.operation).trim() : '';
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
  const latest = latestSheetForStyle(sheets, { style, order_no });
  return latest ? (Array.isArray(latest.operations) ? latest.operations : []) : [];
}

/**
 * The newest sheet saved for a style/order, or null.
 *
 * Split out of `operationsForStyle` so a caller that needs the sheet's own
 * attributes — its percentage buffer, its file name — can read them without a
 * second lookup that might pick a different sheet.
 */
export function latestSheetForStyle(sheets = [], { style, order_no } = {}) {
  if (!style && !order_no) return null;
  const matches = (Array.isArray(sheets) ? sheets : []).filter((s) => {
    if (style && String(s.style || '') === String(style)) return true;
    if (order_no && String(s.order_no || '') === String(order_no)) return true;
    return false;
  });
  if (matches.length === 0) return null;
  // Newest by upload date, then by id, so two uploads on the same day still order.
  return [...matches].sort((a, b) => {
    const byDate = String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''));
    if (byDate !== 0) return byDate;
    return Number(b.id || 0) - Number(a.id || 0);
  })[0];
}

/** The percentage buffer agreed on a style's latest process sheet, or 0. */
export function targetBufferForStyle(sheets = [], order = {}) {
  const sheet = latestSheetForStyle(sheets, order);
  return Number(sheet?.targetBuffer) > 0 ? Number(sheet.targetBuffer) : 0;
}

/**
 * Re-derive a saved sheet's totals from its operations.
 *
 * Called whenever a sheet is edited — a process added, removed, or its SMV changed.
 * The totals are DERIVED, never typed, so a sheet whose operations were changed
 * cannot keep advertising the total it was uploaded with. That mismatch is the
 * quiet kind of wrong: the table would show 72 minutes while the operations added
 * up to 80, and every target would follow the stale figure.
 *
 * `totalSmvSeconds` is recomputed from minutes for the same reason, rather than
 * being left at whatever the original upload happened to report.
 */
export function withRecomputedTotals(sheet) {
  const buffer = Number(sheet?.targetBuffer) > 0 ? Number(sheet.targetBuffer) : 0;
  const hasLineSettings = Number(sheet?.manpower) > 0;
  const targetSettings = hasLineSettings
    ? { manpower: Number(sheet?.manpower) > 0 ? sheet.manpower : 1, workingHours: Number(sheet?.workingHours) > 0 ? sheet.workingHours : 10, efficiency: Number(sheet?.efficiency) > 0 ? sheet.efficiency : 100 }
    : {};
  const operations = (sheet?.operations || []).map((o) => {
    const smv = Number(o?.smv) || 0;
    // The derived figures are RECOMPUTED here, not carried through. An edit that
    // changed an operation's SMV (or the sheet's buffer) must move its targets with
    // it, or the sheet would advertise the targets of the version it was uploaded as.
    const auto = autoTargetForProcess(smv, buffer, targetSettings);
    return {
      ...o,
      operation: String(o?.operation || '').trim(),
      smv,
      baseHourlyCapacity: auto.baseHourlyCapacity,
      autoHourlyTarget: auto.hourlyTarget,
      autoDailyTarget: auto.dailyTarget,
      autoMonthlyTarget: auto.monthlyTarget,
      // The manual override is a CHOICE, so it is carried through rather than
      // recomputed — the same reasoning as the line-output designation below.
      target: Number(o?.target) > 0 ? Number(o.target) : 0,
      // The optional Weight % column is carried through too, so a re-save (or a
      // re-distribution after correcting the garment total) does not lose the split.
      // Null when the sheet never carried one — which is how the distribution knows to
      // fall back to the predefined complexity weights rather than reading a 0 as 0%.
      weight: o?.weight === undefined || o?.weight === null || o?.weight === ''
        ? null
        : Number(o.weight),
    };
  });
  const minutes = totalSmvOf(operations);
  // The line-output designation is carried through, not recomputed from the rows:
  // it is a CHOICE about the sheet (set by the file's column or the in-app
  // dropdown), and re-deriving it here would wipe a dropdown selection the moment
  // any operation's SMV was edited. A designation naming an operation that is no
  // longer on the sheet is dropped, so a removed operation cannot leave the sheet
  // pointing at a process it no longer carries.
  const names = new Set(operations.map((o) => o.operation.toLowerCase()));
  const chosen = String(sheet?.lineOutputProcess ?? sheet?.outputProcess ?? '').trim();
  return {
    ...sheet,
    operations,
    totalSmv: minutes,
    totalSmvSeconds: Math.round(minutes * 60 * 100) / 100,
    // The garment total is carried through for the same reason as the weight column:
    // a re-save must not forget which figure the SMVs were distributed from.
    totalGarmentSmv: Number(sheet?.totalGarmentSmv) > 0 ? Number(sheet.totalGarmentSmv) : 0,
    // The percentage buffer is carried through, not recomputed: it is an agreement
    // about the sheet, not a figure derived from its rows. Normalised to a
    // non-negative number so a hand-edited value cannot subtract from a target.
    targetBuffer: Number(sheet?.targetBuffer) > 0 ? Number(sheet.targetBuffer) : 0,
    manpower: Number(sheet?.manpower) || 0,
    inputProcess: String(sheet?.lineInputProcess ?? sheet?.inputProcess ?? '').trim(),
    outputProcess: String(sheet?.lineOutputProcess ?? sheet?.outputProcess ?? '').trim(),
    lineInputProcess: String(sheet?.lineInputProcess ?? sheet?.inputProcess ?? '').trim(),
    workingHours: Number(sheet?.workingHours) || 10,
    efficiency: Number(sheet?.efficiency) || 70,
    lineOutputProcess: chosen && names.has(chosen.toLowerCase()) ? chosen : '',
  };
}

/**
 * Whether an edited sheet actually differs from the one it was opened from.
 *
 * Used by the View modal to decide if "Save changes" should be offered.
 *
 * A plain JSON comparison is wrong here because the draft is passed through
 * `withRecomputedTotals` while the saved sheet is not, so the draft carries derived
 * fields (`autoHourlyTarget`, `baseHourlyCapacity`, `totalSmvSeconds`, ...) the
 * saved row may lack — that difference is not an edit and must not light the button
 * up. The comparison is therefore made on the fields a person can actually change:
 * the sheet's own header values, and each operation's name, machine, section, SMV,
 * weight and manual target. Operations are matched BY INDEX, which is what the
 * editor itself works on (add appends, remove splices), so a rename is seen as a
 * change to that row rather than as one row vanishing and another appearing.
 */
export function dirtyAgainstSheet(draft, sheet) {
  if (!draft) return false;
  if (!sheet) return true;

  const SHEET_FIELDS = [
    'style', 'order_no', 'buyer', 'totalSmv', 'totalSmvSeconds',
    'totalGarmentSmv', 'targetBuffer', 'lineOutputProcess', 'manpower',
    'inputProcess', 'outputProcess', 'lineInputProcess', 'workingHours', 'efficiency',
  ];
  const OP_FIELDS = ['operation', 'machine', 'section', 'smv', 'weight', 'target'];

  const norm = (v) => (v === undefined || v === null ? '' : String(v).trim());
  const sameField = (a, b) => {
    const x = norm(a);
    const y = norm(b);
    // Numeric-looking values are compared as numbers, so '5' and 5 (and '5.0') agree.
    if (x !== '' && y !== '' && !Number.isNaN(Number(x)) && !Number.isNaN(Number(y))) {
      return Number(x) === Number(y);
    }
    return x === y;
  };

  if (SHEET_FIELDS.some((f) => !sameField(draft[f], sheet[f]))) return true;

  const a = Array.isArray(draft.operations) ? draft.operations : [];
  const b = Array.isArray(sheet.operations) ? sheet.operations : [];
  if (a.length !== b.length) return true;
  return a.some((op, i) => OP_FIELDS.some((f) => !sameField(op?.[f], b[i]?.[f])));
}

/**
 * The operation designated as the line output for a style/order, or ''.
 *
 * This is the single read every screen uses to find the line-output process: it
 * looks at the style's latest sheet and returns the operation the file's column
 * (Option A) or the in-app dropdown (Option B) designated. Reading it here means
 * Hourly Production, Daily Production, the Overall Summary and the dashboards all
 * agree on WHICH process the line output comes from.
 */
export function lineOutputProcessFor(sheets = [], order = {}) {
  const sheet = latestSheetForStyle(sheets, order);
  return sheet ? String(sheet.lineOutputProcess || '').trim() : '';
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

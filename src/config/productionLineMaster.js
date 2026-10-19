/**
 * ROBIUL GARMENTS ERP — the production line master.
 *
 * `productionLines` is a FOREIGN KEY, not a convenience list:
 *
 *   hourlyProduction.lineId   REQUIRED — the hourly mirror cannot write a row whose
 *                             line is not in this master
 *   lineShifts.lineId         REQUIRED
 *   lineInputs.line_no        resolved against it
 *
 * So a line document has to be creatable somewhere, and its shape has to match what
 * the schema declares exactly — `lineNo` is the unique key, `name` and `department`
 * are required, and the capacity is a non-negative number. That is what this module
 * produces, as pure functions, so the screen, the validation and the tests share one
 * definition rather than three.
 */

/** Where a line sits in the plant. Kept as an explicit list, like the schema's selects. */
export const LINE_DEPARTMENTS = [
  'Sewing',
  'Cutting',
  'Finishing',
  'Packing',
  'Embroidery',
  'Printing',
  'Washing',
];

export function lineDepartmentOptions() {
  return [...LINE_DEPARTMENTS];
}

/** A line number as the rest of the app spells it: trimmed, single-spaced. */
export function normalizeLineNo(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * The comparison used for uniqueness.
 *
 * Case and layout are not meaning: "Line-03", "line-03", "Line 03" and "LINE-3"
 * all name the same line on a floor, and accepting two of them as different lines
 * would split one line's production across two master records. So everything except
 * a letter or a digit is dropped, and a leading zero on the numeric tail is ignored.
 */
function lineKey(value) {
  const compact = normalizeLineNo(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return compact.replace(/^([a-z]+)0+(\d)/, '$1$2');
}

/**
 * The `lineNo` every reader matches on: `lineNo` first, then `name`.
 *
 * Recorded production rows store the label the floor typed ("Line-03"), so a line
 * whose document carries only a `name` is still resolvable by that name.
 */
export function lineNoOf(line = {}) {
  return normalizeLineNo(line.lineNo || line.name || line.line_no);
}

/**
 * Field-by-field validation, in the same shape the ERP save expects.
 *
 * @param {object} form       the form's values
 * @param {Array}  existing   the current master rows
 * @param {*}      editingId  the document being edited, if any — it is not a
 *                            duplicate of itself
 * @returns {Record<string,string>} empty when valid
 */
export function validateLine(form = {}, existing = [], editingId = null) {
  const errors = {};
  const lineNo = normalizeLineNo(form.lineNo);
  const name = String(form.name || '').trim();
  const department = String(form.department || '').trim();
  const capacity = form.capacityPerHour;

  if (!lineNo) {
    errors.lineNo = 'A line number is required, for example Line-03.';
  } else {
    const wanted = lineKey(lineNo);
    const clash = (Array.isArray(existing) ? existing : []).find(
      (row) => row && String(row.id) !== String(editingId) && lineKey(lineNoOf(row)) === wanted,
    );
    if (clash) errors.lineNo = `${lineNoOf(clash) || lineNo} already exists. A line number must be unique.`;
  }

  if (!name) errors.name = 'A line name is required.';
  if (!department) errors.department = 'Choose the department this line belongs to.';
  if (!LINE_DEPARTMENTS.includes(department)) {
    errors.department = 'Choose one of the listed departments.';
  }

  // A capacity is optional — a line can be registered before its target is agreed —
  // but a figure that IS given must be a real, non-negative number.
  if (capacity !== '' && capacity !== null && capacity !== undefined) {
    const n = Number(capacity);
    if (!Number.isFinite(n)) errors.capacityPerHour = 'Capacity must be a number.';
    else if (n < 0) errors.capacityPerHour = 'Capacity cannot be negative.';
  }

  return errors;
}

/**
 * The document to save, in the schema's own field names.
 *
 * `supervisorName` is stored additively beside `supervisorId`: the ERP schema only
 * requires the reference, but a printed roster or a CSV export is far more useful
 * with the person's name on the row than with a document id.
 */
export function buildLineRecord(form = {}, { supervisorName = '' } = {}) {
  const capacity = Number(form.capacityPerHour);
  return {
    lineNo: normalizeLineNo(form.lineNo),
    name: String(form.name || '').trim(),
    department: String(form.department || '').trim(),
    supervisorId: String(form.supervisorId || '').trim(),
    supervisorName: String(supervisorName || '').trim(),
    capacityPerHour: Number.isFinite(capacity) && capacity >= 0 ? capacity : 0,
    active: form.active !== false,
  };
}

/**
 * The lines offered on an entry form: ACTIVE ones only, in line-number order.
 *
 * A deactivated line stays in the master so the history booked to it stays
 * readable, but it must not be picked for new work.
 */
export function activeLineNames(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .filter((line) => line && line.active !== false)
    .map((line) => lineNoOf(line))
    .filter(Boolean)
    .filter((value, index, all) => all.findIndex((other) => lineKey(other) === lineKey(value)) === index)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

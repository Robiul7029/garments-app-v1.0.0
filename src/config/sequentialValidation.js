/**
 * ROBIUL GARMENTS ERP — sequential field validation.
 *
 * One reusable rule for the whole Order Management module: a save action is
 * checked ONE field at a time, in the order the user meets the fields, and it
 * stops at the FIRST field that is empty or invalid. That field — and only that
 * field — is flagged, with its own message; the user fills it, saves again, and
 * the check moves to the next one.
 *
 * This is deliberately NOT "list every problem at once". A banner naming five
 * missing boxes is read as noise, and on a narrow screen it buries the one thing
 * the user has to do next. Walking the form a single prompt at a time keeps the
 * instruction unmistakable.
 *
 * The check is pure — it takes the raw values and a list of rules and returns the
 * offending field or null — so Order Input, the Process Sheet uploader and the
 * capacity panel all share one implementation, and the behaviour can be tested
 * without a DOM.
 */

/**
 * The first rule that fails, or null when every rule passes.
 *
 * @param {Array}   rules  ordered [{ name, message, valid(value) }]
 * @param {object}  values the raw form values, keyed by field name
 * @returns {{name:string, message:string}|null}
 */
export function firstInvalid(rules = [], values = {}) {
  for (const rule of rules) {
    let ok;
    try {
      ok = rule.valid(values[rule.name], values);
    } catch {
      // A rule that throws is treated as failed rather than crashing the save —
      // the user still gets a prompt instead of a dead button.
      ok = false;
    }
    if (!ok) return { name: rule.name, message: rule.message };
  }
  return null;
}

/** A required text/number field: filled once something non-blank is present. */
export function required(value) {
  return String(value ?? '').trim() !== '';
}

/** A positive number (> 0), used for the capacity targets. */
export function positiveNumber(value) {
  const n = Number(value);
  return String(value ?? '').trim() !== '' && Number.isFinite(n) && n > 0;
}

/** A percentage in (0, 100]. */
export function percentWithin100(value) {
  const n = Number(value);
  return String(value ?? '').trim() !== '' && Number.isFinite(n) && n > 0 && n <= 100;
}

/**
 * The sequential rules for the Process Sheet uploader's "Save to Style".
 * Order matches the form: Style / Order → Process sheet → Operations.
 */
export const PROCESS_SHEET_RULES = [
  {
    name: 'style',
    message: 'Please select Style/Order',
    valid: (value) => required(value),
  },
  {
    name: 'file',
    // A PDF reference with operations typed by hand has no parsed rows but is
    // still valid, so the rule accepts EITHER a chosen file OR typed operations.
    message: 'Please upload a process sheet',
    valid: (value, values) => required(value) || (values.operationCount || 0) > 0,
  },
  {
    name: 'operations',
    message: 'Please add at least one operation',
    valid: (value, values) => (values.operationCount || 0) > 0,
  },
];

/**
 * The sequential rules for the Capacity panel's "Save targets for this style".
 * Order: Total Deployed Manpower → Working Hours → Efficiency %. English only.
 */
/**
 * One rule per field, in order. Each rule reports BOTH "empty" and "out of
 * range" with the same field name, because the sequential check flags the field
 * itself — the message is chosen by which condition actually failed, so an empty
 * box says "please enter" and a typed-but-wrong value says what is wrong.
 *
 * `message` is the empty-state prompt; `invalidMessage` is used when a value is
 * present but rejected. This keeps a single entry per field, so "first invalid"
 * really does mean the first FIELD in the sequence.
 */
export const CAPACITY_RULES = [
  {
    name: 'manpower',
    message: 'Please enter Total Deployed Manpower',
    invalidMessage: 'Total Deployed Manpower must be greater than 0',
    valid: required,
    validValue: positiveNumber,
  },
  {
    name: 'workingHours',
    message: 'Please enter Working Hours',
    invalidMessage: 'Working Hours must be greater than 0',
    valid: required,
    validValue: positiveNumber,
  },
  {
    name: 'efficiency',
    message: 'Please enter Efficiency %',
    invalidMessage: 'Efficiency % must be between 1 and 100',
    valid: required,
    validValue: percentWithin100,
  },
];

/**
 * The sequential rules for a capacity save, resolved for one set of values.
 *
 * `firstInvalid` expects each rule to carry a single `message` and a single
 * `valid`, so this expands the two-condition entries above into exactly that —
 * still one field at a time, but with the right sentence for the failure.
 */
export function capacityRules(values = {}) {
  return CAPACITY_RULES.map((rule) => ({
    name: rule.name,
    message: required(values[rule.name]) ? rule.invalidMessage : rule.message,
    valid: (value) => required(value) && rule.validValue(value),
  }));
}

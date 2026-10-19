/**
 * ROBIUL GARMENTS ERP — the targets a Total Line Output entry inherits.
 *
 * A line entry names an ORDER and an ACHIEVEMENT, and nothing else. The targets it
 * is measured against already exist: the uploaded Process Sheet for that order
 * carries every operation's SMV, so it carries the line's hourly and daily goal.
 * Asking a supervisor to type them would mean two people deriving the same figure
 * and one of them eventually getting it wrong.
 *
 * So this module is the ONE lookup the form uses — "given this order's sheet, what
 * are its hourly and daily targets?" — stated as pure functions so the precedence
 * is testable without a rendered form.
 *
 * WHERE THE FIGURES COME FROM, in order
 * -------------------------------------
 *   1. The capacity record saved against the style ("Save targets for this style"
 *      on the Process Sheet screen). It holds the line's own hourly and daily
 *      targets, so it is the most specific figure there is.
 *   2. The line-output operation's row on the sheet, through the shared SMV engine.
 *   3. The whole-garment target — every operation's target with the buffer applied —
 *      which is what a "Total Line Output" entry is measured against: the line
 *      completes garments, not one operation's share.
 *
 * Anything unreadable returns `hasTarget: false`, so a caller shows a "no sheet"
 * note rather than an invented target.
 */

import { latestSheetForStyle, lineOutputProcessFor } from './orderWorkflow';
import {
  autoTargetForOperation,
  completeBodyTarget,
  capacityForStyle,
  STANDARD_DAY_HOURS,
} from './smvTargetEngine';

/** The shape a caller always receives, whatever was found. */
function none() {
  return {
    hourlyTarget: 0,
    dailyTarget: 0,
    process: '',
    source: 'none',
    hasTarget: false,
    sheet: null,
    operations: 0,
  };
}

/**
 * A positive number from a stored figure, or 0.
 * `Number('')` is 0 and `Number(undefined)` is NaN, so both collapse cleanly.
 */
function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The targets one order's Process Sheet states for its line.
 *
 * @param {Array}  sheets  the saved `process-breakdown` rows
 * @param {object} order   { style, order_no } — the order the entry is booked to
 * @param {Array}  capacityRows the saved `process-capacity` rows (optional)
 * @returns {{
 *   hourlyTarget: number, dailyTarget: number, process: string,
 *   source: 'capacity'|'line-output'|'garment'|'none',
 *   hasTarget: boolean, sheet: object|null, operations: number
 * }}
 */
export function processSheetTargets(sheets = [], order = {}, capacityRows = []) {
  const { style, order_no: orderNo } = order || {};
  // `capacityForStyle` also matches on the order number, so a style name that has
  // since been corrected still finds the settings saved under the order.
  const capacity = capacityForStyle(capacityRows, { style, order_no: orderNo });
  const sheet = latestSheetForStyle(sheets, { style, order_no: orderNo });

  // ---- 1. The line targets saved against the style ----
  const savedHourly = positive(capacity?.lineHourlyTarget);
  const savedDaily = positive(capacity?.bodyTarget) || positive(capacity?.lineDailyTarget);
  if (savedHourly > 0 || savedDaily > 0) {
    return {
      hourlyTarget: savedHourly,
      // A capacity record that states only one of the two is completed from the
      // other over the standard day, rather than reporting a half-known target.
      dailyTarget: savedDaily || savedHourly * STANDARD_DAY_HOURS,
      process: lineOutputProcessFor(sheets, { style, order_no: orderNo }),
      source: 'capacity',
      hasTarget: true,
      sheet,
      operations: Array.isArray(sheet?.operations) ? sheet.operations.length : 0,
    };
  }

  if (!sheet) return none();

  const operations = Array.isArray(sheet.operations) ? sheet.operations : [];
  const process = lineOutputProcessFor(sheets, { style, order_no: orderNo });
  const buffer = positive(sheet.targetBuffer);
  const settings = { ...sheet, targetBuffer: buffer };

  // ---- 2. The designated line-output operation's own target ----
  if (process) {
    const auto = autoTargetForOperation({
      operations,
      settings,
      operationName: process,
      bufferPercent: buffer,
    });
    if (auto.hasSmv && (auto.hourlyTarget > 0 || auto.dailyTarget > 0)) {
      return {
        hourlyTarget: positive(auto.hourlyTarget),
        dailyTarget: positive(auto.dailyTarget),
        process,
        source: 'line-output',
        hasTarget: true,
        sheet,
        operations: operations.length,
      };
    }
  }

  // ---- 3. The whole garment ----
  const body = completeBodyTarget(operations, settings);
  if (body.hasTarget && body.dailyTarget > 0) {
    return {
      hourlyTarget: positive(body.hourlyTarget),
      dailyTarget: positive(body.dailyTarget),
      process,
      source: 'garment',
      hasTarget: true,
      sheet,
      operations: operations.length,
    };
  }

  // The sheet exists but carries no SMV anywhere — an order booked before its
  // operations were timed. Reported as "no target", never as zero achieved.
  return { ...none(), process, sheet, operations: operations.length };
}

/**
 * A short English explanation of where a target came from, for the form's hint.
 *
 * Kept beside the lookup so the wording and the precedence cannot drift: a screen
 * printing "from the sheet" for a figure that was actually derived from the garment
 * total is a small lie that gets repeated on every review.
 */
export function targetSourceNote(targets = {}) {
  switch (targets.source) {
    case 'capacity':
      return 'Loaded from the targets saved for this order\u2019s style.';
    case 'line-output':
      return `Derived from the Process Sheet\u2019s SMV for "${targets.process}".`;
    case 'garment':
      return 'Derived from the whole-garment SMV on the Process Sheet.';
    case 'none':
      return targets.sheet
        ? 'This order\u2019s Process Sheet carries no SMV, so no target can be derived yet.'
        : 'No Process Sheet is uploaded for this order yet. Upload one to load the targets.';
    default:
      return '';
  }
}

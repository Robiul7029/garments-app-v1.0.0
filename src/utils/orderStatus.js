import { ORDER_STATUS } from '../config/erpSchema';
import { toNumber } from './erpCalculations';

const CLOSED = new Set([
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.INACTIVE,
  ORDER_STATUS.CLOSED,
  ORDER_STATUS.ARCHIVED,
  ORDER_STATUS.CANCELLED,
]);

/**
 * Normalise anything date-like to a `YYYY-MM-DD` string at LOCAL midnight.
 *
 * This is the fix for the time-zone bug: `new Date('2026-11-30')` is parsed as
 * UTC midnight, so reading its local day parts on a machine behind UTC yields the
 * 29th — an order due on the 30th would silently drop out of the active count a
 * day early. Comparing two `YYYY-MM-DD` STRINGS instead removes the time zone
 * from the comparison entirely: the string is built from the value's own local
 * parts, and lexicographic order on `YYYY-MM-DD` is calendar order.
 *
 * Accepts a `Date`, a Firestore Timestamp (`toDate()`), or a string. A bare
 * `YYYY-MM-DD` string is taken at face value rather than re-parsed, so it cannot
 * be shifted by a UTC round-trip. Returns `''` for a missing/unreadable value,
 * which every caller treats as "no bound".
 */
export function normaliseDateKey(value) {
  if (!value) return '';
  // A plain calendar string is already the answer — do not round-trip it.
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  let d = null;
  if (value instanceof Date) d = value;
  else if (typeof value?.toDate === 'function') d = value.toDate();
  else d = new Date(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve fulfillment and deadline state without mutating the saved order.
 *
 * The date window is read from whichever key the record carries, so an order
 * master row (`order_date` / `ship_date`) and a purchase order (`poDate` /
 * `shipmentDate`) are both understood:
 *
 *   startDate     the day work on the order begins  (`YYYY-MM-DD` or '')
 *   deliveryDate  the day it is due                 (`YYYY-MM-DD` or '')
 *
 * `beforeStartDate` and `pastDeliveryDate` are the two ends of that window, and
 * together with `fullyFulfilled` they are what make an order "active" — see
 * `isActiveOrder`. Both are inclusive: an order starting today is active, and one
 * due today is still active until the day ends.
 *
 * The comparison is done on `YYYY-MM-DD` strings (see `normaliseDateKey`), never
 * on `Date` objects, so no time zone can shift an order across a day boundary.
 *
 * Every field is read defensively: a row missing `orderNo`, `styleNo`, dates or
 * quantities resolves to a sensible state rather than throwing.
 */
export function resolveOrderStatus(order = {}, today = new Date()) {
  const qty = Math.max(0, toNumber(order?.totalQty ?? order?.poQty ?? order?.quantity));
  const shipped = Math.max(0, toNumber(order?.shippedQty));
  const produced = Math.max(0, toNumber(order?.producedQty ?? order?.productionOutput));
  const fulfilled = Math.max(shipped, produced);

  const startKey = normaliseDateKey(
    order?.startDate ?? order?.start_date ?? order?.orderDate ?? order?.order_date ?? order?.poDate,
  );
  const dueKey = normaliseDateKey(
    order?.shipmentDate ?? order?.deliveryDate ?? order?.delivery_date ?? order?.ship_date,
  );
  const todayKey = normaliseDateKey(today);

  // Lexicographic comparison on `YYYY-MM-DD` is calendar comparison, with no
  // time zone involved. A missing bound is "no bound", never a rejection.
  const beforeStartDate = Boolean(startKey && todayKey && todayKey < startKey);
  const pastDeliveryDate = Boolean(dueKey && todayKey && todayKey > dueKey);
  const fullyFulfilled = qty > 0 && fulfilled >= qty;
  const manuallyClosed = CLOSED.has(String(order?.status || '').trim());
  const manualOverride = order?.manualStatusOverride === true;

  let status = order?.status || ORDER_STATUS.NEW;
  let autoStatus = '';
  if (!manualOverride && !manuallyClosed && (pastDeliveryDate || fullyFulfilled)) {
    autoStatus = fullyFulfilled ? ORDER_STATUS.COMPLETED : ORDER_STATUS.INACTIVE;
    status = autoStatus;
  }
  return {
    status, autoStatus, manuallyClosed, manualOverride,
    startDate: startKey, dueDate: dueKey, today: todayKey,
    beforeStartDate, pastDeliveryDate, fullyFulfilled, fulfilled, qty,
  };
}

export function isEligibleForAutomaticStatus(status = '') {
  return new Set([
    'Active',
    ORDER_STATUS.NEW,
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.PRODUCTION,
    ORDER_STATUS.PARTIALLY_COMPLETED,
    ORDER_STATUS.READY_TO_SHIP,
    ORDER_STATUS.DELAYED,
  ]).has(String(status).trim());
}

/**
 * Is an order ACTIVE on `today`?
 *
 * The brief's dynamic window, with no manual status toggle and no exact-day
 * matching required:
 *
 *   current date >= start date
 *   AND current date <= delivery date
 *   AND total produced output < PO qty
 *
 * So an order is active while it is inside its own start→delivery window and not
 * yet fully produced. It drops out of the count the day after its delivery date,
 * or the moment production reaches the PO quantity.
 *
 * A missing start date is treated as "already started" rather than "not yet
 * started": an order that predates this field, or one entered without a plan
 * date, must still be countable. A missing delivery date is treated as open-ended
 * for the same reason. Only a start date genuinely in the FUTURE excludes a row.
 *
 * A manual close (Completed / Cancelled / Closed / …) always wins, and an explicit
 * `manualStatusOverride` is honoured as the operator's own decision.
 *
 * A row missing `orderNo` / `styleNo` is NOT rejected here — identity is the
 * caller's concern, and the counter must count an order even when a label is
 * blank. This function only ever answers the date-and-quantity question.
 */
export function isActiveOrder(order, today = new Date()) {
  const resolved = resolveOrderStatus(order, today);
  if (resolved.manualOverride) return !resolved.manuallyClosed;
  return !resolved.manuallyClosed
    && !resolved.beforeStartDate
    && !resolved.pastDeliveryDate
    && !resolved.fullyFulfilled;
}

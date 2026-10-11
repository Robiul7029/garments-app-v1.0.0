/**
 * ROBIUL GARMENTS ERP — dashboard helpers.
 *
 * The calculations that exist only to feed the Management Dashboard, kept out of
 * `erpCalculations` so that the shared, business-critical maths stays small and
 * unit-tested. Everything here is pure: it takes rows and returns the exact
 * shape the chart and table components expect.
 */

import {
  toNumber, toDateKey, parseDate, stockFromLedger, stockLevel, round,
} from './erpCalculations';

/**
 * Whole days from `today` to `dueDate`; negative means the date has passed.
 *
 * Returns `null` — not 0 — when there is no usable date, because "no delivery
 * date recorded" and "due today" are different answers and the order table has
 * to tell them apart. The dashboard already branches on `null` for overdue and
 * due-soon checks, so a missing date can never be mistaken for a delay.
 */
export function daysUntil(dueDate, today) {
  const due = parseDate(dueDate);
  const now = parseDate(today) || new Date();
  if (!due) return null;
  // Compare date parts, not millisecond instants: a PO due "today" is due in 0
  // days whether the timestamp sits at 00:00 or at 18:00.
  const dueKey = toDateKey(due);
  const nowKey = toDateKey(now);
  if (!dueKey || !nowKey) return null;
  const dueMidnight = new Date(`${dueKey}T00:00:00`);
  const nowMidnight = new Date(`${nowKey}T00:00:00`);
  if (Number.isNaN(dueMidnight.getTime()) || Number.isNaN(nowMidnight.getTime())) return null;
  return Math.round((dueMidnight - nowMidnight) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Compact, unambiguous date for a dense table cell: `10 Oct`.
 *
 * The dashboard is read on a factory floor by people who know the month they are
 * in, so the year is dropped — but kept in a `title` on the cell by the caller
 * for the rare case of a year boundary. Returns `—` rather than `Invalid Date`.
 */
export function formatShort(value) {
  const d = parseDate(value);
  if (!d) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Stock position per item, from the movement ledger.
 *
 * Stock is the sum of movements — never a counter stored on the item — so this
 * reads the ledger, joins it to the item master for the name and thresholds, and
 * returns three things the dashboard panel needs:
 *
 *   byItem   every item with stock and its 🟢/🟠/🔴 level, worst first
 *   low      only the items at or below their own minimum
 *   totalQty / totalValue  the headline figures for the KPI card
 *
 * Items that have never moved are still listed, at zero — an item that should
 * have stock and has none is exactly what a storekeeper needs to see.
 */
export function summariseStock(items = [], ledger = []) {
  const itemRows = Array.isArray(items) ? items : [];
  const moves = Array.isArray(ledger) ? ledger : [];

  // Group movements by item once, rather than filtering the ledger per item —
  // this runs on every snapshot and the ledger only grows.
  const movesByItem = new Map();
  moves.forEach((entry) => {
    const id = entry?.itemId;
    if (!id) return;
    const bucket = movesByItem.get(id);
    if (bucket) bucket.push(entry);
    else movesByItem.set(id, [entry]);
  });

  const byItem = itemRows.map((item) => {
    const qty = stockFromLedger(movesByItem.get(item.id) || []);
    const level = stockLevel(item, qty);
    const minQty = toNumber(item.minQty);
    const maxQty = toNumber(item.maxQty);
    // `unitCost` is the schema's field name; `rate` is kept as a fallback for
    // deployments that imported items before the costing fields were settled.
    const rate = toNumber(item.unitCost ?? item.rate ?? item.unitPrice);
    return {
      id: item.id,
      label: item.name || item.itemCode || item.id,
      icon: level === 'critical' ? '🔴' : level === 'warning' ? '🟠' : '🟢',
      value: qty,
      minQty,
      maxQty,
      unit: item.unit || 'pcs',
      // The per-unit cost is carried through as well as the extended value: the
      // dashboard prices a FULL store (max qty x cost) to scale its inventory
      // bar, which it cannot do from an extended value alone without dividing
      // by the quantity — and that divide is undefined for an item at zero.
      unitCost: rate,
      value_currency: round(qty * rate, 2),
      level,
      hint: minQty > 0 ? `Minimum ${minQty.toLocaleString()}${item.unit ? ` ${item.unit}` : ''}` : '',
    };
  });

  // Worst first: the red items are the ones someone has to act on today.
  const rank = (r) => (r.level === 'critical' ? 0 : r.level === 'warning' ? 1 : 2);
  byItem.sort((a, b) => rank(a) - rank(b) || a.value - b.value);

  const low = byItem.filter((r) => r.level !== 'good');

  return {
    byItem,
    low,
    totalQty: byItem.reduce((s, r) => s + r.value, 0),
    totalValue: round(byItem.reduce((s, r) => s + r.value_currency, 0), 2),
  };
}

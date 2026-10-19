/**
 * ROBIUL GARMENTS ERP — Cutting Department production.
 *
 * The arithmetic behind the Cutting Entry form and the Cutting Report, written as
 * pure functions so it can be unit-tested without a database and reused by the
 * form's preview, the report table and the KPI cards alike. No React, no storage,
 * no Firestore — pure functions only.
 *
 * THE MODEL
 * ---------
 * A cutting entry is one LAY/TABLE cut: the operator spreads a marker of a given
 * length, consumes a length of fabric, and cuts a number of pieces. It is recorded
 * in the `cuttingEntries` collection, one document per lay.
 *
 *     Total Cut Pcs ................ the pieces that lay produced
 *     Issued to Sewing Line Pcs .... how much of that has been handed to a line
 *     Remaining Balance ............ cut − issued = what is still in cutting stock
 *
 * The "Remaining Balance in Cutting Stock" is the quantity that is available to
 * feed a sewing line next — which is exactly the WIP the brief asks to link into
 * the Line Input pool. `cuttingWipFeed` produces the rows the Line Input screen
 * offers, so the two screens cannot disagree about what is available to feed.
 *
 * Both "issued" figures are read: the quantity recorded on the cutting entry
 * itself (`issuedQty`) AND the quantity actually logged as a line input against
 * the same order (the `lineInputs` collection, written by the Line Input Entry
 * screen). A lay is issued once, but it may be logged in either place depending on
 * which screen the supervisor was on, so taking the larger of the two avoids
 * double-counting while never reporting more remaining stock than truly exists.
 *
 * LEGACY ROWS
 * -----------
 * Before this module existed, cutting was recorded through the generic
 * `DataModule` table into a local `cutting-production` collection with a different
 * shape (`lay_qty`, `quantity`, no order number, no fabric). `normaliseLegacyCuttingRows`
 * reads those rows into the shape the report renders, so a factory that has been
 * cutting for months does not open the new report and find it empty. The mapping
 * is READ-ONLY and additive: the legacy rows are never rewritten, so nothing that
 * still reads the old collection changes behaviour.
 */

import { toNumber } from '../utils/erpCalculations';

/** A YYYY-MM-DD key from anything a stored row may hold. */
export function cuttingDayKey(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/** Today's YYYY-MM-DD, in the factory's own local calendar. */
export function todayKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The order number a cutting entry belongs to, tolerating the two spellings. */
export function cuttingOrderOf(row = {}) {
  return String(row.order_no || row.orderNo || '').trim();
}

/** The style a cutting entry is for. */
export function cuttingStyleOf(row = {}) {
  return String(row.style || row.styleNo || '').trim();
}

/** The buyer a cutting entry is for. */
export function cuttingBuyerOf(row = {}) {
  return String(row.buyer || row.buyerName || '').trim();
}

/** The lay / table number — what makes one entry on a day distinct from the next. */
export function cuttingLayOf(row = {}) {
  return String(row.layNo || row.lay_no || row.lay || '').trim();
}

/** The total pieces one cutting entry produced. */
export function cuttingQtyOf(row = {}) {
  return toNumber(row.cutQty)
    || toNumber(row.totalCutQty)
    || toNumber(row.quantity)
    || toNumber(row.qty);
}

/** The fabric consumed by one cutting entry. */
export function cuttingFabricOf(row = {}) {
  return toNumber(row.fabricConsumed)
    || toNumber(row.fabric_consumed)
    || toNumber(row.fabricUsed);
}

/**
 * The unit the fabric figure is in.
 *
 * Yards and Meters are the two units the brief names. Anything else falls back to
 * Yards, because a fabricated third unit would silently make the "Total Fabric
 * Consumed" card add unlike quantities together.
 */
export function cuttingFabricUnitOf(row = {}) {
  const unit = String(row.fabricUnit || row.fabric_unit || '').trim().toLowerCase();
  if (unit.startsWith('met') || unit === 'm' || unit === 'mtr') return 'Meters';
  return 'Yards';
}

/** The pieces a cutting entry recorded as handed to a sewing line. */
export function cuttingIssuedOf(row = {}) {
  return toNumber(row.issuedQty)
    || toNumber(row.issued_to_sewing)
    || toNumber(row.issuedToSewing)
    || 0;
}

/**
 * The pieces logged as a line input against one order.
 *
 * Used as the OTHER source of "issued to sewing": a supervisor may log the feeding
 * on the Line Input Entry screen rather than against the cutting entry, and the
 * report must count it either way. Returns a Map keyed on the order number.
 */
export function issuedByOrderFromLineInputs(lineInputs = []) {
  const map = new Map();
  (Array.isArray(lineInputs) ? lineInputs : []).forEach((row) => {
    if (!row) return;
    const order = String(row.order_no || row.orderNo || '').trim().toLowerCase();
    if (!order) return;
    const qty = toNumber(row.inputQty) || toNumber(row.quantity) || toNumber(row.qty);
    map.set(order, (map.get(order) || 0) + qty);
  });
  return map;
}

/**
 * The cutting report rows: one row per cutting entry, with the remaining balance
 * in cutting stock computed.
 *
 * This is the table the brief describes — Buyer, Order No, Style, Lay No, Total
 * Cut Pcs, Fabric Used, Issued to Sewing Line Pcs, Remaining Balance — plus the
 * date and status a reader needs to make sense of it.
 *
 * `opts.issuedByOrder` is the per-order issued total read from `lineInputs`, so a
 * feeding logged on the Line Input screen counts here too. The issued figure on
 * the row and the per-order feeding are never ADDED: the larger is taken, because
 * they describe the same pieces. Adding them would show a lay as fully issued
 * twice over and hide genuine remaining stock.
 */
export function cuttingReportRows(entries = [], opts = {}) {
  const { issuedByOrder = new Map() } = opts;
  return (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .map((row) => {
      const orderKey = cuttingOrderOf(row).toLowerCase();
      const onRow = cuttingIssuedOf(row);
      const fromLine = orderKey ? toNumber(issuedByOrder.get(orderKey)) : 0;
      const cutQty = cuttingQtyOf(row);
      // The larger of the two records of the same feeding — see the note above.
      const issuedQty = Math.max(onRow, fromLine);
      const remaining = Math.max(0, cutQty - issuedQty);
      return {
        id: row.id,
        date: cuttingDayKey(row.date),
        rawDate: row.date || '',
        buyer: cuttingBuyerOf(row),
        order_no: cuttingOrderOf(row),
        style: cuttingStyleOf(row),
        color: String(row.color || '').trim(),
        sizeRange: String(row.sizeRange || row.size_range || '').trim(),
        poQty: toNumber(row.poQty) || toNumber(row.po_qty),
        layNo: cuttingLayOf(row),
        markerLength: toNumber(row.markerLength),
        fabricConsumed: cuttingFabricOf(row),
        fabricUnit: cuttingFabricUnitOf(row),
        cutQty,
        issuedQty,
        remaining,
        remarks: String(row.remarks || '').trim(),
        // A row migrated from the old `cutting-production` collection. Carried
        // through so the report can badge it: a reader must be able to tell an
        // imported historical row from one entered on the new form, because the
        // imported row has no fabric figure and cannot be edited.
        legacy: row.legacy === true,
        // The badge the report shows. Derived, never stored: a lay's status is a
        // consequence of the two quantities, so storing it would let the two drift.
        status: remaining <= 0 ? 'Issued to Sewing' : issuedQty > 0 ? 'Partially Issued' : 'Ready',
        // Tone for the 🟢🟠🔴 indicator the rest of the app uses.
        level: remaining <= 0 ? 'good' : issuedQty > 0 ? 'warning' : 'info',
      };
    })
    .sort((a, b) => (
      String(b.date).localeCompare(String(a.date))
      || String(a.order_no).localeCompare(String(b.order_no))
      || String(a.layNo).localeCompare(String(b.layNo), undefined, { numeric: true })
    ));
}

/**
 * Applies the report's filters to the computed rows.
 *
 * Filtering happens here rather than in the screen so the table and the KPI cards
 * read the SAME filtered set and cannot describe different days.
 */
export function filterCuttingRows(rows = [], filters = {}) {
  const { date = '', from = '', to = '', order_no = '', style = '' } = filters;
  const day = cuttingDayKey(date);
  const fromKey = cuttingDayKey(from);
  const toKey = cuttingDayKey(to);
  const wantedOrder = String(order_no || '').trim().toLowerCase();
  const wantedStyle = String(style || '').trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const key = row.date;
    if (!key) return !day && !fromKey && !toKey;
    if (day && key !== day) return false;
    if (fromKey && key < fromKey) return false;
    if (toKey && key > toKey) return false;
    if (wantedOrder && String(row.order_no || '').toLowerCase() !== wantedOrder) return false;
    if (wantedStyle && String(row.style || '').toLowerCase() !== wantedStyle) return false;
    return true;
  });
}

/**
 * The four KPI cards the brief asks for.
 *
 *   Today's Total Cut Pcs ................ pieces cut today
 *   Cutting Target vs Achievement % ...... today's cut against the day's target
 *   Total Fabric Consumed Today .......... fabric used today, per unit
 *   Ready Stock for Sewing Feeding ....... cut but not yet issued — the WIP
 *
 * The achievement percentage is computed from the SAME rows the table renders, so
 * a filter that changes the table changes the percentage with it.
 *
 * The target is derived from the cutting plan when one is available (the day's
 * planned quantity), and otherwise from the sum of the entries' own PO quantities
 * for the day — so the card is meaningful on a deployment that has not filled in a
 * plan. When neither exists the target is 0 and the percentage is reported as null
 * rather than as a misleading 100%.
 */
export function cuttingKpis(rows = [], opts = {}) {
  const { date = todayKey(), target = 0 } = opts;
  const day = cuttingDayKey(date);
  const todayRows = (Array.isArray(rows) ? rows : []).filter((row) => row.date === day);

  const totalCut = todayRows.reduce((sum, r) => sum + toNumber(r.cutQty), 0);
  const totalIssued = todayRows.reduce((sum, r) => sum + toNumber(r.issuedQty), 0);
  const readyStock = todayRows.reduce((sum, r) => sum + toNumber(r.remaining), 0);

  // Fabric is reported per unit, never summed across units: adding 500 yards to
  // 300 meters would produce a number that means nothing.
  const fabricByUnit = todayRows.reduce((acc, r) => {
    const unit = r.fabricUnit || 'Yards';
    acc[unit] = (acc[unit] || 0) + toNumber(r.fabricConsumed);
    return acc;
  }, {});

  const dayTarget = toNumber(target) || todayRows.reduce((sum, r) => sum + toNumber(r.poQty), 0);
  const achievement = dayTarget > 0 ? Math.round((totalCut / dayTarget) * 1000) / 10 : null;

  return {
    date: day,
    totalCut,
    totalIssued,
    readyStock,
    fabricByUnit,
    // The primary fabric figure, for a single-number card. The unit is carried
    // with it so the card can never print "1,200" without saying of what.
    fabricTotal: Object.values(fabricByUnit).reduce((sum, v) => sum + v, 0),
    fabricUnit: Object.keys(fabricByUnit)[0] || 'Yards',
    target: dayTarget,
    achievement,
    // Tone for the 🟢🟠🔴 indicator: meeting the day's target is good, falling
    // short of it is a warning, and having no target at all is informational.
    achievementLevel: achievement === null ? 'info' : achievement >= 100 ? 'good' : achievement >= 80 ? 'warning' : 'critical',
    entries: todayRows.length,
  };
}

/**
 * The rows the Line Input screen offers as available WIP.
 *
 * The brief's requirement is that a saved "Total Cut Quantity" becomes available
 * Work In Progress for the sewing line's input pool. This produces exactly that:
 * one row per order + style + colour that has cut pieces which have not yet been
 * issued, with the balance available to feed.
 *
 * A row with nothing left to issue is dropped, so the Line Input dropdown never
 * offers a line a feeding that has already happened.
 */
export function cuttingWipFeed(rows = []) {
  const groups = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    const remaining = toNumber(row.remaining);
    if (remaining <= 0) return;
    const key = [
      String(row.order_no || '').trim().toLowerCase(),
      String(row.style || '').trim().toLowerCase(),
      String(row.color || '').trim().toLowerCase(),
    ].join('||');
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        order_no: row.order_no || '',
        style: row.style || '',
        color: row.color || '',
        buyer: row.buyer || '',
        sizeRange: row.sizeRange || '',
        cutQty: 0,
        issuedQty: 0,
        availableQty: 0,
        // The lay numbers behind this balance, so a feeding can name the lay it
        // came from rather than a nameless lump of pieces.
        lays: new Set(),
        lastDate: '',
      });
    }
    const group = groups.get(key);
    group.cutQty += toNumber(row.cutQty);
    group.issuedQty += toNumber(row.issuedQty);
    group.availableQty += remaining;
    if (row.layNo) group.lays.add(row.layNo);
    if (row.date && row.date > group.lastDate) group.lastDate = row.date;
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      lays: [...group.lays].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    }))
    .sort((a, b) => (
      String(a.order_no).localeCompare(String(b.order_no))
      || String(a.style).localeCompare(String(b.style))
      || String(a.color).localeCompare(String(b.color))
    ));
}

/**
 * The per-order summary: how much was cut and how much is left to feed.
 *
 * A different aggregation from `cuttingWipFeed` on purpose — the WIP feed splits
 * on colour because a feeding is for one colour, while this answers "for this
 * order, how far did cutting get", which is the question the report's order filter
 * raises.
 */
export function cuttingByOrder(rows = []) {
  const groups = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    const key = String(row.order_no || row.style || '').trim().toLowerCase();
    if (!key) return;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        order_no: row.order_no || '',
        style: row.style || '',
        buyer: row.buyer || '',
        poQty: 0,
        cutQty: 0,
        issuedQty: 0,
        remaining: 0,
        fabricByUnit: {},
        lays: 0,
      });
    }
    const group = groups.get(key);
    group.poQty = Math.max(group.poQty, toNumber(row.poQty));
    group.cutQty += toNumber(row.cutQty);
    group.issuedQty += toNumber(row.issuedQty);
    group.remaining += toNumber(row.remaining);
    const unit = row.fabricUnit || 'Yards';
    group.fabricByUnit[unit] = (group.fabricByUnit[unit] || 0) + toNumber(row.fabricConsumed);
    group.lays += 1;
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      // How far this order has been cut against its PO quantity.
      cutPercent: group.poQty > 0
        ? Math.round((Math.min(group.cutQty, group.poQty) / group.poQty) * 1000) / 10
        : null,
    }))
    .sort((a, b) => b.cutQty - a.cutQty);
}

/**
 * The distinct value of a field across the report rows — used to populate the
 * Order and Style filters without a second collection read.
 */
export function cuttingDistinct(rows = [], field) {
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const value = String(row?.[field] || '').trim();
    if (value) seen.add(value);
  });
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Builds the record a cutting entry is SAVED as.
 *
 * Kept as a function (rather than assembled inline in the form) so the fields the
 * report reads are written in one place: the form, the sync and any future import
 * all produce the same shape.
 *
 * `cutQty` is normalised to a number and the buyer/style/colour/size/PO quantity
 * are copied from the selected order, so the cutting book remains readable without
 * a join even if the order is later amended.
 */
export function buildCuttingEntry(input = {}) {
  const order = input.order || {};
  return {
    date: cuttingDayKey(input.date) || todayKey(),
    order_no: String(input.order_no || order.order_no || order.orderNo || '').trim(),
    buyer: String(input.buyer || order.buyer || '').trim(),
    style: String(input.style || order.style || order.styleNo || '').trim(),
    color: String(input.color || order.color || '').trim(),
    sizeRange: String(input.sizeRange || input.size_range || order.size_range || order.sizeRange || '').trim(),
    poQty: toNumber(input.poQty ?? order.qty ?? order.poQty),
    layNo: String(input.layNo || '').trim(),
    markerLength: toNumber(input.markerLength),
    fabricConsumed: toNumber(input.fabricConsumed),
    fabricUnit: input.fabricUnit === 'Meters' ? 'Meters' : 'Yards',
    cutQty: toNumber(input.cutQty),
    issuedQty: toNumber(input.issuedQty),
    supervisor: String(input.supervisor || '').trim(),
    remarks: String(input.remarks || '').trim(),
    orderId: order.id || input.orderId || '',
  };
}

/**
 * Reads a LEGACY `cutting-production` row into the shape the report renders.
 *
 * The old generic table recorded a cutting row as:
 *
 *     { id, date, employee, style, color, lay_qty, quantity, shortfall_reason }
 *
 * and the new report needs:
 *
 *     { date, order_no, buyer, style, color, sizeRange, poQty,
 *       layNo, cutQty, fabricConsumed, ... }
 *
 * The two shapes cannot be reconciled field-for-field, because the old row simply
 * never captured an order number, a buyer or a fabric consumption. So the mapping
 * is deliberately HONEST rather than inventive:
 *
 *   quantity  → cutQty          (the old "Cut Quantity" IS the cut quantity)
 *   lay_qty   → layNo           ("No. of Lay" was a count, now it labels the lay)
 *   style     → order_no/buyer  resolved from the order master BY STYLE, which is
 *                               the only link the old row carries
 *   —         → fabricConsumed  left 0, because the old row never recorded it
 *
 * Inventing a fabric figure or an order number would put a number in front of a
 * reader that no cutting table ever produced. A blank is a blank.
 *
 * `legacy: true` marks every migrated row. The report shows the badge so nobody
 * mistakes an imported row for one entered on the new form, and it is what stops
 * the migration from being applied twice (see `mergeCuttingEntries`).
 *
 * @param {Array} legacyRows  rows from the local `cutting-production` collection
 * @param {Array} orders      the order master, used to resolve style → order/buyer
 */
export function normaliseLegacyCuttingRows(legacyRows = [], orders = []) {
  // Style is the only link a legacy row carries, so it is indexed once rather
  // than searched per row.
  const byStyle = new Map();
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    if (!order) return;
    const style = String(order.style || order.styleNo || '').trim().toLowerCase();
    if (style && !byStyle.has(style)) byStyle.set(style, order);
  });

  return (Array.isArray(legacyRows) ? legacyRows : [])
    .filter(Boolean)
    .map((row, index) => {
      const style = String(row.style || '').trim();
      const order = byStyle.get(style.toLowerCase()) || null;
      const cutQty = toNumber(row.quantity) || toNumber(row.cutQty) || toNumber(row.qty);
      // "No. of Lay" was a number in the old form; the new field is a label, so a
      // bare number becomes "Lay 3" rather than being dropped.
      const layRaw = row.layNo ?? row.lay_no ?? row.lay_qty ?? row.lay;
      const layNo = String(layRaw ?? '').trim();
      return {
        // A stable, namespaced id so a migrated row can never collide with a real
        // `cuttingEntries` document id.
        id: `legacy-${row.id ?? index}`,
        date: cuttingDayKey(row.date),
        order_no: String(row.order_no || row.orderNo || order?.order_no || order?.orderNo || '').trim(),
        buyer: String(row.buyer || order?.buyer || '').trim(),
        style,
        color: String(row.color || '').trim(),
        sizeRange: String(row.sizeRange || row.size_range || order?.size_range || order?.sizeRange || '').trim(),
        poQty: toNumber(row.poQty) || toNumber(order?.qty) || toNumber(order?.poQty),
        layNo: layNo ? (String(Number(layNo)) === layNo ? `Lay ${layNo}` : layNo) : '',
        markerLength: toNumber(row.markerLength),
        // Left at 0 on purpose — the old row has no fabric figure, and a made-up
        // one would corrupt the "Total Fabric Consumed" card.
        fabricConsumed: toNumber(row.fabricConsumed),
        fabricUnit: 'Yards',
        cutQty,
        // The old row had no issue tracking, so nothing is assumed to have been
        // issued. The `lineInputs` collection still supplies the real figure (see
        // `cuttingReportRows`), so a migrated row is not stranded at "nothing
        // issued" when the feeding was in fact logged on the Line Input screen.
        issuedQty: toNumber(row.issuedQty),
        supervisor: String(row.supervisor || row.employee || '').trim(),
        remarks: String(row.remarks || row.shortfall_reason || '').trim(),
        legacy: true,
      };
    })
    // A legacy row with no quantity at all cannot be reported on, and one with no
    // date cannot be placed in any window. Both are dropped rather than shown as a
    // zero-quantity row that would drag every average down.
    .filter((row) => row.cutQty > 0 && row.date);
}

/**
 * Merges the migrated legacy rows with the real `cuttingEntries` rows.
 *
 * A migrated row is dropped when a real entry already covers the same lay, which
 * is what stops a factory that has been entering on BOTH screens seeing every lay
 * twice. The match is on date + style + lay label + cut quantity, because those
 * four together identify a lay and no single one of them is unique.
 *
 * The real entries always win: a migrated row is a read-only echo of history, so
 * it must never shadow a row somebody can still edit.
 */
export function mergeCuttingEntries(entries = [], legacyRows = [], orders = []) {
  const real = Array.isArray(entries) ? entries : [];
  const migrated = normaliseLegacyCuttingRows(legacyRows, orders);

  const seen = new Set(real.map((row) => [
    cuttingDayKey(row.date),
    String(row.style || '').trim().toLowerCase(),
    cuttingLayOf(row).toLowerCase(),
    cuttingQtyOf(row),
  ].join('||')));

  const uniqueLegacy = migrated.filter((row) => {
    const key = [
      row.date,
      row.style.toLowerCase(),
      row.layNo.toLowerCase(),
      row.cutQty,
    ].join('||');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...real, ...uniqueLegacy];
}

/**
 * The client-side check for a cutting entry, mirroring the schema's required
 * fields so the form can answer instantly. The schema's own validator still runs
 * on save — this only makes the common case faster and gives a per-field message.
 *
 * Returns an object of { field: message }. Empty means valid.
 */
export function validateCuttingEntry(values = {}) {
  const errors = {};
  if (!String(values.order_no || '').trim()) errors.order_no = 'Order No is required.';
  if (!String(values.layNo || '').trim()) errors.layNo = 'Lay / Table No is required.';
  if (toNumber(values.fabricConsumed) <= 0) errors.fabricConsumed = 'Fabric Consumed must be greater than zero.';
  if (toNumber(values.cutQty) <= 0) errors.cutQty = 'Total Cut Quantity must be greater than zero.';
  if (!String(values.date || '').trim()) errors.date = 'Date is required.';
  // Issuing more than was cut would show negative stock, which cannot happen on a
  // cutting table: the excess is a mis-key, so it is refused rather than clamped.
  if (toNumber(values.issuedQty) > toNumber(values.cutQty)) {
    errors.issuedQty = 'Issued to Sewing Line cannot be more than the Total Cut Quantity.';
  }
  return errors;
}

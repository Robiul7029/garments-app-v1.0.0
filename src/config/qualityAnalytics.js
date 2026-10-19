/**
 * ROBIUL GARMENTS ERP — Quality Control analytics.
 *
 * Every figure the Quality Control screen shows — the KPI cards, the summary
 * table, the defect-type ranking — is computed HERE, as pure functions over the
 * stored QC rows. The screen renders; it does not calculate. That split matters
 * because a QC figure is the sort of number a manager makes a decision against:
 * one definition of "pass rate" in one tested place means the card, the table
 * and the export can never quietly disagree.
 *
 * The rows come from the `quality-control` collection — the SAME collection the
 * Unified Entry Modal's "QC Product Check" mode writes to (`buildQcRecord` in
 * `hourlyEntryMode.js`). The stored shape is therefore known and stable:
 *
 *   date, order_no, style, line, process, employee, supervisor,
 *   checked         — the brief's Total Checked (OK + Alter + Defect)
 *   defect_qty      — the brief's Defect / Reject quantity
 *   ok_pcs, alter_pcs, defect_pcs — the OK / Alter / Defect split
 *   total_checked, pass_rate, alter_rate, defect_rate — the derived figures,
 *                   kept on the document so an older reader finds what it knows
 *   defect_type     — the defect catalogue entry the check was tagged with
 *   remarks, entry_type ('qc')
 *
 * A row may also carry the split only as `ok_pcs`/`alter_pcs`/`defect_pcs` with no
 * `checked` (an older record), or only `checked`/`defect_qty` (a hand-entered one).
 * `qcBreakdown()` reconciles both without double-counting, so every aggregation
 * below starts from the same three numbers.
 */

import { toNumber, toDateKey } from '../utils/erpCalculations';

/**
 * The OK / Alter / Defect split of one QC row, always reconciled.
 *
 * Preference order for the "checked" figure:
 *   1. the explicit split, when it is present and non-zero — it is the most
 *      detailed and it is what the Unified Entry Modal writes;
 *   2. `total_checked`, the derived total the same modal stores;
 *   3. `checked`, the field the legacy QC screen and a hand-entered row use.
 *
 * The defect figure is read from `defect_pcs` first, then `defect_qty`, so a row
 * that carries both cannot have its defects counted twice.
 */
export function qcBreakdown(row = {}) {
  const okSplit = toNumber(row.ok_pcs);
  const alterSplit = toNumber(row.alter_pcs);
  const defectSplit = toNumber(row.defect_pcs);

  const splitTotal = okSplit + alterSplit + defectSplit;
  const explicitTotal = toNumber(row.total_checked) || toNumber(row.checked);
  const totalChecked = splitTotal > 0 ? splitTotal : explicitTotal;

  // The defect quantity: the split when there is one, else the flat defect field.
  let defectQty = splitTotal > 0 ? defectSplit : toNumber(row.defect_qty);
  // A hand-entered row may carry only `defect_qty` alongside a larger `checked`;
  // never let the reject figure exceed what was actually inspected.
  defectQty = Math.min(defectQty, totalChecked);

  // OK and Alter are the remainder once the defects are taken out — this keeps
  // ok + alter + defect === checked for every row, whatever shape it arrived in.
  let okPcs = splitTotal > 0 ? okSplit : Math.max(0, totalChecked - defectQty);
  let alterPcs = splitTotal > 0 ? alterSplit : 0;
  const accounted = okPcs + alterPcs + defectQty;
  if (accounted > totalChecked && accounted > 0) {
    // A row whose split over-runs its own total (bad data, not a bug here):
    // scale the OK/alter down proportionally so the row still balances.
    const excess = accounted - totalChecked;
    const reducible = okPcs + alterPcs;
    if (reducible > 0) {
      const factor = Math.max(0, (reducible - excess) / reducible);
      okPcs = Math.round(okPcs * factor);
      alterPcs = Math.round(alterPcs * factor);
    }
  }

  return {
    okPcs,
    alterPcs,
    defectPcs: defectQty,
    totalChecked,
    // The two "pending" figures a QC report needs: pieces waiting on the repair
    // table (alter) and pieces rejected outright (defect).
    passRate: totalChecked > 0 ? round1((okPcs / totalChecked) * 100) : 0,
    alterRate: totalChecked > 0 ? round1((alterPcs / totalChecked) * 100) : 0,
    defectRate: totalChecked > 0 ? round1((defectQty / totalChecked) * 100) : 0,
  };
}

/** One decimal, so 2.05 reads as 2.1 and 2.04 as 2 — the rounding a report uses. */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/** The date part of a row as YYYY-MM-DD, tolerant of Timestamp / ISO / Date. */
export function qcDateKey(row = {}) {
  return row.date ? toDateKey(row.date) : '';
}

/** The line a QC row belongs to, from either stored field name. */
export function qcLine(row = {}) {
  return String(row.line ?? row.line_no ?? row.lineNo ?? '').trim();
}

/** The order a QC row belongs to, from either stored field name. */
export function qcOrder(row = {}) {
  return String(row.order_no ?? row.orderNo ?? row.poNo ?? '').trim();
}

/** The style a QC row belongs to. */
export function qcStyle(row = {}) {
  return String(row.style ?? row.styleNo ?? '').trim();
}

/** The process a QC row belongs to. */
export function qcProcess(row = {}) {
  return String(row.process ?? row.operation ?? '').trim();
}

/**
 * The status badge a summary row carries.
 *
 * The brief's FTR bands, applied per row: Green >= 95%, Yellow 90–94%, Red < 90%.
 * The label is a WORD, never colour alone — "Pass", "Watch", "At Risk" — so the
 * badge survives a colour-blind reader and a cheap factory monitor.
 */
export function qcRowStatus(passRate) {
  const rate = toNumber(passRate);
  if (rate >= 95) return { key: 'pass', label: 'Pass', tone: 'success' };
  if (rate >= 90) return { key: 'watch', label: 'Watch', tone: 'warning' };
  return { key: 'risk', label: 'At Risk', tone: 'danger' };
}

/**
 * The KPI headline for a set of QC rows.
 *
 *   totalChecked  — sum of OK + Alter + Defect pcs across the set
 *   okPcs / alterPcs / defectPcs — the split
 *   passRate      — OK share of everything checked (the brief's FTR %)
 *   defectRate    — defect share of everything checked
 *   pendingAlter  — pieces waiting on the repair table
 *   defectTypes   — the distinct defect types seen, ranked by defect qty
 */
export function summariseQuality(rows = []) {
  const safe = Array.isArray(rows) ? rows : [];
  let totalChecked = 0;
  let okPcs = 0;
  let alterPcs = 0;
  let defectPcs = 0;
  const byType = new Map();

  safe.forEach((row) => {
    const b = qcBreakdown(row);
    totalChecked += b.totalChecked;
    okPcs += b.okPcs;
    alterPcs += b.alterPcs;
    defectPcs += b.defectPcs;

    const type = String(row.defect_type ?? row.defectType ?? '').trim();
    // A check with no defects is not a defect type — it must not become a row
    // labelled "—" in the ranking.
    if (b.defectPcs > 0) {
      const key = type || 'Unspecified';
      const entry = byType.get(key) || { type: key, defectPcs: 0, entries: 0, checked: 0 };
      entry.defectPcs += b.defectPcs;
      entry.checked += b.totalChecked;
      entry.entries += 1;
      byType.set(key, entry);
    }
  });

  const defectTypes = [...byType.values()]
    .map((entry) => ({
      ...entry,
      // What share of everything inspected this type accounts for — the figure
      // that tells a manager whether a fix is worth the line's time.
      share: totalChecked > 0 ? round1((entry.defectPcs / totalChecked) * 100) : 0,
    }))
    .sort((a, b) => b.defectPcs - a.defectPcs || a.type.localeCompare(b.type));

  return {
    totalChecked,
    okPcs,
    alterPcs,
    defectPcs,
    passRate: totalChecked > 0 ? round1((okPcs / totalChecked) * 100) : 0,
    defectRate: totalChecked > 0 ? round1((defectPcs / totalChecked) * 100) : 0,
    alterRate: totalChecked > 0 ? round1((alterPcs / totalChecked) * 100) : 0,
    pendingAlter: alterPcs,
    entries: safe.length,
    defectTypes,
    topDefectTypes: defectTypes.slice(0, 3),
  };
}

/**
 * The summary table: one row per QC entry, in the brief's column order.
 *
 * `rows` is already filtered by the screen (date range, line, order) — filtering
 * happens on the raw rows so the KPI cards and the table describe the same set.
 */
export function buildQualitySummaryRows(rows = []) {
  const safe = Array.isArray(rows) ? rows : [];
  return safe
    .map((row) => {
      const b = qcBreakdown(row);
      const status = qcRowStatus(b.passRate);
      return {
        id: row.id,
        date: qcDateKey(row),
        line: qcLine(row) || '—',
        orderNo: qcOrder(row) || '—',
        style: qcStyle(row) || '—',
        process: qcProcess(row) || '—',
        checkedQty: b.totalChecked,
        okPcs: b.okPcs,
        alterPcs: b.alterPcs,
        defectQty: b.defectPcs,
        defectRate: b.defectRate,
        passRate: b.passRate,
        defectType: String(row.defect_type ?? row.defectType ?? '').trim() || '—',
        statusKey: status.key,
        statusLabel: status.label,
        statusTone: status.tone,
        raw: row,
      };
    })
    // Newest first; a tie falls back to line then order so the order is stable
    // between renders rather than whatever Firestore happened to return.
    .sort((a, b) => (
      b.date.localeCompare(a.date)
      || String(a.line).localeCompare(String(b.line))
      || String(a.orderNo).localeCompare(String(b.orderNo))
    ));
}

/**
 * Applies the screen's filters to the raw QC rows.
 *
 * All filters are optional; an empty one is ignored. `date` is a single-day
 * filter (the "selected date" the top-defect widget describes); `from`/`to`
 * are the inclusive date range the report filters on. A row with no date is
 * kept only when no date filter is set — a dateless row cannot be placed on a
 * calendar, so filtering by date must not silently include it.
 */
export function filterQualityRows(rows = [], filters = {}) {
  const {
    date = '', from = '', to = '', line = '', order = '',
  } = filters;
  const safe = Array.isArray(rows) ? rows : [];
  const lineNeedle = String(line).trim().toLowerCase();
  const orderNeedle = String(order).trim().toLowerCase();

  return safe.filter((row) => {
    const key = qcDateKey(row);
    if (date && key !== date) return false;
    if (from && key && key < from) return false;
    if (to && key && key > to) return false;
    if (from && !key) return false;
    if (to && !key) return false;
    if (lineNeedle && qcLine(row).toLowerCase() !== lineNeedle) return false;
    if (orderNeedle && qcOrder(row).toLowerCase() !== orderNeedle) return false;
    return true;
  });
}

/** Distinct, sorted values of one field across the raw rows — for a dropdown. */
export function distinctQualityValues(rows = [], field) {
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const value = String(row[field] ?? '').trim();
    if (value) seen.add(value);
  });
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export { round1 };

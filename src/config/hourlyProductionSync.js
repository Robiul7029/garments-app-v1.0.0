/**
 * ROBIUL GARMENTS ERP — hourly production → the ERP `hourlyProduction` collection.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app has two storage backends, and they never met:
 *
 *   LOCAL  `hourly-timesheet-rows`   localStorage — what the Daily sheet, the
 *                                    Monthly matrix and the Overall Summary read
 *   ERP    `hourlyProduction`        Firestore   — what the ERP Management
 *                                    Dashboard and Operator Performance read
 *
 * The unified entry form wrote only the LOCAL store, so an entry made on the floor
 * was invisible on the ERP dashboard. This module is the bridge: it turns one local
 * row into the ERP rows that represent the same fact.
 *
 * ONE LOCAL ROW → MANY ERP ROWS
 * -----------------------------
 * The two shapes are genuinely different, not merely renamed:
 *
 *   local   { date, employee, process, hours: { '08:00': 50, '09:00': 55 } }
 *   ERP     { date, lineId, hourSlot: '08:00', target, actual }   ← one per slot
 *
 * The ERP collection is keyed on ONE HOUR SLOT per document (`hourSlot` is a
 * required field and `actual` is that slot's figure), so a local row covering
 * several slots becomes several ERP rows. Writing one row per slot is what lets the
 * ERP dashboard sum, group and chart by hour without parsing a map.
 *
 * A DAY-MODE row has no clock slots — it is one figure under the DAY sentinel — so
 * it becomes ONE ERP row on a synthetic slot that still sums correctly.
 *
 * IDEMPOTENCY
 * -----------
 * `syncId` is declared on the ERP schema but is NOT enforced as a unique key, so
 * this module must make the mirror idempotent itself. Every ERP row carries a
 * `syncId` built from the local row's id and its slot, which is stable across
 * re-saves: the same local row always maps to the same ERP rows. `erpRowIdFor`
 * exposes that key so a caller can update in place rather than append.
 *
 * Pure functions only — no React, no Firestore.
 */

import { toNumber } from '../utils/erpCalculations';

/** The sentinel the ERP side uses for a whole-day figure, mirroring the local DAY mode. */
export const ERP_DAY_SLOT = 'Full Day';

/** A `YYYY-MM-DD` key from anything a stored row may hold. */
export function syncDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  let d = null;
  if (value instanceof Date) d = value;
  else if (typeof value?.toDate === 'function') {
    try {
      d = value.toDate();
    } catch {
      return '';
    }
  } else d = new Date(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The line a row was logged against, tolerating the two spellings in use. */
export function syncLineOf(row = {}) {
  return String(row.line_no || row.line || row.lineNo || '').trim();
}

/**
 * The hour slots a local row covers, as a list of `[slot, qty]` pairs.
 *
 * A row in DAY mode has the sentinel as its only slot; an hourly row has its clock
 * slots. A slot with a zero (or missing) figure is dropped — the ERP row would
 * otherwise be a document stating "nothing happened this hour", which is noise the
 * dashboard would have to filter back out.
 */
export function slotsOf(row = {}) {
  const hours = row.hours || {};
  const entries = Object.entries(hours)
    .map(([slot, qty]) => [String(slot), toNumber(qty)])
    .filter(([, qty]) => qty > 0);

  if (entries.length > 0) return entries;

  // A DAY-mode row stores its figure under the sentinel; when the map is empty the
  // day's total is the fallback, so a whole-day entry is never silently dropped.
  const total = toNumber(row.dailyTotal);
  if (total > 0) return [[ERP_DAY_SLOT, total]];
  return [];
}

/**
 * The stable id for one mirrored ERP row.
 *
 * Built from the LOCAL row's id and its slot, so re-saving the same local row
 * always produces the same id. That is what makes the mirror idempotent without a
 * server-side unique index: an update writes to the id it already owns rather than
 * appending a duplicate.
 */
export function erpRowIdFor(localRowId, slot) {
  const safeSlot = String(slot).replace(/[^a-zA-Z0-9]/g, '-');
  return `hp-${localRowId}-${safeSlot}`;
}

/** The `syncId` written onto the ERP document, for traceability back to the local row. */
export function syncIdFor(localRowId, slot) {
  return `${localRowId}::${slot}`;
}

/**
 * The hourly target for one slot.
 *
 * Read from the local row's own `hourlyTarget` (what the entry form computed from
 * the process's SMV and the style's buffer), falling back to the day's target
 * divided across its slots. The ERP row's `target` is required and must be a real
 * number, so a row with neither gets 0 rather than `undefined`.
 */
export function targetForSlot(row = {}, slot, slotCount = 1) {
  const perHour = toNumber(row.hourlyTarget);
  if (perHour > 0) return perHour;
  const perDay = toNumber(row.dailyTarget);
  if (perDay > 0 && slotCount > 0) return Math.round((perDay / slotCount) * 100) / 100;
  return 0;
}

/**
 * Turns ONE local hourly row into the ERP `hourlyProduction` documents for it.
 *
 * @param {object} row        a `hourly-timesheet-rows` document
 * @param {object} ctx        {
 *   lineIdFor:  (lineName) => lineId | ''   — resolves the required `lineId`
 *   employeeIdFor: (name) => id | ''        — optional; the schema only refs it
 *   poIdFor / styleIdFor: (value) => id     — optional foreign keys
 * }
 * @returns {Array<{ id, values }>}  one entry per hour slot, ready for `erp.save`
 *
 * A row with no line cannot be mirrored: `lineId` is REQUIRED on the ERP schema,
 * so a write without it would be rejected. Such a row is returned as an empty list
 * rather than written and refused, and the caller reports it as skipped.
 */
export function localRowToErpRows(row = {}, ctx = {}) {
  const {
    lineIdFor = () => '',
    employeeIdFor = () => '',
    poIdFor = () => '',
    styleIdFor = () => '',
  } = ctx;

  if (!row || row.id === undefined || row.id === null) return [];

  const date = syncDateKey(row.date);
  if (!date) return [];

  const lineName = syncLineOf(row);
  const lineId = lineIdFor(lineName);
  // `lineId` is required by the schema. Without it the write would be refused, so
  // the row is skipped here and the caller can say how many were.
  if (!lineId) return [];

  const slots = slotsOf(row);
  if (slots.length === 0) return [];

  const employeeId = employeeIdFor(row.employee || '');
  const poId = poIdFor(row.order_no || '');
  const styleId = styleIdFor(row.style || '');

  return slots.map(([slot, qty]) => ({
    id: erpRowIdFor(row.id, slot),
    values: {
      // ---- The ERP schema's own fields ----
      lineId,
      date,
      hourSlot: slot,
      poId,
      styleId,
      target: targetForSlot(row, slot, slots.length),
      actual: qty,
      // The local form records the pieces and the rejects; it has no separate
      // rework or downtime box, so those are stated as zero rather than guessed.
      rework: toNumber(row.rework),
      reject: toNumber(row.reject) || toNumber(row.defect_qty),
      downtimeMin: toNumber(row.downtimeMin),
      employeeId,
      syncId: syncIdFor(row.id, slot),
      // ---- Additive keys, so the ERP screens can show the floor's own labels ----
      // The ERP dashboard groups by these when it has them, and falls back to the
      // resolved masters when it does not.
      order_no: String(row.order_no || '').trim(),
      style: String(row.style || '').trim(),
      process: String(row.process || '').trim(),
      line_no: lineName,
      employee: String(row.employee || '').trim(),
      // Which kind of entry produced this slot ('hourly' | 'daily' | 'line'), so a
      // report can tell a whole-day figure from a clock-hour one.
      entry_type: String(row.entry_type || 'hourly').trim(),
      workingHours: toNumber(row.workingHours),
      dailyTarget: toNumber(row.dailyTarget),
      localRowId: row.id,
    },
  }));
}

/**
 * Mirrors a whole collection of local rows, returning the ERP rows to write.
 *
 * Duplicate `id`s are collapsed: a multi-process local entry is SPLIT on write into
 * one row per process, so two local rows can share a date, line and slot. The ERP
 * collection is one document per slot, so they are summed rather than letting the
 * second silently overwrite the first.
 */
export function buildErpMirror(localRows = [], ctx = {}) {
  const byId = new Map();

  (Array.isArray(localRows) ? localRows : []).forEach((row) => {
    localRowToErpRows(row, ctx).forEach(({ id, values }) => {
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, { id, values: { ...values } });
        return;
      }
      // Sum the figures; the descriptive fields are identical for a shared slot.
      byId.set(id, {
        id,
        values: {
          ...existing.values,
          actual: existing.values.actual + values.actual,
          reject: existing.values.reject + values.reject,
          rework: existing.values.rework + values.rework,
        },
      });
    });
  });

  return [...byId.values()];
}

/**
 * The ERP row ids a set of local rows SHOULD own.
 *
 * Used to reconcile deletes: the ids present here are the ones that must exist, so
 * anything else in the mirrored range is an orphan and is removed. That is what
 * stops an edited or deleted hourly entry from leaving a stale ERP row behind,
 * which would keep inflating the ERP dashboard's figures.
 */
export function expectedErpIds(localRows = [], ctx = {}) {
  return new Set(buildErpMirror(localRows, ctx).map((r) => r.id));
}

/**
 * The ERP rows to delete, given what exists and what should exist.
 *
 * `existingErpRows` is the live `hourlyProduction` collection; `localRows` is the
 * local store. An ERP row is an orphan when it was written by this mirror (it
 * carries a `localRowId`) and its local row no longer produces it — either because
 * the local row was deleted, or because its hours changed and the slot went away.
 *
 * A row with NO `localRowId` was not written by this mirror (it may have come from
 * another screen), so it is left alone: the mirror only ever cleans up after itself.
 */
export function orphanErpIds(existingErpRows = [], localRows = [], ctx = {}) {
  const wanted = expectedErpIds(localRows, ctx);
  return (Array.isArray(existingErpRows) ? existingErpRows : [])
    .filter((row) => row && row.localRowId !== undefined && row.localRowId !== null)
    .filter((row) => !wanted.has(row.id))
    .map((row) => row.id);
}

/** The `hourlyProduction` rows for one day, for the reconcile's scope. */
export function mirrorRowsForDate(existingErpRows = [], date) {
  const day = syncDateKey(date);
  return (Array.isArray(existingErpRows) ? existingErpRows : [])
    .filter((row) => syncDateKey(row?.date) === day);
}

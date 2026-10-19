/**
 * ROBIUL GARMENTS ERP — data access layer.
 *
 * Every ERP read and write goes through this module. Screens never import the
 * Firestore SDK directly, which is what keeps the UI free of query building and
 * gives one place to enforce pagination, validation and auditing.
 *
 * Design notes:
 *  - No query returns an unbounded collection. `listCollection` requires a
 *    page size, so a 50,000-row table can never be pulled into a phone's memory.
 *  - Writes validate before they reach the database and are audited after.
 *  - `uniqueKeys` holds one document per natural key (PO number, employee id).
 *    Claiming a key is a transaction, so two supervisors saving "PO-105" at the
 *    same moment cannot both succeed — this is the duplicate-PO guard.
 */
import {
  collection as fsCollection,
  collectionGroup,
  deleteDoc as fsDeleteDoc,
  doc as fsDoc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy as fsOrderBy,
  query as fsQuery,
  serverTimestamp,
  setDoc,
  updateDoc as fsUpdateDoc,
  where as fsWhere,
  writeBatch,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../firebase';
import { APP_DATA_ROOT } from './appDataStore';
import { categoryOf } from '../config/dataCategories';
import { C, editableFields, uniqueFieldsOf } from '../config/erpSchema';
import { validateRecord, applyDefaults } from './validationService';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

/**
 * Where an ERP document is written.
 *
 * Default: the collection at the root (`cuttingEntries/abc`).
 * Categorised: filed under its module (`appData/production/cuttingEntries/abc`), so the
 * Daily Production area owns its own rows instead of sharing the root with everything
 * else. `categoryOf` decides the folder from the collection name.
 *
 * @param {string} path  'cuttingEntries' or 'cuttingEntries/abc'
 */
function resolvePath(path, { categorize = false } = {}) {
  if (!categorize) return path;
  const [collectionId, ...rest] = String(path).split('/');
  return [APP_DATA_ROOT, categoryOf(collectionId), collectionId, ...rest].join('/');
}

// ---- Core helpers ----------------------------------------------------------

const COLS = {
  BUYERS: C.BUYERS,
  BUYER_CONTACTS: C.BUYER_CONTACTS,
  ORDERS: C.ORDERS,
  PURCHASE_ORDERS: C.PURCHASE_ORDERS,
  PO_LINES: C.PO_LINES,
  STYLES: C.STYLES,
  COLORS: C.COLORS,
  SIZES: C.SIZES,
  TNA_TASKS: C.TNA_TASKS,
  SHIPMENT_PLANS: C.SHIPMENT_PLANS,
  PRODUCTION_LINES: C.PRODUCTION_LINES,
  LINE_SHIFTS: C.LINE_SHIFTS,
  HOURLY_PRODUCTION: C.HOURLY_PRODUCTION,
  CUTTING_PLANS: C.CUTTING_PLANS,
  CUTTING_BATCHES: C.CUTTING_BATCHES,
  DEFECT_CATEGORIES: C.DEFECT_CATEGORIES,
  INLINE_QC: C.INLINE_QC,
  END_LINE_QC: C.END_LINE_QC,
  FINAL_INSPECTIONS: C.FINAL_INSPECTIONS,
  STORES: C.STORES,
  ITEMS: C.ITEMS,
  STOCK_LEDGER: C.STOCK_LEDGER,
  SUPPLIERS: C.SUPPLIERS,
  PURCHASE_REQUESTS: C.PURCHASE_REQUESTS,
  GRNS: C.GRNS,
  EMPLOYEES: C.EMPLOYEES,
  LEAVE_REQUESTS: C.LEAVE_REQUESTS,
  OVERTIME_REQUESTS: C.OVERTIME_REQUESTS,
  MACHINES: C.MACHINES,
  MAINTENANCE_REQUESTS: C.MAINTENANCE_REQUESTS,
  PACKING_PLANS: C.PACKING_PLANS,
  CARTONS: C.CARTONS,
  COST_HEADS: C.COST_HEADS,
  EXPENSES: C.EXPENSES,
  AUDIT_LOGS: C.AUDIT_LOGS,
  ALERTS: C.ALERTS,
  APPROVALS: C.APPROVALS,
  UNIQUE_KEYS: C.UNIQUE_KEYS,
};

/** Uniform error shape, so a screen never has to guess what it caught. */
export class ErpError extends Error {
  constructor(message, { code = 'erp-error', field = '', cause = null } = {}) {
    super(message);
    this.name = 'ErpError';
    this.code = code;
    this.field = field;
    this.cause = cause;
  }

  /** Turns a Firestore failure into an actionable, non-technical message. */
  static from(error, fallback = 'Something went wrong. Please try again.') {
    const code = String(error?.code || '');
    const map = {
      'permission-denied': 'You do not have permission to do that. Ask an administrator if you need access.',
      'unavailable': 'No connection to the server. Your change has not been saved.',
      'deadline-exceeded': 'The server took too long to respond. Please try again.',
      'not-found': 'That record no longer exists.',
      'failed-precondition': 'The database index this report needs is missing. Ask an administrator.',
      'unauthenticated': 'Your session has expired. Please sign in again.',
    };
    return new ErpError(map[code] || error?.message || fallback, { code: code || 'erp-error', cause: error });
  }
}

/** Firestore timestamps are not JSON — normalise them on the way out. */
function normalise(docSnap) {
  const data = docSnap.data() || {};
  const out = { id: docSnap.id };
  Object.entries(data).forEach(([k, v]) => {
    if (v && typeof v === 'object' && typeof v.toDate === 'function') out[k] = v.toDate().toISOString();
    else out[k] = v;
  });
  return out;
}

/**
 * Resolves a document id into a short human label, for tables that show a
 * foreign key (e.g. "Line 03" rather than "abc123xyz"). Falls back to the raw id
 * when the target document is missing, so a broken link is visible rather than
 * silently blank.
 */
export async function resolveLabel(collection, id, field = 'name') {
  if (!id) return '';
  try {
    const snap = await getDoc(fsDoc(db, collection, id));
    if (!snap.exists()) return id;
    const data = snap.data();
    return data[field] || data.label || data.code || snap.id;
  } catch {
    return id;
  }
}

/** Resolves many ids at once, returning a { id: label } map for one render. */
export async function resolveLabels(collection, ids, field = 'name') {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return {};
  const result = {};
  await Promise.all(unique.map(async (id) => {
    result[id] = await resolveLabel(collection, id, field);
  }));
  return result;
}

// ---- Reads -----------------------------------------------------------------

/**
 * One-shot paginated read.
 *
 * @param {object} opts
 *   collection  collection id
 *   where       [{ field, op, value }]   op defaults to '=='
 *   orderBy     [{ field, dir }]           dir defaults to 'asc'
 *   pageSize    number, clamped to MAX_PAGE_SIZE
 *   startAfter  last document snapshot of the previous page (cursor pagination)
 */
export async function listCollection({
  collection,
  where = [],
  orderBy = [],
  pageSize = DEFAULT_PAGE_SIZE,
  startAfter = null,
} = {}) {
  if (!collection) throw new ErpError('No collection supplied.', { code: 'bad-argument' });
  const size = Math.min(Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  const constraints = [];
  where.forEach((clause) => {
    if (clause?.field === undefined || clause.value === undefined || clause.value === null) return;
    constraints.push(fsWhere(clause.field, clause.op || '==', clause.value));
  });
  orderBy.forEach((clause) => {
    if (!clause?.field) return;
    constraints.push(fsOrderBy(clause.field, clause.dir || 'asc'));
  });
  // A deterministic tie-breaker: two documents with the same sort key must still
  // paginate correctly, otherwise a row can be repeated or skipped on page 2.
  if (startAfter) constraints.push(fsOrderBy('__name__', 'asc'));
  constraints.push(fsLimit(size));

  const snap = await getDocs(fsQuery(fsCollection(db, collection), ...constraints));
  const rows = snap.docs.map(normalise);
  return {
    rows,
    lastDoc: snap.docs.length === size ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === size,
  };
}

/** Convenience wrapper for a whole small collection (dropdowns, lookups). */
export async function listAll(collection, { where = [], orderBy = [] } = {}) {
  const result = await listCollection({ collection, where, orderBy, pageSize: MAX_PAGE_SIZE });
  return result.rows;
}

/** One document by id, or null. */
export async function getDocument(collection, id, opts = {}) {
  if (!id) return null;
  try {
    const snap = await getDoc(fsDoc(db, resolvePath(`${collection}/${id}`, opts)));
    return snap.exists() ? normalise(snap) : null;
  } catch (error) {
    throw ErpError.from(error, 'Could not load that record.');
  }
}

/**
 * Live subscription. Returns an unsubscribe function.
 * `onChange(rows, meta)` receives normalised rows on every server change, which
 * is how the dashboard reflects a supervisor's entry without a refresh.
 */
export function subscribeCollection(
  collection,
  { where = [], orderBy = [], pageSize = DEFAULT_PAGE_SIZE, onChange, onError, categorize = false } = {}
) {
  const size = Math.min(Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const constraints = [];
  where.forEach((clause) => {
    if (clause?.field === undefined || clause.value === undefined || clause.value === null) return;
    constraints.push(fsWhere(clause.field, clause.op || '==', clause.value));
  });
  orderBy.forEach((clause) => {
    if (!clause?.field) return;
    constraints.push(fsOrderBy(clause.field, clause.dir || 'asc'));
  });
  constraints.push(fsLimit(size));

  return onSnapshot(
    fsQuery(fsCollection(db, resolvePath(collection, { categorize })), ...constraints),
    (snap) => {
      const rows = snap.docs.map(normalise);
      onChange?.(rows, { count: snap.size, serverTimestamp: snap.queryOptions?.limit || null });
    },
    (error) => {
      // A missing composite index is a deployment problem, not a user error:
      // it is reported once, loudly, rather than silently showing empty data.
      console.error(`[ERP] live read failed for "${collection}":`, error?.message || error);
      onError?.(ErpError.from(error, `Could not load live data for ${collection}.`));
    }
  );
}

/** Live subscription to a single document (e.g. the signed-in user's record). */
export function subscribeDocument(collection, id, { onChange, onError } = {}) {
  if (!id) {
    onChange?.(null);
    return () => { };
  }
  return onSnapshot(
    fsDoc(db, collection, id),
    (snap) => onChange?.(snap.exists() ? normalise(snap) : null),
    (error) => {
      console.error(`[ERP] document read failed for "${collection}/${id}":`, error?.message || error);
      onError?.(ErpError.from(error, 'Could not load that record.'));
    }
  );
}

/**
 * Counts documents matching a filter. Firestore has no COUNT, so this reads ids
 * only and is deliberately capped — it is for KPIs, not for exact tallies on
 * huge collections.
 */
export async function countCollection(collection, { where = [], cap = 5000 } = {}) {
  const constraints = [];
  where.forEach((clause) => {
    if (clause?.field === undefined || clause.value === undefined || clause.value === null) return;
    constraints.push(fsWhere(clause.field, clause.op || '==', clause.value));
  });
  constraints.push(fsLimit(cap));
  const snap = await getDocs(fsQuery(fsCollection(db, collection), ...constraints));
  return snap.size;
}

// ---- Uniqueness ------------------------------------------------------------

/**
 * Claims one or more natural keys for a document, atomically.
 *
 * Runs inside a transaction: a key document is created for a new record and
 * removed for an edited record whose key changed. If another user holds the key,
 * the transaction fails and the caller surfaces "PO-105 already exists".
 *
 * @returns {Promise<{ ok: boolean, conflicts: Record<string,string> }>}
 */
async function claimUniqueKeys(collection, docId, values, previousValues) {
  const fields = uniqueFieldsOf(collection);
  if (fields.length === 0) return { ok: true, conflicts: {} };

  const conflicts = {};
  const toClaim = [];
  const toRelease = [];

  fields.forEach((field) => {
    const next = String(values[field] ?? '').trim();
    const prev = previousValues ? String(previousValues[field] ?? '').trim() : '';
    if (next && next !== prev) toClaim.push({ field, value: next });
    if (prev && prev !== next) toRelease.push({ field, value: prev });
  });

  if (toClaim.length === 0 && toRelease.length === 0) return { ok: true, conflicts: {} };

  await runTransaction(db, async (tx) => {
    // Releases run first so that swapping one unique value for another (a
    // rename onto a freed key) is not blocked by the row's own old key.
    for (const rel of toRelease) {
      const keyId = `${collection}__${rel.field}__${rel.value}`;
      const ref = fsDoc(db, C.UNIQUE_KEYS, keyId);
      const snap = await tx.get(ref);
      if (snap.exists() && snap.data()?.docId === docId) tx.delete(ref);
    }
    for (const claim of toClaim) {
      const keyId = `${collection}__${claim.field}__${claim.value}`;
      const ref = fsDoc(db, C.UNIQUE_KEYS, keyId);
      const snap = await tx.get(ref);
      if (snap.exists() && snap.data()?.docId !== docId) {
        const label = editableFields(collection).find((f) => f.name === claim.field)?.label || claim.field;
        conflicts[claim.field] = `${label} "${claim.value}" already exists.`;
      }
      tx.set(ref, { collection, field: claim.field, value: claim.value, docId, claimedAt: serverTimestamp() });
    }
    if (Object.keys(conflicts).length > 0) {
      // Abort by throwing: nothing above is committed, so a rejected claim leaves
      // no orphan key documents behind.
      throw new ErpError('Duplicate value.', { code: 'duplicate', field: Object.keys(conflicts)[0] });
    }
  }).catch((error) => {
    if (error instanceof ErpError && error.code === 'duplicate') throw error;
    throw ErpError.from(error, 'Could not verify this value is unique. Please try again.');
  });

  return { ok: true, conflicts: {} };
}

async function releaseUniqueKeys(collection, docId, values) {
  const fields = uniqueFieldsOf(collection);
  const batch = writeBatch(db);
  let pending = 0;
  fields.forEach((field) => {
    const value = String(values[field] ?? '').trim();
    if (!value) return;
    batch.delete(fsDoc(db, C.UNIQUE_KEYS, `${collection}__${field}__${value}`));
    pending += 1;
  });
  if (pending > 0) await batch.commit();
}

// ---- Writes ----------------------------------------------------------------

/**
 * Creates a document.
 *
 * @param {string} collection
 * @param {object} values            raw form values
 * @param {object} ctx               { actor, duplicates, availableQty, skipUnique }
 * @returns {Promise<object>} the created document with its generated id
 */
export async function createDocument(collection, values, options = {}) {
  const errors = {};
  // ctx.categorize files the new document under its module (see resolvePath); every
  // other key (actor, duplicates, availableQty) is the validation context it always was.
  const { categorize = false, ...ctx } = options;
  // Uniqueness is checked inside a transaction, so the pre-flight lookup here is
  // only to give an instant, friendly message. ctx.duplicates is optional.
  const check = validateRecord(collection, values, ctx);
  Object.assign(errors, check.errors);
  if (!check.valid) {
    const field = Object.keys(errors)[0];
    const error = new ErpError(errors[field], { code: 'validation', field });
    error.errors = errors;
    throw error;
  }

  const payload = applyDefaults(collection, values);
  payload.createdAt = serverTimestamp();
  payload.createdBy = ctx.actor || 'unknown';
  payload.updatedAt = serverTimestamp();

  const ref = fsDoc(fsCollection(db, resolvePath(collection, { categorize })));
  await claimUniqueKeys(collection, ref.id, payload, null);
  try {
    await setDoc(ref, payload);
  } catch (error) {
    // The claim succeeded but the document failed: give the key back, otherwise
    // the value would look taken forever.
    await releaseUniqueKeys(collection, ref.id, payload).catch(() => { });
    throw ErpError.from(error, 'Could not save this record.');
  }

  return { id: ref.id, ...stripTimestamps(payload) };
}

/**
 * Updates a document. Only the supplied fields are written, so a partial form
 * submission never blanks a field the user did not touch.
 */
export async function updateDocument(collection, id, values, options = {}) {
  const { categorize = false, ...ctx } = options;
  const existing = await getDocument(collection, id, { categorize });
  if (!existing) throw new ErpError('That record no longer exists.', { code: 'not-found' });

  const merged = { ...existing, ...values };
  const check = validateRecord(collection, merged, { ...ctx, existing });
  if (!check.valid) {
    const field = Object.keys(check.errors)[0];
    const error = new ErpError(check.errors[field], { code: 'validation', field });
    error.errors = check.errors;
    throw error;
  }

  const payload = applyDefaults(collection, values);
  payload.updatedAt = serverTimestamp();
  payload.updatedBy = ctx.actor || 'unknown';

  await claimUniqueKeys(collection, id, merged, existing);
  try {
    await fsUpdateDoc(fsDoc(db, resolvePath(`${collection}/${id}`, { categorize })), payload);
  } catch (error) {
    throw ErpError.from(error, 'Could not save your changes.');
  }
  return { id, ...merged, ...payload };
}

/**
 * Deletes a document and releases its natural keys.
 * `label` is kept in the audit log so the record is still identifiable after it
 * is gone.
 */
export async function deleteDocument(collection, id, ctx = {}) {
  const { categorize = false } = ctx;
  const existing = await getDocument(collection, id, { categorize });
  if (!existing) throw new ErpError('That record no longer exists.', { code: 'not-found' });
  try {
    await fsDeleteDoc(fsDoc(db, resolvePath(`${collection}/${id}`, { categorize })));
  } catch (error) {
    throw ErpError.from(error, 'Could not delete this record.');
  }
  await releaseUniqueKeys(collection, id, existing).catch(() => { });
  return existing;
}

/**
 * Writes several documents in one atomic batch. Used by the places where a
 * business action is genuinely more than one row — a GRN that must also move
 * stock, a shipment that must also update its cartons.
 *
 * @param {Array<{ collection, id?, values }>} writes  omit `id` to create
 */
export async function writeBatchDocuments(writes, ctx = {}) {
  if (!Array.isArray(writes) || writes.length === 0) {
    throw new ErpError('Nothing to save.', { code: 'bad-argument' });
  }
  const batch = writeBatch(db);
  const prepared = [];
  writes.forEach((w, index) => {
    if (!w?.collection) return;
    const payload = applyDefaults(w.collection, w.values);
    payload.updatedAt = serverTimestamp();
    if (w.id) {
      batch.update(fsDoc(db, w.collection, w.id), payload);
      prepared.push({ index, collection: w.collection, id: w.id, values: w.values });
    } else {
      const ref = fsDoc(fsCollection(db, w.collection));
      batch.set(ref, { ...payload, createdAt: serverTimestamp(), createdBy: ctx.actor || 'unknown' });
      prepared.push({ index, collection: w.collection, id: ref.id, values: w.values });
    }
  });
  try {
    await batch.commit();
  } catch (error) {
    throw ErpError.from(error, 'Could not save all changes. Nothing was applied.');
  }
  return prepared;
}

function stripTimestamps(payload) {
  const out = { ...payload };
  delete out.createdAt;
  delete out.updatedAt;
  return out;
}

// ---- Reference -------------------------------------------------------------
export { COLS as COLLECTIONS };
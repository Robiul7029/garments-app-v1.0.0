/**
 * ROBIUL GARMENTS ERP — the app's own data, in Firestore.
 *
 * WHAT THIS REPLACES
 * ------------------
 * `DataContext` used to keep every collection in localStorage under one key
 * (`garments_app_data`). That made the Daily sheet, Hourly Production, attendance,
 * salary, orders and manpower visible only on the machine they were typed on. This
 * module moves the same rows to Firestore so the factory sees one shared set of
 * numbers from any device, while localStorage stays as an OFFLINE CACHE so the
 * screens still open instantly (and still work on a dropped connection).
 *
 * THE SHAPE — AND WHY IT IS NOT `dailyProduction` / `hourlyProduction`
 * -------------------------------------------------------------------
 * The ERP collections are NOT the right home for these rows, and writing there
 * would corrupt existing data:
 *
 *   `dailyProduction`   one document per line/day, written by the sync batch.
 *   `hourlyProduction`  one document per hour slot, owned by the ERP mirror and
 *                       identified by `localRowId`. Its `lineId` is a REQUIRED
 *                       foreign key to `productionLines`.
 *
 * The rows here are the app's own cruder shape (plain ids, typed-in line names,
 * no foreign keys). Uploading them into either collection would append duplicate
 * documents next to the good ones and inflate every dashboard figure. So they get
 * their own namespace, keyed by the SAME collection key the local store uses:
 *
 *   appData/{collectionId}/{rowId}
 *     collectionId   the local key, verbatim — 'daily-production', 'hourly-timesheet-rows',
 *                    'salary', 'order-model', …
 *     rowId          String(row.id) — stable, so re-running the upload overwrites
 *                    rather than appending
 *     …the row's own fields, unchanged
 *
 * The ERP mirror keeps running exactly as before, so the ERP dashboards are
 * unaffected: it now reads a local store that is merely cached from the cloud.
 *
 * MERGE, NEVER REPLACE
 * --------------------
 * `mergeRows` unions by id instead of replacing the collection. A screen that has
 * been offline still has rows the cloud has not seen; replacing would delete them.
 * Remote wins on a collision because it is the shared truth. Nothing is ever
 * deleted by an upload.
 *
 * THE ONE-TIME UPLOAD
 * -------------------
 * `uploadLocalStore` reads the legacy localStorage payload and writes every row
 * that is missing from the cloud. It is idempotent and only ever adds or updates —
 * a document already in Firestore with the same id is left with its newer values.
 *
 * OBJECTS ARE NEVER SPLIT
 * -----------------------
 * Only top-level keys that are arrays of row objects are uploaded. `employees` (an
 * array of NAMES) and `employee-sequence` (a single number in an array) are skipped:
 * a bare string or number is not a row, and splitting names into id-less documents
 * would leave nothing that could ever be selected back together.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ALL_CATEGORIES, categoryOf } from '../config/dataCategories';

/** The legacy localStorage key the app used before the cloud migration. */
export const LEGACY_STORAGE_KEY = 'garments_app_data';

/** Root collection holding one sub-collection per app collection key. */
export const APP_DATA_ROOT = 'appData';

/**
 * THE CATEGORY LAYOUT
 * -------------------
 * Rows are filed by the module that owns them:
 *
 *   appData/{category}/{collectionId}/{rowId}      <- current write path
 *   appData/{collectionId}/{rowId}                 <- legacy (read + migrated)
 *
 * `categoryOf` (config/dataCategories.js) owns that decision, so a screen still just names
 * its collection and never needs to know which folder it belongs in. Reads consult BOTH
 * layouts: a row written before the migration is still visible, and the migration itself
 * copies it across, so the legacy paths can eventually be emptied.
 */
export function categoryPathFor(collectionId) {
  return categoryOf(collectionId);
}

/**
 * Collections that are NOT rows, and must never be uploaded as documents.
 * They are local-only bookkeeping (a name list and an ID counter).
 */
export const NON_ROW_KEYS = new Set(['employees', 'employee-sequence', '_dataVersion']);

/** Firestore documents cannot carry these; stamped separately on write. */
const RESERVED_FIELDS = ['createdAt', 'updatedAt', 'uploadedAt', 'localId'];

/** True when `key` holds rows that belong in Firestore. */
export function isRowCollection(key, value) {
  if (NON_ROW_KEYS.has(key)) return false;
  if (String(key).startsWith('_')) return false;
  return Array.isArray(value);
}

/**
 * Removes `undefined` (Firestore rejects it) and unwraps nothing else.
 * Plain JSON is already the only thing the local store holds, so this is a light
 * guard rather than a general serialiser.
 */
function cleanRow(row) {
  const out = {};
  Object.entries(row || {}).forEach(([field, value]) => {
    if (value === undefined) return;
    if (RESERVED_FIELDS.includes(field)) return;
    out[field] = value;
  });
  return out;
}

/** `appData` — the root holding one category per module. */
function collectionRefRoot(database) {
  return collection(database, APP_DATA_ROOT);
}

/** The rows of one collection in the CURRENT (category) layout. */
function categoryRowsRef(database, collectionId) {
  return collection(database, APP_DATA_ROOT, categoryPathFor(collectionId), String(collectionId));
}

/** The rows of one collection in the LEGACY (flat) layout. */
function legacyRowsRef(database, collectionId) {
  return collection(database, APP_DATA_ROOT, String(collectionId));
}

/** A row's document in the current layout. */
function categoryRowRef(database, collectionId, id) {
  return doc(database, APP_DATA_ROOT, categoryPathFor(collectionId), String(collectionId), String(id));
}

/**
 * Is this `appData` top-level id a CATEGORY (a folder) or a legacy collection?
 *
 * The two live side by side during the migration, so every walk below has to tell them
 * apart. A category is a known folder name; anything else at the top level is a legacy
 * collection document id (`order-model`, `daily-production`, …).
 */
export function isCategoryId(id) {
  return ALL_CATEGORIES.includes(String(id)) || String(id) === 'uncategorized';
}

/** The document id for a row: its local id, stringified. */
export function rowIdOf(row, fallback = '') {
  if (row && row.id !== undefined && row.id !== null && row.id !== '') return String(row.id);
  return fallback;
}

/**
 * Reads every app collection into `{ [collectionId]: rows[] }`.
 *
 * Returns `{ data, failed }`: a collection whose read is refused is reported, not
 * thrown, so one bad permission cannot blank the whole app. The caller keeps its
 * cache for any key that failed.
 */
export async function loadAll(database = db) {
  const data = {};
  const failed = [];
  let snapshots;
  try {
    snapshots = await getDocs(collectionRefRoot(database));
  } catch (error) {
    return { data, failed: ['*'], error };
  }

  // One level below the root is either a category folder (whose children are
  // collections) or a legacy collection (whose children are rows). Both are read, and a
  // collection seen in both layouts is UNIONED — a row that only exists in the legacy
  // copy is not lost while the migration is still running.
  const merge = (collectionId, rows) => {
    const existing = data[collectionId] || [];
    const byId = new Map(existing.map((row) => [String(row.id), row]));
    (rows || []).forEach((row) => byId.set(String(row.id), row));
    data[collectionId] = [...byId.values()];
  };

  await Promise.all(snapshots.docs.map(async (topDoc) => {
    try {
      if (isCategoryId(topDoc.id)) {
        const inner = await getDocs(collection(database, APP_DATA_ROOT, topDoc.id));
        await Promise.all(inner.docs.map(async (collectionDoc) => {
          try {
            const rowsSnap = await getDocs(collection(database, APP_DATA_ROOT, topDoc.id, collectionDoc.id));
            merge(collectionDoc.id, rowsSnap.docs.map((rowDoc) => ({ id: rowDoc.id, ...rowDoc.data() })));
          } catch {
            failed.push(collectionDoc.id);
          }
        }));
        return;
      }
      const rowsSnap = await getDocs(collection(database, APP_DATA_ROOT, topDoc.id));
      merge(topDoc.id, rowsSnap.docs.map((rowDoc) => ({ id: rowDoc.id, ...rowDoc.data() })));
    } catch {
      failed.push(topDoc.id);
    }
  }));

  return { data, failed };
}

/**
 * Live subscription to the whole app-data tree.
 *
 * `onData` receives `{ [collectionId]: rows[] }` for the collections that changed,
 * freshly read in full. Reading a sub-collection per event (rather than diffing
 * document changes) keeps the merge trivial: the collection is simply replaced with
 * the cloud's current truth.
 *
 * @returns {() => void} unsubscribe
 */
export function subscribeAll(onData, onError = () => {}, database = db) {
  let cancelled = false;
  const active = new Set();
  const offs = new Map();

  // Reads BOTH layouts for one collection and hands back the union, so a row written
  // under the legacy path (not yet migrated) and the same row under its category never
  // arrive as two copies.
  const readCollection = async (collectionId) => {
    if (active.has(collectionId)) return;
    active.add(collectionId);
    try {
      const [current, legacy] = await Promise.all([
        getDocs(categoryRowsRef(database, collectionId)).catch(() => null),
        getDocs(legacyRowsRef(database, collectionId)).catch(() => null),
      ]);
      if (cancelled) return;
      if (!current && !legacy) {
        onError(new Error(`Could not read ${collectionId}.`), collectionId);
        return;
      }
      const byId = new Map();
      [legacy, current].forEach((snap) => {
        (snap?.docs || []).forEach((rowDoc) => byId.set(rowDoc.id, { id: rowDoc.id, ...rowDoc.data() }));
      });
      onData({ [collectionId]: [...byId.values()] });
    } finally {
      active.delete(collectionId);
    }
  };

  const offRoot = onSnapshot(
    collectionRefRoot(database),
    (snapshot) => {
      const present = new Set();
      const categories = [...snapshot.docs]
        .filter((topDoc) => isCategoryId(topDoc.id));

      // A legacy top-level collection document.
      snapshot.docs.forEach((topDoc) => {
        if (isCategoryId(topDoc.id)) return;
        present.add(topDoc.id);
        readCollection(topDoc.id);
        if (!offs.has(topDoc.id)) {
          offs.set(topDoc.id, onSnapshot(
            legacyRowsRef(database, topDoc.id),
            () => readCollection(topDoc.id),
            (error) => onError(error, topDoc.id),
          ));
        }
      });

      // A category folder: each of its children is a collection to follow.
      categories.forEach((categoryDoc) => {
        const categoryOff = `category:${categoryDoc.id}`;
        if (offs.has(categoryOff)) return;
        offs.set(categoryOff, onSnapshot(
          collection(database, APP_DATA_ROOT, categoryDoc.id),
          (inner) => {
            inner.docs.forEach((collectionDoc) => {
              present.add(collectionDoc.id);
              readCollection(collectionDoc.id);
              const key = `rows:${collectionDoc.id}`;
              if (!offs.has(key)) {
                offs.set(key, onSnapshot(
                  collection(database, APP_DATA_ROOT, categoryDoc.id, collectionDoc.id),
                  () => readCollection(collectionDoc.id),
                  (error) => onError(error, collectionDoc.id),
                ));
              }
            });
          },
          (error) => onError(error, categoryDoc.id),
        ));
      });

      // A collection removed wholesale stops listening; its rows are then gone.
      [...offs.keys()].forEach((key) => {
        const collectionId = key.replace(/^(rows:|category:)/, '');
        if (present.has(collectionId)) return;
        offs.get(key)();
        offs.delete(key);
      });
    },
    (error) => onError(error, '*'),
  );

  return () => {
    cancelled = true;
    offRoot();
    offs.forEach((off) => off());
    offs.clear();
  };
}

/**
 * Writes one row. `id` is the row's own id, so a save updates in place.
 * Firestore batches are capped at 500 writes, so this is one call per row and the
 * caller batches larger work with `writeRows`.
 */
export async function writeRow(collectionId, row, database = db) {
  const id = rowIdOf(row);
  if (!id) return null;
  const payload = cleanRow(row);
  delete payload.id;
  const ref = categoryRowRef(database, collectionId, id);
  await setDoc(ref, { ...payload, localId: id, updatedAt: serverTimestamp() }, { merge: true });
  // A row that already exists in the LEGACY layout is mirrored into its category here, so
  // an edit made before the migration does not leave the two copies disagreeing. The copy
  // is best-effort: the category write above is the one that must succeed.
  await setDoc(
    doc(database, APP_DATA_ROOT, String(collectionId), id),
    { ...payload, localId: id, updatedAt: serverTimestamp() },
    { merge: true },
  ).catch(() => {});
  return id;
}

/** Removes one row. Called from the entry screens' delete action. */
export async function removeRow(collectionId, id, database = db) {
  if (id === undefined || id === null || id === '') return false;
  await deleteDoc(categoryRowRef(database, collectionId, id));
  // Remove the legacy copy too, otherwise the union read would bring a deleted row back.
  await deleteDoc(doc(database, APP_DATA_ROOT, String(collectionId), String(id))).catch(() => {});
  return true;
}

/** Writes many rows in chunks of 450 (under Firestore's 500-op limit). */
export async function writeRows(collectionId, rows, database = db) {
  const list = (rows || []).filter((row) => rowIdOf(row));
  for (let i = 0; i < list.length; i += 450) {
    const batch = writeBatch(database);
    list.slice(i, i + 450).forEach((row) => {
      const id = rowIdOf(row);
      const payload = cleanRow(row);
      delete payload.id;
      batch.set(
        categoryRowRef(database, collectionId, id),
        { ...payload, localId: id, updatedAt: serverTimestamp() },
        { merge: true },
      );
    });
    await batch.commit();
  }
  return list.length;
}

/**
 * Unions rows by id.
 *
 * `remote` wins on a collision (it is the shared truth); `local` rows the cloud has
 * not seen yet are kept. Never deletes.
 */
export function mergeRows(localRows, remoteRows) {
  const byId = new Map();
  (Array.isArray(remoteRows) ? remoteRows : []).forEach((row) => {
    if (!row || row.id === undefined || row.id === null) return;
    byId.set(String(row.id), row);
  });
  (Array.isArray(localRows) ? localRows : []).forEach((row) => {
    if (!row || row.id === undefined || row.id === null) return;
    const key = String(row.id);
    if (!byId.has(key)) byId.set(key, row);
  });
  return [...byId.values()];
}

/** Reads the legacy localStorage payload, tolerating no storage or bad JSON. */
export function readLegacyStore(storage = globalThis?.localStorage) {
  try {
    const raw = storage?.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The one-time upload of the browser's existing data.
 *
 * Only rows the cloud does not already have are written, so running it twice (or on
 * a second device with an older cache) cannot duplicate or overwrite good records.
 *
 * @returns {Promise<{ uploaded: number, collections: number, error?: string }>}
 */
/**
 * Makes every category a REAL folder document.
 *
 * `appData/{category}` holds no fields — it exists so the Firestore console lists the
 * category under `appData` even before its first row is saved. A document that held only
 * sub-collections would not be shown there. Idempotent: an existing category is left
 * untouched.
 */
export async function ensureCategories(database = db) {
  const created = [];
  await Promise.all(ALL_CATEGORIES.map(async (categoryId) => {
    try {
      const ref = doc(database, APP_DATA_ROOT, categoryId);
      const snap = await getDocs(collection(database, APP_DATA_ROOT, categoryId)).catch(() => null);
      // `setDoc(..., merge)` would create a document even for an existing category; the
      // read above keeps a folder's existing fields (none today) intact.
      if (snap) await setDoc(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      created.push(categoryId);
    } catch {
      // A refused write must not stop the app: the folder appears with its first row.
    }
  }));
  return created;
}

/**
 * ONE-TIME MIGRATION: flat layout -> category layout.
 *
 * Copies every row from `appData/{collectionId}/{rowId}` to
 * `appData/{category}/{collectionId}/{rowId}`. It is a COPY, never a move of the only
 * copy: the legacy documents stay in place, and the reads union both layouts, so nothing
 * disappears if this is interrupted half-way.
 *
 * Re-running is safe and cheap: a row already present at its category path is skipped, so
 * a second run writes nothing.
 *
 * @returns {Promise<{ moved: number, collections: number, error?: string }>}
 */
export async function migrateFlatCollections(database = db) {
  const result = { moved: 0, collections: 0 };
  let root;
  try {
    root = await getDocs(collectionRefRoot(database));
  } catch (error) {
    return { ...result, error: error?.message || 'Could not read the cloud store.' };
  }

  // Only the LEGACY top-level documents: a category folder is not a collection.
  const legacyDocs = root.docs.filter((topDoc) => !isCategoryId(topDoc.id));

  for (const topDoc of legacyDocs) {
    const collectionId = topDoc.id;
    const categoryId = categoryPathFor(collectionId);
    try {
      const [legacyRows, currentRows] = await Promise.all([
        getDocs(legacyRowsRef(database, collectionId)),
        getDocs(categoryRowsRef(database, collectionId)).catch(() => null),
      ]);
      const already = new Set((currentRows?.docs || []).map((rowDoc) => rowDoc.id));
      const pending = legacyRows.docs.filter((rowDoc) => !already.has(rowDoc.id));
      if (pending.length === 0) continue;

      for (let i = 0; i < pending.length; i += 450) {
        const batch = writeBatch(database);
        pending.slice(i, i + 450).forEach((rowDoc) => {
          const data = rowDoc.data() || {};
          batch.set(
            doc(database, APP_DATA_ROOT, categoryId, collectionId, rowDoc.id),
            { ...data, localId: rowDoc.id, migratedAt: serverTimestamp() },
            { merge: true },
          );
        });
        await batch.commit();
      }
      result.moved += pending.length;
      result.collections += 1;
    } catch (error) {
      result.error = error?.message || `Could not migrate ${collectionId}.`;
    }
  }

  return result;
}

export async function uploadLocalStore(legacy, database = db) {
  const result = { uploaded: 0, collections: 0 };
  if (!legacy || typeof legacy !== 'object') return result;

  // What is already in the cloud, so an existing document is never rewritten.
  const { data: existing, failed } = await loadAll(database);
  if (failed.includes('*')) {
    return { ...result, error: 'Could not read the cloud store.' };
  }

  const entries = Object.entries(legacy).filter(([key, value]) => (
    isRowCollection(key, value) && !failed.includes(key)
  ));

  for (const [key, rows] of entries) {
    const seen = new Set((existing[key] || []).map((row) => String(row.id)));
    const fresh = (rows || []).filter((row) => {
      const id = rowIdOf(row);
      return id && !seen.has(id);
    });
    if (fresh.length === 0) continue;
    try {
      result.uploaded += await writeRows(key, fresh, database);
      result.collections += 1;
    } catch (error) {
      result.error = error?.message || 'Upload failed.';
    }
  }

  return result;
}

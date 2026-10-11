/**
 * ROBIUL GARMENTS ERP — audit trail.
 *
 * Every meaningful action is written to `auditLogs` with the actor, the action,
 * the record it touched and the before/after values. The trail is append-only:
 * nothing in this file can update or delete an entry, and firestore.rules
 * denies those verbs on the collection outright.
 *
 * Auditing must never break the action it is recording, so `record()` resolves
 * to `false` rather than throwing when the write fails.
 */
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { C, SCHEMA } from '../config/erpSchema';

export const AUDIT_ACTION = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  REJECT: 'reject',
  LOGIN: 'login',
  LOGOUT: 'logout',
  VIEW: 'view',
  EXPORT: 'export',
  SYNC: 'sync',
};

/**
 * Builds a compact, human-readable description of what changed.
 * Only the fields that actually differ are named — "PO 105 qty 420 → 470", not a
 * dump of the whole document.
 */
export function diffSummary(before = {}, after = {}) {
  const changed = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  keys.forEach((key) => {
    if (key === 'id' || key.endsWith('At') || key.endsWith('By')) return;
    const a = before?.[key];
    const b = after?.[key];
    if (b === undefined) return; // a field removed by the update, not a change to report
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) return;
    changed.push(`${key}: ${formatValue(a)} → ${formatValue(b)}`);
  });
  return changed.slice(0, 12).join(', ');
}

function formatValue(value) {
  if (value === undefined || value === null || value === '') return '(empty)';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Writes one audit entry.
 *
 * @param {object} entry
 *   action     one of AUDIT_ACTION
 *   collection collection id (use C.* for ERP documents)
 *   recordId   the document id, or '' for a non-document action such as login
 *   label      human name of the record, so the log still reads well if the
 *              record is later deleted
 *   before     the document before the change
 *   after      the document after the change
 *   actor      display name of the user
 *   actorUid   firebase uid
 *   module     the ERP module key, for filtering
 *   meta       anything else worth keeping (line number, reason, page)
 * @returns {Promise<boolean>} true when the entry was stored
 */
export async function record(entry = {}) {
  try {
    await addDoc(collection(db, C.AUDIT_LOGS), {
      action: entry.action || AUDIT_ACTION.UPDATE,
      collection: entry.collection || '',
      recordId: entry.recordId ? String(entry.recordId) : '',
      label: entry.label || '',
      summary: entry.summary || diffSummary(entry.before, entry.after),
      before: sanitize(entry.before),
      after: sanitize(entry.after),
      actor: entry.actor || 'Unknown user',
      actorUid: entry.actorUid || '',
      module: entry.module || '',
      meta: sanitize(entry.meta || {}),
      // clientTime is a real Date so the log is readable offline / in exports;
      // createdAt is the server's own clock, used for ordering.
      clientTime: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error('[Audit] could not write entry:', error?.message || error);
    return false;
  }
}

/**
 * Strips values that must never reach a log: passwords, tokens, secrets. Audit
 * entries are readable by management, so anything sensitive is dropped on the
 * way in rather than filtered on the way out.
 */
const SECRET_KEYS = /password|passwd|token|secret|apikey|api_key|authorization|credential|pin|hash|salt/i;

function sanitize(source) {
  if (!source || typeof source !== 'object') return {};
  const out = {};
  Object.entries(source).forEach(([key, value]) => {
    if (SECRET_KEYS.test(key)) return;
    if (value === undefined) return;
    if (value !== null && typeof value === 'object') {
      if (typeof value.toDate === 'function') {
        out[key] = value.toDate().toISOString();
      } else {
        out[key] = sanitize(value);
      }
      return;
    }
    out[key] = value;
  });
  return out;
}

/** Human label for a collection, used in the log's "record" column. */
export function collectionLabel(collectionId) {
  return SCHEMA[collectionId]?.label || collectionId || 'System';
}

/**
 * Convenience wrappers so call sites read as business sentences.
 *
 * The parameter is named `doc_` rather than `record` because a parameter called
 * `record` would shadow the exported `record()` function this object calls.
 */
export const audit = {
  created: (ctx, collection, doc_) => record({
    ...ctx,
    action: AUDIT_ACTION.CREATE,
    collection,
    recordId: doc_?.id,
    label: doc_?.label || '',
    after: doc_,
  }),
  updated: (ctx, collection, before, after) => record({
    ...ctx,
    action: AUDIT_ACTION.UPDATE,
    collection,
    recordId: after?.id,
    label: after?.label || '',
    before,
    after,
  }),
  deleted: (ctx, collection, doc_) => record({
    ...ctx,
    action: AUDIT_ACTION.DELETE,
    collection,
    recordId: doc_?.id,
    label: doc_?.label || '',
    before: doc_,
  }),
  approved: (ctx, collection, doc_) => record({
    ...ctx,
    action: AUDIT_ACTION.APPROVE,
    collection,
    recordId: doc_?.id,
    label: doc_?.label || '',
    after: doc_,
  }),
  rejected: (ctx, collection, doc_) => record({
    ...ctx,
    action: AUDIT_ACTION.REJECT,
    collection,
    recordId: doc_?.id,
    label: doc_?.label || '',
    after: doc_,
  }),
  login: (ctx, detail) => record({ ...ctx, action: AUDIT_ACTION.LOGIN, meta: detail }),
  logout: (ctx, detail) => record({ ...ctx, action: AUDIT_ACTION.LOGOUT, meta: detail }),
  security: (ctx, entry) => record({ ...ctx, ...entry }),
};
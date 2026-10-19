import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeCollection, getDocument, createDocument, updateDocument, deleteDocument } from '../services/erpRepository';
import { audit } from '../services/auditService';
import { usePermissions } from './PermissionContext';
import { ACTION } from '../config/erpRoles';
import { C } from '../config/erpSchema';

/**
 * ROBIUL GARMENTS ERP — real-time data layer.
 *
 * A screen asks for a collection ("I need today's hourly production for the
 * lines I can see") and gets back live rows plus loading and error state. The
 * subscription is a Firestore `onSnapshot`, so when a supervisor enters
 * Line 03 = 470 at 10:00 the GM's dashboard updates on its own, with no refresh
 * and no polling.
 *
 * Every mutation is funnelled through `save`/`remove`, which:
 *   1. check the permission,
 *   2. validate the document,
 *   3. write to Firestore,
 *   4. write an audit entry describing the change.
 * A screen therefore cannot forget any of those four steps, because it never
 * touches the repository directly.
 */

// Collections the dashboard aggregates. Kept explicit rather than fetched
// wholesale: the dashboard only needs today's rows, not the whole history, which
// is what keeps it fast as the tables grow.
const DASHBOARD_SOURCES = [
  { key: 'productionLines', collection: C.PRODUCTION_LINES, pageSize: 100 },
  { key: 'hourlyProduction', collection: C.HOURLY_PRODUCTION, pageSize: 500 },
  { key: 'dailyProduction', collection: C.DAILY_PRODUCTION, pageSize: 500 },
  { key: 'lineShifts', collection: C.LINE_SHIFTS, pageSize: 200 },
  { key: 'purchaseOrders', collection: C.PURCHASE_ORDERS, pageSize: 100 },
  { key: 'orders', collection: C.ORDERS, pageSize: 100 },
  { key: 'endLineQc', collection: C.END_LINE_QC, pageSize: 200 },
  { key: 'alerts', collection: C.ALERTS, pageSize: 200 },
];

export function ErpDataProvider({ children }) {
  const permissions = usePermissions();
  const [cache, setCache] = useState({});
  const [status, setStatus] = useState({});
  const [errors, setErrors] = useState({});
  const unsubs = useRef([]);

  /**
   * Live subscription to a collection. Safe to call from a screen's effect; the
   * subscription is torn down when the component unmounts or the query changes.
   */
  const subscribe = useCallback((collectionKey, { collection, where, orderBy, pageSize = 100 } = {}) => {
    if (!collection) return () => { };
    setStatus((s) => ({ ...s, [collectionKey]: 'loading' }));
    setErrors((s) => ({ ...s, [collectionKey]: '' }));

    const unsubscribe = subscribeCollection(collection, {
      where,
      orderBy,
      pageSize,
      onChange: (rows) => {
        setCache((c) => ({ ...c, [collectionKey]: rows }));
        setStatus((s) => ({ ...s, [collectionKey]: 'ready' }));
      },
      onError: (error) => {
        // Keep whatever was already on screen and surface the problem: a failed
        // refresh must not blank a dashboard somebody is reading.
        setStatus((s) => ({ ...s, [collectionKey]: 'error' }));
        setErrors((s) => ({ ...s, [collectionKey]: error.message }));
      },
    });
    return unsubscribe;
  }, []);

  const rows = useCallback((collectionKey) => cache[collectionKey] || [], [cache]);
  const isLoading = useCallback((collectionKey) => status[collectionKey] === 'loading', [status]);
  const errorFor = useCallback((collectionKey) => errors[collectionKey] || '', [errors]);

  const loadOne = useCallback(async (collection, id) => getDocument(collection, id), []);

  /**
   * Create / update / delete with permission check, validation and audit.
   * Returns `{ ok, row }` or `{ ok:false, error }` — never throws, so a screen
   * can render the message directly.
   */
  /**
   * `categorize: true` files the row under its module's category
   * (`appData/production/cuttingEntries/…`) instead of the shared root. Screens for the
   * Daily Production area pass it; every other screen keeps the root path it has always
   * used, so this is opt-in and cannot move a collection by accident.
   */
  const save = useCallback(async (collection, values, { id, module, categorize = false } = {}) => {
    const action = id ? ACTION.EDIT : ACTION.CREATE;
    if (!permissions.can(module, action)) {
      return { ok: false, error: 'You do not have permission to do that. Ask an administrator.' };
    }
    const ctx = { actor: permissions.actorName, actorUid: permissions.uid, module, categorize };
    try {
      const before = id ? await getDocument(collection, id, { categorize }) : null;
      const row = id
        ? await updateDocument(collection, id, values, ctx)
        : await createDocument(collection, values, ctx);
      await (id
        ? audit.updated(ctx, collection, before, row)
        : audit.created(ctx, collection, row));
      return { ok: true, row };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not save this record.', errors: error.errors };
    }
  }, [permissions]);

  const remove = useCallback(async (collection, id, { module, label, categorize = false } = {}) => {
    if (!permissions.can(module, ACTION.DELETE)) {
      return { ok: false, error: 'You do not have permission to delete records here.' };
    }
    const ctx = { actor: permissions.actorName, actorUid: permissions.uid, module, categorize };
    try {
      const before = await getDocument(collection, id, { categorize });
      await deleteDocument(collection, id, ctx);
      await audit.deleted(ctx, collection, before || { id, label });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not delete this record.' };
    }
  }, [permissions]);

  /** Approve / reject a pending request, when the role carries approval rights. */
  const decide = useCallback(async (collection, id, decision, { module, note } = {}) => {
    if (!permissions.can(module, ACTION.APPROVE)) {
      return { ok: false, error: 'You do not have permission to approve this.' };
    }
    const result = await save(collection, { status: decision, decisionNote: note || '' }, { id, module });
    if (result.ok) {
      const ctx = { actor: permissions.actorName, actorUid: permissions.uid, module };
      const fn = decision === 'Approved' ? audit.approved : audit.rejected;
      await fn(ctx, collection, result.row);
    }
    return result;
  }, [permissions, save]);

  const value = useMemo(() => ({
    subscribe, rows, isLoading, errorFor, loadOne, save, remove, decide,
    cache, status,
  }), [subscribe, rows, isLoading, errorFor, loadOne, save, remove, decide, cache, status]);

  return <ErpDataContext.Provider value={value}>{children}</ErpDataContext.Provider>;
}

// Exported so a test can provide a stub data source directly, matching
// PermissionContext and DataContext. Production reads it only through
// `useErpData`.
export const ErpDataContext = createContext(null);

export function useErpData() {
  const ctx = useContext(ErpDataContext);
  if (!ctx) {
    // Rendered outside the provider (e.g. the /login route, which sits above the
    // app shell). Returning inert functions is correct there: nothing writes.
    return {
      subscribe: () => () => { }, rows: () => [], isLoading: () => false, errorFor: () => '',
      loadOne: async () => null,
      save: async () => ({ ok: false, error: 'Not connected.' }),
      remove: async () => ({ ok: false, error: 'Not connected.' }),
      decide: async () => ({ ok: false, error: 'Not connected.' }),
      cache: {}, status: {},
    };
  }
  return ctx;
}

export { DASHBOARD_SOURCES };
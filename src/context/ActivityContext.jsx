import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import {
  NOTIFICATIONS,
  createNotification,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotification,
  todayKey,
} from '../services/notificationService';
import { menu, modulePath } from '../config/menuConfig';

// One place that records everything a user types in, feeds the bell notifications, and backs
// the History screen. Firestore is the source of truth; localStorage is only an offline
// fallback so the bell is never empty just because the network blipped.
const ACTIVITY_KEY = 'garments_app_activity';
const MAX_ENTRIES = 500;
const MAX_CACHED = 100;

const ACTION_TITLE = { create: '— new entry', update: '— updated', delete: '— removed', access: '— access change' };

// Builds a readable label + route for a data key, so a notification can say both
// "what was entered" and "where to go".
const MODULE_INDEX = (() => {
  const index = {};
  menu.forEach((cat) => {
    (cat.items || []).forEach((item) => {
      index[item.key] = {
        label: item.label,
        icon: item.icon,
        categoryLabel: cat.label,
        categoryKey: cat.key,
        path: modulePath(cat.key, item.key),
      };
    });
  });
  return index;
})();

function describe(key) {
  return MODULE_INDEX[key] || { label: key, icon: '📄', categoryLabel: 'Workspace', categoryKey: '', path: '/' };
}

function loadActivity() {
  try {
    const stored = JSON.parse(localStorage.getItem(ACTIVITY_KEY));
    if (Array.isArray(stored)) return stored;
  } catch { /* start clean */ }
  return [];
}

// Turns a Firestore notification document into the shape the bell / History screens use.
function toActivityRow(document) {
  const data = document.data() || {};
  const when = data.createdAt?.toDate?.() || new Date();
  return {
    id: document.id,
    action: data.action || 'create',
    key: data.moduleKey || '',
    moduleLabel: data.moduleLabel || data.title || 'Activity',
    moduleIcon: data.icon || '🔔',
    categoryLabel: data.categoryLabel || 'Workspace',
    path: data.targetRoute || '/',
    entry: data.entry || null,
    entryId: data.entryId ?? null,
    title: data.title || '',
    message: data.message || data.summary || '',
    date: when.toISOString(),
    day: data.day || todayKey(when),
    actor: data.actor || 'System',
    actionRequired: data.actionRequired || '',
    read: data.isRead === true,
  };
}

export const ActivityContext = createContext(null);

export function ActivityProvider({ children }) {
  const { user } = useAuth();
  const [entries, setEntries] = useState(loadActivity);
  const [loadError, setLoadError] = useState('');
  // True until the first snapshot (or a failure) for the signed-in user arrives, so the
  // header can show a loading line instead of a misleading "nothing new".
  const [ready, setReady] = useState(false);
  // Guards against a slow snapshot from a previous user landing after a sign-out/sign-in.
  const sessionRef = useRef(0);
  const today = todayKey();

  // Live listener: the badge updates the moment any notification document is written.
  useEffect(() => {
    if (!user?.id) {
      setEntries([]);
      setReady(false);
      return undefined;
    }
    const session = ++sessionRef.current;
    // Only the signed-in user's own notifications. This query needs a composite index on
    // (recipientUid ASC, createdAt DESC) in the Firestore console.
    const notifQuery = query(
      collection(db, NOTIFICATIONS),
      where('recipientUid', '==', user.id),
      orderBy('createdAt', 'desc'),
      limit(MAX_CACHED)
    );

    const unsubscribe = onSnapshot(notifQuery, (snapshot) => {
      if (session !== sessionRef.current) return;
      setLoadError('');
      setEntries(snapshot.docs.map(toActivityRow));
      setReady(true);
    }, (error) => {
      if (session !== sessionRef.current) return;
      // A missing index or a rules rejection must never break the header: keep the local
      // cache and surface a soft warning instead.
      console.error('[Notifications] live listen failed', error?.message || error);
      setLoadError('Live notifications unavailable — showing saved activity.');
      setReady(true);
    });

    return () => {
      sessionRef.current += 1;
      unsubscribe();
    };
  }, [user?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    } catch {
      /* storage full or blocked - the log simply stops growing in this session */
    }
  }, [entries]);

  // Records one action in Firestore and mirrors it locally. Never throws: a notification
  // failure must never block the data write that triggered it.
  const record = useCallback(async (action, { key, entry, actor, actionRequired, recipient, summary } = {}) => {
    const meta = describe(key);
    const row = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action,                       // 'create' | 'update' | 'delete' | 'access'
      key,
      moduleLabel: meta.label,
      moduleIcon: meta.icon,
      categoryLabel: meta.categoryLabel,
      path: meta.path,
      entry: entry || null,
      entryId: entry?.id ?? null,
      title: `${meta.label} ${ACTION_TITLE[action] || 'updated'}`,
      message: summary || entry?.summary || `${meta.categoryLabel} → ${meta.label}`,
      date: new Date().toISOString(),
      day: todayKey(),
      actor: actor || 'Unknown user',
      actionRequired: actionRequired || '',
      read: false,
    };
    // Optimistic insert so the badge reacts before the snapshot arrives.
    setEntries((current) => [row, ...current].slice(0, MAX_ENTRIES));

    await createNotification({
      title: row.title,
      message: row.message,
      summary: row.message,
      type: 'activity',
      moduleKey: key,
      moduleLabel: meta.label,
      categoryLabel: meta.categoryLabel,
      targetRoute: path,
      entryId: row.entryId,
      actor: row.actor,
      recipient: recipient || user || null,
      createdAt: row.date,
    }).catch((error) => {
      console.error('[Notifications] record failed', error?.message || error);
    });

    return row;
  }, [user]);

  // A single item is marked read when the user clicks through to its page.
  const markRead = useCallback(async (id) => {
    setEntries((current) => current.map((row) => (row.id === id ? { ...row, read: true } : row)));
    await markNotificationRead(id, true);
  }, []);

  const markAllRead = useCallback(async () => {
    const ids = entries.filter((row) => !row.read).map((row) => row.id);
    if (ids.length === 0) return;
    setEntries((current) => current.map((row) => ({ ...row, read: true })));
    await markAllNotificationsRead(ids);
  }, [entries]);

  // Final (non-undoable) delete. The row leaves local state only once Firestore confirms,
  // so a refused delete leaves the notification where it was. Returns true on success.
  const removeNotification = useCallback(async (id) => {
    if (!id) return false;
    const ok = await deleteNotification(id);
    if (ok) setEntries((current) => current.filter((row) => row.id !== id));
    return ok;
  }, []);

  const clearActivity = useCallback(() => setEntries([]), []);

  // The badge counts TODAY's unread items only.
  const todaysEntries = useMemo(() => entries.filter((row) => row.day === today), [entries, today]);
  const unreadCount = useMemo(() => todaysEntries.filter((row) => !row.read).length, [todaysEntries]);

  // Newest first, with unread rows pinned above the read ones.
  const notifications = useMemo(
    () => [...entries].sort((a, b) => Number(a.read) - Number(b.read) || b.date.localeCompare(a.date)),
    [entries]
  );

  const value = useMemo(
    () => ({ entries: notifications, todaysEntries, unreadCount, loadError, ready, record, markRead, markAllRead, removeNotification, clearActivity }),
    [notifications, todaysEntries, unreadCount, loadError, ready, record, markRead, markAllRead, removeNotification, clearActivity]
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  return useContext(ActivityContext);
}

export { describe as describeDataKey };

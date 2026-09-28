import emailjs from '@emailjs/browser';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

const NOTIFICATIONS = 'notifications';

// A "day" is a local calendar date (YYYY-MM-DD), not a UTC one, so the bell resets at the
// user's own midnight.
export function todayKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// Deep link that opens the app on the related screen, read-only.
export function buildAppLink(path) {
  const base = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, '');
  return `${base}${path || '/'}`;
}

async function resolveRecipientEmail(recipient) {
  if (!recipient) return '';
  if (recipient.email) return String(recipient.email).trim();
  const uid = typeof recipient === 'string' ? recipient : recipient.id;
  if (!uid) return '';
  try {
    const snapshot = await getDoc(doc(db, 'users', uid));
    return String(snapshot.data()?.email || '').trim();
  } catch {
    // A missing profile is not a reason to drop the in-app notification.
    return '';
  }
}

// Best effort: a failing mail send is logged, never thrown, so the caller's data write
// is not rolled back because of a mail server problem.
async function sendActivityEmail({ to, title, message, link }) {
  if (!to) return { emailed: false, reason: 'no-recipient' };
  const templateId = import.meta.env.VITE_EMAILJS_ACTIVITY_TEMPLATE_ID || import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
  const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
  const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
  if (!templateId || !serviceId || !publicKey) {
    console.warn('[Notifications] EmailJS env vars missing, email skipped');
    return { emailed: false, reason: 'not-configured' };
  }
  try {
    await emailjs.send(serviceId, templateId, {
      to_email: to,
      to,
      reply_to: to,
      subject: title,
      title,
      message,
      details: message,
      link,
      action_link: link,
    }, publicKey);
    return { emailed: true };
  } catch (error) {
    console.error('[Notifications] email failed', error?.message || error);
    return { emailed: false, reason: 'send-failed' };
  }
}

/**
 * Creates a notification record in Firestore and (best effort) emails the recipient.
 *
 * Firestore document shape — `notifications/{autoId}`:
 * {
 *   title, message, summary, type, moduleKey, moduleLabel, categoryLabel,
 *   targetRoute, targetUrl, entryId,
 *   recipientUid, recipientEmail, actor,
 *   day,            // 'YYYY-MM-DD' — lets the bell query "today" without a range scan
 *   isRead, readAt, createdAt (serverTimestamp)
 * }
 *
 * @returns {Promise<string|null>} the new document id, or null if the write failed.
 */
export async function createNotification({
  title,
  message,
  summary,
  type = 'activity',
  moduleKey = '',
  moduleLabel = '',
  categoryLabel = '',
  targetRoute = '/',
  entryId = null,
  actor = '',
  recipient = null,          // { id, email } | uid | null  (null = everyone)
  createdAt,
}) {
  const recipientUid = typeof recipient === 'string' ? recipient : recipient?.id || '';
  const recipientEmail = await resolveRecipientEmail(recipient);
  const when = createdAt ? new Date(createdAt) : new Date();
  const path = targetRoute || '/';

  const payload = {
    title: title || 'New activity',
    message: message || '',
    summary: summary || message || '',
    type,
    moduleKey,
    moduleLabel,
    categoryLabel,
    targetRoute: path,
    targetUrl: buildAppLink(path),
    entryId,
    recipientUid,
    recipientEmail,
    actor,
    day: todayKey(when),
    isRead: false,
    readAt: null,
    createdAt: serverTimestamp(),
  };

  try {
    const snapshot = await addDoc(collection(db, NOTIFICATIONS), payload);
    // Fire and forget: the bell updates from Firestore immediately, the mail may lag.
    sendActivityEmail({
      to: recipientEmail,
      title: payload.title,
      message: payload.message,
      link: payload.targetUrl,
    });
    return snapshot.id;
  } catch (error) {
    console.error('[Notifications] Firestore write failed', error?.message || error);
    return null;
  }
}

// Deterministic id per activity entry, so a retry or double write cannot duplicate a bell item.
export function activityNotificationId(moduleKey, entryId) {
  return `${String(moduleKey || 'activity').replace(/[^\w-]/g, '_')}_${entryId ?? 'none'}`;
}

/** Upsert used by the real-time path — same shape as createNotification. */
export async function upsertNotification({ id, ...payload }) {
  const key = todayKey(payload.createdAt);
  const docId = id || activityNotificationId(payload.moduleKey, payload.entryId);
  try {
    await setDoc(doc(db, NOTIFICATIONS, docId), { ...payload, day: key, createdAt: serverTimestamp() }, { merge: true });
    return docId;
  } catch (error) {
    console.error('[Notifications] upsert failed', error?.message || error);
    return null;
  }
}

export async function markNotificationRead(id, isRead = true) {
  if (!id) return false;
  try {
    await updateDoc(doc(db, NOTIFICATIONS, id), { isRead, readAt: isRead ? serverTimestamp() : null });
    return true;
  } catch (error) {
    console.error('[Notifications] mark read failed', error?.message || error);
    return false;
  }
}

// Permanently removes one notification. Returns false instead of throwing so the undo
// flow can put the row back if Firestore refuses (offline, rules).
export async function deleteNotification(id) {
  if (!id) return false;
  try {
    await deleteDoc(doc(db, NOTIFICATIONS, String(id)));
    return true;
  } catch (error) {
    console.error('[Notifications] delete failed', error?.message || error);
    return false;
  }
}

export async function markAllNotificationsRead(uids = []) {
  // Caller supplies ids; Firestore has no "mark all" primitive, so a batch is used and
  // failures are swallowed (offline / rules) to keep the UI responsive.
  const results = await Promise.allSettled(uids.map((id) => markNotificationRead(id, true)));
  return results.filter((r) => r.status === 'fulfilled' && r.value).length;
}

export { NOTIFICATIONS };

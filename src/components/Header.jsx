import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import { useData } from '../context/DataContext';
import { useActivity } from '../context/ActivityContext';
import { useNavigate, Link } from 'react-router-dom';
import { todayKey } from '../services/notificationService';
import ProfileModal from './ProfileModal';

const COMPANY_NAME = 'ART BOUTIQUE SRL';

// Hold time that turns a press into a long press, how long UNDO is offered, and how far a
// finger may drift (px) before the press counts as a scroll instead of a hold.
const LONG_PRESS_MS = 500;
const UNDO_MS = 5000;
const MOVE_TOLERANCE_PX = 10;

const ACTION_ICON = { create: '➕', update: '✏️', delete: '🗑️', access: '🔐' };

// Full date for the hover tooltip on a relative stamp.
function formatFullStamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Relative, human stamp: "just now", "5 mins ago", "2 hrs ago", then an absolute date once the
// notification is older than a day. Returns '' for anything unparseable so the row still renders.
function formatStamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const seconds = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min${Math.round(seconds / 60) === 1 ? '' : 's'} ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr${Math.round(seconds / 3600) === 1 ? '' : 's'} ago`;
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// A context can legitimately hand back nothing (provider missing, or a render that happens
// before it is mounted). Everything below is then treated as "no data yet" instead of
// crashing the whole app.
const EMPTY = [];
const NO_ACTIVITY = {
  entries: EMPTY,
  notifications: EMPTY,
  todaysEntries: EMPTY,
  unreadCount: 0,
  loadError: '',
  ready: true,
  record: () => {},
  markRead: async () => {},
  markAllRead: async () => {},
  removeNotification: async () => false,
  clearActivity: () => {},
};

// toArray() is the single guard used for every list rendered or counted below, so a null /
// non-array value from Firestore (or from localStorage) can never reach .map() or .length.
function toArray(value) {
  return Array.isArray(value) ? value : EMPTY;
}

export default function Header() {
  const auth = useAuth() || {};
  const { user, logout, pendingManagers, approveManager } = auth;
  const role = useRole() || {};
  const { isAdmin } = role;
  const data = useData() || {};
  const { getData } = data;
  const activity = useActivity() || NO_ACTIVITY;
  const { notifications, unreadCount, markRead, markAllRead, removeNotification, loadError, ready } = activity;
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Confirmation shown before "Add / Switch Another Account" signs the user out, so the
  // destructive action is never taken on a single stray click.
  const [switchAccountOpen, setSwitchAccountOpen] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [pendingMgrs, setPendingMgrs] = useState(EMPTY);
  // Delete + undo. A deleted row is only HIDDEN for 5 s, never spliced out, so UNDO puts it
  // back in exactly the same position.
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const [pendingDelete, setPendingDelete] = useState(null); // { id, title } while UNDO is offered
  const [armedId, setArmedId] = useState(null);             // row showing its Delete button
  const [actionError, setActionError] = useState('');
  const notifRef = useRef(null);
  const accountRef = useRef(null);
  const toastRef = useRef(null);
  const deleteTimerRef = useRef(null);
  const pendingRef = useRef(null);                          // mirror of pendingDelete for timers
  const removeRef = useRef(removeNotification);
  const pressRef = useRef({ timer: null, fired: false, x: 0, y: 0, id: null });

  useEffect(() => { removeRef.current = removeNotification; }, [removeNotification]);

  // Safe reads: every list below is a real array, whatever the providers returned.
  const allNotifs = toArray(notifications);
  const notifList = allNotifs.filter((row) => row && row.id != null && !hiddenIds.has(row.id));
  const leaveList = toArray(typeof getData === 'function' ? getData('leave-requests') : null);
  const pendingLeave = leaveList.filter((r) => r?.status === 'Pending');
  const mgrList = toArray(pendingMgrs);

  // Today's unread notifications drive the badge; the full list shows in the dropdown. A
  // row waiting in the undo window no longer counts.
  const today = todayKey();
  const hiddenUnreadToday = allNotifs.filter((row) => row && hiddenIds.has(row.id) && !row.read && row.day === today).length;
  const rawUnread = Number.isFinite(Number(unreadCount)) ? Number(unreadCount) : 0;
  const safeUnread = Math.max(0, rawUnread - hiddenUnreadToday);
  const notifCount = safeUnread + pendingLeave.length + mgrList.length;
  // Shown only while the first snapshot is still on its way, so an empty list is never
  // mistaken for "no activity today".
  const notifLoading = !ready;
  const hasUnread = notifList.some((row) => !row?.read);

  useEffect(() => {
    if (!user?.isSuperAdmin) { setPendingMgrs([]); return undefined; }
    let active = true;
    // Cached in state, not awaited inline: an approval lookup must never block the header.
    // pendingManagers is a new function identity on every provider render, so it is
    // deliberately not a dependency — otherwise this effect would re-run forever.
    if (typeof pendingManagers !== 'function') return undefined;
    Promise.resolve(pendingManagers())
      .then((rows) => { if (active) setPendingMgrs(toArray(rows)); })
      .catch((error) => { if (active) setPendingMgrs(EMPTY); console.error('[Header] pending managers failed', error?.message || error); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.isSuperAdmin]);

  // Close the dropdown on an outside click or Escape, so a failed read cannot leave the
  // panel stuck open over the page. The undo toast counts as "inside": pressing UNDO must
  // not also close the list the row is being restored into.
  useEffect(() => {
    if (!notifOpen && !accountOpen) return undefined;
    function onPointerDown(event) {
      const inToast = toastRef.current?.contains(event.target);
      if (notifOpen && notifRef.current && !notifRef.current.contains(event.target) && !inToast) setNotifOpen(false);
      if (accountOpen && accountRef.current && !accountRef.current.contains(event.target)) setAccountOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') { setNotifOpen(false); setAccountOpen(false); setArmedId(null); }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [notifOpen, accountOpen]);

  // A closed list must not reopen with a Delete button still showing.
  useEffect(() => { if (!notifOpen) setArmedId(null); }, [notifOpen]);

  // A delete error is a short-lived toast, not a permanent banner.
  useEffect(() => {
    if (!actionError) return undefined;
    const timer = window.setTimeout(() => setActionError(''), 4000);
    return () => window.clearTimeout(timer);
  }, [actionError]);

  /* ---------------------------- delete + undo ---------------------------- */

  const clearDeleteTimer = useCallback(() => {
    if (deleteTimerRef.current) {
      window.clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
  }, []);

  const unhide = useCallback((id) => {
    setHiddenIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  // Commits the delete to Firestore once the undo window has passed. If Firestore refuses
  // (offline, rules) the row reappears, so nothing is lost without the user knowing.
  const finalizeDelete = useCallback(async (pending) => {
    if (!pending?.id) return;
    const remove = removeRef.current;
    let ok = false;
    try {
      ok = typeof remove === 'function' ? await remove(pending.id) : false;
    } catch {
      ok = false;
    }
    // On success the context has already dropped the row, so un-hiding is a no-op cleanup.
    unhide(pending.id);
    if (!ok) setActionError("Couldn't delete the notification — it has been restored.");
  }, [unhide]);

  const requestDelete = useCallback((row) => {
    if (!row?.id) return;
    // Only one undo toast at a time: a second delete commits the previous one right away.
    const previous = pendingRef.current;
    clearDeleteTimer();
    if (previous && previous.id !== row.id) finalizeDelete(previous);

    const pending = { id: row.id, title: row.title || row.moduleLabel || 'Notification' };
    pendingRef.current = pending;
    setPendingDelete(pending);
    setArmedId(null);
    setActionError('');
    setHiddenIds((current) => new Set(current).add(row.id));

    deleteTimerRef.current = window.setTimeout(() => {
      deleteTimerRef.current = null;
      pendingRef.current = null;
      setPendingDelete(null);
      finalizeDelete(pending);
    }, UNDO_MS);
  }, [clearDeleteTimer, finalizeDelete]);

  const undoDelete = useCallback(() => {
    const pending = pendingRef.current;
    clearDeleteTimer();
    pendingRef.current = null;
    setPendingDelete(null);
    if (pending) unhide(pending.id);
  }, [clearDeleteTimer, unhide]);

  // Leaving the screen (sign-out, route change that unmounts the header) inside the undo
  // window still honours the delete instead of silently dropping it.
  useEffect(() => () => {
    window.clearTimeout(deleteTimerRef.current);
    window.clearTimeout(pressRef.current.timer);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending && typeof removeRef.current === 'function') {
      Promise.resolve(removeRef.current(pending.id)).catch(() => {});
    }
  }, []);

  /* ------------------------------ long press ----------------------------- */

  function cancelPress() {
    window.clearTimeout(pressRef.current.timer);
    pressRef.current.timer = null;
  }

  function startPress(event, row) {
    // Left button only for a mouse; touch and pen always qualify.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    cancelPress();
    const press = { timer: null, fired: false, x: event.clientX, y: event.clientY, id: row.id };
    press.timer = window.setTimeout(() => {
      press.fired = true;
      press.timer = null;
      setArmedId(row.id);
      try { navigator.vibrate?.(30); } catch { /* haptics unsupported */ }
    }, LONG_PRESS_MS);
    pressRef.current = press;
  }

  // Scrolling the list is not a long press.
  function movePress(event) {
    const press = pressRef.current;
    if (!press.timer) return;
    if (Math.abs(event.clientX - press.x) > MOVE_TOLERANCE_PX || Math.abs(event.clientY - press.y) > MOVE_TOLERANCE_PX) {
      cancelPress();
    }
  }

  function handleItemClick(row) {
    // The click that ends a long press must not also open the page.
    if (pressRef.current.fired && pressRef.current.id === row.id) {
      pressRef.current.fired = false;
      return;
    }
    // Tapping an armed row simply dismisses its Delete button.
    if (armedId === row.id) { setArmedId(null); return; }
    setArmedId(null);
    openNotification(row);
  }

  // Keyboard parity: Enter/Space opens, Delete/Backspace deletes (with the same undo).
  function handleItemKey(event, row) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openNotification(row); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); requestDelete(row); }
  }

  // Clicking a notification goes straight to the screen where that data was entered. A
  // general user lands there read-only; only their own Profile stays editable.
  async function openNotification(row) {
    if (!row) return;
    // Marked read first: the click must never be lost if the route fails to render.
    if (typeof markRead === 'function') markRead(row.id).catch(() => {});
    // Flagged so the target screen opens with every add/edit/delete control hidden.
    sessionStorage.setItem('viewOnlyTarget', '1');
    setNotifOpen(false);
    try {
      navigate(row.path || '/');
    } catch (error) {
      console.error('[Notifications] navigation failed', error?.message || error);
      setNotifOpen(true);
    }
  }

  function go(path) {
    setAccountOpen(false);
    navigate(path);
  }

  // "Add / Switch Another Account" opens a confirmation instead of signing out straight away.
  function requestSwitchAccount() {
    setAccountOpen(false);
    setSwitchAccountOpen(true);
  }

  // "No" and the backdrop both just dismiss the modal; the current page is untouched.
  function cancelSwitchAccount() {
    setSwitchAccountOpen(false);
  }

  // "Yes" signs out (guarded: a missing logout must not crash the header) and lands on the
  // login / registration screen where another account can be created or signed in to.
  async function confirmSwitchAccount() {
    setSwitchAccountOpen(false);
    setSwitchingAccount(true);
    try {
      if (typeof logout === 'function') await logout('signin');
    } catch (error) {
      console.error('[Header] switch account sign-out failed', error?.message || error);
    } finally {
      setSwitchingAccount(false);
      navigate('/login');
    }
  }

  return (
    <>
      <header className="app-header">
        {/* The whole brand block is a link back to the dashboard. */}
        <Link to="/" className="brand brand-link" aria-label={`${COMPANY_NAME} — go to dashboard`}>
          <div className="brand-logo">AB</div>
          <div className="brand-name">{COMPANY_NAME}</div>
        </Link>

        <div className="header-actions">
          <div className="account-menu" ref={notifRef}>
            <button
              className="account-btn"
              onClick={() => { setNotifOpen((v) => !v); setAccountOpen(false); }}
              aria-label="Notifications"
              aria-expanded={notifOpen}
            >
              🔔
              {notifCount > 0 && <span className="notif-badge">{notifCount > 99 ? '99+' : notifCount}</span>}
            </button>

            {notifOpen && (
              <div className="notif-dropdown">
                <div className="notif-dropdown-header">
                  <div className="notif-dropdown-title">
                    <strong>Today's activity</strong>
                    <small>Tap to open · hold to delete</small>
                  </div>
                  <button
                    className="notif-clear-btn"
                    disabled={!hasUnread}
                    onClick={() => { if (typeof markAllRead === 'function') markAllRead().catch(() => {}); }}
                  >
                    Mark all read
                  </button>
                </div>
                {loadError && <p className="notif-dropdown-error">{loadError}</p>}
                {notifLoading && <p className="hint notif-loading">Loading today's activity…</p>}
                {!notifLoading && notifList.length === 0 && pendingLeave.length === 0 && mgrList.length === 0 && (
                  <p className="hint">Nothing new right now.</p>
                )}

                {notifList.map((row) => {
                  const armed = armedId === row.id;
                  const heading = row?.title || `${row?.actor || 'Someone'} · ${row?.moduleIcon || ''} ${row?.moduleLabel || 'Activity'}`;
                  // A div, not a <button>: the row contains its own Delete / Cancel buttons,
                  // and buttons cannot be nested. role + tabIndex keep it keyboard-usable.
                  return (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${heading}. Press Delete to remove.`}
                      className={`notif-dropdown-item notif-clickable notif-pressable${row?.read ? '' : ' notif-unread'}${armed ? ' notif-armed' : ''}`}
                      onPointerDown={(event) => startPress(event, row)}
                      onPointerMove={movePress}
                      onPointerUp={cancelPress}
                      onPointerLeave={cancelPress}
                      onPointerCancel={cancelPress}
                      onContextMenu={(event) => event.preventDefault()}
                      onClick={() => handleItemClick(row)}
                      onKeyDown={(event) => handleItemKey(event, row)}
                    >
                      <div className="notif-item-head">
                        <span className="notif-item-icon">{ACTION_ICON[row?.action] || '🔔'}</span>
                        <strong>{heading}</strong>
                        <small title={formatFullStamp(row?.date)}>{formatStamp(row?.date)}</small>
                      </div>
                      {row?.message && <p className="notif-item-summary">{row.message}</p>}
                      {row?.actionRequired && <p className="notif-item-action">👉 Action needed: {row.actionRequired}</p>}

                      {armed && (
                        <div className="notif-item-actions">
                          <button
                            type="button"
                            className="notif-delete-btn"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => { event.stopPropagation(); requestDelete(row); }}
                          >
                            🗑️ Delete
                          </button>
                          <button
                            type="button"
                            className="notif-cancel-btn"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => { event.stopPropagation(); setArmedId(null); }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {pendingLeave.map((r) => (
                  <button
                    key={`leave-${r?.id}`}
                    className="notif-dropdown-item notif-clickable"
                    onClick={() => { setNotifOpen(false); navigate('/attendance/attendance-leave'); }}
                  >
                    <div className="notif-item-head">
                      <span className="notif-item-icon">🗓️</span>
                      <strong>Leave request from {r?.employee}</strong>
                    </div>
                    <p className="notif-item-action">👉 Action needed: Review and approve this leave request.</p>
                  </button>
                ))}

                {mgrList.map((m) => (
                  <div key={`mgr-${m?.id}`} className="notif-dropdown-item notif-approve">
                    <div className="notif-item-head">
                      <span className="notif-item-icon">🧑‍💼</span>
                      <strong>{m?.username || 'A user'} requested manager access</strong>
                    </div>
                    <p className="notif-item-action">👉 Action needed: Approve or reject this account.</p>
                    <button
                      className="btn btn-primary notif-approve-btn"
                      onClick={() => {
                        if (typeof approveManager !== 'function') return;
                        Promise.resolve(approveManager(m?.id))
                          .catch((error) => console.error('[Header] approve failed', error?.message || error));
                      }}
                    >
                      Approve
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="account-menu" ref={accountRef}>
            <button className="account-btn" onClick={() => setAccountOpen(!accountOpen)} aria-label="Account menu">
              {user?.profilePicture ? <img className="account-avatar-image" src={user.profilePicture} alt="Profile" /> : <span className="account-avatar">{isAdmin ? '🧑‍💼' : '🙂'}</span>}
            </button>
            {accountOpen && (
              <div className="account-dropdown">
                <div className="account-dropdown-profile">
                  {user?.profilePicture ? <img src={user.profilePicture} alt="Profile" /> : <span>{isAdmin ? '🧑‍💼' : '🙂'}</span>}
                  <strong>{user?.username || 'User'}</strong>
                  <small>{user?.email}</small>
                </div>
                {/* Order: Profile → History → Settings → Switch Account → Log Out */}
                <button className="account-dropdown-item" onClick={() => { setAccountOpen(false); setProfileOpen(true); }}>👤 <span>Profile / Account</span></button>
                <button className="account-dropdown-item" onClick={() => go('/history')}>📜 <span>History</span></button>
                <button className="account-dropdown-item" onClick={() => go('/settings')}>⚙️ <span>Settings</span></button>
                <button className="account-dropdown-item" onClick={requestSwitchAccount}>🔄 <span>Add / Switch Another Account</span></button>
                <button className="account-dropdown-item account-dropdown-logout" onClick={() => { setAccountOpen(false); if (typeof logout === 'function') logout('signin'); }}>🚪 <span>Log Out</span></button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Bottom toast. Keyed by id so the 5 s progress bar restarts for every new delete. */}
      {pendingDelete && (
        <div key={pendingDelete.id} ref={toastRef} className="notif-toast" role="status" aria-live="polite">
          <span className="notif-toast-text">Notification deleted</span>
          <button type="button" className="notif-toast-undo" onClick={undoDelete}>UNDO</button>
          <span className="notif-toast-progress" style={{ animationDuration: `${UNDO_MS}ms` }} />
        </div>
      )}
      {!pendingDelete && actionError && (
        <div className="notif-toast notif-toast-error" role="alert">
          <span className="notif-toast-text">{actionError}</span>
        </div>
      )}

      {switchAccountOpen && (
        <div className="modal-backdrop" onClick={cancelSwitchAccount} role="presentation">
          <div
            className="profile-modal confirm-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Switch account confirmation"
          >
            <div className="profile-modal-head">
              <h2>Switch account</h2>
              <button type="button" className="modal-close" onClick={cancelSwitchAccount} aria-label="Close">✕</button>
            </div>
            <p className="confirm-modal-text">Are you sure you want to log out to create or switch account?</p>
            <div className="settings-actions confirm-modal-actions">
              <button type="button" className="btn btn-outline" disabled={switchingAccount} onClick={cancelSwitchAccount}>No</button>
              <button type="button" className="btn btn-primary" disabled={switchingAccount} onClick={confirmSwitchAccount}>
                {switchingAccount ? 'Signing out…' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}

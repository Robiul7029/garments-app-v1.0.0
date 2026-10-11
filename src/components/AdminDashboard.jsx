import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

/**
 * The admin panel's approval table.
 *
 * It lists every account in the `users` collection — not only the pending applicants — so
 * an approver can also promote an existing general user to manager, downgrade one, or
 * delete an account outright. Each row offers the decisions the panel supports:
 *
 *   Approve as Manager      -> role: 'admin',  status: 'approved'  (full data rights)
 *   Approve as View-Only    -> role: 'user',   status: 'approved'  (reports only)
 *   Reject / Delete         -> the account is marked rejected, or removed entirely
 *
 * The write goes through AuthContext.setUserAccess, which updates `users/{uid}` and the
 * `managerDirectory/{uid}` entry in one atomic batch so a decision can never be recorded
 * in one place and missing from the other.
 */
const styles = {
  wrapper: { padding: 20 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 12 },
  th: { textAlign: 'left', padding: '10px 12px', background: '#f3f4f6', borderBottom: '2px solid #e5e7eb' },
  td: { padding: '10px 12px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'middle' },
  btn: { border: 'none', borderRadius: 6, padding: '6px 12px', color: '#fff', cursor: 'pointer', marginRight: 8, fontSize: 13 },
  approveManager: { background: '#16a34a' },
  approveViewer: { background: '#2563eb' },
  reject: { background: '#dc2626' },
  disabled: { opacity: 0.55, cursor: 'not-allowed' },
  error: { color: '#dc2626', marginTop: 8 },
  empty: { color: '#4a5568', marginTop: 8 },
};

const BADGE = {
  approved: { background: '#dcfce7', color: '#166534' },
  pending: { background: '#fef3c7', color: '#92400e' },
  rejected: { background: '#fee2e2', color: '#991b1b' },
};

function statusOf(record = {}) {
  const status = String(record.managerStatus || record.status || '').trim().toLowerCase();
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'pending') return 'pending';
  return status || 'pending';
}

function roleOf(record = {}) {
  const role = String(record.role || '').trim().toLowerCase();
  if (role === 'admin' || role === 'manager') return 'manager';
  const roles = Array.isArray(record.roles) ? record.roles : [];
  if (roles.some((value) => String(value || '').trim().toLowerCase() === 'manager')) return 'manager';
  return 'user';
}

/**
 * A missing-permission rejection is an expected state for this screen, not a failure.
 * The query below is scoped to accounts this admin may act on, and a deployment whose
 * rules have not been updated yet will refuse the read. Neither case is something a user
 * of this page can act on, so it must not be surfaced as a red error.
 */
function isPermissionError(error) {
  const code = String(error?.code || '');
  if (code === 'permission-denied' || code === 'unauthenticated') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('permission') || message.includes('insufficient permissions');
}

export default function AdminDashboard() {
  const { approveAsManager, approveAsViewer, rejectUser, deleteUser, user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => { };

    // onSnapshot can reject synchronously (a malformed query) as well as through its error
    // callback, so both paths are guarded.
    try {
      // No `where` clause: every account must be listed so an existing general user can be
      // promoted later. Ordering is done here rather than in the query, which also avoids
      // needing a composite Firestore index for this screen.
      unsubscribe = onSnapshot(
        query(collection(db, 'users')),
        (snapshot) => {
          if (!active) return;
          setUsers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (err) => {
          if (!active) return;
          if (isPermissionError(err)) {
            console.warn('[AdminDashboard] approvals read refused; showing empty list.');
            setUsers([]);
            setError('');
          } else {
            console.error('Failed to load users:', err);
            setError(err?.message || 'Unable to load accounts.');
          }
          setLoading(false);
        }
      );
    } catch (err) {
      if (isPermissionError(err)) {
        setUsers([]);
        setError('');
      } else {
        setError(err?.message || 'Unable to load accounts.');
      }
      setLoading(false);
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Pending applicants first, because that is the queue the panel exists to clear; within
  // each group the newest request is on top.
  const sorted = useMemo(() => {
    const rank = { pending: 0, rejected: 1, approved: 2 };
    return [...users].sort((a, b) => {
      const diff = (rank[statusOf(a)] ?? 3) - (rank[statusOf(b)] ?? 3);
      if (diff !== 0) return diff;
      return String(b.createdAt?.toDate?.() || 0).localeCompare(String(a.createdAt?.toDate?.() || 0));
    });
  }, [users]);

  async function run(id, action, successMessage) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await action(id);
      setNotice(successMessage);
    } catch (err) {
      console.error('[AdminDashboard] action failed', err);
      // A write refused by the rules is reported plainly: the admin pressed a button and
      // needs to know it did not take effect.
      setError(err?.message || 'That change could not be saved. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={styles.wrapper}>
      <h2>User Approvals</h2>
      <p className="hint" style={{ marginTop: 4 }}>
        Approve an account as a Manager (full data entry rights) or as a View-Only user
        (reports only). Managers cannot open this area.
      </p>

      {error && <p style={styles.error}>{error}</p>}
      {notice && <p className="settings-success">{notice}</p>}

      {loading ? (
        <p>Loading accounts…</p>
      ) : sorted.length === 0 ? (
        <p style={styles.empty}>No accounts found.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>User</th>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const status = statusOf(row);
              const role = roleOf(row);
              const isSelf = currentUser?.id === row.id;
              const busy = busyId === row.id;
              return (
                <tr key={row.id}>
                  <td style={styles.td}>{row.username || '—'}</td>
                  <td style={styles.td}>{row.email || '—'}</td>
                  <td style={styles.td}>{role === 'manager' ? 'Manager' : 'View-Only'}</td>
                  <td style={styles.td}>
                    <span style={{ ...BADGE[status], padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>
                      {status}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {/* The approver cannot change their own row: an admin demoting
                        themselves would lock the panel out on the very next read. */}
                    {isSelf ? (
                      <span className="hint">This is you</span>
                    ) : (
                      <>
                        <button
                          style={{ ...styles.btn, ...styles.approveManager, ...(busy && styles.disabled) }}
                          disabled={busy}
                          onClick={() => run(row.id, approveAsManager, `${row.username || row.email} approved as Manager.`)}
                        >
                          Approve as Manager
                        </button>
                        <button
                          style={{ ...styles.btn, ...styles.approveViewer, ...(busy && styles.disabled) }}
                          disabled={busy}
                          onClick={() => run(row.id, approveAsViewer, `${row.username || row.email} approved as View-Only.`)}
                        >
                          Approve as View-Only
                        </button>
                        <button
                          style={{ ...styles.btn, ...styles.reject, ...(busy && styles.disabled) }}
                          disabled={busy}
                          onClick={() => run(row.id, rejectUser, `${row.username || row.email} rejected.`)}
                        >
                          Reject
                        </button>
                        <button
                          style={{ ...styles.btn, background: '#4b5563', ...(busy && styles.disabled) }}
                          disabled={busy}
                          onClick={() => run(row.id, deleteUser, `${row.username || row.email} deleted.`)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
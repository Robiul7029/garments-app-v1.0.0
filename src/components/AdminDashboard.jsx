import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

const styles = {
  wrapper: { padding: 20 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 12 },
  th: { textAlign: 'left', padding: '10px 12px', background: '#f3f4f6', borderBottom: '2px solid #e5e7eb' },
  td: { padding: '10px 12px', borderBottom: '1px solid #e5e7eb' },
  btn: { border: 'none', borderRadius: 6, padding: '6px 14px', color: '#fff', cursor: 'pointer', marginRight: 8 },
  approve: { background: '#16a34a' },
  reject: { background: '#dc2626' },
  error: { color: '#dc2626', marginTop: 8 },
};

export default function AdminDashboard() {
  const { approveManager, rejectManager } = useAuth();
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const q = query(
      collection(db, 'users'),
      where('role', '==', 'manager'),
      where('status', '==', 'pending')
    );

    // Real-time listener: approved/rejected users disappear from the list automatically.
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setManagers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('Failed to load pending managers:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  async function updateStatus(id, status) {
    setBusyId(id);
    setError('');
    try {
      // Updates users/{id}.status and the managerDirectory entry in one batch.
      if (status === 'approved') await approveManager(id);
      else await rejectManager(id);
    } catch (err) {
      console.error(`Failed to set status "${status}":`, err);
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={styles.wrapper}>
      <h2>Pending Manager Approvals</h2>
      {error && <p style={styles.error}>{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : managers.length === 0 ? (
        <p>No pending manager requests.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Username</th>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {managers.map((m) => (
              <tr key={m.id}>
                <td style={styles.td}>{m.username || '—'}</td>
                <td style={styles.td}>{m.email || '—'}</td>
                <td style={styles.td}>
                  <button
                    style={{ ...styles.btn, ...styles.approve }}
                    disabled={busyId === m.id}
                    onClick={() => updateStatus(m.id, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    style={{ ...styles.btn, ...styles.reject }}
                    disabled={busyId === m.id}
                    onClick={() => updateStatus(m.id, 'rejected')}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

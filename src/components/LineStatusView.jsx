import React from 'react';
import { useData } from '../context/DataContext';
import { downloadCSV } from '../utils/csv';
import { useRole } from '../context/RoleContext';

export default function LineStatusView({ item }) {
  const { getData } = useData();
  const { isAdmin } = useRole();
  const orders = getData('order-model');
  const production = getData('daily-production');

  const rows = orders.map((o) => {
    const done = production.filter((p) => p.style === o.style).reduce((s, p) => s + Number(p.quantity || 0), 0);
    const remaining = Math.max(0, o.qty - done);
    const status = remaining <= 0 ? 'Completed' : 'Running';
    const pct = o.qty ? Math.min(100, Math.round((done / o.qty) * 100)) : 0;
    return { ...o, done, remaining, status, pct };
  });

  return (
    <div className="module">
      <div className="module-header"><h2>🏗️ Production Line — Style Status</h2></div>
      {isAdmin && (
        <div className="module-actions">
          <button
            className="btn btn-outline"
            onClick={() => downloadCSV('production-line-status.csv', rows, [
              { name: 'style', label: 'Style' }, { name: 'buyer', label: 'Buyer' }, { name: 'qty', label: 'Total Qty' },
              { name: 'done', label: 'Done' }, { name: 'remaining', label: 'Remaining' }, { name: 'status', label: 'Status' },
            ])}
          >
            ⬇ Download Report
          </button>
        </div>
      )}
      {rows.length === 0 ? <p className="hint">Add styles in Order / Model to see line status here.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => (
            <div key={r.id} className="progress-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <strong>{r.style}</strong> <span className="hint" style={{ marginLeft: 8 }}>{r.buyer}</span>
                </div>
                <span className={`badge ${r.status === 'Completed' ? 'badge-green' : 'badge-amber'}`}>{r.status}</span>
              </div>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${r.pct}%`, background: r.status === 'Completed' ? '#34d399' : '#f59e0b' }} />
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {r.done.toLocaleString()} done of {Number(r.qty).toLocaleString()} — {r.remaining.toLocaleString()} remaining ({r.pct}%)
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

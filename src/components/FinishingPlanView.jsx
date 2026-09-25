import React from 'react';
import { useData } from '../context/DataContext';

export default function FinishingPlanView() {
  const { getData } = useData();
  const orders = getData('order-model');
  const production = getData('daily-production');
  const finishing = getData('finishing-production');

  const rows = orders
    .map((o) => {
      const sewnOut = production.filter((p) => p.style === o.style).reduce((s, p) => s + Number(p.quantity || 0), 0);
      const finishedOut = finishing.filter((f) => f.style === o.style).reduce((s, f) => s + Number(f.quantity || 0), 0);
      const daysLeft = Math.ceil((new Date(o.ship_date) - new Date()) / 86400000);
      return { ...o, sewnOut, finishedOut, daysLeft };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  return (
    <div className="module">
      <div className="module-header"><h2>📐 Finishing Plan</h2></div>
      <p className="hint" style={{ marginBottom: 14 }}>Sorted by delivery urgency — finish the styles at the top first.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Style</th><th>Buyer</th><th>Delivery Date</th><th>Days Left</th>
              <th>Sewn (ready for finishing)</th><th>Finished so far</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="empty-row">Add styles in Order / Model first.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.style}</strong></td>
                <td>{r.buyer}</td>
                <td>{r.ship_date}</td>
                <td style={{ color: r.daysLeft <= 3 ? '#f87171' : r.daysLeft <= 7 ? '#fbbf24' : '#34d399' }}>{r.daysLeft} days</td>
                <td>{r.sewnOut.toLocaleString()}</td>
                <td>{r.finishedOut.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

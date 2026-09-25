import React from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadCSV } from '../utils/csv';
import { targetForProcess, dueLabel } from '../utils/calc';

export function ProductionReportView() {
  const { getData } = useData();
  const { isAdmin } = useRole();
  const rows = getData('daily-production');

  const computed = rows.map((r) => {
    const target = targetForProcess(r.process);
    const due = dueLabel(target, Number(r.quantity || 0));
    return { ...r, target, due: due.label, ok: due.ok };
  });

  // Line-output style summary: total sewn per style, delivered onward to finishing
  const byStyle = {};
  computed.forEach((r) => {
    if (!byStyle[r.style]) byStyle[r.style] = { style: r.style, target: 0, achieved: 0 };
    byStyle[r.style].target += r.target;
    byStyle[r.style].achieved += Number(r.quantity || 0);
  });
  const summary = Object.values(byStyle);

  const columns = [
    { name: 'date', label: 'Date' }, { name: 'employee', label: 'Employee' }, { name: 'style', label: 'Style' },
    { name: 'department', label: 'Department' }, { name: 'process', label: 'Process' },
    { name: 'target', label: 'Target' }, { name: 'quantity', label: 'Achieved' }, { name: 'due', label: 'Due' },
  ];

  return (
    <div className="module">
      <div className="module-header"><h2>📈 Production Report</h2></div>

      {summary.length > 0 && (
        <div className="progress-card" style={{ marginBottom: 16 }}>
          <strong style={{ display: 'block', marginBottom: 8 }}>Output by Style</strong>
          {summary.map((s) => (
            <div key={s.style} className="hint" style={{ marginBottom: 4 }}>
              {s.style}: {s.achieved.toLocaleString()} pcs produced of {s.target.toLocaleString()} target
              {' '}({s.achieved >= s.target ? 'on track' : `${s.target - s.achieved} pcs behind`})
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="module-actions">
          <button className="btn btn-outline" onClick={() => downloadCSV('production-report.csv', computed, columns)}>⬇ Download Report</button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c) => <th key={c.name}>{c.label}</th>)}</tr></thead>
          <tbody>
            {computed.length === 0 && <tr><td colSpan={columns.length} className="empty-row">No entries yet.</td></tr>}
            {computed.map((r) => (
              <tr key={r.id}>
                {columns.slice(0, -1).map((c) => <td key={c.name}>{r[c.name]}</td>)}
                <td style={{ color: r.ok ? '#34d399' : '#f87171' }}>{r.due}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CuttingReportView() {
  const { getData } = useData();
  const { isAdmin } = useRole();
  const rows = getData('cutting-production');

  const computed = rows.map((r) => {
    const target = Number(r.lay_qty || 0) * 10; // 10 pcs per lay, adjust to your real ratio
    const due = dueLabel(target, Number(r.quantity || 0));
    return { ...r, cutting_target: target, due: due.label, ok: due.ok };
  });

  const columns = [
    { name: 'date', label: 'Date' }, { name: 'employee', label: 'Employee' }, { name: 'style', label: 'Style' },
    { name: 'color', label: 'Color' }, { name: 'lay_qty', label: 'Lay' },
    { name: 'cutting_target', label: 'Cutting Target' }, { name: 'quantity', label: 'Cut Qty' }, { name: 'due', label: 'Due' },
  ];

  return (
    <div className="module">
      <div className="module-header"><h2>📄 Cutting Report</h2></div>
      {isAdmin && (
        <div className="module-actions">
          <button className="btn btn-outline" onClick={() => downloadCSV('cutting-report.csv', computed, columns)}>⬇ Download Report</button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c) => <th key={c.name}>{c.label}</th>)}</tr></thead>
          <tbody>
            {computed.length === 0 && <tr><td colSpan={columns.length} className="empty-row">No entries yet.</td></tr>}
            {computed.map((r) => (
              <tr key={r.id}>
                {columns.slice(0, -1).map((c) => <td key={c.name}>{r[c.name]}</td>)}
                <td style={{ color: r.ok ? '#34d399' : '#f87171' }}>{r.due}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FinishingReportView() {
  const { getData } = useData();
  const { isAdmin } = useRole();
  const rows = getData('finishing-production');

  const computed = rows.map((r) => {
    const target = targetForProcess(r.process);
    return { ...r, target };
  });

  const columns = [
    { name: 'employee', label: 'Worker Name' }, { name: 'date', label: 'Date' }, { name: 'style', label: 'Style' },
    { name: 'process', label: 'Process' }, { name: 'target', label: 'Target' }, { name: 'quantity', label: 'Output Quantity' },
  ];

  return (
    <div className="module">
      <div className="module-header"><h2>📄 Finishing Report</h2></div>
      {isAdmin && (
        <div className="module-actions">
          <button className="btn btn-outline" onClick={() => downloadCSV('finishing-report.csv', computed, columns)}>⬇ Download Report</button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c) => <th key={c.name}>{c.label}</th>)}</tr></thead>
          <tbody>
            {computed.length === 0 && <tr><td colSpan={columns.length} className="empty-row">No entries yet.</td></tr>}
            {computed.map((r) => (
              <tr key={r.id}>{columns.map((c) => <td key={c.name}>{r[c.name]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

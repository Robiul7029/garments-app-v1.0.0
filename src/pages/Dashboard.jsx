import React from 'react';
import { Link } from 'react-router-dom';
import { menu, modulePath } from '../config/menuConfig';
import { useData } from '../context/DataContext';

function pct(a, t) {
  return t === 0 ? 0 : Math.round((a / t) * 100);
}
function statusColor(p) {
  if (p >= 90) return '#34d399';
  if (p >= 75) return '#fbbf24';
  return '#f87171';
}

export default function Dashboard() {
  const { getData } = useData();
  const production = getData('daily-production');
  const totalTarget = production.reduce((s, r) => s + Number(r.target || 0), 0);
  const totalAchieved = production.reduce((s, r) => s + Number(r.quantity || 0), 0);
  const overallPct = pct(totalAchieved, totalTarget);
  const attendance = getData('daily-attendance');
  const absentCount = attendance.filter((r) => r.status === 'Absent').length;

  return (
    <div className="module">
      <div className="module-header"><h2>📊 Overview</h2></div>

      <div className="stat-grid">
        <StatCard label="Today's Target" value={totalTarget.toLocaleString()} />
        <StatCard label="Achieved" value={totalAchieved.toLocaleString()} accent={statusColor(overallPct)} />
        <StatCard label="Efficiency" value={`${overallPct}%`} accent={statusColor(overallPct)} />
        <StatCard label="Absent Today" value={absentCount} accent={absentCount > 0 ? '#f87171' : '#34d399'} />
      </div>

      <h3 className="section-sub">Departments</h3>
      <div className="cat-grid">
        {/* A category with no items would make `cat.items[0].key` throw and take the whole
            Dashboard down, so it is filtered out before the link is built. */}
        {menu
          .filter((cat) => Array.isArray(cat?.items) && cat.items.length > 0 && cat.items[0]?.key && cat.key)
          .map((cat) => (
          <Link key={cat.key} to={modulePath(cat.key, cat.items[0].key)} className="cat-card" style={{ borderTop: `3px solid ${cat.accent || '#334155'}` }}>
            <span className="cat-icon">{cat.icon}</span>
            <span>{cat.label}</span>
          </Link>
        ))}
        <Link to="/salary" className="cat-card">
          <span className="cat-icon">💰</span>
          <span>Salary</span>
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value" style={{ color: accent || '#e6e9ed' }}>{value}</div>
    </div>
  );
}

import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useData } from '../context/DataContext';
import { targetForProcess } from '../utils/calc';

export default function EmployeeTargetChart({ item }) {
  const { getData } = useData();
  const employees = getData('employees');
  const [selected, setSelected] = useState(employees[0] || '');

  const entries = useMemo(() => {
    const production = getData('daily-production');
    const finishing = getData('finishing-production');
    return [...production, ...finishing].filter((r) => r.employee === selected);
  }, [selected]);

  const dayWise = useMemo(() => {
    const byDate = {};
    entries.forEach((e) => {
      const t = targetForProcess(e.process);
      if (!byDate[e.date]) byDate[e.date] = { date: e.date, target: 0, actual: 0 };
      byDate[e.date].target += t;
      byDate[e.date].actual += Number(e.quantity || 0);
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [entries]);

  const monthTotal = dayWise.reduce((s, d) => ({ target: s.target + d.target, actual: s.actual + d.actual }), { target: 0, actual: 0 });

  return (
    <div className="module">
      <div className="module-header"><h2>🎯 Target vs Actual</h2></div>

      <label className="form-field" style={{ maxWidth: 260, marginBottom: 18 }}>
        <span>Employee</span>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {employees.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </label>

      {dayWise.length === 0 ? (
        <p className="hint">No production entries yet for {selected || 'this employee'}.</p>
      ) : (
        <>
          <div className="progress-stats" style={{ marginBottom: 16 }}>
            <div><span className="big-num">{monthTotal.target}</span><span className="stat-label">Monthly Target</span></div>
            <div><span className="big-num" style={{ color: monthTotal.actual >= monthTotal.target ? '#34d399' : '#fbbf24' }}>{monthTotal.actual}</span><span className="stat-label">Monthly Actual</span></div>
          </div>

          <div style={{ background: '#11161d', border: '1px solid #1c2530', borderRadius: 12, padding: '16px 8px' }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dayWise}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1c2530" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#5b6b7c', fontSize: 11 }} axisLine={{ stroke: '#1c2530' }} tickLine={false} />
                <YAxis tick={{ fill: '#5b6b7c', fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={{ background: '#171f29', border: '1px solid #263140', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="target" fill="#263140" name="Target" radius={[3, 3, 0, 0]} />
                <Bar dataKey="actual" fill="#a78bfa" name="Actual" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

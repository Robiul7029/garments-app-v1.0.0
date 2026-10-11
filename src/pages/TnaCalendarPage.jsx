import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';

/**
 * TNA Management → TNA Calendar.
 *
 * The Time & Action board: every milestone between order confirmation and
 * shipment, laid against the delivery date. Read as a month grid so a clash is
 * visible as a clash — two critical milestones on the same day, or a stage
 * sequenced after the shipment it feeds, is obvious here and invisible in a list.
 *
 * Reads from the same `tna-tasks` collection the Action Tasks table writes to, so
 * the two screens are two views of one set of rows rather than two datasets.
 */
const CRITICAL_HINT = 'Critical path — a slip here delays the shipment';

function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const dayKey = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export default function TnaCalendarPage({ category, item }) {
  const { getData } = useData();
  const tasks = getData('tna-tasks');

  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selectedDay, setSelectedDay] = useState(null);

  const cells = useMemo(() => monthMatrix(cursor.y, cursor.m), [cursor]);

  /** Tasks bucketed by their planned date, so a cell is one lookup. */
  const byDay = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      const key = String(t.planned_date || t.plannedDate || '').slice(0, 10);
      if (!key) return;
      (map[key] = map[key] || []).push(t);
    });
    return map;
  }, [tasks]);

  const monthTaskCount = useMemo(
    () => Object.entries(byDay)
      .filter(([k]) => k.startsWith(`${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`))
      .reduce((n, [, list]) => n + list.length, 0),
    [byDay, cursor],
  );

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  function shift(delta) {
    setSelectedDay(null);
    setCursor(({ y, m }) => {
      const next = new Date(y, m + delta, 1);
      return { y: next.getFullYear(), m: next.getMonth() };
    });
  }

  const selectedTasks = selectedDay ? (byDay[selectedDay] || []) : [];

  return (
    <div className="module">
      <div className="module-header">
        <div className="breadcrumb">{category.icon} {category.label}</div>
        <h2 style={{ margin: 0 }}>{item.icon} {item.label}</h2>
        <p className="hint" style={{ maxWidth: '76ch' }}>
          Milestones across the month, read straight from the TNA task list. A day with anything on it is
          marked; select a day to see what falls on it. Critical-path milestones are flagged 🔴.
        </p>
      </div>

      <div className="dp-recent-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-outline btn-sm" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <strong style={{ minWidth: 160, textAlign: 'center' }}>{monthLabel}</strong>
          <button className="btn btn-outline btn-sm" onClick={() => shift(1)} aria-label="Next month">›</button>
          <button className="btn btn-outline btn-sm" onClick={() => { setCursor({ y: today.getFullYear(), m: today.getMonth() }); setSelectedDay(null); }}>
            Today
          </button>
        </div>
        <span className="hint" style={{ margin: 0 }}>{monthTaskCount} milestone{monthTaskCount === 1 ? '' : 's'} this month</span>
      </div>

      <div className="tna-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="tna-dow">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} className="tna-cell tna-cell-blank" />;
          const key = dayKey(cursor.y, cursor.m, day);
          const list = byDay[key] || [];
          const isToday = key === dayKey(today.getFullYear(), today.getMonth(), today.getDate());
          const hasCritical = list.some((t) => t.isCritical || t.critical);
          return (
            <button
              key={key}
              type="button"
              className={`tna-cell${isToday ? ' tna-cell-today' : ''}${selectedDay === key ? ' tna-cell-selected' : ''}`}
              onClick={() => setSelectedDay(selectedDay === key ? null : key)}
            >
              <span className="tna-daynum">{day}</span>
              {list.slice(0, 3).map((t, n) => (
                <span key={n} className={`tna-chip${(t.isCritical || t.critical) ? ' tna-chip-critical' : ''}`} title={t.stage}>
                  {(t.isCritical || t.critical) ? '🔴 ' : ''}{t.stage}
                </span>
              ))}
              {list.length > 3 && <span className="tna-more">+{list.length - 3} more</span>}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <section className="dp-recent" style={{ marginTop: 18 }}>
          <h3 className="dp-recent-title">{selectedDay} — {selectedTasks.length} milestone{selectedTasks.length === 1 ? '' : 's'}</h3>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="dp-table">
              <thead>
                <tr><th>Stage</th><th>Order</th><th>Responsible</th><th>Status</th><th>Critical</th></tr>
              </thead>
              <tbody>
                {selectedTasks.length === 0 && (
                  <tr><td colSpan={5} className="empty-row">Nothing scheduled on this day.</td></tr>
                )}
                {selectedTasks.map((t, i) => (
                  <tr key={t.id ?? i}>
                    <td>{t.stage || '—'}</td>
                    <td className="mono-cell">{t.order_no || t.orderNo || '—'}</td>
                    <td>{t.responsible || '—'}</td>
                    <td>{t.status || 'Pending'}</td>
                    <td title={CRITICAL_HINT}>{(t.isCritical || t.critical) ? '🔴 Yes' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

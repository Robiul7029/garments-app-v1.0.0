import React, { useMemo, useState } from 'react';
import { useActivity } from '../context/ActivityContext';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadCSV } from '../utils/csv';
import { useNavigate } from 'react-router-dom';

const ACTION_ICON = { create: '➕', update: '✏️', delete: '🗑️', access: '🔐' };
const ACTION_LABEL = { create: 'Added', update: 'Updated', delete: 'Deleted', access: 'Access changed' };

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function formatStamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Every logged input, with a free-text search and Date / Month / Year filters. The three
// filters combine: picking a year and a month narrows to that month of that year.
export default function History() {
  const { entries } = useActivity();
  const { summarize } = useData();
  const { isAdmin } = useRole();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');

  // Only offer the years that actually appear in the log, newest first.
  const years = useMemo(() => {
    const found = new Set(entries.map((row) => String(row.date || '').slice(0, 4)).filter(Boolean));
    return [...found].sort((a, b) => b.localeCompare(a));
  }, [entries]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((row) => {
      const stamp = String(row.date || '');
      if (year && !stamp.startsWith(year)) return false;
      if (month && stamp.slice(0, 7) !== `${year || stamp.slice(0, 4)}-${month}`) return false;
      if (day && stamp.slice(0, 10) !== day) return false;
      if (!term) return true;
      const haystack = [
        row.actor,
        row.moduleLabel,
        row.categoryLabel,
        ACTION_LABEL[row.action] || row.action,
        summarize(row.action, row.key, row.entry || {}),
        row.actionRequired,
        JSON.stringify(row.entry || {}),
      ].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [entries, search, year, month, day, summarize]);

  function clearFilters() {
    setSearch('');
    setYear('');
    setMonth('');
    setDay('');
  }

  function exportRows() {
    downloadCSV(
      'history.csv',
      filtered.map((row) => ({
        date: row.date,
        time: formatStamp(row.date),
        actor: row.actor,
        action: ACTION_LABEL[row.action] || row.action,
        department: row.categoryLabel,
        module: row.moduleLabel,
        details: summarize(row.action, row.key, row.entry || {}),
        action_required: row.actionRequired,
        page: row.path,
      })),
      [
        { name: 'time', label: 'Date & Time' },
        { name: 'actor', label: 'Entered By' },
        { name: 'action', label: 'Action' },
        { name: 'department', label: 'Department' },
        { name: 'module', label: 'Screen' },
        { name: 'details', label: 'Data Entered' },
        { name: 'action_required', label: 'Action Required' },
        { name: 'page', label: 'Page' },
      ]
    );
  }

  return (
    <section className="settings-page">
      <div className="settings-header">
        <button className="btn btn-outline" onClick={() => navigate(-1)}>← Back</button>
        <h2>History</h2>
      </div>

      <div className="settings-panel history-filters">
        <label className="form-field history-search">
          <span>Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by person, screen, action or any value…"
          />
        </label>
        <label className="form-field">
          <span>Year</span>
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            <option value="">All years</option>
            {years.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>Month</span>
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            <option value="">All months</option>
            {MONTH_NAMES.map((name, index) => {
              const value = String(index + 1).padStart(2, '0');
              return <option key={value} value={value}>{name}</option>;
            })}
          </select>
        </label>
        <label className="form-field">
          <span>Date</span>
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        <div className="settings-actions history-filter-actions">
          <button type="button" className="btn btn-outline" onClick={clearFilters}>Clear filters</button>
          {isAdmin && <button type="button" className="btn btn-primary" onClick={exportRows}>⬇ Download</button>}
        </div>
      </div>

      <div className="settings-panel">
        <p className="hint">
          {filtered.length} of {entries.length} record{entries.length === 1 ? '' : 's'} shown.
        </p>
        {filtered.length === 0 ? (
          <p className="empty-row">No records match these filters.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date &amp; Time</th>
                  <th>Entered By</th>
                  <th>Action</th>
                  <th>Screen</th>
                  <th>Data Entered</th>
                  <th>Action Required</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td className="mono-cell">{formatStamp(row.date)}</td>
                    <td>{row.actor}</td>
                    <td>{ACTION_ICON[row.action] || '🔔'} {ACTION_LABEL[row.action] || row.action}</td>
                    <td>{row.moduleIcon} {row.moduleLabel}<br /><small className="hint">{row.categoryLabel}</small></td>
                    <td>{summarize(row.action, row.key, row.entry || {})}</td>
                    <td>{row.actionRequired || '—'}</td>
                    <td><button className="btn btn-outline" onClick={() => navigate(row.path || '/')}>Go</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

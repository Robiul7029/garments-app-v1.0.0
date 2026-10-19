import { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { downloadCSV } from '../utils/csv';
import { COLLECTIONS, ORDER_FIELDS, orderValue, colorsOf, sizesOf } from '../config/orderWorkflow';

/**
 * The Order List tab — every saved order, READ ONLY.
 *
 * This is the order book: one row per order raised on the Order Input tab, with
 * a search box, a month filter and a CSV export. It has no add form and no row
 * actions on purpose — orders are raised, amended and deleted on the Order Input
 * tab (which has its own Actions column), and a second editing surface here would
 * be a second place for the sequential validation and the duplicate-style guard
 * to disagree with the first.
 *
 * LIVE BY CONSTRUCTION. Rows are read straight from `useData()`, the same store
 * the Order Input tab writes to via `addEntry` / `updateEntry` / `deleteEntry`.
 * There is no local copy and no effect that syncs one into the other, so an order
 * raised, edited or deleted on the Order Input tab appears — or vanishes — here on
 * the same render. There is no state that could fall out of step, because there is
 * only one state. That is what "full sync" costs: nothing, as long as no cache is
 * introduced later.
 *
 * It deliberately does NOT reuse DataModule's generic table. That table is
 * built around add/edit/delete — a form, a store keyed by the config, and an
 * Actions column — and every part of it would then have to be switched off. The
 * two multi-value fields also need real chips rather than the raw "Navy, Black"
 * string the generic table prints.
 */

/** The columns to show, in order, from the order model itself. */
const COLUMNS = ORDER_FIELDS.map((f) => ({ name: f.name, label: f.label, type: f.type }));

/** The month key ("2026-10") for a stored date, or '' when there is none. */
function monthKeyOf(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : '';
}

/** The month name for a "2026-01" key, e.g. "January". */
function monthName(key) {
  const m = Number(String(key).slice(5, 7));
  if (!m || m < 1 || m > 12) return key;
  return new Date(2000, m - 1, 1).toLocaleString('en-GB', { month: 'long' });
}

export default function OrderListTable() {
  const { getData } = useData();
  const rows = getData(COLLECTIONS.ORDERS);

  const [query, setQuery] = useState('');
  const [month, setMonth] = useState('all');

  // The filter offers the FULL calendar — all 12 months of the year currently in
  // view — rather than only the months that already have orders behind them. A
  // filter that hides the empty months cannot answer "were there no orders in
  // March, or did I fail to look?", which is exactly what an order book is
  // checked for.
  //
  // The year shown is the current one, unless the newest order belongs to a later
  // year (rare, but a forward-dated order must not become unreachable). "All
  // months" is the DEFAULT selection, so opening the tab shows the whole book.
  const year = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const newest = rows
      .map((r) => monthKeyOf(r.order_date) || monthKeyOf(r.ship_date))
      .filter(Boolean)
      .sort()
      .pop();
    const newestYear = newest ? Number(newest.slice(0, 4)) : 0;
    return Math.max(currentYear, newestYear || 0);
  }, [rows]);

  // January → December of that year, as "2026-01" keys, so the dropdown is always
  // all twelve months in calendar order.
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`),
    [year],
  );

  // Search matches any visible value, so typing a buyer, a style or a PO number
  // all work without the user choosing a field first — on an order book that is
  // the question being asked ("where is STY-1003?"), and a field selector would
  // just be a step in the way. `orderValue` follows each field's legacy alias so
  // a row saved by the old screen is still searchable by its own values.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (month !== 'all') {
        const key = monthKeyOf(row.order_date) || monthKeyOf(row.ship_date);
        if (key !== month) return false;
      }
      if (!q) return true;
      return COLUMNS.some((c) => String(orderValue(row, c.name) ?? '').toLowerCase().includes(q));
    });
  }, [rows, query, month]);

  function exportCsv() {
    downloadCSV(
      `order-list${month === 'all' ? '' : `-${month}`}.csv`,
      filtered,
      COLUMNS.map((c) => ({ name: c.name, label: c.label })),
    );
  }

  return (
    <div className="oi-list">
      {/* Search sits top-right, above the table. */}
      <div className="oi-list-bar">
        <span className="oi-list-count">
          {filtered.length === rows.length
            ? `${rows.length} order${rows.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${rows.length} orders`}
        </span>
        <div className="oi-search">
          <span className="oi-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            className="oi-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search buyer, style, order no…"
            aria-label="Search orders"
          />
          {query && (
            <button
              type="button"
              className="oi-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="table-wrap">
        <table className="dp-table oi-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => <th key={c.name}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="empty-row">
                  No orders yet — raise one on the Order Input tab and it appears here immediately.
                </td>
              </tr>
            )}
            {rows.length > 0 && filtered.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="empty-row">
                  No orders match this search or month.
                </td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr key={row.id}>
                {COLUMNS.map((c) => (
                  <td key={c.name} className={c.type === 'number' ? 'mono-cell' : undefined}>
                    <CellValue field={c} row={row} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer: the monthly filter and the download sit together, bottom-right,
          so the export is clearly about the rows currently in view. */}
      <div className="oi-list-foot">
        <label className="oi-month">
          <span>Month</span>
          <select
            className="erp-select oi-month-select"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Filter by month for the report"
          >
            <option value="all">All Months</option>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-outline" onClick={exportCsv}>
          ⬇ Download Report
        </button>
      </div>
    </div>
  );
}

/**
 * One cell. The two multi-value fields render as chips — the raw stored string
 * is a CSV, and printing "Navy, Black, Red" in a cell reads as one long word
 * rather than as three colours.
 */
function CellValue({ field, row }) {
  const value = orderValue(row, field.name);

  if (field.type === 'color-tags' || field.type === 'size-multi') {
    const parts = field.type === 'color-tags' ? colorsOf(row) : sizesOf(row);
    if (parts.length === 0) return '—';
    const tone = field.type === 'size-multi' ? ' mv-chip-size' : '';
    return (
      <span className="mv-cell">
        {parts.map((p) => <span key={p} className={`mv-chip${tone}`}>{p}</span>)}
      </span>
    );
  }

  if (value === undefined || value === null || String(value).trim() === '') return '—';
  return String(value);
}

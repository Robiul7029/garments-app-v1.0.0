import { useMemo, useState } from 'react';
import { LoadingState, ErrorState, EmptyState, StatCard } from '../../../components/erp/Primitives';
import { RankedBarCard, ChartStatCard, formatNumber } from '../../../components/erp/Charts';
import { toNumber } from '../../../utils/erpCalculations';
import { formatShort } from '../../../utils/erpDashboard';
import { useErpSources, useErpOverview, useToday } from '../../../components/erp/useErpOverview';

/**
 * ROBIUL GARMENTS ERP — Inventory & Stock.
 *
 * Three things a storekeeper actually opens this screen for:
 *
 *   1. the stock graph    — every item's balance against its own minimum
 *   2. low-stock alerts   — the subset that has tripped its threshold
 *   3. the item ledger    — the individual movements behind those balances
 *
 * Stock is NEVER a stored counter on the item. It is the sum of the ledger, and
 * the balance here is recomputed from movement rows every time, so the ledger
 * and the on-hand figure cannot disagree — which is the whole reason the ledger
 * exists. `summariseStock` is the same function the Management Dashboard uses.
 *
 * NOTE — this is a working, read-only first cut. Still missing: issuing and
 * receiving stock, the GRN (goods-received) side, inter-store transfers, and CSV
 * export. Those are the storekeeper's write screens, and they belong with the
 * procurement work of the next phase.
 */
export default function InventoryStock() {
  const today = useToday();
  const { loading, error, erp } = useErpSources();
  const data = useErpOverview(today);

  if (loading && data.stock.byItem.length === 0) {
    return <LoadingState label="Loading the stock ledger…" rows={4} />;
  }
  if (error && data.stock.byItem.length === 0) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="erp-page">
      <header className="erp-page-header">
        <div>
          <h1 className="erp-page-title">🏬 Inventory &amp; Stock</h1>
          <p className="erp-page-description">
            {formatNumber(data.stock.byItem.length)} items ·{' '}
            {formatNumber(data.stock.totalQty)} units on hand · balances derived from the movement ledger.
          </p>
        </div>
      </header>

      <StockKpis stock={data.stock} />
      <StockGraphs stock={data.stock} />

      <div className="erp-split">
        <LowStockAlerts stock={data.stock} trend={data.kpiTrend.lowStock} days={data.trend.days} />
        <ItemLedger ledger={data.stockRows} items={data.items} erp={erp} />
      </div>
    </div>
  );
}

/** ---- headline figures ---- */
function StockKpis({ stock }) {
  const critical = stock.low.filter((r) => r.level === 'critical').length;
  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">Stock position</h2>
      <div className="erp-stat-grid">
        <StatCard label="Items tracked" value={formatNumber(stock.byItem.length)} icon="🏷️" />
        <StatCard label="Units on hand" value={formatNumber(stock.totalQty)} icon="📦" />
        <ChartStatCard
          label="Stock value"
          value={formatNumber(Math.round(stock.totalValue))}
          icon="💰"
          hint="Quantity × unit cost"
        />
        <StatCard
          label="Below minimum"
          value={formatNumber(stock.low.length)}
          level={critical > 0 ? 'critical' : stock.low.length ? 'warning' : 'good'}
          icon="⚠️"
          hint={critical > 0 ? `${critical} critical` : 'None critical'}
        />
      </div>
    </section>
  );
}

/** ---- 1. the stock graph ---- */
function StockGraphs({ stock }) {
  /** Longest bars first: the items holding the most stock, by quantity. */
  const byQuantity = useMemo(() => (
    [...stock.byItem]
      .sort((a, b) => b.value - a.value)
      .slice(0, 12)
      .map((r) => ({
        id: r.id,
        label: r.label,
        icon: r.icon,
        value: r.value,
        level: r.level,
        hint: r.hint || undefined,
      }))
  ), [stock.byItem]);

  return (
    <div className="erp-split">
      <RankedBarCard
        title="Stock on hand"
        icon="📦"
        data={byQuantity}
        // The bar's own unit varies per item (kg, mtr, pcs), so a single axis
        // label would be a lie. Each row prints its item's unit in the label.
        unit=""
        emptyMessage="No stock recorded yet — stock appears with the first goods receipt or issue."
      />
      <RankedBarCard
        title="Items below minimum"
        icon="🚨"
        data={stock.low.map((r) => ({
          id: r.id,
          label: r.label,
          icon: r.icon,
          value: r.value,
          level: r.level,
          hint: r.hint || 'At or below minimum',
        }))}
        unit=""
        emptyMessage="Every item is above its minimum — no reorder is due today."
      />
    </div>
  );
}

/**
 * A seven-day shape of the low-stock count, drawn as a small bar strip.
 * Shows whether the store is getting worse or recovering — a single number
 * cannot tell you that, and it is the reason to look at this panel twice.
 */
function LowStockSpark({ trend, days }) {
  if (!trend?.length || trend.every((v) => v === 0)) return null;
  const peak = trend.reduce((m, v) => Math.max(m, v), 0);
  return (
    <div className="erp-spark-row" style={{ marginBottom: 12 }}>
      <span className="erp-spark" role="img" aria-label={`Low-stock items over the last 7 days: ${trend.join(', ')}`}>
        {trend.map((v, i) => (
          <span
            key={i}
            title={`${days[i]}: ${v} item${v === 1 ? '' : 's'} below minimum`}
            className={`erp-spark-bar${i === trend.length - 1 ? ' erp-spark-bar-last' : ''}`}
            style={{ height: `${peak > 0 ? Math.max(8, (v / peak) * 100) : 8}%` }}
          />
        ))}
      </span>
      <span className="erp-hint">Last 7 days</span>
    </div>
  );
}

/** ---- 2. low-stock alerts ---- */
function LowStockAlerts({ stock, trend, days }) {
  if (stock.low.length === 0) {
    return (
      <section className="erp-panel">
        <h2 className="erp-panel-title">Low-stock alerts</h2>
        <LowStockSpark trend={trend} days={days} />
        <EmptyState
          icon="✅"
          title="No item is below its minimum"
          message="When an item falls to or below the minimum set on the item master, it is listed here."
        />
      </section>
    );
  }

  const critical = stock.low.filter((r) => r.level === 'critical');

  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Low-stock alerts
        <span className="erp-count-chip erp-chip-warning">{stock.low.length}</span>
        {critical.length > 0 && <span className="erp-count-chip erp-chip-critical">{critical.length} critical</span>}
      </h2>
      <LowStockSpark trend={trend} days={days} />
      <ul className="erp-alert-list">
        {stock.low.slice(0, 12).map((item) => (
          <li key={item.id} className={`erp-alert erp-alert-${item.level === 'critical' ? 'critical' : 'warning'}`}>
            <div className="erp-alert-head">
              <div className="erp-alert-title">{item.icon} {item.label}</div>
              <span className={`erp-badge erp-badge-${item.level === 'critical' ? 'danger' : 'warning'}`}>
                {item.level === 'critical' ? 'At or below minimum' : 'Running low'}
              </span>
            </div>
            <div className="erp-alert-message">
              {formatNumber(item.value)}{item.unit ? ` ${item.unit}` : ''} on hand
              {item.minQty > 0 ? ` · minimum ${formatNumber(item.minQty)}` : ''}
              {item.minQty > 0 && item.value < item.minQty
                ? ` · short by ${formatNumber(item.minQty - item.value)}`
                : ''}
            </div>
          </li>
        ))}
      </ul>
      {stock.low.length > 12 && (
        <p className="erp-panel-foot">Showing the 12 most urgent of {stock.low.length} low items.</p>
      )}
    </section>
  );
}

/** ---- 3. the item ledger ---- */
function ItemLedger({ ledger, items, erp }) {
  const [itemFilter, setItemFilter] = useState('all');

  const itemNames = useMemo(() => {
    const map = {};
    items.forEach((i) => { map[i.id] = i.name || i.itemCode || i.id; });
    return map;
  }, [items]);

  const storeNames = useMemo(() => {
    const map = {};
    erp.rows('stores').forEach((s) => { map[s.id] = s.name || s.id; });
    return map;
  }, [erp]);

  /** Items that actually have movements, so the filter never lists empty items. */
  const usedItems = useMemo(() => {
    const seen = new Set();
    ledger.forEach((e) => { if (e?.itemId) seen.add(e.itemId); });
    return [...seen]
      .map((id) => ({ id, name: itemNames[id] || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ledger, itemNames]);

  const rows = useMemo(() => {
    const filtered = itemFilter === 'all' ? ledger : ledger.filter((e) => e.itemId === itemFilter);
    // Newest movement first — the ledger is read backwards from today.
    return [...filtered].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [ledger, itemFilter]);

  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Item ledger
        <span className="erp-panel-sub">{formatNumber(rows.length)} movements</span>
      </h2>

      {ledger.length === 0 ? (
        <EmptyState
          icon="📒"
          title="No stock movements yet"
          message="Every goods receipt, issue, return and adjustment is recorded here — the balances above are the running total."
        />
      ) : (
        <>
          <div className="erp-filter-bar">
            <select
              className="erp-select"
              value={itemFilter}
              onChange={(e) => setItemFilter(e.target.value)}
              aria-label="Filter the ledger by item"
            >
              <option value="all">All items ({usedItems.length})</option>
              {usedItems.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>

          <div className="erp-table-wrap">
            <table className="erp-table erp-table-compact">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>Type</th>
                  <th align="right">In</th>
                  <th align="right">Out</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((entry, i) => {
                  const type = String(entry.type || '');
                  const isIn = toNumber(entry.qtyIn) > 0;
                  return (
                    <tr key={entry.id || `${entry.itemId}-${entry.date}-${i}`}>
                      <td className="erp-mono">{entry.date ? formatShort(entry.date) : '—'}</td>
                      <td className="erp-strong" title={itemNames[entry.itemId] || entry.itemId}>
                        {itemNames[entry.itemId] || entry.itemId || '—'}
                      </td>
                      <td>
                        <span className={`erp-badge erp-badge-${isIn ? 'success' : 'warning'}`}>
                          {type || '—'}
                        </span>
                      </td>
                      <td align="right" className="erp-mono">
                        {toNumber(entry.qtyIn) > 0 ? `+${formatNumber(entry.qtyIn)}` : '—'}
                      </td>
                      <td align="right" className="erp-mono">
                        {toNumber(entry.qtyOut) > 0 ? `−${formatNumber(entry.qtyOut)}` : '—'}
                      </td>
                      <td title={storeNames[entry.storeId] || ''}>
                        {entry.reference || storeNames[entry.storeId] || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rows.length > 40 && (
            <p className="erp-panel-foot">
              Showing the 40 most recent of {formatNumber(rows.length)} movements — export the full ledger from Reports.
            </p>
          )}
        </>
      )}
    </section>
  );
}

import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { MODULE } from '../../../config/erpRoles';
import { evaluateAllRules, syncAlerts, THRESHOLDS } from '../../../services/alertService';
import { LoadingState, ErrorState, EmptyState } from '../../../components/erp/Primitives';
import {
  RgeBarChart, RgeRankedBars, RgeFlowChart, RgeDonut,
  RgeGauge, RgeStackedBars, RgeGroupedBars, formatNumber,
} from '../../../components/erp/RgeCharts';
import { erpModulePath } from '../../../config/erpMenu';
import { formatShort } from '../../../utils/erpDashboard';
import {
  useErpDashboardModel, FLOW_COLORS, dayKey,
} from '../../../components/erp/useErpDashboardModel';

/**
 * ROBIUL GARMENTS ERP — Overview / Dashboard.
 *
 * The dashboard design, bound to the live ERP data rather than to mock values:
 *
 *   1. Key Performance Indicators — Active Orders, Production Efficiency (dial),
 *      Current Inventory Value
 *   2. Production Status (stacked bars) + Order Management (compact table)
 *   3. Inventory Overview (grouped bars) + the low-stock list
 *   4. Production Flow, quality, alerts and the trend charts below the fold
 *
 * On data: nothing here is invented. Every figure comes from the collections the
 * signed-in role may read, through `useErpDashboardModel`. A role with no store
 * access sees "not available to your role" where stock would be, rather than a
 * plausible-looking zero — a fabricated inventory value in a factory app is
 * worse than a blank one, because somebody would order against it.
 *
 * Two panels from the reference mock are deliberately absent:
 *
 *   - Sales Analytics — there is no sales, invoice or revenue collection in this
 *     schema (`invoiceNo` is a text field on a PO). A sales chart could only be
 *     drawn from invented numbers, so it is omitted until that data exists.
 *   - "Customer" on the order table is the buyer. The schema stores buyers, not
 *     a separate customer entity, and the PO already links to one.
 */
export default function ErpDashboard() {
  const today = dayKey(new Date());
  const model = useErpDashboardModel(today);
  const [note, setNote] = useState(null);

  const { loading, error, liveCounts, totals, stock, quality, orderStats } = model;

  const runRules = useCallback(async () => {
    setNote({ kind: 'info', message: 'Evaluating business rules…' });
    const descriptors = evaluateAllRules({
      today: new Date(today),
      items: model.items,
      stockLedger: model.stockRows,
    });
    const result = await syncAlerts(descriptors);
    setNote(result.error
      ? { kind: 'error', message: result.error }
      : { kind: 'success', message: `Alerts updated — ${result.raised} raised, ${result.resolved} resolved.` });
  }, [today, model.items, model.stockRows]);

  if (loading && liveCounts.production === 0 && liveCounts.lines === 0) {
    return <LoadingState label="Loading today's factory picture…" rows={5} />;
  }
  if (error && liveCounts.production === 0) {
    return <ErrorState message={error} onRetry={runRules} retryLabel="Re-run business rules" />;
  }

  return (
    <div className="rge-dash">
      <header className="rge-dash-head">
        <div>
          <h1 className="rge-dash-title">Dashboard</h1>
          <p className="rge-dash-sub">
            Single Factory • English • Production Management • {formatDay(today)}
          </p>
        </div>
        <div className="rge-dash-actions">
          <button type="button" className="rge-btn rge-btn-secondary" onClick={runRules}>
            🔔 Run alert rules
          </button>
          <Link className="rge-btn rge-btn-primary" to={erpModulePath(MODULE.REPORTS)}>
            Open reports
          </Link>
        </div>
      </header>

      {note && (
        <div className={`rge-note rge-note-${note.kind === 'error' ? 'error' : 'success'}`} role="status">
          {note.message}
        </div>
      )}

      {/* ============ 1. KEY PERFORMANCE INDICATORS ============ */}
      <section className="rge-section">
        <h2 className="rge-section-title">Key Performance Indicators</h2>
        <div className="rge-kpi-row">
          <div className="rge-card rge-kpi-panel">
            <div className="rge-kpi-label">Active Orders</div>
            <div className="rge-kpi-value">{formatNumber(orderStats.pending)}</div>
            <TrendNote trend={model.kpiTrend.delayed} label="Trend" />
          </div>

          <div className="rge-card rge-kpi-panel">
            <div className="rge-kpi-label">Production Efficiency</div>
            <RgeGauge
              value={totals.efficiency}
              label="Production efficiency"
              level={totals.efficiency >= 85 ? 'good' : totals.efficiency >= 70 ? 'warning' : 'critical'}
            />
          </div>

          <div className="rge-card rge-kpi-panel">
            <div className="rge-kpi-label">Current Inventory Value</div>
            <div className="rge-kpi-value">
              {model.canInventory ? formatMoney(stock.totalValue) : '—'}
            </div>
            {model.canInventory && (
              <div
                className="rge-bar rge-bar-good"
                style={{ marginTop: 12 }}
                role="img"
                aria-label={`Stock value ${formatMoney(stock.totalValue)} of ${formatMoney(model.inventoryValueCeiling)}`}
              >
                <span style={{ width: `${model.inventoryValuePercent}%` }} />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ 2. PRODUCTION STATUS + ORDER MANAGEMENT ============ */}
      <section className="rge-section rge-cols">
        <div className="rge-card">
          <h2 className="rge-card-title">
            Production Status
            <span className="rge-card-sub">today, by line</span>
          </h2>
          <RgeStackedBars
            rows={model.productionStatus}
            series={[
              { key: 'target', label: 'Target', color: '#1e3a5f' },
              { key: 'actual', label: 'Actual', color: '#5b8fc9' },
              { key: 'rework', label: 'Rework', color: '#f59e0b' },
              { key: 'reject', label: 'Reject', color: '#c53030' },
            ]}
            emptyMessage="No production recorded yet today."
          />
        </div>

        <div className="rge-card">
          <h2 className="rge-card-title">Order Management</h2>
          <OrderMiniTable rows={model.orderTable} />
        </div>
      </section>

      {/* ============ 3. INVENTORY OVERVIEW ============ */}
      <section className="rge-section rge-cols-even">
        <div className="rge-card">
          <h2 className="rge-card-title">
            Inventory Overview
            <span className="rge-card-sub">stock against minimum</span>
          </h2>
          {!model.canInventory ? (
            <p className="rge-empty">Your role does not include the store, so stock is not shown.</p>
          ) : (
            <RgeGroupedBars
              rows={model.inventoryChart}
              series={[
                { key: 'onHand', label: 'On hand', color: '#1e3a5f' },
                { key: 'min', label: 'Minimum', color: '#8fb8dd' },
              ]}
              emptyMessage="No stock movements recorded yet."
            />
          )}
        </div>

        <div className="rge-card">
          <h2 className="rge-card-title">
            Low-stock items
            {stock.low.length > 0 && (
              <span className="rge-badge rge-badge-warning">{stock.low.length}</span>
            )}
          </h2>
          {!model.canInventory ? (
            <p className="rge-empty">Store not available to your role.</p>
          ) : stock.low.length === 0 ? (
            <p className="rge-empty">Every item is above its minimum. No reorder is due today.</p>
          ) : (
            <ul className="rge-ranked">
              {stock.low.slice(0, 7).map((item) => (
                <li key={item.id}>
                  <div className="rge-ranked-head">
                    <span className="rge-ranked-label" title={item.label}>
                      {item.icon} {item.label}
                    </span>
                    <span className={`rge-ranked-value rge-level-${item.level}`}>
                      {formatNumber(item.value)}{item.unit ? ` ${item.unit}` : ''}
                    </span>
                  </div>
                  <div className="rge-ranked-hint">{item.hint || 'At or below minimum'}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ============ 4. PRODUCTION FLOW + TREND ============ */}
      <section className="rge-section rge-cols">
        <div className="rge-card">
          <h2 className="rge-card-title">
            Target vs Actual by line
            <span className="rge-card-sub">today</span>
          </h2>
          <RgeBarChart
            data={model.lineChartData}
            series={[
              { key: 'target', label: 'Target', color: '#94a3b8' },
              { key: 'actual', label: 'Actual', color: '#38bdf8' },
            ]}
            emptyMessage="No production entered today — the chart fills in with the first hour recorded."
          />
        </div>

        <div className="rge-card">
          <h2 className="rge-card-title">Production Flow</h2>
          <RgeFlowChart stages={model.flow} colors={FLOW_COLORS} />
        </div>
      </section>

      {/* ============ 5. ORDER STATUS + QUALITY + ALERTS ============ */}
      <section className="rge-section rge-grid-3">
        <div className="rge-card">
          <h2 className="rge-card-title">Order Status</h2>
          <RgeDonut
            data={model.orderDonut}
            centerLabel="Purchase orders"
            emptyMessage="No orders to summarise yet."
          />
        </div>

        <div className="rge-card">
          <h2 className="rge-card-title">Quality Today</h2>
          <RgeRankedBars
            data={[
              { id: 'checked', label: 'Checked', value: quality.checked, unit: 'pcs', level: 'info' },
              { id: 'passed', label: 'Passed', value: quality.passed, unit: 'pcs', level: 'good' },
              { id: 'rework', label: 'Rework', value: quality.rework, unit: 'pcs', level: quality.rework > 0 ? 'warning' : 'good' },
              { id: 'reject', label: 'Reject', value: quality.reject, unit: 'pcs', level: qualityLevel(quality.rejectPct) },
            ]}
            emptyMessage="No QC recorded today."
          />
          <p className="rge-ranked-hint" style={{ marginTop: 12 }}>
            DHU {quality.dhu.toFixed(2)} · Reject {quality.rejectPct.toFixed(1)}% of checked
          </p>
        </div>

        <div className="rge-card">
          <h2 className="rge-card-title">
            Alert Center
            {model.alertSummary.critical > 0 && (
              <span className="rge-badge rge-badge-critical">{model.alertSummary.critical} critical</span>
            )}
            {model.alertSummary.warning > 0 && (
              <span className="rge-badge rge-badge-warning">{model.alertSummary.warning} warning</span>
            )}
          </h2>
          {model.topAlerts.length === 0 ? (
            <p className="rge-empty">No active alerts — every rule is currently satisfied.</p>
          ) : (
            <ul className="rge-ranked">
              {model.topAlerts.slice(0, 5).map((alert) => (
                <li key={alert.id}>
                  <div className="rge-ranked-head">
                    <span className="rge-ranked-label" title={alert.title}>{alert.title}</span>
                    <span className={`rge-badge rge-badge-${alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'info'}`}>
                      {alert.severity}
                    </span>
                  </div>
                  <div className="rge-ranked-hint">{alert.message}</div>
                </li>
              ))}
            </ul>
          )}
          <Link className="rge-ranked-hint" style={{ display: 'inline-block', marginTop: 12 }} to={erpModulePath(MODULE.ALERTS)}>
            Open Alert Center →
          </Link>
        </div>
      </section>

      {!model.canInventory && (
        <p className="rge-ranked-hint" style={{ marginTop: 16 }}>
          Stock figures are hidden because your role does not include the store.
        </p>
      )}
    </div>
  );
}

/* ---- pieces ---------------------------------------------------------------- */

/**
 * The "Trend ↗ 100%" note beside Active Orders.
 *
 * Hidden when there is no usable history. An arrow drawn from a single point,
 * or from a zero baseline, would report a percentage move that never happened —
 * and a trend is exactly the kind of number someone makes a decision on.
 */
function TrendNote({ trend = [], label }) {
  const values = trend.map((v) => Number(v) || 0);
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0) return null;
  const delta = Math.round(((last - first) / Math.abs(first)) * 100);
  const up = delta >= 0;
  return (
    <div className="rge-trend-note">
      <span className="rge-trend-note-label">{label}</span>
      <span className={`rge-trend-note-value ${up ? 'is-up' : 'is-down'}`}>
        {up ? '↗' : '↘'} {Math.abs(delta)}%
      </span>
    </div>
  );
}

/**
 * The compact order table for the dashboard.
 *
 * Not the full pipeline table the Orders screen owns: it carries only the
 * columns this design shows and links through, rather than pretending the home
 * page is where orders are managed.
 */
function OrderMiniTable({ rows = [] }) {
  if (rows.length === 0) {
    return <p className="rge-empty">No purchase orders yet.</p>;
  }
  const shown = rows.slice(0, 6);
  return (
    <>
      <div className="rge-table-wrap">
        <table className="rge-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>Style</th>
              <th className="rge-num">Quantity</th>
              <th>Status</th>
              <th>Delivery Date</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                <td className="rge-mono">{row.po}</td>
                <td>{row.buyer}</td>
                <td>{row.style}</td>
                <td className="rge-num">{formatNumber(row.qty)}</td>
                <td>
                  <span className={`rge-status-pill rge-status-${pillTone(row)}`}>{row.status}</span>
                </td>
                <td className="rge-mono">{row.delivery ? formatShort(row.delivery) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link className="rge-panel-link" to={erpModulePath(MODULE.ORDERS)}>
        Showing {shown.length} of {rows.length} — open Order Management →
      </Link>
    </>
  );
}

/* ---- helpers --------------------------------------------------------------- */

/** A PO's pill tone. An overdue PO outranks whatever its status field claims. */
function pillTone(row) {
  if (row.overdue) return 'late';
  const s = String(row.status || '').toLowerCase();
  if (/(shipped|completed|closed|done)/.test(s)) return 'done';
  if (/(production|progress|partial)/.test(s)) return 'active';
  return 'pending';
}

/** QC reject % → a level, using the same limit the alert rules use. */
function qualityLevel(rejectPct) {
  if (rejectPct > THRESHOLDS.qcRejectLimitPercent) return 'critical';
  if (rejectPct > THRESHOLDS.qcRejectLimitPercent / 2) return 'warning';
  return 'good';
}

/** Money for a management figure: grouped, with no decimals on a whole number. */
function formatMoney(value) {
  const n = Number(value) || 0;
  return `৳${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDay(key) {
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

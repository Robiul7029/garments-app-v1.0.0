import { useMemo, useState } from 'react';
import { useErpData } from '../../../context/ErpDataContext';
import { usePermissions } from '../../../context/PermissionContext';
import { MODULE } from '../../../config/erpRoles';
import { C, ORDER_STATUS } from '../../../config/erpSchema';
import { LoadingState, ErrorState, EmptyState, StatusBadge, StatCard } from '../../../components/erp/Primitives';
import { DonutChartCard, RankedBarCard, formatNumber } from '../../../components/erp/Charts';
import { formatShort } from '../../../utils/erpDashboard';
import { useErpSources, useErpOverview, useToday } from '../../../components/erp/useErpOverview';

/**
 * ROBIUL GARMENTS ERP — Order Management.
 *
 * Purchase orders with delivery status and progress, in three bands:
 *
 *   1. the KPI row     — how many POs, how much quantity, what is late
 *   2. the status chart — the same orders split four ways, plus the buyers
 *   3. the order table  — one row per PO, most urgent first
 *
 * The rows and the statistics come from `useErpOverview`, the same hook the
 * Management Dashboard uses, so a PO shown as "3d late" here is the same PO the
 * dashboard counted as overdue. There is deliberately no second implementation
 * of the overdue rule.
 *
 * NOTE — this is a working, read-only first cut, not the finished module. What
 * is still missing is everything that WRITES: raising a PO, amending a quantity,
 * booking a shipment against it. Those need the order-entry forms and belong to
 * the next phase; the read model below is complete and correct meanwhile.
 */
export default function OrderManagement() {
  const today = useToday();
  const { loading, error } = useErpSources();
  const data = useErpOverview(today);
  const erp = useErpData();
  // Role-based UI trigger: the per-row "Manual status" control is an EDIT, so it
  // is only offered to a role that holds the edit action on Order Management. A
  // View-Only general user gets the full order table and the KPI/chart summary
  // without that column — read access is unchanged.
  const permissions = usePermissions();
  const canManageOrders = permissions.canEdit(MODULE.ORDERS);

  async function updateOrderStatus(row, status) {
    const result = await erp.save(C.PURCHASE_ORDERS, { status, manualStatusOverride: true }, { id: row.id, module: MODULE.ORDERS });
    if (!result.ok) window.alert(result.error || 'Could not update the order status.');
  }

  if (loading && data.orderRows.length === 0) {
    return <LoadingState label="Loading purchase orders…" rows={4} />;
  }
  // A failure that left nothing on screen is an error; one that left stale rows
  // is not, because the table below is still worth reading.
  if (error && data.orderRows.length === 0) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="erp-page">
      <header className="erp-page-header">
        <div>
          <h1 className="erp-page-title">📑 Order Management</h1>
          <p className="erp-page-description">
            {data.orderStats.total} purchase order{data.orderStats.total === 1 ? '' : 's'} ·{' '}
            {formatNumber(data.orderStats.quantity)} pcs ordered · most urgent first.
          </p>
        </div>
      </header>

      <OrderKpis stats={data.orderStats} />
      <OrderCharts data={data} />
      <OrderTable rows={data.orderRows} canManageOrders={canManageOrders} onStatusChange={updateOrderStatus} />
    </div>
  );
}

/** ---- 1. the KPI row ---- */
function OrderKpis({ stats }) {
  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">Order book</h2>
      <div className="erp-stat-grid">
        <StatCard label="Purchase orders" value={formatNumber(stats.total)} icon="🧾" />
        <StatCard label="Order quantity" value={formatNumber(stats.quantity)} unit="pcs" icon="📦" />
        <StatCard label="In progress" value={formatNumber(stats.pending)} icon="⚙️" />
        <StatCard
          label="Overdue"
          value={formatNumber(stats.delayed)}
          level={stats.delayed > 0 ? 'critical' : 'good'}
          icon="⏰"
        />
        <StatCard
          label="Due within 7 days"
          value={formatNumber(stats.dueSoon)}
          level={stats.dueSoon > 0 ? 'warning' : 'good'}
          icon="📅"
        />
      </div>
    </section>
  );
}

/** ---- 2. the status chart ---- */
function OrderCharts({ data }) {
  /** Quantity at risk per buyer — the mercantile question the status chart raises. */
  const byBuyer = useMemo(() => {
    const map = new Map();
    data.orderRows.forEach((row) => {
      const entry = map.get(row.buyer) || { value: 0, overdue: 0 };
      entry.value += row.total;
      if (row.overdue) entry.overdue += row.total;
      map.set(row.buyer, entry);
    });
    return [...map.entries()]
      .sort((a, b) => b[1].overdue - a[1].overdue || b[1].value - a[1].value)
      .slice(0, 8)
      .map(([buyer, v]) => ({
        id: buyer,
        label: buyer,
        icon: v.overdue > 0 ? '🔴' : '🟢',
        value: v.value,
        level: v.overdue > 0 ? 'critical' : 'good',
        hint: v.overdue > 0
          ? `${formatNumber(v.overdue)} pcs overdue`
          : 'Nothing overdue',
      }));
  }, [data.orderRows]);

  return (
    <div className="erp-split">
      <DonutChartCard
        title="Order status"
        icon="🧭"
        data={data.orderDonut}
        centerLabel="Purchase orders"
        emptyMessage="No orders to summarise yet."
      />
      <RankedBarCard
        title="Ordered quantity by buyer"
        icon="🏷️"
        data={byBuyer}
        unit="pcs"
        emptyMessage="No orders to rank yet."
      />
    </div>
  );
}

/** ---- 3. the order table ---- */
function OrderTable({ rows, canManageOrders, onStatusChange }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);

  // Offered from the data rather than hard-coded, so a factory using its own
  // status names still gets a working filter instead of an empty dropdown.
  const statuses = useMemo(() => {
    const seen = new Set();
    rows.forEach((r) => seen.add(String(r.status)));
    return [...seen].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return rows;
    if (statusFilter === 'overdue') return rows.filter((r) => r.overdue);
    return rows.filter((r) => String(r.status) === statusFilter);
  }, [rows, statusFilter]);

  const visible = showAll ? filtered : filtered.slice(0, 20);

  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Purchase orders
        {filtered.length !== rows.length && (
          <span className="erp-panel-sub">{filtered.length} of {rows.length} shown</span>
        )}
      </h2>

      {rows.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="No purchase orders yet"
          message="Orders appear here as soon as merchandising raises a PO against a buyer order."
        />
      ) : (
        <>
          <div className="erp-filter-bar">
            <select
              className="erp-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter orders by status"
            >
              <option value="all">All statuses ({rows.length})</option>
              <option value="overdue">Overdue ({rows.filter((r) => r.overdue).length})</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon="🔍" title="Nothing matches this filter" message="Try a different status." />
          ) : (
            <>
              <div className="erp-table-wrap">
                <table className="erp-table">
                  <thead>
                    <tr>
                      <th>PO</th>
                      <th>Buyer</th>
                      <th>Due</th>
                      <th align="right">Qty</th>
                      <th align="right">Shipped</th>
                      <th align="right">Balance</th>
                      <th>Progress</th>
                      <th>Status</th>
                      {canManageOrders && <th>Manual status</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.id}>
                        <td className="erp-strong erp-mono">{row.poNo}</td>
                        <td>{row.buyer}</td>
                        <td className="erp-mono" title={row.due || 'No delivery date recorded'}>
                          {row.due ? formatShort(row.due) : '—'}
                          {row.daysLeft !== null && (
                            <span className={`erp-due-note erp-level-${row.level}`}>
                              {row.daysLeft < 0
                                ? `${Math.abs(row.daysLeft)}d late`
                                : row.daysLeft === 0 ? 'today' : `in ${row.daysLeft}d`}
                            </span>
                          )}
                        </td>
                        <td align="right" className="erp-mono">{formatNumber(row.total)}</td>
                        <td align="right" className="erp-mono">{formatNumber(Math.max(row.shipped, row.produced || 0))}</td>
                        <td align="right" className="erp-mono">{formatNumber(Math.max(0, row.total - Math.max(row.shipped, row.produced || 0)))}</td>
                        <td>
                          <span className="erp-progress" role="img" aria-label={`${row.progress}% shipped`}>
                            <span className="erp-progress-track">
                              <span
                                className={`erp-progress-fill erp-progress-fill-${row.level === 'info' ? 'good' : row.level}`}
                                style={{ width: `${row.progress}%` }}
                              />
                            </span>
                            <span className="erp-progress-text erp-mono">{row.progress}%</span>
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={row.status || ORDER_STATUS.NEW} />
                          {row.autoStatus && <span className="erp-cell-note">Automatically {row.autoStatus === ORDER_STATUS.COMPLETED ? 'completed' : 'closed'} from delivery date or fulfillment</span>}
                        </td>
                        {canManageOrders && (
                          <td>
                            <select className="erp-select" aria-label={`Manually update status for ${row.poNo}`} value={row.rawStatus || row.status} onChange={(event) => onStatusChange(row, event.target.value)}>
                              {[ORDER_STATUS.NEW, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PRODUCTION, ORDER_STATUS.PARTIALLY_COMPLETED, ORDER_STATUS.READY_TO_SHIP, ORDER_STATUS.SHIPPED, ORDER_STATUS.COMPLETED, ORDER_STATUS.INACTIVE, ORDER_STATUS.CLOSED, ORDER_STATUS.ARCHIVED, ORDER_STATUS.CANCELLED].map((status) => <option key={status} value={status}>{status}</option>)}
                            </select>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filtered.length > 20 && (
                <button
                  type="button"
                  className="erp-panel-link"
                  aria-expanded={showAll}
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? 'Show the 20 most urgent →' : `Show all ${filtered.length} orders →`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

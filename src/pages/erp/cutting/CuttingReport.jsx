import { useMemo, useState } from 'react';
import { EmptyState, LoadingState, ErrorState, StatCard, StatusBadge, SeverityDot } from '../../../components/erp/Primitives';
import { RankedBarCard, formatNumber } from '../../../components/erp/Charts';
import { downloadCSV } from '../../../utils/csv';
import { usePermissions } from '../../../context/PermissionContext';
import { MODULE } from '../../../config/erpRoles';
import { useCuttingProduction } from '../../../hooks/useCuttingProduction';

/**
 * ROBIUL GARMENTS ERP — Cutting Department → Cutting Report.
 *
 * The cutting book, as the brief describes it: one row per lay with the buyer,
 * order, style, lay number, total cut pieces, fabric used, what has been issued to
 * a sewing line, and what is therefore still sitting in cutting stock.
 *
 * Four bands, in the order the brief asks for them:
 *
 *   1. KPI cards        — today's cut, target vs achievement, fabric consumed and
 *                         the ready stock available to feed a sewing line
 *   2. Filters          — date / range / order / style
 *   3. WIP feed         — what is available to issue, per order + style + colour
 *   4. The report table — the brief's column order
 *
 * Every figure comes from `config/cuttingProduction`, which is pure and tested, so
 * the cards, the table and the export describe one set of numbers. The screen only
 * renders what that module returns.
 *
 * STRICT ENGLISH: every label, header and status badge below is English.
 */
export default function CuttingReport() {
  const permissions = usePermissions();
  const [filters, setFilters] = useState({ date: '', from: '', to: '', order_no: '', style: '' });

  const {
    rows, allRows, kpis, wipFeed, byOrder,
    orderOptions, styleOptions, loading, error, legacyCount,
  } = useCuttingProduction(filters);

  const filtersActive = Boolean(filters.date || filters.from || filters.to || filters.order_no || filters.style);
  const clearFilters = () => setFilters({ date: '', from: '', to: '', order_no: '', style: '' });
  const set = (patch) => setFilters((prev) => ({ ...prev, ...patch }));

  // Export is a read action, so it follows the export right on the module rather
  // than the write actions — a general user may still download the report.
  const canExport = permissions.can(MODULE.PRODUCTION, 'export') || permissions.can(MODULE.REPORTS, 'export');

  const hasData = allRows.length > 0;

  const columns = useMemo(() => [
    { name: 'date', label: 'Date' },
    { name: 'buyer', label: 'Buyer' },
    { name: 'order_no', label: 'Order No' },
    { name: 'style', label: 'Style' },
    { name: 'layNo', label: 'Lay No' },
    { name: 'cutQty', label: 'Total Cut Pcs' },
    { name: 'fabricConsumed', label: 'Fabric Used' },
    { name: 'issuedQty', label: 'Issued to Sewing Line Pcs' },
    { name: 'remaining', label: 'Remaining Balance in Cutting Stock' },
    { name: 'status', label: 'Status' },
  ], []);

  function handleExport() {
    if (rows.length === 0) {
      window.alert('No cutting data to export for these filters.');
      return;
    }
    // The fabric unit is printed beside the figure so an exported sheet never
    // shows a bare number whose unit the reader has to guess.
    const exportRows = rows.map((r) => ({
      ...r,
      fabricConsumed: `${formatNumber(r.fabricConsumed)} ${r.fabricUnit}`,
    }));
    downloadCSV('cutting-production-report.csv', exportRows, columns);
  }

  if (loading && allRows.length === 0) {
    return <LoadingState label="Loading the cutting register…" rows={4} />;
  }
  if (error && allRows.length === 0) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="erp-page">
      {/* ---- 1. KPI cards — the brief's four headline figures ---- */}
      <CuttingKpis kpis={kpis} />

      <section className="erp-panel">
        <h2 className="erp-panel-title">Filters</h2>
        <div className="erp-filter-bar">
          <label className="erp-field erp-field-inline">
            <span className="erp-field-label">Date</span>
            <input
              type="date" className="erp-input" value={filters.date}
              onChange={(e) => set({ date: e.target.value, from: '', to: '' })}
            />
          </label>
          <label className="erp-field erp-field-inline">
            <span className="erp-field-label">From</span>
            <input
              type="date" className="erp-input" value={filters.from}
              onChange={(e) => set({ from: e.target.value, date: '' })}
            />
          </label>
          <label className="erp-field erp-field-inline">
            <span className="erp-field-label">To</span>
            <input
              type="date" className="erp-input" value={filters.to}
              onChange={(e) => set({ to: e.target.value, date: '' })}
            />
          </label>
          <label className="erp-field erp-field-inline">
            <span className="erp-field-label">Order No</span>
            <select
              className="erp-input" value={filters.order_no}
              onChange={(e) => set({ order_no: e.target.value })}
              aria-label="Filter by order number"
            >
              <option value="">All orders ({orderOptions.length})</option>
              {orderOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="erp-field erp-field-inline">
            <span className="erp-field-label">Style</span>
            <select
              className="erp-input" value={filters.style}
              onChange={(e) => set({ style: e.target.value })}
              aria-label="Filter by style"
            >
              <option value="">All styles ({styleOptions.length})</option>
              {styleOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {filtersActive && (
            <button type="button" className="btn btn-outline btn-sm" onClick={clearFilters}>✕ Clear filters</button>
          )}
          {canExport && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleExport}
              disabled={rows.length === 0}
            >
              ⬇ Export CSV
            </button>
          )}
        </div>
      </section>

      {!hasData && (
        <EmptyState
          icon="✂️"
          title="No cutting entries recorded yet"
          message="Record a lay on the Cutting Entry tab and its buyer, order, style, cut quantity and remaining balance will appear here automatically."
        />
      )}

      {/* Says plainly that some rows came from the old cutting collection, so an
          imported historical row is never mistaken for one entered on the new
          form — it has no fabric figure and cannot be edited. */}
      {legacyCount > 0 && (
        <p className="erp-panel-foot" role="status">
          {formatNumber(legacyCount)} row{legacyCount === 1 ? '' : 's'} shown below came from the older cutting register
          and are read-only. Their fabric consumption was never recorded, so it reads 0.
        </p>
      )}

      {hasData && (
        <>
          {/* ---- 2. The WIP feed: what is available to a sewing line ---- */}
          <div className="erp-split">
            <WipFeedTable rows={wipFeed} />
            <RankedBarCard
              title="Cut quantity by order"
              icon="📊"
              data={byOrder.slice(0, 10).map((o) => ({
                id: o.key,
                label: o.order_no || o.style || 'Unassigned',
                icon: o.remaining > 0 ? '🟠' : '🟢',
                value: o.cutQty,
                level: o.remaining > 0 ? 'warning' : 'good',
                hint: `${formatNumber(o.remaining)} pcs still to feed`,
              }))}
              unit="pcs"
              emptyMessage="No cutting to rank yet."
            />
          </div>

          {/* ---- 3. The report table, in the brief's column order ---- */}
          <CuttingReportTable rows={rows} filtersActive={filtersActive} onClear={clearFilters} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 1. KPI cards — the brief's four headline figures.
 * ------------------------------------------------------------------ */

function CuttingKpis({ kpis }) {
  // Fabric is reported per unit: adding yards to meters would produce a number
  // that means nothing, so the card names the unit it is showing.
  const fabricEntries = Object.entries(kpis.fabricByUnit || {});

  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Cutting KPIs
        <span className="erp-panel-sub">{kpis.date} · {formatNumber(kpis.entries)} lay(s)</span>
      </h2>
      <div className="erp-stat-grid">
        <StatCard
          label="Today's Total Cut Pcs"
          value={formatNumber(kpis.totalCut)}
          unit="pcs"
          icon="✂️"
          hint={`${formatNumber(kpis.totalIssued)} pcs issued to sewing lines`}
        />
        <StatCard
          label="Cutting Target vs Achievement %"
          value={kpis.achievement === null ? '—' : `${kpis.achievement}%`}
          icon="🎯"
          level={kpis.achievementLevel}
          hint={kpis.target > 0
            ? `Target ${formatNumber(kpis.target)} pcs · cut ${formatNumber(kpis.totalCut)} pcs`
            : 'No cutting target set for today'}
        />
        <StatCard
          label="Total Fabric Consumed Today"
          value={formatNumber(kpis.fabricTotal)}
          unit={kpis.fabricUnit}
          icon="🧶"
          hint={fabricEntries.length > 1
            ? fabricEntries.map(([unit, value]) => `${formatNumber(value)} ${unit}`).join(' · ')
            : 'Measured across every lay cut today'}
        />
        <StatCard
          label="Ready Stock for Sewing Feeding"
          value={formatNumber(kpis.readyStock)}
          unit="pcs"
          icon="🧺"
          level={kpis.readyStock > 0 ? 'warning' : 'good'}
          hint="Cut and not yet issued — available as WIP"
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 2. The WIP feed — what the sewing line may be fed next.
 * ------------------------------------------------------------------ */

function WipFeedTable({ rows }) {
  if (rows.length === 0) {
    return (
      <section className="erp-panel">
        <h2 className="erp-panel-title">Ready to feed a sewing line</h2>
        <EmptyState
          icon="✅"
          title="Nothing waiting to be fed"
          message="Every lay that has been cut has been issued to a sewing line. Record a new cutting entry to add to the pool."
        />
      </section>
    );
  }

  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Ready to feed a sewing line
        <span className="erp-panel-sub">Available WIP by order, style and colour</span>
      </h2>
      <div className="erp-table-wrap">
        <table className="erp-table erp-table-compact">
          <thead>
            <tr>
              <th>Order No</th>
              <th>Style</th>
              <th>Color</th>
              <th>Lay No</th>
              <th align="right">Cut Pcs</th>
              <th align="right">Issued</th>
              <th align="right">Available to Feed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="erp-strong erp-mono">{row.order_no || '—'}</td>
                <td>{row.style || '—'}</td>
                <td>{row.color || '—'}</td>
                <td className="erp-mono">{row.lays.join(', ') || '—'}</td>
                <td align="right" className="erp-mono">{formatNumber(row.cutQty)}</td>
                <td align="right" className="erp-mono">{formatNumber(row.issuedQty)}</td>
                <td align="right" className="erp-mono">
                  <strong>{formatNumber(row.availableQty)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="erp-panel-foot">
        These quantities are the available Work In Progress for the sewing line input pool —
        feeding one reduces the balance here and adds it to Line Input &amp; WIP.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 3. The comprehensive report table — the brief's column order.
 * ------------------------------------------------------------------ */

function CuttingReportTable({ rows, filtersActive, onClear }) {
  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Cutting production report
        <span className="erp-panel-sub">{formatNumber(rows.length)} row(s)</span>
      </h2>
      {rows.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No cutting entries match these filters"
          message="Widen the date range or clear the order / style filter to see the full cutting register."
          action={filtersActive ? (
            <button type="button" className="btn btn-outline" onClick={onClear}>Clear filters</button>
          ) : undefined}
        />
      ) : (
        <div className="erp-table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Buyer</th>
                <th>Order No</th>
                <th>Style</th>
                <th>Lay No</th>
                <th align="right">Total Cut Pcs</th>
                <th align="right">Fabric Used</th>
                <th align="right">Issued to Sewing Line Pcs</th>
                <th align="right">Remaining Balance in Cutting Stock</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id ?? `${row.order_no}-${row.layNo}-${i}`}>
                  <td className="erp-mono erp-nowrap">
                    {row.date || '—'}
                    {row.legacy && (
                      <span
                        className="erp-badge erp-badge-neutral"
                        title="Migrated from the older cutting register — read-only, and its fabric consumption was never recorded"
                      >
                        Legacy
                      </span>
                    )}
                  </td>
                  <td>{row.buyer || '—'}</td>
                  <td className="erp-strong erp-mono erp-nowrap">{row.order_no || '—'}</td>
                  <td>{row.style || '—'}</td>
                  <td className="erp-mono erp-nowrap">{row.layNo || '—'}</td>
                  <td align="right" className="erp-mono">{formatNumber(row.cutQty)}</td>
                  <td align="right" className="erp-mono erp-nowrap">
                    {formatNumber(row.fabricConsumed)} <span className="erp-cell-note">{row.fabricUnit}</span>
                  </td>
                  <td align="right" className="erp-mono">{formatNumber(row.issuedQty)}</td>
                  <td align="right" className="erp-mono">
                    <SeverityDot
                      level={row.level === 'info' ? 'good' : row.level}
                      label={formatNumber(row.remaining)}
                    />
                  </td>
                  <td>
                    <StatusBadge status={row.status} tone={row.level === 'info' ? 'neutral' : row.level} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

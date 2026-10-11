import { useMemo, useState } from 'react';
import { LoadingState, ErrorState, EmptyState, StatCard, Notice } from '../../../components/erp/Primitives';
import { BarChartCard, formatNumber } from '../../../components/erp/Charts';
import { downloadCSV } from '../../../utils/csv';
import { toNumber, toDateKey, summariseProductionDay, summariseEndLineQc } from '../../../utils/erpCalculations';
import { useErpSources, useErpOverview, useToday } from '../../../components/erp/useErpOverview';

/**
 * ROBIUL GARMENTS ERP — Reports hub.
 *
 * Four reports over the live data — Production, Quality, Orders, Stock — each a
 * roll-up that can be read on screen and exported as CSV.
 *
 * Every figure is computed by the same helpers the dashboards use, so a number
 * exported here matches the number on the screen it came from. A report that
 * disagreed with the dashboard beside it would be worse than no report, because
 * someone would have to decide which one to believe.
 *
 * The roll-ups are grouped by DAY, not by line or hour: this is the sheet a
 * manager carries into a morning meeting, and "how did we do on Tuesday" is the
 * question it has to answer.
 *
 * NOTE — this is a working first cut. Still missing: a picked date range (each
 * report covers the window the live subscriptions hold), a printable layout,
 * and the TNA / costing reports, which depend on modules not yet built.
 */

const REPORTS = [
  { key: 'production', label: 'Production', icon: '🏭' },
  { key: 'quality', label: 'Quality', icon: '🔍' },
  { key: 'orders', label: 'Orders', icon: '📑' },
  { key: 'stock', label: 'Stock', icon: '🏬' },
];

export default function ReportHub() {
  const today = useToday();
  const { loading, error } = useErpSources();

  if (loading) return <LoadingState label="Loading reports…" rows={4} />;
  if (error) return <ErrorState message={error} />;

  return <ReportHubBody today={today} />;
}

/**
 * Split from the gate above so the data hook only runs once loading has settled.
 * The hook itself is not conditional — React would reject that — and the gate
 * means the reports never render against a half-filled cache.
 */
function ReportHubBody({ today }) {
  const data = useErpOverview(today);
  const [report, setReport] = useState('production');
  const [note, setNote] = useState(null);

  /** Production rolled up per day, newest first. */
  const productionRows = useMemo(() => {
    const byDay = {};
    data.allProduction.forEach((row) => {
      const day = toDateKey(row.date);
      if (!day) return;
      (byDay[day] = byDay[day] || []).push(row);
    });
    return Object.entries(byDay).map(([date, rows]) => {
      const s = summariseProductionDay(rows);
      return {
        date,
        target: s.target,
        actual: s.actual,
        achievement: s.achievement,
        efficiency: s.efficiency,
        rework: s.rework,
        reject: s.reject,
        downtimeMin: s.downtimeMin,
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [data.allProduction]);

  /** Quality rolled up per day, newest first. */
  const qualityRows = useMemo(() => {
    const byDay = {};
    data.qcRows.forEach((row) => {
      const day = toDateKey(row.date);
      if (!day) return;
      (byDay[day] = byDay[day] || []).push(row);
    });
    return Object.entries(byDay).map(([date, rows]) => {
      const s = summariseEndLineQc(rows);
      return {
        date,
        checked: s.checkedQty,
        passed: s.passedQty,
        failed: s.failedQty,
        rework: s.reworkQty,
        reject: s.rejectQty,
        dhu: s.dhu,
        rejectPct: s.rejectPct,
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [data.qcRows]);

  /** The order pipeline, as exported: one row per PO. */
  const orderRows = useMemo(
    () => data.orderRows.map((r) => ({
      poNo: r.poNo,
      buyer: r.buyer,
      due: r.due ? toDateKey(r.due) : '',
      daysLeft: r.daysLeft === null ? '' : r.daysLeft,
      totalQty: r.total,
      shippedQty: r.shipped,
      balanceQty: Math.max(0, r.total - r.shipped),
      progress: r.progress,
      status: r.status,
    })),
    [data.orderRows]
  );

  const definitions = {
    production: {
      rows: productionRows,
      icon: '🏭',
      description: 'Daily target, actual, achievement and efficiency.',
      columns: [
        { name: 'date', label: 'Date' },
        { name: 'target', label: 'Target' },
        { name: 'actual', label: 'Actual' },
        { name: 'achievement', label: 'Achievement %' },
        { name: 'efficiency', label: 'Efficiency %' },
        { name: 'rework', label: 'Rework' },
        { name: 'reject', label: 'Reject' },
        { name: 'downtimeMin', label: 'Downtime (min)' },
      ],
      stats: [
        ['Days recorded', formatNumber(productionRows.length)],
        ['Total produced', formatNumber(productionRows.reduce((s, r) => s + r.actual, 0))],
        ['Avg achievement', productionRows.length
          ? `${(productionRows.reduce((s, r) => s + r.achievement, 0) / productionRows.length).toFixed(1)}%`
          : '—'],
      ],
      chart: {
        title: 'Actual produced per day',
        data: [...productionRows].reverse().slice(-10).map((r) => ({
          id: r.date, label: r.date.slice(5), actual: r.actual, target: r.target,
        })),
        series: [
          { key: 'target', label: 'Target', color: '#94a3b8' },
          { key: 'actual', label: 'Actual', color: '#38bdf8' },
        ],
      },
      empty: ['No production recorded', 'Daily totals appear once supervisors enter hourly output.'],
    },
    quality: {
      rows: qualityRows,
      icon: '🔍',
      description: 'Daily pieces checked, passed, reworked and rejected.',
      columns: [
        { name: 'date', label: 'Date' },
        { name: 'checked', label: 'Checked' },
        { name: 'passed', label: 'Passed' },
        { name: 'failed', label: 'Failed' },
        { name: 'rework', label: 'Rework' },
        { name: 'reject', label: 'Reject' },
        { name: 'dhu', label: 'DHU' },
        { name: 'rejectPct', label: 'Reject %' },
      ],
      stats: [
        ['Days recorded', formatNumber(qualityRows.length)],
        ['Total checked', formatNumber(qualityRows.reduce((s, r) => s + r.checked, 0))],
        ['Avg DHU', qualityRows.length
          ? (qualityRows.reduce((s, r) => s + r.dhu, 0) / qualityRows.length).toFixed(2)
          : '—'],
      ],
      chart: {
        title: 'Rejects per day',
        data: [...qualityRows].reverse().slice(-10).map((r) => ({
          id: r.date, label: r.date.slice(5), reject: r.reject, rework: r.rework,
        })),
        series: [
          { key: 'rework', label: 'Rework', color: '#f59e0b' },
          { key: 'reject', label: 'Reject', color: '#f87171' },
        ],
      },
      empty: ['No end-line QC recorded', 'Roll-ups appear once inspection results are entered.'],
    },
    orders: {
      rows: orderRows,
      icon: '📑',
      description: 'Every purchase order with its shipping progress.',
      columns: [
        { name: 'poNo', label: 'PO' },
        { name: 'buyer', label: 'Buyer' },
        { name: 'due', label: 'Due' },
        { name: 'daysLeft', label: 'Days left' },
        { name: 'totalQty', label: 'Order qty' },
        { name: 'shippedQty', label: 'Shipped qty' },
        { name: 'balanceQty', label: 'Balance' },
        { name: 'progress', label: 'Progress %' },
        { name: 'status', label: 'Status' },
      ],
      stats: [
        ['Purchase orders', formatNumber(orderRows.length)],
        ['Total quantity', formatNumber(orderRows.reduce((s, r) => s + r.totalQty, 0))],
        ['Overdue', formatNumber(orderRows.filter((r) => typeof r.daysLeft === 'number' && r.daysLeft < 0).length)],
      ],
      chart: null,
      empty: ['No purchase orders', 'Orders appear once merchandising raises a PO.'],
    },
    stock: {
      rows: data.stock.byItem,
      icon: '🏬',
      description: 'Item balances derived from the movement ledger.',
      columns: [
        { name: 'label', label: 'Item' },
        { name: 'value', label: 'On hand' },
        { name: 'unit', label: 'Unit' },
        { name: 'minQty', label: 'Minimum' },
        { name: 'maxQty', label: 'Maximum' },
        { name: 'value_currency', label: 'Value' },
        { name: 'level', label: 'Level' },
      ],
      stats: [
        ['Items', formatNumber(data.stock.byItem.length)],
        ['Units on hand', formatNumber(data.stock.totalQty)],
        ['Below minimum', formatNumber(data.stock.low.length)],
      ],
      chart: null,
      empty: ['No stock movements', 'Stock appears with the first goods receipt or issue.'],
    },
  };

  const active = definitions[report];

  function onExport() {
    if (active.rows.length === 0) {
      setNote({ kind: 'error', message: 'There is nothing to export for this report yet.' });
      return;
    }
    downloadCSV(`erp-${report}-${today}.csv`, active.rows, active.columns);
    setNote({ kind: 'success', message: `Exported ${active.rows.length} rows to CSV.` });
  }

  return (
    <>
      <header className="erp-page-header">
        <div>
          <h1 className="erp-page-title">📄 Reports</h1>
          <p className="erp-page-description">{active.description}</p>
        </div>
        <div className="erp-page-actions">
          <button className="btn btn-primary" onClick={onExport} disabled={active.rows.length === 0}>
            ⬇ Export CSV
          </button>
        </div>
      </header>

      {note && <Notice kind={note.kind} onDismiss={() => setNote(null)}>{note.message}</Notice>}

      <div className="erp-filter-bar">
        <div className="erp-segmented" role="tablist" aria-label="Report">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={report === r.key}
              className={`erp-segment${report === r.key ? ' active' : ''}`}
              onClick={() => { setReport(r.key); setNote(null); }}
            >
              <span aria-hidden="true">{r.icon}</span> {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="erp-stat-grid">
        {active.stats.map(([label, value]) => (
          <StatCard key={label} label={label} value={value} />
        ))}
      </div>

      {active.chart && active.chart.data.length > 0 && (
        <BarChartCard
          title={active.chart.title}
          icon={active.icon}
          data={active.chart.data}
          series={active.chart.series}
        />
      )}

      <section className="erp-panel">
        <h2 className="erp-panel-title">
          {active.icon} {REPORTS.find((r) => r.key === report).label} detail
          <span className="erp-panel-sub">{formatNumber(active.rows.length)} rows</span>
        </h2>

        {active.rows.length === 0 ? (
          <EmptyState icon={active.icon} title={active.empty[0]} message={active.empty[1]} />
        ) : (
          <>
            <div className="erp-table-wrap">
              <table className="erp-table erp-table-compact">
                <thead>
                  <tr>
                    {active.columns.map((c) => <th key={c.name}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {active.rows.slice(0, 100).map((row, i) => (
                    <tr key={row.id ?? row.date ?? row.poNo ?? i}>
                      {active.columns.map((c) => (
                        <td key={c.name} className="erp-mono">{cell(row[c.name])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {active.rows.length > 100 && (
              <p className="erp-panel-foot">
                Showing the first 100 of {formatNumber(active.rows.length)} rows — export the CSV for the full report.
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

/** One table cell. Numbers are grouped; empties are a dash, never "undefined". */
function cell(value) {
  if (value === '' || value === null || value === undefined) return '—';
  if (typeof value === 'number') return toNumber(value).toLocaleString();
  return String(value);
}

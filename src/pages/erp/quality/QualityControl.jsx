import { useMemo, useState } from 'react';
import {
  EmptyState, ErrorState, LoadingState, StatCard, StatusBadge,
} from '../../../components/erp/Primitives';
import { formatNumber } from '../../../components/erp/Charts';
import { useQualityAnalytics } from '../../../hooks/useQualityAnalytics';
import {
  downloadQualityReportWorkbook,
  downloadQualityReportPDF,
} from '../../../utils/qualityReportExport';

/**
 * ROBIUL GARMENTS ERP — Quality Control.
 *
 * A Quality Analytics & Summary Dashboard rather than a raw list. It reads the
 * `quality-control` collection — the SAME collection the Unified Entry Modal's
 * "QC Product Check" mode writes to — so every check logged on the shop floor is
 * aggregated here automatically, with no second entry screen and no second list
 * to reconcile.
 *
 * The screen has four parts, in the order the brief asks for them:
 *
 *   1. KPI cards      — Total Checked Qty, Pass / FTR %, Defect Qty & Rate,
 *                        Pending Alter / Repair Qty. The FTR card is colour-coded
 *                        Green >= 95%, Yellow 90–94%, Red < 90%.
 *   2. Summary table  — one row per QC entry: Date, Line No, Order No, Style No,
 *                        Process Name, Checked Qty, OK Pcs, Alter Pcs, Defect Qty,
 *                        Defect Rate %, Status badge.
 *   3. Defect analysis— the Top 3 Defect Types for the selected date, plus Date
 *                        Range / Line / Order filters and the Export buttons.
 *   4. Strict English — every label, header and badge is English.
 *
 * All the arithmetic lives in `config/qualityAnalytics`, which is pure and tested,
 * so the cards, the table and the exported file describe one set of numbers. The
 * screen only renders what that module returns.
 */
export default function QualityControl() {
  const [filters, setFilters] = useState({ date: '', from: '', to: '', line: '', order: '' });
  const [busy, setBusy] = useState('');

  const {
    summary, tableRows, allRows, filteredRows,
    lineOptions, orderOptions, focusDate, focusSummary,
    loading, error,
  } = useQualityAnalytics(filters);

  const filtersActive = Boolean(filters.date || filters.from || filters.to || filters.line || filters.order);
  const clearFilters = () => setFilters({ date: '', from: '', to: '', line: '', order: '' });

  const hasData = allRows.length > 0;
  const hasFiltered = filteredRows.length > 0;

  const exportPayload = useMemo(() => ({
    rows: tableRows,
    summary,
    filters,
  }), [tableRows, summary, filters]);

  function handleExport(kind) {
    if (tableRows.length === 0) {
      window.alert('No data to export for these filters.');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'excel') {
        downloadQualityReportWorkbook(exportPayload);
      } else {
        downloadQualityReportPDF(exportPayload);
      }
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="erp-page qc-dashboard">
      <header className="erp-page-header">
        <div>
          <h1 className="erp-page-title">🔍 Quality Control</h1>
          <p className="erp-page-description">
            Inspection summary auto-aggregated from every QC Product Check logged in the Unified Entry Modal.
            Pass / First-Time-Right %, defect rate, pending alterations and the defect types behind them — for the
            selected date range, line or order.
          </p>
        </div>
        <div className="erp-page-actions">
          <button type="button" className="btn btn-outline" onClick={() => handleExport('excel')} disabled={!hasFiltered || busy === 'excel'}>
            ⬇ Export Excel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => handleExport('pdf')} disabled={!hasFiltered || busy === 'pdf'}>
            🖨️ Export PDF
          </button>
        </div>
      </header>

      {loading && !hasData && <LoadingState label="Loading quality checks…" />}
      {error && !hasData && <ErrorState message={error} />}

      {!loading && !hasData && !error && (
        <EmptyState
          icon="🔍"
          title="No quality checks recorded yet"
          message="Log a QC Product Check from the Unified Entry Modal (+ New Entry → QC Product Check) and the summary, KPI cards and defect analysis will fill in here automatically."
        />
      )}

      {hasData && (
        <>
          <QualityKpis summary={summary} />

          <QualityFilters
            filters={filters} setFilters={setFilters}
            lineOptions={lineOptions} orderOptions={orderOptions}
            active={filtersActive} onClear={clearFilters}
          />

          <TopDefectTypes summary={focusSummary} date={focusDate} />

          <QualitySummaryTable rows={tableRows} filtersActive={filtersActive} onClear={clearFilters} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 1. KPI cards — the brief's headline figures.
 * ------------------------------------------------------------------ */

function QualityKpis({ summary }) {
  // The brief's FTR bands: Green >= 95%, Yellow 90–94%, Red < 90%.
  const ftr = summary.passRate;
  const ftrLevel = ftr >= 95 ? 'good' : ftr >= 90 ? 'warning' : 'critical';
  const ftrBand = ftr >= 95 ? 'Green' : ftr >= 90 ? 'Yellow' : 'Red';

  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Quality KPIs
        <span className="erp-panel-sub">{formatNumber(summary.entries)} check(s)</span>
      </h2>
      <div className="erp-stat-grid">
        <StatCard
          label="Total Checked Qty"
          value={formatNumber(summary.totalChecked)}
          unit="pcs"
          icon="🔎"
          hint={`OK ${formatNumber(summary.okPcs)} · Alter ${formatNumber(summary.alterPcs)} · Defect ${formatNumber(summary.defectPcs)}`}
        />
        <StatCard
          label="Pass / First-Time-Right %"
          value={`${ftr}%`}
          unit=""
          icon="🎯"
          level={ftrLevel}
          hint={`${ftrBand} band · Green >= 95, Yellow 90–94, Red < 90`}
        />
        <StatCard
          label="Total Defect / Reject Qty"
          value={formatNumber(summary.defectPcs)}
          unit="pcs"
          icon="⛔"
          level={summary.defectRate > 10 ? 'critical' : summary.defectRate > 5 ? 'warning' : 'good'}
          hint={`Defect Rate ${summary.defectRate}%`}
        />
        <StatCard
          label="Pending Alter / Repair Qty"
          value={formatNumber(summary.pendingAlter)}
          unit="pcs"
          icon="🧵"
          level={summary.pendingAlter > 0 ? 'warning' : 'good'}
          hint={`${summary.alterRate}% of everything checked`}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 3a. Filters — Date Range, Line and Order. One row, above the defect
 *     widget and the table, so the two cannot describe different sets.
 * ------------------------------------------------------------------ */

function QualityFilters({ filters, setFilters, lineOptions, orderOptions, active, onClear }) {
  const set = (patch) => setFilters((prev) => ({ ...prev, ...patch }));
  return (
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
          <span className="erp-field-label">Line No</span>
          <select
            className="erp-input" value={filters.line}
            onChange={(e) => set({ line: e.target.value })}
            aria-label="Filter by line number"
          >
            <option value="">All lines ({lineOptions.length})</option>
            {lineOptions.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="erp-field erp-field-inline">
          <span className="erp-field-label">Order No</span>
          <select
            className="erp-input" value={filters.order}
            onChange={(e) => set({ order: e.target.value })}
            aria-label="Filter by order number"
          >
            <option value="">All orders ({orderOptions.length})</option>
            {orderOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        {active && (
          <button type="button" className="btn btn-outline btn-sm" onClick={onClear}>✕ Clear filters</button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 3b. Top defect types — the summary widget for the selected date.
 * ------------------------------------------------------------------ */

function TopDefectTypes({ summary, date }) {
  const top = summary.topDefectTypes || [];
  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Top Defect Types
        <span className="erp-panel-sub">
          {date ? `For ${date}` : 'No date selected'}
          {' · '}
          {formatNumber(summary.defectPcs)} defect pcs
        </span>
      </h2>
      {top.length === 0 ? (
        <EmptyState
          icon="✅"
          title="No defects recorded"
          message={date
            ? `Every check on ${date} passed with no defects. Nothing needs a fix from this day.`
            : 'No defects have been recorded for the current filters.'}
        />
      ) : (
        <div className="qc-defect-grid">
          {top.map((d, i) => (
            <div className="qc-defect-card" key={d.type}>
              <div className="qc-defect-rank">#{i + 1}</div>
              <div className="qc-defect-body">
                <div className="qc-defect-name">{d.type}</div>
                <div className="qc-defect-figures">
                  <span className="qc-defect-qty">{formatNumber(d.defectPcs)} <em>pcs</em></span>
                  <span className="qc-defect-share">{d.share}% of checked</span>
                  <span className="qc-defect-entries">{formatNumber(d.entries)} entry(ies)</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 2. The comprehensive summary table — the brief's column order.
 * ------------------------------------------------------------------ */

function QualitySummaryTable({ rows, filtersActive, onClear }) {
  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        QC Summary
        <span className="erp-panel-sub">{formatNumber(rows.length)} row(s)</span>
      </h2>
      {rows.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No checks match these filters"
          message="Widen the date range or clear the line / order filter to see the full summary."
          action={filtersActive ? (
            <button type="button" className="btn btn-outline" onClick={onClear}>Clear filters</button>
          ) : undefined}
        />
      ) : (
        <div className="erp-table-wrap">
          <table className="erp-table qc-summary-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Line No</th>
                <th>Order No</th>
                <th>Style No</th>
                <th>Process Name</th>
                <th align="right" className="qc-num">Checked Qty</th>
                <th align="right" className="qc-num">OK Pcs</th>
                <th align="right" className="qc-num">Alter Pcs</th>
                <th align="right" className="qc-num">Defect Qty</th>
                <th align="right" className="qc-num">Defect Rate %</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id ?? `${row.date}-${row.line}-${row.orderNo}-${row.process}-${i}`}>
                  <td className="erp-mono erp-nowrap">{row.date || '—'}</td>
                  <td className="erp-nowrap">{row.line}</td>
                  <td className="erp-strong erp-nowrap">{row.orderNo}</td>
                  <td className="erp-nowrap">{row.style}</td>
                  <td>{row.process}</td>
                  <td align="right" className="erp-mono qc-num">{formatNumber(row.checkedQty)}</td>
                  <td align="right" className="erp-mono qc-num">{formatNumber(row.okPcs)}</td>
                  <td align="right" className="erp-mono qc-num">{formatNumber(row.alterPcs)}</td>
                  <td align="right" className="erp-mono qc-num">{formatNumber(row.defectQty)}</td>
                  <td align="right" className="erp-mono qc-num">
                    <span className={`qc-rate qc-rate-${row.statusTone}`}>{row.defectRate}%</span>
                  </td>
                  <td><StatusBadge status={row.statusLabel} tone={row.statusTone} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

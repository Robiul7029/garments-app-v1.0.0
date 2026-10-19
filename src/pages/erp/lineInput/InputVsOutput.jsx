import { useMemo, useState } from 'react';
import {
  EmptyState, ErrorState, LoadingState, StatCard, SeverityDot, StatusBadge,
} from '../../../components/erp/Primitives';
import { BarChartCard, RankedBarCard, formatNumber } from '../../../components/erp/Charts';
import { comparisonLevel, comparisonPercent } from '../../../config/lineInputWip';
import { useLineInputWip, useLineInputWipSources } from '../../../hooks/useLineInputWip';

/**
 * ROBIUL GARMENTS ERP — Input vs Output.
 *
 * The brief's comparison view: how much material was fed INTO the line against
 * how much was successfully finished and PACKED. It answers the question the WIP
 * table cannot — "how far did this order actually get" — so it groups on the
 * ORDER, the unit a merchandiser tracks, while the WIP table groups on
 * order + line, the unit a supervisor tracks. Same figures, different axis, which
 * is why both exist rather than one replacing the other.
 *
 *   Input   = everything recorded on the Line Input Entry tab
 *   Output  = finished and packed (packing plans), or passed end-line QC
 *
 * The comparison is shown three ways, because the three audiences want different
 * shapes of the same data:
 *
 *   1. headline cards     — the factory-wide totals and the completion rate
 *   2. grouped bars       — every order's input beside its output, same scale
 *   3. by order / by line — the detail, switchable, with a progress bar per row
 *
 * The progress bar is the honest version of "how much is left": it is output ÷
 * input, clamped to 100%, so a row whose output exceeds its input shows a full bar
 * and is flagged rather than showing 120%.
 */
export default function InputVsOutput() {
  const { loading, error } = useLineInputWipSources();
  const [view, setView] = useState('order');
  const [date, setDate] = useState('');
  const [line, setLine] = useState('');

  const filters = useMemo(() => ({ date, line_no: line }), [date, line]);
  const {
    totals, byOrder, byLine, wipRows, inputs, lineOptions,
  } = useLineInputWip(filters);

  const filtersActive = Boolean(date || line);
  const clearFilters = () => { setDate(''); setLine(''); };

  if (loading && inputs.length === 0) {
    return <LoadingState label="Comparing line input against output…" rows={4} />;
  }
  if (error && inputs.length === 0) {
    return <ErrorState message={error} />;
  }

  /** The orders with the most material fed in — the ones worth looking at first. */
  const orderChart = byOrder.slice(0, 12).map((r) => ({
    id: r.key,
    label: r.order_no || r.style || '—',
    input: r.input,
    output: r.output,
    level: comparisonLevel(r),
  }));

  const lineChart = [...byLine]
    .sort((a, b) => b.input - a.input)
    .slice(0, 12)
    .map((r) => ({
      id: r.key,
      label: r.line_no,
      value: r.wip,
      level: comparisonLevel(r),
      hint: `${formatNumber(r.input)} fed in · ${formatNumber(r.output)} finished`,
    }));

  const finished = byOrder.filter((r) => r.input > 0 && comparisonPercent(r) >= 100).length;
  const atRisk = byOrder.filter((r) => comparisonLevel(r) === 'critical').length;

  const rows = view === 'order' ? byOrder : byLine;

  return (
    <div className="erp-lineinput-compare">
      <ComparisonKpis totals={totals} finished={finished} atRisk={atRisk} orders={byOrder.length} />

      <section className="erp-panel">
        <div className="erp-filter-bar">
          <label className="erp-field erp-field-inline">
            <span className="erp-field-label">Date</span>
            <input type="date" className="erp-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="erp-field erp-field-inline">
            <span className="erp-field-label">Line No</span>
            <select className="erp-input" value={line} onChange={(e) => setLine(e.target.value)} aria-label="Filter by line number">
              <option value="">All lines ({lineOptions.length})</option>
              {lineOptions.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          {filtersActive && (
            <button type="button" className="btn btn-outline" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
        <p className="erp-panel-foot">
          Leave the date empty for the whole history. Output counts pieces finished and packed, or passed at end-line QC.
        </p>
      </section>

      {/* The grouped bar is the direct answer to "input vs output": both series on
          one scale, so the gap between them IS the work in progress. */}
      <BarChartCard
        title="Input vs Output by order"
        icon="📊"
        data={orderChart}
        series={[
          { key: 'input', label: 'Input', color: '#38bdf8' },
          { key: 'output', label: 'Output', color: '#22c55e' },
        ]}
        unit="pcs"
        emptyMessage="No feeding recorded for these filters yet."
      />

      <div className="erp-split">
        <RankedBarCard
          title="WIP still on the line, by line"
          icon="⚖️"
          data={lineChart}
          unit="pcs"
          emptyMessage="Every line has finished what it was fed."
        />

        <section className="erp-panel">
          <h2 className="erp-panel-title">
            Comparison detail
            <span className="erp-panel-sub">{formatNumber(rows.length)} rows</span>
          </h2>

          {/* By order or by line — the same data on the axis the reader needs. */}
          <div className="erp-tabbar erp-tabbar-inline" role="tablist" aria-label="Comparison grouping">
            <button
              type="button" role="tab" aria-selected={view === 'order'}
              className={`erp-tab${view === 'order' ? ' active' : ''}`}
              onClick={() => setView('order')}
            >
              By order
            </button>
            <button
              type="button" role="tab" aria-selected={view === 'line'}
              className={`erp-tab${view === 'line' ? ' active' : ''}`}
              onClick={() => setView('line')}
            >
              By line
            </button>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon="📊"
              title={filtersActive ? 'Nothing matches these filters' : 'No comparison to draw yet'}
              message={filtersActive
                ? 'No feeding or output matches the filters above. Clear them to see the whole picture.'
                : 'Once material is fed into a line and finished pieces come out, the comparison appears here.'}
              action={filtersActive
                ? <button type="button" className="btn btn-outline" onClick={clearFilters}>Clear filters</button>
                : null}
            />
          ) : (
            <div className="erp-table-wrap">
              <table className="erp-table erp-table-compact">
                <thead>
                  <tr>
                    <th>{view === 'order' ? 'Order No' : 'Line No'}</th>
                    <th>{view === 'order' ? 'Style' : 'Orders'}</th>
                    <th align="right">Input</th>
                    <th align="right">Output</th>
                    <th align="right">WIP</th>
                    <th>Progress</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pct = comparisonPercent(r);
                    const level = comparisonLevel(r);
                    return (
                      <tr key={r.key}>
                        <td className="erp-strong">
                          {view === 'order'
                            ? (r.order_no || '—')
                            : <StatusBadge status={r.line_no} tone="info" />}
                        </td>
                        <td>
                          {view === 'order'
                            ? (r.style || '—')
                            : `${formatNumber(r.orders.length)} order(s)`}
                        </td>
                        <td align="right" className="erp-mono">{formatNumber(r.input)}</td>
                        <td align="right" className="erp-mono">{formatNumber(r.output)}</td>
                        <td align="right" className="erp-mono erp-strong">{formatNumber(r.wip)}</td>
                        <td>
                          {/* A real progress element, so the value is available to a
                              screen reader rather than only to the eye. */}
                          <div className="erp-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% complete`}>
                            <div className={`erp-progress-fill erp-progress-fill-${level}`} style={{ width: `${pct}%` }} />
                            <span className="erp-progress-text">{formatNumber(pct)}%</span>
                          </div>
                        </td>
                        <td>
                          <SeverityDot level={level} label={statusWord(r, pct)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function statusWord(row, pct) {
  if (row.input <= 0 && row.output > 0) return 'No input recorded';
  if (row.output > row.input) return 'Output exceeds input';
  if (pct >= 100) return 'Fully finished';
  if (pct >= 80) return 'Nearly finished';
  if (pct >= 40) return 'In progress';
  return 'Barely started';
}

/* ------------------------------------------------------------------ *
 * Headline figures for the comparison.
 * ------------------------------------------------------------------ */

function ComparisonKpis({ totals, finished, atRisk, orders }) {
  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        Input vs output
        <span className="erp-panel-sub">Fed in against finished and packed</span>
      </h2>
      <div className="erp-stat-grid">
        <StatCard
          label="Material fed into lines"
          value={formatNumber(totals.totalInput)}
          unit="pcs"
          icon="🧺"
          hint={`${formatNumber(orders)} order(s) tracked`}
        />
        <StatCard
          label="Finished and packed"
          value={formatNumber(totals.totalCompletedOutput)}
          unit="pcs"
          icon="📦"
          hint="Output counted for the comparison"
        />
        <StatCard
          label="Overall completion"
          value={formatNumber(totals.completedPercent)}
          unit="%"
          icon="📈"
          level={totals.completedPercent >= 80 ? 'good' : totals.completedPercent >= 40 ? 'warning' : 'critical'}
          hint="Finished pieces as a share of material fed"
        />
        <StatCard
          label="Orders fully finished"
          value={formatNumber(finished)}
          unit={`of ${formatNumber(orders)}`}
          icon="✅"
          level={finished === orders && orders > 0 ? 'good' : 'info'}
          hint={atRisk > 0 ? `${formatNumber(atRisk)} order(s) at risk` : 'Nothing at risk'}
        />
      </div>
      <div className="erp-stat-grid">
        <StatCard
          label="Work in progress"
          value={formatNumber(totals.wip)}
          unit="pcs"
          icon="⚖️"
          level={totals.level}
          hint={`${totals.wipPercent}% of fed material still on the line`}
        />
        <StatCard
          label="Input already finished"
          value={formatNumber(totals.totalCompletedOutput)}
          unit="pcs"
          icon="🏁"
          hint="Packed or passed at end-line QC"
        />
      </div>
    </section>
  );
}

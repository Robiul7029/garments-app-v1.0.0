import { useMemo, useState } from 'react';
import {
  EmptyState, ErrorState, LoadingState, StatCard, SeverityDot, StatusBadge,
} from '../../../components/erp/Primitives';
import { RankedBarCard, formatNumber } from '../../../components/erp/Charts';
import { useLineInputWip, useLineInputWipSources } from '../../../hooks/useLineInputWip';

/**
 * ROBIUL GARMENTS ERP — WIP & Balance.
 *
 * The brief's balance, per order and line:
 *
 *      WIP = Total Line Input − Total Completed Line Output
 *
 * "Total line input" is everything recorded on the Entry tab for that order and
 * line. "Total completed line output" is what was finished and packed (packing
 * plans) or passed final inspection at the end of the line (end-line QC).
 *
 * The arithmetic lives in `config/lineInputWip`, not here: `summariseWip` rolls
 * the two sides up into one row per order + style + line and `summariseWipTotals`
 * sums those rows. This screen only filters and renders — so the table, the
 * headline cards and the bar chart are literally the same numbers, and applying a
 * filter moves all three together.
 *
 * Two things the screen refuses to hide:
 *
 *   1. WIP is never shown as a negative number. More output than input means the
 *      two records disagree — an unlogged feeding or a mis-keyed figure — which is
 *      a data problem, not negative work in progress. Those rows are flagged
 *      "Output exceeds input" instead, and counted in their own card.
 *   2. A row with no input at all is called out rather than shown as a healthy
 *      100% — it means the line was fed but nobody recorded it.
 */
export default function WipBalance() {
  const { loading, error } = useLineInputWipSources();
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [order, setOrder] = useState('');
  const [line, setLine] = useState('');

  const filters = useMemo(() => ({
    date, from: date ? '' : from, to: date ? '' : to, order_no: order, line_no: line,
  }), [date, from, to, order, line]);

  const {
    wipRows, totals, orderOptions, lineOptions, inputs,
  } = useLineInputWip(filters);

  const filtersActive = Boolean(date || from || to || order || line);
  const clearFilters = () => {
    setDate(''); setFrom(''); setTo(''); setOrder(''); setLine('');
  };

  if (loading && inputs.length === 0) {
    return <LoadingState label="Calculating work in progress…" rows={4} />;
  }
  if (error && inputs.length === 0) {
    return <ErrorState message={error} />;
  }

  const overReported = wipRows.filter((r) => r.overReported > 0);
  const unfed = wipRows.filter((r) => r.totalInput <= 0 && r.totalCompletedOutput > 0);

  /** The worst offenders first: most WIP still sitting on the floor. */
  const topWip = [...wipRows]
    .filter((r) => r.wip > 0)
    .sort((a, b) => b.wip - a.wip)
    .slice(0, 12)
    .map((r) => ({
      id: r.key,
      label: `${r.order_no || r.style || '—'} · ${r.line_no || 'Unassigned'}`,
      value: r.wip,
      level: r.level,
      hint: `${formatNumber(r.totalInput)} in · ${formatNumber(r.totalCompletedOutput)} out`,
    }));

  return (
    <div className="erp-lineinput-wip">
      <BalanceKpis totals={totals} overCount={overReported.length} unfedCount={unfed.length} />

      <BalanceFilters
        date={date} from={from} to={to} order={order} line={line}
        orderOptions={orderOptions} lineOptions={lineOptions}
        active={filtersActive}
        onDate={setDate} onFrom={setFrom} onTo={setTo} onOrder={setOrder} onLine={setLine}
        onClear={clearFilters}
      />

      <RankedBarCard
        title="Work in progress by order and line"
        icon="⚖️"
        data={topWip}
        unit="pcs"
        emptyMessage="Nothing is sitting on the floor for these filters — every piece fed has been finished."
        action={<span className="erp-panel-sub">{formatNumber(wipRows.length)} groups</span>}
      />

      <BalanceTable rows={wipRows} filtersActive={filtersActive} onClear={clearFilters} />

      {overReported.length > 0 && <DiscrepancyNote rows={overReported} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The headline figures — the brief's "WIP balance shown clearly".
 * ------------------------------------------------------------------ */

function BalanceKpis({ totals, overCount, unfedCount }) {
  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        WIP balance
        <span className="erp-panel-sub">Input − Completed output</span>
      </h2>
      <div className="erp-stat-grid">
        <StatCard
          label="Total line input"
          value={formatNumber(totals.totalInput)}
          unit="pcs"
          icon="🧺"
          hint={`${formatNumber(totals.orders)} order(s) · ${formatNumber(totals.lines)} line(s)`}
        />
        <StatCard
          label="Completed line output"
          value={formatNumber(totals.totalCompletedOutput)}
          unit="pcs"
          icon="✅"
          hint="Finished and packed, or passed end-line QC"
        />
        <StatCard
          label="Work in progress"
          value={formatNumber(totals.wip)}
          unit="pcs"
          icon="⚖️"
          level={totals.level}
          hint={`${totals.wipPercent}% of everything fed is still on the line`}
        />
        <StatCard
          label="Completion"
          value={formatNumber(totals.completedPercent)}
          unit="%"
          icon="📈"
          level={totals.completedPercent >= 80 ? 'good' : totals.completedPercent >= 40 ? 'warning' : 'critical'}
          hint="Share of fed material finished"
        />
      </div>

      {(overCount > 0 || unfedCount > 0) && (
        <div className="erp-stat-grid">
          {overCount > 0 && (
            <StatCard
              label="Groups where output exceeds input"
              value={formatNumber(overCount)}
              icon="⚠️"
              level="critical"
              hint="An unlogged feeding or a mis-keyed figure"
            />
          )}
          {unfedCount > 0 && (
            <StatCard
              label="Groups finished without any input"
              value={formatNumber(unfedCount)}
              icon="❓"
              level="warning"
              hint="Fed but never recorded on the entry form"
            />
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Filters. One row, above both the chart and the table, so the two
 * cannot describe different sets of data.
 * ------------------------------------------------------------------ */

function BalanceFilters({
  date, from, to, order, line, orderOptions, lineOptions, active, onDate, onFrom, onTo, onOrder, onLine, onClear,
}) {
  return (
    <section className="erp-panel">
      <div className="erp-filter-bar">
        <label className="erp-field erp-field-inline">
          <span className="erp-field-label">Date</span>
          <input
            type="date" className="erp-input" value={date}
            onChange={(e) => { onDate(e.target.value); if (e.target.value) { onFrom(''); onTo(''); } }}
          />
        </label>
        <label className="erp-field erp-field-inline">
          <span className="erp-field-label">From</span>
          <input type="date" className="erp-input" value={from} onChange={(e) => { onFrom(e.target.value); if (e.target.value) onDate(''); }} />
        </label>
        <label className="erp-field erp-field-inline">
          <span className="erp-field-label">To</span>
          <input type="date" className="erp-input" value={to} onChange={(e) => { onTo(e.target.value); if (e.target.value) onDate(''); }} />
        </label>
        <label className="erp-field erp-field-inline">
          <span className="erp-field-label">Order No</span>
          <select className="erp-input" value={order} onChange={(e) => onOrder(e.target.value)} aria-label="Filter by order number">
            <option value="">All orders ({orderOptions.length})</option>
            {orderOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="erp-field erp-field-inline">
          <span className="erp-field-label">Line No</span>
          <select className="erp-input" value={line} onChange={(e) => onLine(e.target.value)} aria-label="Filter by line number">
            <option value="">All lines ({lineOptions.length})</option>
            {lineOptions.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        {active && (
          <button type="button" className="btn btn-outline" onClick={onClear}>Clear filters</button>
        )}
      </div>
      <p className="erp-panel-foot">
        Leave the dates empty to see the whole history. A single Date overrides the From/To range.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The balance table — one row per order + style + line.
 * ------------------------------------------------------------------ */

function BalanceTable({ rows, filtersActive, onClear }) {
  if (rows.length === 0) {
    return (
      <section className="erp-panel">
        <h2 className="erp-panel-title">WIP by order and line</h2>
        <EmptyState
          icon="⚖️"
          title={filtersActive ? 'No balance for these filters' : 'No line input recorded yet'}
          message={filtersActive
            ? 'No feeding or output matches the filters above. Widen the date range or clear the filters.'
            : 'Record fabric or bundle feeding on the Line Input Entry tab and the balance will be calculated here automatically.'}
          action={filtersActive
            ? <button type="button" className="btn btn-outline" onClick={onClear}>Clear filters</button>
            : null}
        />
      </section>
    );
  }

  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        WIP by order and line
        <span className="erp-panel-sub">{formatNumber(rows.length)} rows</span>
      </h2>
      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>Order No</th>
              <th>Style</th>
              <th>Color</th>
              <th>Size Range</th>
              <th>Line No</th>
              <th align="right">Total Input</th>
              <th align="right">Completed Output</th>
              <th align="right">WIP Balance</th>
              <th align="right">Completion</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="erp-strong">{r.order_no || '—'}</td>
                <td>{r.style || '—'}</td>
                <td>{r.colors.length ? r.colors.join(', ') : '—'}</td>
                <td>{r.sizeRanges.length ? r.sizeRanges.join(', ') : '—'}</td>
                <td>
                  {r.line_no ? <StatusBadge status={r.line_no} tone="info" /> : <StatusBadge status="Unassigned" tone="warning" />}
                </td>
                <td align="right" className="erp-mono">{formatNumber(r.totalInput)}</td>
                <td align="right" className="erp-mono">{formatNumber(r.totalCompletedOutput)}</td>
                <td align="right" className="erp-mono erp-strong">{formatNumber(r.wip)}</td>
                <td align="right" className="erp-mono">{formatNumber(r.completedPercent)}%</td>
                <td>
                  <SeverityDot level={r.level} label={levelWord(r)} />
                </td>
              </tr>
            ))}
          </tbody>
          {/* The footer totals come from the same rows the table renders, so a
              filter cannot leave the totals describing a different set. */}
          <tfoot>
            <tr>
              <th colSpan={5}>Total ({formatNumber(rows.length)} rows)</th>
              <th align="right" className="erp-mono">{formatNumber(rows.reduce((s, r) => s + r.totalInput, 0))}</th>
              <th align="right" className="erp-mono">{formatNumber(rows.reduce((s, r) => s + r.totalCompletedOutput, 0))}</th>
              <th align="right" className="erp-mono">{formatNumber(rows.reduce((s, r) => s + r.wip, 0))}</th>
              <th colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** The level word beside the dot — never colour alone. */
function levelWord(row) {
  if (row.totalInput <= 0 && row.totalCompletedOutput > 0) return 'No input recorded';
  if (row.overReported > 0) return 'Output exceeds input';
  if (row.wip <= 0) return 'Fully completed';
  return row.level === 'warning' ? 'High WIP' : 'In progress';
}

/* ------------------------------------------------------------------ *
 * The discrepancy note. A negative balance is a records problem, so it
 * is stated rather than swallowed by a floor of zero.
 * ------------------------------------------------------------------ */

function DiscrepancyNote({ rows }) {
  return (
    <section className="erp-panel">
      <h2 className="erp-panel-title">
        ⚠️ Output exceeds input
        <span className="erp-panel-sub">{formatNumber(rows.length)} group(s)</span>
      </h2>
      <p className="erp-panel-sub">
        These groups have completed more pieces than were recorded as fed. WIP cannot be negative, so the
        balance is shown as zero and the excess is listed here instead. It almost always means a feeding was
        never entered on the Line Input Entry tab, or a quantity was keyed into the wrong field.
      </p>
      <div className="erp-table-wrap">
        <table className="erp-table erp-table-compact">
          <thead>
            <tr>
              <th>Order No</th>
              <th>Style</th>
              <th>Line No</th>
              <th align="right">Total Input</th>
              <th align="right">Completed Output</th>
              <th align="right">Excess</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="erp-strong">{r.order_no || '—'}</td>
                <td>{r.style || '—'}</td>
                <td>{r.line_no || 'Unassigned'}</td>
                <td align="right" className="erp-mono">{formatNumber(r.totalInput)}</td>
                <td align="right" className="erp-mono">{formatNumber(r.totalCompletedOutput)}</td>
                <td align="right" className="erp-mono erp-level-critical">{formatNumber(r.overReported)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

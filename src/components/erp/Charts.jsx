import React, { useId, useMemo, useState } from 'react';
import { LEVEL_DOT } from '../../utils/erpCalculations';

/**
 * ROBIUL GARMENTS ERP — charts.
 *
 * No charting library is used here on purpose. The factory runs this app on
 * cheap Android phones over a slowworkshop connection, so a 400 KB charting
 * bundle is a real cost. Everything below is a handful of absolutely
 * positioned divs — it renders instantly, needs no layout pass from a canvas,
 * and inherits the `erp-` design tokens, so it looks native to the app.
 *
 * Every chart is responsive by construction: widths are percentages and the
 * plot height is fixed in `em`, so the same markup works from a 320 px phone to
 * a 1600 px desktop without a resize listener.
 *
 * Accessibility: a chart is decorative, the NUMBER is not. Each chart is
 * `role="img"` with an aria-label summarising it, and the same figures are
 * always available in the table beside it, so nothing is colour-only.
 */

const RAMP = ['#38bdf8', '#2dd4bf', '#f59e0b', '#a78bfa', '#fb7185', '#a3e635'];

/** `pct` of a total, guarded so a zero total never yields NaN in a style string. */
function share(value, total) {
  const t = Number(total);
  const v = Number(value);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, (v / t) * 100));
}

export function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

/** Trims a long label so it cannot push a chart row out of its column. */
function shortLabel(label, max = 22) {
  const text = String(label ?? '').trim();
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ------------------------------------------------------------------ *
 * Grouped bar chart — "Target vs Actual" style comparisons.
 * ------------------------------------------------------------------ */

export function BarChartCard({
  title,
  icon = '📊',
  data = [],
  series = [],
  height = 190,
  emptyMessage = 'No data to chart yet.',
  action,
}) {
  const [showTable, setShowTable] = useState(false);
  const headingId = useId();
  const rows = Array.isArray(data) ? data : [];

  // The peak of every series decides the scale, and the tick labels are three
  // round-ish steps of it — enough to read the chart, not a full axis engine.
  const peak = useMemo(() => {
    let max = 0;
    rows.forEach((row) => {
      series.forEach((s) => {
        const v = Number(row?.[s.key]);
        if (Number.isFinite(v) && v > max) max = v;
      });
    });
    return max;
  }, [rows, series]);

  const ticks = useMemo(() => {
    if (peak <= 0) return [0, 0, 0];
    return [peak, Math.round(peak / 2), 0];
  }, [peak]);

  const summary = rows
    .slice(0, 8)
    .map((row) => `${row.label}: ${series.map((s) => `${s.label} ${formatNumber(row[s.key])}`).join(', ')}`)
    .join('; ');

  return (
    <section className="erp-chart-card" aria-labelledby={headingId}>
      <header className="erp-chart-head">
        <h3 className="erp-chart-title" id={headingId}>
          <span aria-hidden="true">{icon}</span> {title}
        </h3>
        <div className="erp-chart-head-actions">
          {action}
          <button
            type="button"
            className="erp-chart-toggle"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? 'Chart' : 'Values'}
          </button>
        </div>
      </header>

      <div className="erp-chart-legend">
        {series.map((s, i) => (
          <span key={s.key} className="erp-legend-item">
            <span className="erp-legend-dot" style={{ background: s.color || RAMP[i % RAMP.length] }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="erp-chart-empty">{emptyMessage}</p>
      ) : showTable ? (
        <div className="erp-table-wrap">
          <table className="erp-table erp-table-compact">
            <thead>
              <tr>
                <th>Group</th>
                {series.map((s) => <th key={s.key} align="right">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id ?? row.label}>
                  <td className="erp-strong">{row.label}</td>
                  {series.map((s) => (
                    <td key={s.key} align="right" className="erp-mono">{formatNumber(row[s.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="erp-chart-plot" style={{ '--erp-plot-height': `${height}px` }} role="img" aria-label={`${title}. ${summary}`}>
          <div className="erp-chart-grid" aria-hidden="true">
            {ticks.map((t, i) => (
              <div key={i} className="erp-chart-grid-line">
                <span className="erp-chart-grid-label">{formatNumber(t)}</span>
              </div>
            ))}
          </div>
          <div className="erp-chart-columns">
            {rows.map((row, rowIndex) => (
              <div className="erp-chart-column" key={row.id ?? row.label}>
                <div className="erp-chart-stack">
                  {series.map((s, i) => {
                    const pct = peak > 0 ? share(row[s.key], peak) : 0;
                    const color = s.color || RAMP[i % RAMP.length];
                    const level = row.level && series.length === 1 ? ` ${LEVEL_DOT[row.level]}` : '';
                    return (
                      <div
                        key={s.key}
                        className="erp-chart-bar"
                        style={{ height: `${pct}%`, background: color }}
                        title={`${row.label} · ${s.label}: ${formatNumber(row[s.key])}${level}`}
                      />
                    );
                  })}
                </div>
                <span className="erp-chart-tick" title={row.label}>{shortLabel(row.label)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Donut chart — a status breakdown where the parts sum to a whole.
 * ------------------------------------------------------------------ */

export function DonutChartCard({
  title,
  icon = '🍩',
  data = [],
  centerLabel = 'Total',
  centerValue,
  emptyMessage = 'Nothing to break down yet.',
}) {
  const headingId = useId();
  const rows = (Array.isArray(data) ? data : []).filter((r) => Number(r.value) > 0);
  const total = rows.reduce((s, r) => s + Number(r.value || 0), 0);

  // Building the conic gradient as one string keeps the whole ring in a single
  // element: no SVG, no nested divs, and it scales with the box.
  const gradient = useMemo(() => {
    if (total <= 0) return 'var(--erp-border)';
    let cursor = 0;
    return `conic-gradient(${rows.map((r, i) => {
      const from = cursor;
      cursor += (Number(r.value) / total) * 100;
      const color = r.color || RAMP[i % RAMP.length];
      return `${color} ${from.toFixed(2)}% ${cursor.toFixed(2)}%`;
    }).join(', ')})`;
  }, [rows, total]);

  const summary = rows.map((r) => `${r.label} ${formatNumber(r.value)}`).join(', ');

  return (
    <section className="erp-chart-card" aria-labelledby={headingId}>
      <header className="erp-chart-head">
        <h3 className="erp-chart-title" id={headingId}>
          <span aria-hidden="true">{icon}</span> {title}
        </h3>
      </header>

      {rows.length === 0 ? (
        <p className="erp-chart-empty">{emptyMessage}</p>
      ) : (
        <div className="erp-donut-wrap">
          <div
            className="erp-donut"
            style={{ background: gradient }}
            role="img"
            aria-label={`${title}. ${summary}.`}
          >
            <div className="erp-donut-hole">
              <span className="erp-donut-value">{formatNumber(centerValue ?? total)}</span>
              <span className="erp-donut-label">{centerLabel}</span>
            </div>
          </div>

          <ul className="erp-donut-legend">
            {rows.map((r, i) => (
              <li key={r.id ?? r.label}>
                <span className="erp-legend-dot" style={{ background: r.color || RAMP[i % RAMP.length] }} aria-hidden="true" />
                <span className="erp-donut-legend-label">{r.label}</span>
                <span className="erp-donut-legend-value">{formatNumber(r.value)}</span>
                <span className="erp-donut-legend-pct">{share(r.value, total).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Horizontal bars — ranked magnitudes with a threshold marker.
 * Used for the stock graph and the department flow, where the LABEL is as
 * important as the length, which is exactly what a vertical bar hides.
 * ------------------------------------------------------------------ */

export function RankedBarCard({
  title,
  icon = '📈',
  data = [],
  unit = '',
  threshold,
  thresholdLabel = 'Minimum',
  emptyMessage = 'No data to rank yet.',
  action,
}) {
  const headingId = useId();
  const rows = Array.isArray(data) ? data : [];
  const peak = rows.reduce((m, r) => Math.max(m, Number(r.value) || 0), 0);

  return (
    <section className="erp-chart-card" aria-labelledby={headingId}>
      <header className="erp-chart-head">
        <h3 className="erp-chart-title" id={headingId}>
          <span aria-hidden="true">{icon}</span> {title}
        </h3>
        {(action || threshold != null) && (
          <div className="erp-chart-head-actions">
            {action}
            {threshold != null && (
              <span className="erp-chart-threshold-key">
                <span className="erp-chart-threshold-mark" aria-hidden="true" /> {thresholdLabel} {formatNumber(threshold)}{unit ? ` ${unit}` : ''}
              </span>
            )}
          </div>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="erp-chart-empty">{emptyMessage}</p>
      ) : (
        <ul className="erp-ranked-list">
          {rows.map((row) => {
            const width = peak > 0 ? share(row.value, peak) : 0;
            const markPct = peak > 0 && threshold != null ? share(threshold, peak) : null;
            const level = row.level || 'info';
            return (
              <li key={row.id ?? row.label} className="erp-ranked-row">
                <div className="erp-ranked-head">
                  <span className="erp-ranked-label" title={row.label}>
                    {row.icon ? `${row.icon} ` : ''}{shortLabel(row.label, 30)}
                  </span>
                  <span className="erp-ranked-value">
                    {formatNumber(row.value)}{unit ? ` ${unit}` : ''}
                  </span>
                </div>
                <div className="erp-ranked-track" role="img" aria-label={`${row.label}: ${formatNumber(row.value)}${unit ? ` ${unit}` : ''}`}>
                  <div
                    className={`erp-ranked-fill erp-ranked-fill-${level}`}
                    style={{ width: `${width}%` }}
                  />
                  {markPct != null && <div className="erp-ranked-marker" style={{ left: `${markPct}%` }} aria-hidden="true" />}
                </div>
                {row.hint && <div className="erp-ranked-hint">{row.hint}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * KPI card with an inline sparkline and a live delta.
 * ------------------------------------------------------------------ */

export function ChartStatCard({ label, value, unit, icon, hint, level, trend = [], onClick }) {
  const Tag = onClick ? 'button' : 'div';
  const raw = trend.map((v) => Number(v) || 0);
  const peak = raw.reduce((m, v) => Math.max(m, v), 0);
  const last = raw.length ? raw[raw.length - 1] : 0;
  const previous = raw.length > 1 ? raw[raw.length - 2] : null;
  const delta = previous && previous !== 0
    ? Math.round(((last - previous) / previous) * 100)
    : null;

  return (
    <Tag
      className={`erp-stat erp-stat-spark${onClick ? ' erp-stat-clickable' : ''}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
    >
      <div className="erp-stat-label">
        {icon && <span className="erp-stat-icon" aria-hidden="true">{icon}</span>}
        {label}
      </div>
      <div className={`erp-stat-value${level ? ` erp-level-${level}` : ''}`}>
        {level && <span aria-hidden="true">{LEVEL_DOT[level]}</span>}{' '}
        <span className="erp-stat-number">{value}</span>
        {unit && <span className="erp-stat-unit">{unit}</span>}
      </div>

      <div className="erp-spark-row">
        {raw.length > 1 ? (
          <span className="erp-spark" role="img" aria-label={`Recent trend: ${raw.join(', ')}`}>
            {raw.map((v, i) => (
              <span
                key={i}
                className={`erp-spark-bar${i === raw.length - 1 ? ' erp-spark-bar-last' : ''}`}
                style={{ height: `${peak > 0 ? Math.max(8, (v / peak) * 100) : 8}%` }}
              />
            ))}
          </span>
        ) : <span className="erp-spark-empty" />}

        {delta !== null && delta !== 0 && (
          <span className={`erp-delta ${delta > 0 ? 'erp-delta-up' : 'erp-delta-down'}`}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}%
          </span>
        )}
      </div>

      {hint && <div className="erp-stat-hint">{hint}</div>}
    </Tag>
  );
}

export { RAMP as CHART_RAMP };

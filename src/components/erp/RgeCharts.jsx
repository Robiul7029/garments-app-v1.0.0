import { useId, useMemo, useState } from 'react';

/**
 * ROBIUL GARMENTS ERP — dashboard charts.
 *
 * The chart primitives for the new dashboard design, in that design's own
 * language rather than the dark `erp-` one. No charting library: the factory
 * runs this on cheap Android phones over a slow workshop connection, so a
 * 400 KB bundle is a real cost. These are absolutely-positioned divs — they
 * render instantly, need no canvas layout pass, and are responsive by
 * construction (percentage widths, `em` heights, no resize listener).
 *
 * Accessibility: a chart is decorative, the NUMBER is not. Every chart carries
 * `role="img"` with an aria-label summarising it, and the same figures are
 * available in the table beside it — so nothing here is colour-only.
 *
 * These are deliberately separate from `Charts.jsx`: that file styles itself
 * with the shared `--erp-*` tokens and is used by screens this design does not
 * touch. Merging the two would repaint those screens.
 */

const RAMP = ['#38bdf8', '#2dd4bf', '#f59e0b', '#a78bfa', '#fb7185', '#a3e635'];

/** A percentage of a total, guarded so a zero total never yields NaN in a style. */
export function share(value, total) {
  const t = Number(total);
  const v = Number(value);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, (v / t) * 100));
}

export function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

/** Trims a long label so it cannot push a chart column out of its grid track. */
function shortLabel(label, max = 14) {
  const text = String(label ?? '').trim();
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ------------------------------------------------------------------ *
 * Grouped bar chart — target vs actual per line, over time, and so on.
 * ------------------------------------------------------------------ */

export function RgeBarChart({
  data = [],
  series = [],
  height = 190,
  emptyMessage = 'No data to chart yet.',
}) {
  const [showTable, setShowTable] = useState(false);
  const headingId = useId();
  const rows = Array.isArray(data) ? data : [];

  // The tallest value of any series sets the scale.
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

  const summary = rows
    .slice(0, 8)
    .map((row) => `${row.label}: ${series.map((s) => `${s.label} ${formatNumber(row[s.key])}`).join(', ')}`)
    .join('; ');

  if (rows.length === 0) {
    return <p className="rge-empty">{emptyMessage}</p>;
  }

  return (
    <div>
      <div className="rge-card-title" id={headingId} style={{ marginBottom: 10 }}>
        <div className="rge-chart-legend" style={{ margin: 0 }}>
          {series.map((s, i) => (
            <span key={s.key} className="rge-legend-item">
              <span
                className="rge-legend-dot"
                style={{ background: s.color || RAMP[i % RAMP.length] }}
                aria-hidden="true"
              />
              {s.label}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="rge-segment"
          aria-pressed={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'Chart' : 'Values'}
        </button>
      </div>

      {showTable ? (
        <div className="rge-table-wrap">
          <table className="rge-table">
            <thead>
              <tr>
                <th>Group</th>
                {series.map((s) => <th key={s.key} className="rge-num">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id ?? row.label}>
                  <td>{row.label}</td>
                  {series.map((s) => (
                    <td key={s.key} className="rge-num">{formatNumber(row[s.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="rge-chart-plot"
          style={{ '--rge-plot-height': `${height}px` }}
          role="img"
          aria-label={summary}
        >
          {rows.map((row) => (
            <div className="rge-chart-col" key={row.id ?? row.label}>
              <div className="rge-chart-stack">
                {series.map((s, i) => {
                  const pct = peak > 0 ? share(row[s.key], peak) : 0;
                  const color = s.color || RAMP[i % RAMP.length];
                  return (
                    <span
                      key={s.key}
                      className="rge-chart-bar"
                      style={{ height: `${pct}%`, background: color }}
                      title={`${row.label} · ${s.label}: ${formatNumber(row[s.key])}`}
                    />
                  );
                })}
              </div>
              <span className="rge-chart-label" title={row.label}>{shortLabel(row.label)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Horizontal ranked bars — the stock graph and the orders-by-buyer chart,
 * where the LABEL matters as much as the length, which a vertical bar hides.
 * ------------------------------------------------------------------ */

export function RgeRankedBars({
  data = [],
  unit = '',
  threshold,
  thresholdLabel = 'Minimum',
  emptyMessage = 'No data to rank yet.',
}) {
  const rows = Array.isArray(data) ? data : [];
  const peak = rows.reduce((m, r) => Math.max(m, Number(r.value) || 0), 0);

  if (rows.length === 0) {
    return <p className="rge-empty">{emptyMessage}</p>;
  }

  return (
    <ul className="rge-ranked">
      {rows.map((row) => {
        const width = peak > 0 ? share(row.value, peak) : 0;
        const markPct = peak > 0 && threshold != null ? share(threshold, peak) : null;
        const level = row.level || 'info';
        return (
          <li key={row.id ?? row.label}>
            <div className="rge-ranked-head">
              <span className="rge-ranked-label" title={row.label}>
                {row.icon ? `${row.icon} ` : ''}{row.label}
              </span>
              <span className={`rge-ranked-value rge-level-${level}`}>
                {formatNumber(row.value)}{unit ? ` ${unit}` : (row.unit ? ` ${row.unit}` : '')}
              </span>
            </div>
            <div
              className={`rge-bar rge-bar-${level}`}
              role="img"
              aria-label={`${row.label}: ${formatNumber(row.value)}${row.unit ? ` ${row.unit}` : ''}`}
            >
              <span style={{ width: `${width}%` }} />
              {markPct != null && (
                <span className="rge-ranked-marker" style={{ left: `${markPct}%` }} aria-hidden="true" />
              )}
            </div>
            {row.hint && <div className="rge-ranked-hint">{row.hint}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Production flow — the staged progress bars from the design.
 * ------------------------------------------------------------------ */

export function RgeFlowChart({ stages = [], colors = {} }) {
  if (stages.length === 0) {
    return <p className="rge-empty">No production recorded today.</p>;
  }
  return (
    <div role="img" aria-label={stages.map((s) => `${s.stage} ${s.value}%`).join(', ')}>
      {stages.map((s) => (
        <div className="rge-flow-row" key={s.stage}>
          <div className="rge-flow-head">
            <span>{s.stage}</span>
            <b>{s.value}%</b>
          </div>
          <div className="rge-bar">
            <span style={{ width: `${s.value}%`, background: colors[s.stage] || 'var(--rge-accent)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Donut — a status breakdown whose parts sum to a whole.
 * ------------------------------------------------------------------ */

export function RgeDonut({ data = [], centerLabel = 'Total', centerValue, emptyMessage = 'Nothing to break down yet.' }) {
  const rows = (Array.isArray(data) ? data : []).filter((r) => Number(r.value) > 0);
  const total = rows.reduce((s, r) => s + Number(r.value || 0), 0);

  // One conic-gradient string keeps the whole ring in a single element: no SVG,
  // no nested divs, and it scales with the box.
  const gradient = useMemo(() => {
    if (total <= 0) return 'var(--rge-line)';
    let cursor = 0;
    return `conic-gradient(${rows.map((r, i) => {
      const from = cursor;
      cursor += (Number(r.value) / total) * 100;
      const color = r.color || RAMP[i % RAMP.length];
      return `${color} ${from.toFixed(2)}% ${cursor.toFixed(2)}%`;
    }).join(', ')})`;
  }, [rows, total]);

  if (rows.length === 0) {
    return <p className="rge-empty">{emptyMessage}</p>;
  }

  return (
    <div className="rge-donut-wrap">
      <div
        className="rge-donut"
        style={{ background: gradient }}
        role="img"
        aria-label={rows.map((r) => `${r.label} ${formatNumber(r.value)}`).join(', ')}
      >
        <div className="rge-donut-hole">
          <span className="rge-donut-value">{formatNumber(centerValue ?? total)}</span>
          <span className="rge-donut-label">{centerLabel}</span>
        </div>
      </div>
      <ul className="rge-donut-legend">
        {rows.map((r, i) => (
          <li key={r.id ?? r.label}>
            <span
              className="rge-legend-dot"
              style={{ background: r.color || RAMP[i % RAMP.length] }}
              aria-hidden="true"
            />
            <span className="rge-donut-legend-label">{r.label}</span>
            <span className="rge-donut-legend-value">{formatNumber(r.value)}</span>
            <span className="rge-donut-legend-pct">{share(r.value, total).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { RAMP as RGE_RAMP };
/* ------------------------------------------------------------------ *
 * Radial gauge — the "Production Efficiency 76%" dial from the design.
 *
 * A filled arc drawn as a conic gradient clipped to a half-ring, with the
 * figure in the middle. Same reasoning as the donut: one element, no SVG, no
 * canvas, and it scales with its box.
 * ------------------------------------------------------------------ */

export function RgeGauge({ value = 0, label, size = 120, level }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = level || (pct >= 90 ? 'good' : pct >= 75 ? 'warning' : 'critical');
  const color = tone === 'good' ? '#16834a' : tone === 'warning' ? '#b7791f' : '#c53030';

  // A 240° sweep starting bottom-left, so the dial reads like a speedometer
  // rather than a full circle — the shape the design uses.
  const SWEEP = 240;
  const filled = (pct / 100) * SWEEP;

  return (
    <div
      className="rge-gauge"
      style={{ width: size, height: size * 0.72 }}
      role="img"
      aria-label={`${label || 'Efficiency'}: ${pct.toFixed(0)} percent`}
    >
      <div
        className="rge-gauge-arc"
        style={{
          background: `conic-gradient(from 240deg, ${color} 0deg ${filled}deg, #e9eef5 ${filled}deg ${SWEEP}deg, transparent ${SWEEP}deg 360deg)`,
        }}
      />
      <div className="rge-gauge-hole">
        <span className="rge-gauge-value" style={{ color }}>{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Horizontal stacked bars — the "Production Status" panel, where each stage
 * is split into its contributing bands and the scale is shared across rows.
 * ------------------------------------------------------------------ */

export function RgeStackedBars({ rows = [], series = [], max, tickCount = 5, emptyMessage = 'No data yet.' }) {
  const safe = Array.isArray(rows) ? rows : [];
  if (safe.length === 0) return <p className="rge-empty">{emptyMessage}</p>;

  // One scale for every row, or the bars would not be comparable — and a shared
  // scale is the entire point of stacking them in a column.
  const peak = Number.isFinite(max) && max > 0
    ? max
    : safe.reduce((m, r) => Math.max(m, series.reduce((s, k) => s + (Number(r[k.key]) || 0), 0)), 0);

  const ticks = [];
  if (peak > 0) {
    for (let i = 0; i <= tickCount; i += 1) ticks.push(Math.round((peak / tickCount) * i));
  }

  return (
    <div className="rge-stack">
      <div className="rge-stack-body">
        <div className="rge-stack-axis" aria-hidden="true">
          {safe.map((r) => <span key={r.id ?? r.label} className="rge-stack-axis-label">{r.label}</span>)}
        </div>

        <div className="rge-stack-plot">
          {safe.map((row) => (
            <div className="rge-stack-row" key={row.id ?? row.label}>
              {series.map((s, i) => {
                const v = Number(row[s.key]) || 0;
                const w = peak > 0 ? (v / peak) * 100 : 0;
                if (w <= 0) return null;
                return (
                  <span
                    key={s.key}
                    className="rge-stack-seg"
                    style={{ width: `${w}%`, background: s.color || RAMP[i % RAMP.length] }}
                    title={`${row.label} · ${s.label}: ${formatNumber(v)}`}
                  />
                );
              })}
            </div>
          ))}

          {ticks.length > 0 && (
            <div className="rge-stack-ticks" aria-hidden="true">
              {ticks.map((t) => <span key={t} className="rge-stack-tick">{formatNumber(t)}</span>)}
            </div>
          )}
        </div>
      </div>

      <div className="rge-chart-legend">
        {series.map((s, i) => (
          <span key={s.key} className="rge-legend-item">
            <span className="rge-legend-dot" style={{ background: s.color || RAMP[i % RAMP.length] }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Grouped vertical bars — the "Inventory Overview" panel. Two series side by
 * side per item, with the count above each bar and a hover tooltip.
 * ------------------------------------------------------------------ */

export function RgeGroupedBars({ rows = [], series = [], height = 220, emptyMessage = 'No data yet.' }) {
  const [hover, setHover] = useState(null);
  const safe = Array.isArray(rows) ? rows : [];
  if (safe.length === 0) return <p className="rge-empty">{emptyMessage}</p>;

  const peak = safe.reduce((m, r) => Math.max(m, series.reduce((s, k) => Math.max(s, Number(r[k.key]) || 0), 0)), 0);

  return (
    <div className="rge-grouped">
      <div className="rge-grouped-plot" style={{ '--rge-grouped-height': `${height}px` }}>
        {safe.map((row) => (
          <div className="rge-grouped-col" key={row.id ?? row.label}>
            <div className="rge-grouped-bars">
              {series.map((s, i) => {
                const v = Number(row[s.key]) || 0;
                const h = peak > 0 ? Math.max(2, (v / peak) * 100) : 2;
                const color = s.color || RAMP[i % RAMP.length];
                return (
                  <span
                    key={s.key}
                    className="rge-grouped-bar"
                    style={{ height: `${h}%`, background: color }}
                    onMouseEnter={() => setHover({ row: row.label, label: s.label, value: v, unit: row.unit })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <span className="rge-grouped-cap">{formatNumber(v)}</span>
                  </span>
                );
              })}
            </div>
            <span className="rge-chart-label" title={row.label}>{shortLabel(row.label, 12)}</span>
          </div>
        ))}

        {hover && (
          <div className="rge-tip" role="status">
            <b>{hover.row}</b>
            <span>{hover.label}: {formatNumber(hover.value)}{hover.unit ? ` ${hover.unit}` : ''}</span>
          </div>
        )}
      </div>

      <div className="rge-chart-legend">
        {series.map((s, i) => (
          <span key={s.key} className="rge-legend-item">
            <span className="rge-legend-dot" style={{ background: s.color || RAMP[i % RAMP.length] }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

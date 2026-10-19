import React from 'react';
import { useLineInputWip } from '../hooks/useLineInputWip';
import { MODULE } from '../config/erpRoles';
import { erpModulePath } from '../config/erpMenu';
import { comparisonLevel } from '../config/lineInputWip';

/**
 * ROBIUL GARMENTS ERP — Work in Progress on the Overall Summary Dashboard.
 *
 * The brief asks for WIP to be visible in the Overall Summary as well as on its
 * own screen. This panel is that line in the summary:
 *
 *      WIP = Total Line Input − Total Completed Line Output
 *
 *   Total line input          everything Cutting has fed into the sewing lines
 *   Total completed output    what was finished and packed (plus end-line passed)
 *   Work in progress          the balance still sitting on the lines
 *
 * It is the SAME arithmetic the WIP & Balance tab shows, computed by the same
 * tested functions in `config/lineInputWip`, so the summary and the dedicated
 * screen cannot report two different WIP figures for the same factory. The panel
 * deliberately reads the ERP collections directly rather than the day's hourly
 * rows, because WIP is a balance carried across days — a line fed yesterday and
 * finished today still has to balance today.
 *
 * A single day's figure would be misleading, so this shows the whole open
 * balance and links to the WIP tab for the per-order detail and the date filter.
 */
export default function LineInputWipSummaryPanel() {
  const { totals, byOrder } = useLineInputWip();

  const topOrders = byOrder.slice(0, 5);
  const finishedOrders = byOrder.filter((r) => comparisonLevel(r) === 'good').length;

  return (
    <section className="dp-card" aria-label="Line input and work in progress">
      <h3 className="dp-card-title">
        Line Input &amp; Work in Progress
        <span className="dp-card-sub">input from Cutting against finished, packed output</span>
      </h3>

      <div className="dp-kpi-row">
        <WipStat
          icon="🧺"
          label="Total Line Input"
          value={totals.totalInput}
          unit="pcs"
          sub={`fed from Cutting into ${totals.lines} line(s)`}
        />
        <WipStat
          icon="📦"
          label="Completed Line Output"
          value={totals.totalCompletedOutput}
          unit="pcs"
          sub="finished and packed, or passed end-line QC"
        />
        <WipStat
          icon="⚖️"
          label="Work in Progress"
          value={totals.wip}
          unit="pcs"
          sub={`${totals.wipPercent}% of everything fed is still on the line`}
          tone={totals.level}
        />
        <WipStat
          icon="📈"
          label="Completion"
          value={totals.completedPercent}
          unit="%"
          sub={`${finishedOrders} order(s) fully finished of ${byOrder.length}`}
          tone={totals.completedPercent >= 80 ? 'good' : totals.completedPercent >= 40 ? 'warning' : 'critical'}
        />
      </div>

      {topOrders.length === 0 ? (
        <p className="dp-empty">
          No line input recorded yet. Feeding is entered on Line Input &amp; WIP → Line Input Entry.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="dp-table">
            <thead>
              <tr>
                <th>Order No</th>
                <th>Style</th>
                <th className="dp-num">Input</th>
                <th className="dp-num">Completed Output</th>
                <th className="dp-num">WIP Balance</th>
                <th className="dp-num">Completion</th>
              </tr>
            </thead>
            <tbody>
              {topOrders.map((r) => {
                const pct = r.completedPercent;
                const tone = comparisonLevel(r);
                return (
                  <tr key={r.key}>
                    <td className="dp-strong">{r.order_no || '—'}</td>
                    <td>{r.style || '—'}</td>
                    <td className="mono-cell dp-num">{r.input.toLocaleString()}</td>
                    <td className="mono-cell dp-num">{r.output.toLocaleString()}</td>
                    <td className="mono-cell dp-num">{r.wip.toLocaleString()}</td>
                    <td className="mono-cell dp-num">
                      <span className={`dp-eff-badge ${pct >= 80 ? 'dp-good' : pct >= 40 ? '' : 'dp-bad'}`}>
                        {pct}%
                      </span>
                      {/* Output above input is a data discrepancy, and is named rather than
                          silently floored to a 100% completion figure. */}
                      {tone === 'critical' && r.overReported > 0 && (
                        <em className="dp-performer-sub"> · output exceeds input by {r.overReported.toLocaleString()}</em>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Deliberately NOT a <Link>: this panel is also rendered bare by the
          summary's tests and can be embedded outside a Router, where a Link
          throws. The named destination is enough to find the screen. */}
      <p className="rge-ranked-hint" style={{ marginTop: 12 }}>
        Open <strong>Line Input &amp; WIP</strong> for the per-order balance, the
        line-wise view and the Input vs Output comparison.
      </p>
    </section>
  );
}

/** One headline figure in the WIP panel, matching the dashboard's KPI styling. */
function WipStat({ icon, label, value, unit, sub, tone }) {
  return (
    <div className="dp-card dp-kpi-card">
      <div className="dp-kpi-label">
        <span aria-hidden="true">{icon}</span> {label}
      </div>
      <div className={`dp-kpi-value${tone ? ` dp-kpi-${tone}` : ''}`}>
        {Number(value).toLocaleString()}
        {unit && <span className="dp-kpi-unit"> {unit}</span>}
      </div>
      {sub && <div className="dp-kpi-sub">{sub}</div>}
    </div>
  );
}

import React, { useEffect, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useErpData } from '../context/ErpDataContext';
import { summariseDay, monthKeyOf } from '../config/productionAggregation';
import { QC_COLLECTION } from '../config/hourlyEntryMode';
import {
  monthlyCollectionFor,
  summariseLineOutputMonth,
  lineOutputRowsForDate,
} from '../config/monthlyLineOutput';
import { effTone } from './DailyEmployeeSheet';
import MasterBuyerOrderSummaryTable from './MasterBuyerOrderSummaryTable';
import LineOutputPanel from './LineOutputPanel';
import LineInputWipSummaryPanel from './LineInputWipSummaryPanel';

/**
 * ROBIUL GARMENTS ERP — Daily Production, Tab 3: the Overall Summary Dashboard.
 *
 * The high-level picture for one day, built from the same hourly rows the other
 * two tabs read — so the numbers here can never disagree with the detail behind
 * them. The brief asks for four things, and each is a KPI card:
 *
 *   Total Factory Completed Output   every piece recorded today
 *   Process-wise Completed Output    the same total broken down per process
 *   Target vs Achievement            the day's target and the % reached
 *   Total Defects                    what was recorded as faulty
 *
 * The bar charts are drawn with plain divs rather than a chart library: the shapes
 * are simple ranked bars, and a factory floor monitor renders them instantly.
 *
 * BELOW THE KPI CARDS: LINE OUTPUT, LINE INPUT & WIP, THEN THE MASTER TABLE
 * -----------------------------------------------------------------------------
 * The brief asks for Work in Progress to be visible here as well as on its own
 * screen: `WIP = Total Line Input − Total Completed Line Output`. LINE INPUT &
 * WIP is that line — the same arithmetic the WIP & Balance tab computes, read
 * from the same pure functions, so the summary and the dedicated screen cannot
 * report two different balances for the same factory.
 *
 * The brief adds a second half to this tab. First the LINE OUTPUT — the summed
 * operator output for the operation the style's process sheet designated as the
 * line-output process (set by the file's own column or the in-app dropdown), with
 * a manual override guarded by a confirmation dialog. Then the per-ORDER master
 * table, keyed on the Order No the hourly entries were booked against, with its
 * Buyer, Style, PO Qty, Floor, Line and Supervisor pulled from the order master
 * and its output, manpower and targets rolled up from the same hourly rows the
 * cards above read. Both live in their own components so this file stays the
 * day's headline.
 */
export default function OverallSummaryDashboard({ date }) {
  const { getData } = useData();
  const erp = useErpData();
  const rows = getData('hourly-timesheet-rows');
  // The OTHER collection the unified entry form writes to. A QC Product Check is
  // an inspection, not output, so it is kept out of the production totals — but
  // the brief wants the day's QC picture on this screen, so it is read here and
  // surfaced as its own card.
  const localQc = getData('quality-control');

  // The ERP mirror of the same checks, live from Firestore. A QC check is written
  // to BOTH stores by the entry form, so this subscription is what makes the card
  // reflect a check saved in another tab, on another machine, without a reload.
  useEffect(() => {
    return erp.subscribe('summaryQc', { collection: QC_COLLECTION, pageSize: 500 });
  }, [erp.subscribe]);

  /**
   * The local checks and the ERP mirror, deduplicated.
   *
   * The two stores hold the same check, so counting both would double every QC
   * figure. A check is identified by date + line + process + checked quantity,
   * which together name one inspection — the same reasoning `mergeCuttingEntries`
   * uses for the cutting register. The LOCAL row wins, because it is the one the
   * floor's own screens edit.
   */
  const qcRows = useMemo(() => {
    const keyOf = (row) => [
      String(row?.date || '').slice(0, 10),
      String(row?.line || row?.line_no || '').trim().toLowerCase(),
      String(row?.process || '').trim().toLowerCase(),
      Number(row?.total_checked ?? row?.checked) || 0,
    ].join('||');
    const seen = new Set(localQc.map(keyOf));
    const erpOnly = erp.rows('summaryQc').filter((row) => {
      const key = keyOf(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...localQc, ...erpOnly];
  }, [localQc, erp]);

  const summary = useMemo(() => summariseDay(rows, date, qcRows), [rows, date, qcRows]);
  const monthKey = monthKeyOf(date);

  /**
   * Total Line Output is kept MONTH BY MONTH (`line-output-YYYY-MM`), so this tab
   * reads the collection of the month it is showing rather than filtering all
   * history. Stepping back a month opens that month's book.
   */
  const lineCollection = monthlyCollectionFor(monthKey);
  const monthLineRows = lineCollection ? getData(lineCollection) : [];
  const lineMonth = useMemo(
    () => summariseLineOutputMonth(monthLineRows),
    [monthLineRows],
  );
  const lineToday = useMemo(
    () => lineOutputRowsForDate(monthLineRows, date),
    [monthLineRows, date],
  );
  // Today's line total is already inside `rows`: the form writes each line entry to
  // `daily-production` as well, which is what makes the KPI cards above move the
  // moment it is saved. This is the day's share of that figure, for the card below.
  const lineTodayOutput = useMemo(
    () => lineToday.reduce((sum, r) => sum + (Number(r.achievement ?? r.output ?? r.quantity) || 0), 0),
    [lineToday],
  );

  // The month's running total, so the day's figure has context.
  const monthPieces = useMemo(
    () => rows
      .filter((r) => monthKeyOf(r.date) === monthKey)
      .reduce((sum, r) => sum + (Object.values(r.hours || {}).reduce((s, v) => s + (Number(v) || 0), 0)), 0),
    [rows, monthKey],
  );

  const topProcesses = summary.byProcess.slice(0, 8);
  const maxProcessOutput = topProcesses.reduce((m, p) => Math.max(m, p.output), 0) || 1;

  return (
    <div className="dp-tab-view dp-summary-dash">
      {/* ---- 1. Headline KPIs ---- */}
      <div className="dp-kpi-row">
        <KpiCard
          icon="📦"
          label="Total Factory Completed Output"
          value={summary.completedPieces.toLocaleString()}
          unit="pcs"
          sub={`${monthPieces.toLocaleString()} pcs so far in ${monthKey}`}
          level={summary.completedPieces > 0 ? 'good' : ''}
        />
        <KpiCard
          icon="🎯"
          label="Target vs Achievement"
          value={`${summary.achievement}%`}
          sub={`${summary.completedPieces.toLocaleString()} of ${summary.target.toLocaleString()} pcs`}
          level={summary.achievement >= 90 ? 'good' : summary.achievement >= 70 ? 'warning' : 'critical'}
        >
          <div className="dp-progress-track" role="img" aria-label={`Achievement ${summary.achievement}%`}>
            <div
              className={`dp-progress-fill ${achievementTone(summary.achievement)}`}
              style={{ width: `${Math.min(100, Math.max(0, summary.achievement))}%` }}
            />
          </div>
        </KpiCard>
        <KpiCard
          icon="🐞"
          label="Total Defects"
          value={summary.defects.toLocaleString()}
          unit="pcs"
          sub={summary.completedPieces > 0
            ? `${((summary.defects / summary.completedPieces) * 100).toFixed(1)}% of output`
            : 'No output recorded'}
          level={summary.defects === 0 ? 'good' : summary.defects / (summary.completedPieces || 1) <= 0.05 ? 'warning' : 'critical'}
        />
        <KpiCard
          icon="👷"
          label="Active Employees"
          value={summary.activeEmployees}
          sub={`across ${summary.activeProcesses} process${summary.activeProcesses === 1 ? '' : 'es'}`}
          level={summary.activeEmployees > 0 ? 'good' : 'warning'}
        />
        <KpiCard
          icon="🔍"
          label="QC Checks Today"
          value={summary.qc.checked.toLocaleString()}
          unit="pcs"
          sub={summary.qc.checks > 0
            ? `${summary.qc.passRate}% passed · ${summary.qc.defect.toLocaleString()} defect`
            : 'No QC check recorded today'}
          level={summary.qc.checks === 0
            ? ''
            : summary.qc.passRate >= 95 ? 'good' : summary.qc.passRate >= 90 ? 'warning' : 'critical'}
        />
      </div>

      {/* ---- 2. QC inspection summary ----
          A QC Product Check is saved from the SAME unified entry form as
          production, so it lands here the moment it is written. It is shown as its
          own breakdown rather than being folded into the output cards above: an
          inspection counts pieces CHECKED, and adding it to output would inflate
          every production figure the factory reads. */}
      <section className="dp-card">
        <h3 className="dp-card-title">
          Quality Control Summary
          <span className="dp-card-sub">today</span>
        </h3>
        {summary.qc.checks === 0 ? (
          <p className="dp-empty">
            No QC check recorded today. Log one from the same entry form by choosing QC Product Check.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="dp-table">
              <thead>
                <tr>
                  <th>Checks</th>
                  <th className="dp-num">Total Checked</th>
                  <th className="dp-num">OK Pcs</th>
                  <th className="dp-num">Alter Pcs</th>
                  <th className="dp-num">Defect Pcs</th>
                  <th className="dp-num">Pass Rate</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono-cell dp-num">{summary.qc.checks.toLocaleString()}</td>
                  <td className="mono-cell dp-num">{summary.qc.checked.toLocaleString()}</td>
                  <td className="mono-cell dp-num">{summary.qc.ok.toLocaleString()}</td>
                  <td className="mono-cell dp-num">{summary.qc.alter.toLocaleString()}</td>
                  <td className="mono-cell dp-num">{summary.qc.defect.toLocaleString()}</td>
                  <td className="mono-cell dp-num">
                    <span className={`dp-eff-badge ${effTone(summary.qc.passRate)}`}>{summary.qc.passRate}%</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- 2. Total Line Output — the month's entries ----
          The supervisor's daily line figure, stored in the month's own collection.
          Shown as its own table so a month can be read line by line, and so the day's
          figure has the month's running total behind it. */}
      <section className="dp-card">
        <h3 className="dp-card-title">
          Total Line Output
          <span className="dp-card-sub">{monthKey} · {lineMonth.entries} entries</span>
        </h3>
        <div className="dp-kpi-row" style={{ marginBottom: 14 }}>
          <KpiCard
            icon="🏭"
            label="Line Output Today"
            value={lineTodayOutput.toLocaleString()}
            unit="pcs"
            sub={`${lineToday.length} line${lineToday.length === 1 ? '' : 's'} reported`}
            level={lineTodayOutput > 0 ? 'good' : ''}
          />
          <KpiCard
            icon="📅"
            label="Line Output This Month"
            value={lineMonth.achievement.toLocaleString()}
            unit="pcs"
            sub={`${lineMonth.lines} line${lineMonth.lines === 1 ? '' : 's'} · ${lineMonth.orders} order${lineMonth.orders === 1 ? '' : 's'}`}
            level={lineMonth.achievement > 0 ? 'good' : ''}
          />
          <KpiCard
            icon="🎯"
            label="Month Target Achievement"
            value={lineMonth.dailyTarget > 0 ? `${lineMonth.achievementPercent}%` : '—'}
            sub={lineMonth.dailyTarget > 0
              ? `${lineMonth.achievement.toLocaleString()} of ${lineMonth.dailyTarget.toLocaleString()} pcs`
              : 'No target on the month\u2019s line entries yet'}
            level={lineMonth.dailyTarget > 0
              ? (lineMonth.achievementPercent >= 90 ? 'good' : lineMonth.achievementPercent >= 70 ? 'warning' : 'critical')
              : ''}
          />
        </div>

        {lineToday.length === 0 ? (
          <p className="dp-empty">
            No Total Line Output entry for this day yet. Log one from the entry form
            by choosing Total Line Output.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="dp-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Supervisor Name</th>
                  <th>Order No</th>
                  <th>Style</th>
                  <th>Process</th>
                  <th className="dp-num">Hourly Target</th>
                  <th className="dp-num">Daily Target</th>
                  <th className="dp-num">Achievement (Pcs)</th>
                  <th className="dp-num">Achievement %</th>
                </tr>
              </thead>
              <tbody>
                {lineToday.map((r) => {
                  const daily = Number(r.dailyTarget) || 0;
                  const achieved = Number(r.achievement ?? r.output ?? r.quantity) || 0;
                  const percent = daily > 0 ? Math.round((achieved / daily) * 1000) / 10 : 0;
                  return (
                    <tr key={r.id}>
                      <td>{r.line_no || '\u2014'}</td>
                      <td>{r.supervisor || '\u2014'}</td>
                      <td>{r.order_no || '\u2014'}</td>
                      <td>{r.style || '\u2014'}</td>
                      <td>{r.process || '\u2014'}</td>
                      <td className="mono-cell dp-num">{Number(r.hourlyTarget) > 0 ? Number(r.hourlyTarget).toLocaleString() : '\u2014'}</td>
                      <td className="mono-cell dp-num">{daily > 0 ? daily.toLocaleString() : '\u2014'}</td>
                      <td className="mono-cell dp-num">{achieved.toLocaleString()}</td>
                      <td className="mono-cell dp-num">
                        <span className={`dp-eff-badge ${effTone(percent)}`}>{daily > 0 ? `${percent}%` : '\u2014'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- 2b. Line Output — the designated process's summed operator output ---- */}
      <LineOutputPanel date={date} />

      {/* ---- 3. Line Input & WIP — the brief's balance, in the Overall Summary ---- */}
      <LineInputWipSummaryPanel />

      {/* ---- 4. Master Buyer & Order Summary table ----
          Directly below the KPI cards, as the brief asks: the day's headline
          first, then how each order is tracking against its PO. */}
      <MasterBuyerOrderSummaryTable date={date} />

      {/* ---- 4. Process-wise completed output + 5. target vs achievement ---- */}
      <div className="dp-summary-cols">
        <section className="dp-card">
          <h3 className="dp-card-title">
            Process-wise Completed Output
            <span className="dp-card-sub">today, by operation</span>
          </h3>
          {topProcesses.length === 0 ? (
            <p className="dp-empty">No production recorded today yet.</p>
          ) : (
            <ul className="dp-ranked">
              {topProcesses.map((p) => (
                <li key={p.process}>
                  <div className="dp-ranked-head">
                    <span className="dp-ranked-label" title={p.process}>{p.process}</span>
                    <span className="dp-ranked-value">{p.output.toLocaleString()} pcs</span>
                  </div>
                  <div className="dp-bar">
                    <span style={{ width: `${Math.round((p.output / maxProcessOutput) * 100)}%` }} />
                  </div>
                  <div className="dp-ranked-hint">
                    Target {p.target.toLocaleString()} · {p.achievement}% achieved · {p.defects} defects
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dp-card">
          <h3 className="dp-card-title">
            Top Performers
            <span className="dp-card-sub">by pieces today</span>
          </h3>
          {summary.byEmployee.length === 0 ? (
            <p className="dp-empty">No employee output recorded today.</p>
          ) : (
            <ol className="dp-performer-list">
              {summary.byEmployee.slice(0, 6).map((e, i) => (
                <li key={e.employee} className="dp-performer">
                  <span className={`dp-rank-badge dp-rank-${i + 1 <= 3 ? i + 1 : 'n'}`}>{i + 1}</span>
                  <span className="dp-performer-name">{e.employee}</span>
                  <span className="dp-performer-value">
                    {e.output.toLocaleString()} pcs
                    <em className="dp-performer-sub">{e.defects} defects</em>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* ---- 4. Target vs achievement, per process ---- */}
      <section className="dp-card">
        <h3 className="dp-card-title">
          Target vs Achievement by Process
          <span className="dp-card-sub">today</span>
        </h3>
        {summary.byProcess.length === 0 ? (
          <p className="dp-empty">Nothing to compare yet — the table fills in with the first hourly entry.</p>
        ) : (
          <div className="table-wrap">
            <table className="dp-table">
              <thead>
                <tr>
                  <th>Process</th>
                  <th className="dp-num">Output</th>
                  <th className="dp-num">Target</th>
                  <th className="dp-num">Variance</th>
                  <th className="dp-num">Defects</th>
                  <th className="dp-num">Achievement</th>
                </tr>
              </thead>
              <tbody>
                {summary.byProcess.map((p) => {
                  const variance = p.output - p.target;
                  return (
                    <tr key={p.process}>
                      <td>{p.process}</td>
                      <td className="mono-cell dp-num">{p.output.toLocaleString()}</td>
                      <td className="mono-cell dp-num">{p.target.toLocaleString()}</td>
                      <td className={`mono-cell dp-num ${variance >= 0 ? 'dp-good' : 'dp-bad'}`}>
                        {variance === 0 ? '0' : (variance > 0 ? `+${variance.toLocaleString()}` : variance.toLocaleString())}
                      </td>
                      <td className="mono-cell dp-num">{p.defects.toLocaleString()}</td>
                      <td className="mono-cell dp-num">
                        <span className={`dp-eff-badge ${effTone(p.achievement)}`}>{p.achievement}%</span>
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
  );
}

/** The tone class for the achievement progress bar. */
function achievementTone(value) {
  const n = Number(value) || 0;
  if (n >= 90) return 'dp-fill-good';
  if (n >= 70) return 'dp-fill-warn';
  return 'dp-fill-bad';
}

function KpiCard({ icon, label, value, unit, sub, level, children }) {
  return (
    <div className="dp-card dp-kpi-card">
      <div className="dp-kpi-label">
        {icon && <span aria-hidden="true">{icon}</span>} {label}
      </div>
      <div className={`dp-kpi-value${level ? ` dp-kpi-${level}` : ''}`}>
        {value}{unit && <span className="dp-kpi-unit"> {unit}</span>}
      </div>
      {children}
      {sub && <div className="dp-kpi-sub">{sub}</div>}
    </div>
  );
}
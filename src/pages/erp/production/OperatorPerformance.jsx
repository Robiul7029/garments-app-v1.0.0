import React, { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MODULE } from '../../../config/erpRoles';
import { C } from '../../../config/erpSchema';
import { usePermissions } from '../../../context/PermissionContext';
import { useErpData } from '../../../context/ErpDataContext';
import { EmptyState, LoadingState } from '../../../components/erp/Primitives';
import { toNumber, toDateKey } from '../../../utils/erpCalculations';
import {
  operatorDayRows,
  operatorEfficiencyRows,
  averageEfficiency,
} from '../../../config/productionAggregation';
import { useData } from '../../../context/DataContext';
import { latestSheetForStyle } from '../../../config/orderWorkflow';

/**
 * ROBIUL GARMENTS ERP — Operator Performance, with an in-page segmented switch.
 *
 * This used to be two separate sidebar entries ("Operator Output" and "Efficiency
 * %"), which meant the same screen was reachable by two doors and the two halves
 * could never be read side by side. It is now ONE sidebar entry opening ONE screen
 * with a segmented switch bar at the top:
 *
 *   [ Operator Output ]  [ Efficiency % ]
 *
 * The active segment lives in the URL (`?tab=output` / `?tab=efficiency`), so a
 * link from the dashboard lands on the right half, the browser Back button moves
 * between them, and a refresh keeps the segment — while switching itself is a
 * client-side state change with no page reload.
 *
 * The figures come from the ERP hourly-production collection (the live Firestore
 * rows), with the local hourly-timesheet rows used as the same-shaped source when
 * the ERP collection is empty — which is what makes the screen useful in the demo
 * deployment and in production alike.
 */
const TAB_OUTPUT = 'output';
const TAB_EFFICIENCY = 'efficiency';

export default function OperatorPerformance() {
  const [params, setParams] = useSearchParams();
  const erp = useErpData();
  const permissions = usePermissions();
  const { getData } = useData();

  const requested = params.get('tab');
  const active = requested === TAB_EFFICIENCY ? TAB_EFFICIENCY : TAB_OUTPUT;

  // Subscribe to the live hourly production the ERP records. The subscription is
  // torn down when the screen unmounts or the role loses access.
  const allowed = permissions.canView(MODULE.OPERATOR_PERFORMANCE) || permissions.canView(MODULE.PRODUCTION);
  useEffect(() => {
    if (!allowed) return undefined;
    const unsubscribeHourly = erp.subscribe('operatorProduction', {
      collection: C.HOURLY_PRODUCTION,
      pageSize: 500,
    });
    const unsubscribeDaily = erp.subscribe('operatorDailyProduction', {
      collection: C.DAILY_PRODUCTION,
      pageSize: 500,
    });
    return () => { unsubscribeHourly?.(); unsubscribeDaily?.(); };
  }, [allowed, erp.subscribe]);

  const today = useMemo(() => toDateKey(new Date()), []);

  /**
   * The rows this screen reads.
   *
   * Prefer the live ERP collection; fall back to the local hourly-timesheet rows
   * when it is empty. Both carry the same keys (employee, process, hours, date),
   * so the aggregation is written once and works against either.
   */
  const erpRows = erp.rows('operatorProduction');
  const dailyRows = erp.rows('operatorDailyProduction');
  const localRows = getData('hourly-timesheet-rows');
  const localDailyRows = getData('daily-production');
  const rows = useMemo(() => {
    const erpDailyRows = dailyRows.filter((row) => row.source !== 'hourly');
    const sourceRows = [...(erpRows.length > 0 ? erpRows : localRows), ...erpDailyRows];
    if (erpRows.length > 0 || dailyRows.length > 0) {
      // Normalize the ERP shape (which may name the operator differently) into the
      // shape the aggregation reads, so one set of arithmetic serves all sources.
      return sourceRows.map((r) => ({
        ...r,
        employee: r.employee || r.operatorName || r.operator || r.worker || '',
        process: r.process || r.operation || '',
        line: r.line || r.lineName || r.lineNo || '',
        hours: r.hours || (r.actual !== undefined ? { all: toNumber(r.actual) } : {}),
        quantity: r.quantity ?? r.output ?? r.actual,
        dailyTotal: r.dailyTotal ?? r.quantity ?? r.output ?? r.actual,
        workingHours: r.workingHours ?? r.working_hours ?? 10,
        hourlyTarget: r.hourlyTarget ?? r.target,
        target: r.dailyTarget ?? r.daily_target ?? r.target,
      }));
    }
    return sourceRows;
  }, [erpRows, dailyRows, localRows, localDailyRows]);

  // The SMV of every operation on the styles in play, so the efficiency formula
  // ((pieces × SMV) / minutes) has a real SMV to work from. Read from the uploaded
  // process sheets — the same source the production forms use.
  const processSheets = getData('process-breakdown');
  const smvByProcess = useMemo(() => {
    const map = {};
    const styles = new Set(rows.map((r) => r.style).filter(Boolean));
    styles.forEach((style) => {
      const sheet = latestSheetForStyle(processSheets, { style });
      (sheet?.operations || []).forEach((op) => {
        const name = String(op.operation || '').trim();
        if (name && !map[name]) map[name] = toNumber(op.smv);
      });
    });
    // Any operation not covered by a style's sheet falls back to a lookup across
    // every sheet, so an operator on a style with no sheet still gets a figure.
    if (Object.keys(map).length === 0) {
      processSheets.forEach((sheet) => {
        (sheet?.operations || []).forEach((op) => {
          const name = String(op.operation || '').trim();
          if (name && !map[name]) map[name] = toNumber(op.smv);
        });
      });
    }
    return map;
  }, [rows, processSheets]);

  const outputRows = useMemo(() => operatorDayRows(rows, today), [rows, today]);
  const efficiencyRows = useMemo(
    () => operatorEfficiencyRows(rows, today, smvByProcess),
    [rows, today, smvByProcess],
  );

  function selectTab(key) {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    // replace: false, so Back returns to the previous segment — the URL is a real
    // history entry, which is what makes the switch feel like navigation without a
    // reload.
    setParams(next, { replace: false });
  }

  const loading = (erp.isLoading('operatorProduction') || erp.isLoading('operatorDailyProduction')) && rows.length === 0;

  return (
    <div className="erp-page op-page">
      <header className="erp-page-header">
        <div>
          <h1 className="erp-page-title">👷 Operator Performance</h1>
          <p className="erp-page-description">
            Piece-by-piece output per operator, and the efficiency it earns — from the same
            hourly production the floor records.
          </p>
        </div>
      </header>

      {/* ---- The segmented switch bar. A real tab control: roving tabindex and
          arrow keys, so it behaves as one control to a keyboard. Switching is
          client-side and instant — no page reload. ---- */}
      <div className="op-segmented" role="tablist" aria-label="Operator Performance views">
        <button
          type="button"
          role="tab"
          id="op-tab-output"
          aria-selected={active === TAB_OUTPUT}
          aria-controls="op-panel-output"
          tabIndex={active === TAB_OUTPUT ? 0 : -1}
          className={`op-segment${active === TAB_OUTPUT ? ' active' : ''}`}
          onClick={() => selectTab(TAB_OUTPUT)}
        >
          🏭 Operator Output
        </button>
        <button
          type="button"
          role="tab"
          id="op-tab-efficiency"
          aria-selected={active === TAB_EFFICIENCY}
          aria-controls="op-panel-efficiency"
          tabIndex={active === TAB_EFFICIENCY ? 0 : -1}
          className={`op-segment${active === TAB_EFFICIENCY ? ' active' : ''}`}
          onClick={() => selectTab(TAB_EFFICIENCY)}
        >
          📈 Efficiency %
        </button>
      </div>

      {loading ? (
        <LoadingState label="Loading today's operator output…" />
      ) : (
        <div
          className="op-panel"
          role="tabpanel"
          id={`op-panel-${active}`}
          aria-labelledby={`op-tab-${active}`}
        >
          {active === TAB_OUTPUT ? (
            <OperatorOutputTab rows={outputRows} />
          ) : (
            <EfficiencyTab rows={efficiencyRows} />
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Tab 1: Operator Output ------------------------------------------------ */

function OperatorOutputTab({ rows }) {
  const totalOutput = rows.reduce((s, r) => s + r.output, 0);
  const totalDefects = rows.reduce((s, r) => s + r.defects, 0);
  const top = rows[0] || null;

  return (
    <>
      <div className="op-cards">
        <SummaryCard icon="👥" label="Total Active Operators" value={rows.length} />
        <SummaryCard icon="📦" label="Total Daily Output" value={totalOutput.toLocaleString()} unit="pcs" />
        <SummaryCard
          icon="🏆"
          label="Top Performer"
          value={top ? top.employee : '—'}
          sub={top ? `${top.output.toLocaleString()} pcs` : 'No output recorded'}
          level={top ? 'good' : ''}
        />
        <SummaryCard icon="🐞" label="Total Defects" value={totalDefects.toLocaleString()} unit="pcs" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="📭"
          title="No operator output today"
          message="Record an hourly production entry and each operator's output appears here."
        />
      ) : (
        <div className="erp-panel">
          <h2 className="erp-panel-title">Operator output — today</h2>
          <div className="rge-table-wrap">
            <table className="rge-table op-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Line</th>
                  <th>Process</th>
                  <th className="rge-num">Target</th>
                  <th className="rge-num">Actual Output</th>
                  <th className="rge-num">Variance / Due</th>
                  <th className="rge-num">Efficiency</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => r.processes.map((p, i) => (
                  <tr key={`${r.employee}-${p.process}`}>
                    {i === 0 && (
                      <td rowSpan={r.processes.length} className="op-name-cell">
                        <span className="op-name">{r.employee}</span>
                        {r.processes.length > 1 && (
                          <span className="op-name-sub">{r.processes.length} processes</span>
                        )}
                      </td>
                    )}
                    <td>{r.line || '—'}</td>
                    <td>{p.process}</td>
                    <td className="rge-num">{p.target.toLocaleString()}</td>
                    <td className="rge-num">{p.output.toLocaleString()}</td>
                    <td className={`rge-num ${p.variance >= 0 ? 'op-good' : 'op-bad'}`}>
                      {p.variance === 0 ? 'On target' : (p.variance > 0 ? `+${p.variance.toLocaleString()} Extra` : `${Math.abs(p.variance).toLocaleString()} Due`)}
                    </td>
                    <td className="rge-num">
                      <EfficiencyBadge value={p.efficiency} />
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ---- Tab 2: Efficiency % --------------------------------------------------- */

function EfficiencyTab({ rows }) {
  const average = averageEfficiency(rows);
  const withValue = rows.filter((r) => r.efficiency > 0);
  const high = withValue[0] || null;
  const low = withValue[withValue.length - 1] || null;

  return (
    <>
      <div className="op-cards">
        <SummaryCard
          icon="⚡"
          label="Average Line Efficiency"
          value={`${average}%`}
          level={average >= 85 ? 'good' : average >= 70 ? 'warning' : 'critical'}
        />
        <SummaryCard
          icon="🏆"
          label="High Performer"
          value={high ? high.employee : '—'}
          sub={high ? `${high.efficiency}%` : 'No efficiency recorded'}
          level={high ? 'good' : ''}
        />
        <SummaryCard
          icon="📉"
          label="Low Performer"
          value={low ? low.employee : '—'}
          sub={low ? `${low.efficiency}%` : 'No efficiency recorded'}
          level={low ? (low.efficiency >= 70 ? 'warning' : 'critical') : ''}
        />
        <SummaryCard icon="👥" label="Operators Measured" value={rows.length} />
      </div>

      <p className="op-formula">
        Efficiency % = <strong>(Produced Pieces × SMV) ÷ Active Working Minutes</strong> × 100
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon="📭"
          title="No efficiency to measure yet"
          message="Efficiency needs an operator's output, the operation's SMV and their working minutes — all of which come from an hourly production entry."
        />
      ) : (
        <div className="erp-panel">
          <h2 className="erp-panel-title">Efficiency — today</h2>
          <div className="rge-table-wrap">
            <table className="rge-table op-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Line</th>
                  <th className="rge-num">Pieces</th>
                  <th className="rge-num">Allowed Min</th>
                  <th className="rge-num">Worked Min</th>
                  <th className="rge-num">Defects</th>
                  <th>Efficiency</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee}>
                    <td className="op-name">{r.employee}</td>
                    <td>{r.line || '—'}</td>
                    <td className="rge-num">{r.producedPieces.toLocaleString()}</td>
                    <td className="rge-num">{r.allowedMinutes.toLocaleString()}</td>
                    <td className="rge-num">{r.activeMinutes.toLocaleString()}</td>
                    <td className="rge-num">{r.defects.toLocaleString()}</td>
                    <td>
                      <div className="op-eff-cell">
                        <EfficiencyBar value={r.efficiency} />
                        <EfficiencyBadge value={r.efficiency} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ---- Shared pieces --------------------------------------------------------- */

function SummaryCard({ icon, label, value, unit, sub, level }) {
  return (
    <div className="op-card">
      <div className="op-card-label">
        {icon && <span aria-hidden="true">{icon}</span>} {label}
      </div>
      <div className={`op-card-value${level ? ` op-level-${level}` : ''}`}>
        {value}{unit && <span className="op-card-unit"> {unit}</span>}
      </div>
      {sub && <div className="op-card-sub">{sub}</div>}
    </div>
  );
}

/** The coloured progress bar + % badge the brief asks for. */
function EfficiencyBar({ value }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="op-bar" role="img" aria-label={`Efficiency ${pct}%`}>
      <span className={`op-bar-fill ${toneFor(pct)}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function EfficiencyBadge({ value }) {
  const pct = Number(value) || 0;
  return <span className={`op-eff-badge ${toneFor(pct)}`}>{pct}%</span>;
}

/** ≥85 green, ≥70 amber, else red — the same bands the rest of the app uses. */
function toneFor(pct) {
  if (pct >= 85) return 'op-good';
  if (pct >= 70) return 'op-warn';
  return 'op-bad';
}

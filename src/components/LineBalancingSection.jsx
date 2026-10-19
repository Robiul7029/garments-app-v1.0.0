import React, { useEffect, useMemo, useState } from 'react';
import { evaluateSmvTotal } from '../config/smvTargetEngine';

/**
 * Smart Line Balancing & Target Generator.
 *
 * The planning half of the Capacity & Target module: it takes the total SMV of
 * the process sheet that is currently in view and answers the three questions a
 * line is actually planned from —
 *
 *   Daily Target      minutes available ÷ total SMV, at the efficiency allowed
 *   Hourly Target     the daily figure spread over the shift
 *   Operator Load     the SMV one operator carries (total SMV ÷ manpower)
 *
 * WHY IT DERIVES FROM THE SAME FORMULA AS THE CAPACITY PANEL
 * ---------------------------------------------------------
 * The figures follow the shared SMV engine's own rules — minutes available is
 * manpower × hours × 60, and the efficiency allowance is applied to the
 * 100%-efficiency capacity — so this section and the Capacity panel beside it
 * cannot drift apart on what a line is supposed to produce. The two are expected
 * to move together as the inputs change; that is the point of them sitting in one
 * module.
 *
 * The figures are LIVE: they recalculate as the inputs are typed. The Calculate
 * button is kept because the brief asks for it and because an explicit "now go"
 * reads naturally to a supervisor, but it does not gate the result.
 */
export default function LineBalancingSection({
  totalSMV = 0,
  activeSheetId = '',
  activeStyle = '',
  operationsList = [],
  // The unit the sheet was written in. The total is stored in minutes, but a sheet
  // built elsewhere may hand over a raw seconds figure — this is what lets the
  // section read it correctly instead of dividing 4320 by the SMV as if it were
  // 4320 minutes.
  smvUnit,
  // Lets the page seed the boxes from the agreed capacity settings, so this
  // section and the Capacity panel open on the same manpower/hours/efficiency
  // instead of quietly planning a different line.
  defaults = {},
  readOnly = false,
}) {
  // Seeds from the capacity inputs already in force, so this section and the
  // Capacity panel plan the SAME line instead of quietly using their own
  // defaults. A blank box is treated as "nothing agreed yet" and falls through to
  // the default — a saved capacity only fails to seed when it is genuinely empty.
  const seed = (key, fallback) => {
    const v = defaults?.[key];
    if (v === undefined || v === null || v === '') return fallback;
    return v;
  };
  const [manpower, setManpower] = useState(seed('manpower', 10));
  const [totalSmvInput, setTotalSmvInput] = useState(totalSMV ?? '');
  const [workingHours, setWorkingHours] = useState(seed('workingHours', 10));
  const [efficiency, setEfficiency] = useState(seed('efficiency', 100));
  const [restoredGeneratorState] = useState(() => {
    try {
      if (typeof window === 'undefined') return {};
      return JSON.parse(window.localStorage.getItem('process-sheet-line-balancing-state') || '{}');
    } catch { return {}; }
  });
  useEffect(() => {
    if (restoredGeneratorState.activeSheetId && String(restoredGeneratorState.activeSheetId) === String(activeSheetId)) {
      setManpower(restoredGeneratorState.manpower ?? seed('manpower', 10));
      setWorkingHours(restoredGeneratorState.workingHours ?? seed('workingHours', 10));
      setEfficiency(restoredGeneratorState.efficiency ?? seed('efficiency', 100));
      setTotalSmvInput(restoredGeneratorState.totalSmv ?? totalSMV ?? '');
      return;
    }
    setManpower(seed('manpower', 10));
    setWorkingHours(seed('workingHours', 10));
    setEfficiency(seed('efficiency', 100));
    setTotalSmvInput(totalSMV ?? '');
  }, [activeSheetId, totalSMV, defaults?.manpower, defaults?.workingHours, defaults?.efficiency]);
  // The hour and efficiency boxes default to the SAME constants the calculation
  // falls back to. If they defaulted to anything else, a blank box would display
  // one number and be computed with another.
  // Normalised through the engine, so a seconds-valued sheet is converted once
  // here rather than being trusted to have arrived in minutes.
  const smv = evaluateSmvTotal(totalSmvInput, smvUnit);
  const people = Number(manpower) || 0;
  const hours = Number(workingHours) || 0;
  const eff = Number(efficiency) || 0;

  // Mirrors capacitySettings(): a blank or nonsensical box falls back to the
  // factory default rather than silently planning a zero-piece day.
  const safeHours = hours > 0 ? hours : 10;
  const safeEff = eff > 0 ? Math.min(100, eff) : 100;

  const hasSmv = smv > 0;
  // Blank hours/efficiency are covered by the fallbacks above, so only a missing
  // SMV or a missing manpower genuinely stop a plan being drawn.
  const usable = hasSmv && people > 0;

  const result = useMemo(() => {
    const availableMinutes = people * safeHours * 60 * (safeEff / 100);
    if (!usable) {
      return { dailyTarget: 0, hourlyTarget: 0, availableMinutes, targetSMVPerOperator: '0.00' };
    }
    const dailyTarget = Math.floor(availableMinutes / smv);
    const hourlyTarget = Math.floor(dailyTarget / safeHours);
    return {
      dailyTarget,
      hourlyTarget,
      availableMinutes,
      // Minutes of work each operator carries — the figure a line is balanced
      // against.
      targetSMVPerOperator: (smv / people).toFixed(2),
    };
  }, [usable, people, safeHours, safeEff, smv]);

  useEffect(() => {
    if (!activeSheetId && !activeStyle) return;
    try {
      window.localStorage.setItem('process-sheet-line-balancing-state', JSON.stringify({
        activeSheetId,
        style: activeStyle,
        totalSmv: totalSmvInput,
        manpower,
        workingHours,
        efficiency,
        hourlyTarget: result.hourlyTarget,
        dailyTarget: result.dailyTarget,
        availableMinutes: result.availableMinutes,
      }));
    } catch { /* local persistence is best-effort */ }
  }, [activeSheetId, activeStyle, totalSmvInput, manpower, workingHours, efficiency, result]);

  return (
    <section className="lb-section">
      <header className="lb-head">
        <h4 className="lb-title">⚙️ Smart Line Balancing &amp; Target Generator</h4>
        <span className="lb-sub">
          {hasSmv ? `Total SMV ${smv}` : 'No SMV yet'}
          {operationsList.length > 0 ? ` · ${operationsList.length} operations` : ''}
        </span>
      </header>

      <div className="lb-inputs">
        <label className="lb-field">
          <span>Total SMV (min)</span>
          <input type="number" min="0" step="0.01" value={totalSmvInput ?? ''} disabled={readOnly} onChange={(e) => setTotalSmvInput(e.target.value)} aria-label="Total SMV in minutes" />
        </label>
        <label className="lb-field">
          <span>Total Manpower</span>
          <input
            type="number"
            min="0"
            value={manpower}
            disabled={readOnly}
            onChange={(e) => setManpower(e.target.value)}
            placeholder="e.g. 25"
          />
        </label>
        <label className="lb-field">
          <span>Working Hours</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={workingHours}
            disabled={readOnly}
            onChange={(e) => setWorkingHours(e.target.value)}
            placeholder="10"
          />
        </label>
        <label className="lb-field">
          <span>Target Efficiency %</span>
          <input
            type="number"
            min="1"
            max="100"
            value={efficiency}
            disabled={readOnly}
            onChange={(e) => setEfficiency(e.target.value)}
            placeholder="100"
          />
        </label>
      </div>

      {/* A missing SMV is a normal state — the sheet simply has not been
          uploaded yet — so it is stated plainly under the fields rather than
          raised as a blocking popup the user has to dismiss. */}
      {!hasSmv && (
        <p className="lb-hint" role="status">Select or upload a process sheet to load its total SMV.</p>
      )}

      {usable && (
        <div className="lb-result">
          <h5 className="lb-result-title">📊 Production &amp; Target Summary</h5>
          <p className="lb-plan-note" role="status">Targets update automatically when the selected sheet or planning inputs change.</p>

          <div className="lb-figures">
            <LbFigure
              label="Daily Target"
              value={result.dailyTarget.toLocaleString()}
              unit="pcs"
              tone="good"
            />
            <LbFigure
              label="Hourly Target"
              value={result.hourlyTarget.toLocaleString()}
              unit="pcs/hour"
              tone="info"
            />
            <LbFigure
              label="Available minutes"
              value={result.availableMinutes.toLocaleString()}
              unit="min"
              tone="muted"
            />
          </div>

          <p className="lb-operator-load">
            <strong>Standard work per operator:</strong>{' '}
            <span className="lb-mono">{result.targetSMVPerOperator}</span> min per operator
          </p>

          <div className="lb-advice">
            <p>
              💡 <strong>Planning note:</strong> With {people} operators on the line, balance longer or higher-SMV operations by assigning additional operators or combining suitable processes.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function LbFigure({ label, value, unit, tone = 'info' }) {
  return (
    <div className="lb-figure">
      <span className="lb-figure-label">{label}</span>
      <span className={`lb-figure-value lb-tone-${tone}`}>
        {value}
        {unit && <span className="lb-figure-unit"> {unit}</span>}
      </span>
    </div>
  );
}

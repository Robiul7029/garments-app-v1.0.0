import React, { useMemo, useState } from 'react';
import {
  calculateCapacity,
  capacitySettings,
  targetForOperation,
  DEFAULT_WORKING_HOURS,
  DEFAULT_EFFICIENCY,
} from '../config/smvTargetEngine';

/**
 * The capacity panel under a Process Breakdown sheet.
 *
 * Takes the operations the sheet parsed and turns them into targets: how many
 * pieces the line can produce in a day and an hour, and the same figure for each
 * individual operation. The inputs are the four a production manager actually
 * tunes — manpower, hours, efficiency — and everything else is derived.
 *
 * It is deliberately a live panel rather than a saved report: change the manpower
 * and the whole table moves, which is how a line is re-planned when somebody calls
 * in sick. "Save for this style" is a separate, explicit action, because the saved
 * figures are what Daily Production measures operators against and should not
 * change every time a slider is nudged.
 */
export default function CapacityPanel({
  operations = [],
  settings,
  onSettingsChange,
  onSave,
  savedAt,
  canSave = true,
  readOnly = false,
}) {
  const [showAll, setShowAll] = useState(false);

  const capacity = useMemo(
    () => calculateCapacity(operations, settings),
    [operations, settings],
  );

  const resolved = capacitySettings(settings);

  function set(field, value) {
    onSettingsChange?.({ ...settings, [field]: value });
  }

  const rows = showAll ? capacity.perProcess : capacity.perProcess.slice(0, 8);

  return (
    <section className="cap-panel">
      <header className="cap-head">
        <h4 className="cap-title">⚙️ Capacity &amp; target calculation</h4>
        <span className="cap-sub">
          {capacity.operationCount} operation{capacity.operationCount === 1 ? '' : 's'} · total SMV {capacity.totalSmv}
        </span>
      </header>

      {/* ---- The four inputs ---- */}
      <div className="cap-inputs">
        <label className="cap-field">
          <span>Total deployed manpower</span>
          <input
            type="number"
            min="0"
            value={resolved.manpower || ''}
            disabled={readOnly}
            onChange={(e) => set('manpower', e.target.value)}
            placeholder="e.g. 25"
          />
        </label>
        <label className="cap-field">
          <span>Working hours</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={resolved.workingHours}
            disabled={readOnly}
            onChange={(e) => set('workingHours', e.target.value)}
            placeholder={String(DEFAULT_WORKING_HOURS)}
          />
        </label>
        <label className="cap-field">
          <span>Efficiency %</span>
          <input
            type="number"
            min="1"
            max="100"
            value={resolved.efficiency}
            disabled={readOnly}
            onChange={(e) => set('efficiency', e.target.value)}
            placeholder={String(DEFAULT_EFFICIENCY)}
          />
        </label>
      </div>

      {/* ---- What the inputs resolve to ---- */}
      {!capacity.usable ? (
        <p className="cap-hint">
          {capacity.operationCount === 0
            ? 'Upload or add operation rows above — the targets are derived from their SMV.'
            : resolved.manpower > 0
              ? 'None of these operations has an SMV yet. Add an SMV to the rows above to get a target.'
              : 'Enter the deployed manpower to calculate the line target.'}
        </p>
      ) : (
        <>
          <div className="cap-line">
            <CapFigure label="Line daily target" value={capacity.line.dailyTarget} unit="pcs" />
            <CapFigure label="Line hourly target" value={capacity.line.hourlyTarget} unit="pcs/hr" />
            <CapFigure
              label="Available minutes"
              value={capacity.minutes}
              unit="min"
              hint={`${resolved.manpower} × ${resolved.workingHours}h × 60 × ${resolved.efficiency}%`}
            />
            <CapFigure
              label="Target per operator"
              value={capacity.line.perOperatorDaily}
              unit="pcs/day"
              hint="One operator, full shift"
            />
          </div>

          {capacity.missingSmv.length > 0 && (
            <p className="cap-hint cap-warn">
              ⚠️ No SMV on {capacity.missingSmv.length} operation
              {capacity.missingSmv.length === 1 ? '' : 's'} ({capacity.missingSmv.slice(0, 4).join(', ')}
              {capacity.missingSmv.length > 4 ? ', …' : ''}). The line total is lower than the real capacity
              because those minutes are not counted.
            </p>
          )}

          {/* ---- Per-operation targets ---- */}
          <div className="cap-table-wrap">
            <table className="cap-table">
              <thead>
                <tr>
                  <th>Operation</th>
                  <th>Machine</th>
                  <th align="right">SMV</th>
                  <th align="right">Hourly capacity</th>
                  <th align="right">Daily capacity</th>
                  <th align="right">1 operator / hr</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={`${p.name}-${i}`}>
                    <td>{p.name || '—'}</td>
                    <td>{p.machine || '—'}</td>
                    <td align="right" className="cap-mono">{p.smv || '—'}</td>
                    {/* Thousands-separated, to match the headline figures above.
                        "7000" beside "1,292" reads as two different orders of
                        magnitude at a glance. */}
                    <td align="right" className="cap-mono cap-strong">
                      {p.hasSmv ? p.hourlyTarget.toLocaleString() : '—'}
                    </td>
                    <td align="right" className="cap-mono cap-strong">
                      {p.hasSmv ? p.dailyTarget.toLocaleString() : '—'}
                    </td>
                    <td align="right" className="cap-mono">
                      {p.hasSmv ? p.piecesPerOperatorPerHour.toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {capacity.perProcess.length > 8 && (
            <button type="button" className="cap-toggle" onClick={() => setShowAll((v) => !v)}>
              {showAll ? '− Show fewer' : `+ Show all ${capacity.perProcess.length} operations`}
            </button>
          )}

          <p className="cap-note">
            Hourly and daily capacity assume <strong>the whole line works that one operation</strong>, which is
            what a line balance is planned from. The rows therefore do not add up to the line total — the same
            operators cannot work two operations at once — and the last column is the per-operator figure used
            when balancing the line.
          </p>
        </>
      )}

      {/* ---- Saving ---- */}
      <footer className="cap-foot">
        <div>
          {savedAt ? (
            <span className="cap-saved">✔ Saved for this style on {savedAt}</span>
          ) : (
            <span className="cap-hint">Not saved yet — Daily Production uses the saved figures.</span>
          )}
        </div>
        {canSave && !readOnly && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!capacity.usable}
            onClick={() => onSave?.({ settings: resolved, capacity })}
          >
            Save targets for this style
          </button>
        )}
      </footer>
    </section>
  );
}

function CapFigure({ label, value, unit, hint }) {
  return (
    <div className="cap-figure">
      <span className="cap-figure-label">{label}</span>
      <span className="cap-figure-value">
        {Number(value).toLocaleString()}
        {unit && <span className="cap-figure-unit"> {unit}</span>}
      </span>
      {hint && <span className="cap-figure-hint">{hint}</span>}
    </div>
  );
}

export { targetForOperation };

import React, { useMemo, useState } from 'react';
import {
  calculateCapacity,
  capacitySettings,
  targetForOperation,
  DEFAULT_WORKING_HOURS,
  DEFAULT_EFFICIENCY,
} from '../config/smvTargetEngine';
import { firstInvalid, capacityRules } from '../config/sequentialValidation';

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
  // The ONE input the sequential save check is stopped on, as { name, message }
  // — or null. Mirrors the Order Input / Process Sheet check: a single field is
  // flagged at a time, with its own tooltip, and the save does not proceed until
  // that field is filled.
  const [activeError, setActiveError] = useState(null);
  // Re-fires the tooltip animation when Save is pressed again on the same field.
  const [errorNonce, setErrorNonce] = useState(0);

  const capacity = useMemo(
    () => calculateCapacity(operations, settings),
    [operations, settings],
  );

  const resolved = capacitySettings(settings);

  function set(field, value) {
    onSettingsChange?.({ ...settings, [field]: value });
    // The active flag clears the moment ITS field is given a value, ready for the
    // next save to check the next field in the sequence.
    setActiveError((prev) => (prev && prev.name === field ? null : prev));
  }

  /**
   * Flag one input and put the cursor in it.
   *
   * `rawValue` is read from the ORIGINAL settings object rather than the resolved
   * one, so a blank manpower box is caught as blank instead of being silently
   * defaulted to 0 by `capacitySettings`.
   */
  function flagField(name, message) {
    setActiveError({ name, message });
    setErrorNonce((n) => n + 1);
    window.setTimeout(() => {
      const wrap = document.getElementById(`cap-wrap-${name}`);
      if (!wrap) return;
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try { wrap.querySelector('input')?.focus({ preventScroll: true }); } catch { /* older browsers */ }
    }, 0);
  }

  /**
   * Save targets for this style — SEQUENTIAL, one field at a time.
   *
   * The three inputs are checked in the order the user meets them — Total
   * Deployed Manpower, then Working Hours, then Efficiency %. The FIRST one that
   * is empty or invalid is flagged with its own tooltip and the save returns;
   * nothing is saved. Filling that field and saving again checks the next one.
   * All prompts are ENGLISH ONLY, matching the rest of the module.
   *
   * The rules live in config/sequentialValidation so this panel, the Order Input
   * form and the Process Sheet uploader share one definition of "the first thing
   * that is wrong".
   */
  function handleSave() {
    const raw = settings || {};
    const problem = firstInvalid(capacityRules(raw), raw);
    if (problem) {
      flagField(problem.name, problem.message);
      return;
    }
    setActiveError(null);
    onSave?.({ settings: resolved, capacity });
  }

  const rows = capacity.perProcess;

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
        <label
          className={`cap-field${activeError?.name === 'manpower' ? ' has-error' : ''}`}
          id="cap-wrap-manpower"
        >
          <span>Total deployed manpower</span>
          <input
            type="number"
            min="0"
            value={settings?.manpower ?? ''}
            disabled={readOnly}
            onChange={(e) => set('manpower', e.target.value)}
            placeholder="e.g. 25"
            aria-invalid={activeError?.name === 'manpower' ? true : undefined}
          />
          {activeError?.name === 'manpower' && (
            <span className="oi-tooltip" role="alert" aria-live="assertive" key={`manpower-${errorNonce}`}>
              <span aria-hidden="true">⚠</span>{activeError.message}
            </span>
          )}
        </label>
        <label
          className={`cap-field${activeError?.name === 'workingHours' ? ' has-error' : ''}`}
          id="cap-wrap-workingHours"
        >
          <span>Working hours</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={settings?.workingHours ?? ''}
            disabled={readOnly}
            onChange={(e) => set('workingHours', e.target.value)}
            placeholder={String(DEFAULT_WORKING_HOURS)}
            aria-invalid={activeError?.name === 'workingHours' ? true : undefined}
          />
          {activeError?.name === 'workingHours' && (
            <span className="oi-tooltip" role="alert" aria-live="assertive" key={`hours-${errorNonce}`}>
              <span aria-hidden="true">⚠</span>{activeError.message}
            </span>
          )}
        </label>
        <label
          className={`cap-field${activeError?.name === 'efficiency' ? ' has-error' : ''}`}
          id="cap-wrap-efficiency"
        >
          <span>Efficiency %</span>
          <input
            type="number"
            min="1"
            max="100"
            value={settings?.efficiency ?? ''}
            disabled={readOnly}
            onChange={(e) => set('efficiency', e.target.value)}
            placeholder={String(DEFAULT_EFFICIENCY)}
            aria-invalid={activeError?.name === 'efficiency' ? true : undefined}
          />
          {activeError?.name === 'efficiency' && (
            <span className="oi-tooltip" role="alert" aria-live="assertive" key={`eff-${errorNonce}`}>
              <span aria-hidden="true">⚠</span>{activeError.message}
            </span>
          )}
        </label>
        {/* The percentage buffer added on top of every auto-derived target. Left
            blank means no cushion (×1.00), which is the honest default; 5 or 10
            allows the margin a line is often planned with. */}
        <label className="cap-field" id="cap-wrap-targetBuffer">
          <span>Add Percentage (%)</span>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={settings?.targetBuffer ?? ''}
            disabled={readOnly}
            onChange={(e) => set('targetBuffer', e.target.value)}
            placeholder="0"
            aria-label="Percentage buffer added to every auto target"
          />
          <span className="cap-field-hint">Buffer on targets (e.g. 5%)</span>
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
            {/* The percentage-adjusted Complete Body Target — the figure the
                Hourly, Daily and Operator Performance screens all state. */}
            {capacity.bodyTarget?.hasTarget && (
              <CapFigure
                label="Complete Body Target"
                value={capacity.bodyTarget.dailyTarget}
                unit="pcs/day"
                hint={`All ${capacity.bodyTarget.processCount} operations${capacity.targetBuffer > 0 ? ` + ${capacity.targetBuffer}% buffer` : ''}`}
              />
            )}
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
            onClick={handleSave}
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

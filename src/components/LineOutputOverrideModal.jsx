import React, { useState } from 'react';

/**
 * ROBIUL GARMENTS ERP — the manual Line Output override dialog.
 *
 * The line output is normally AGGREGATED: every operator's output logged under the
 * designated line-output process is summed for the day. Occasionally a supervisor
 * needs to type the figure by hand — a machine was down and the pieces were
 * finished off the system, a re-count corrected the floor's tally — so the value
 * is editable, but NEVER silently: overwriting an aggregate that came from real
 * operator entries is the kind of change that must be deliberate.
 *
 * So a manual edit is a two-step act, and this component is the second step:
 *
 *   1. the user types a new figure and presses Save;
 *   2. this modal states the CURRENT auto-aggregated figure and the NEW value, and
 *      asks for confirmation — [ YES ] commits, [ NO ] cancels and leaves the
 *      aggregate untouched.
 *
 * The wording is deliberately explicit about BOTH numbers, because "override to
 * 1,300?" means nothing without "the operators' total was 1,240" beside it — the
 * user is being asked to judge the gap, not merely to confirm a click.
 *
 * STRICTLY ENGLISH: the brief requires every label here in English. That is also
 * the honest choice — a confirmation that guards a data change should read in one
 * unambiguous language.
 */
export default function LineOutputOverrideModal({
  open,
  processName = '',
  autoValue = 0,
  newValue = 0,
  date = '',
  onConfirm,
  onCancel,
}) {
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const fmt = (n) => (Number(n) || 0).toLocaleString();
  const delta = (Number(newValue) || 0) - (Number(autoValue) || 0);

  function confirm() {
    setBusy(true);
    // The parent performs the write; `busy` only guards a double-click.
    onConfirm?.();
  }

  return (
    <div
      className="dp-modal-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel?.(); }}
    >
      <div
        className="dp-modal dp-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lo-override-title"
        aria-describedby="lo-override-message"
      >
        <header className="dp-modal-head">
          <h3 id="lo-override-title">Manual Line Output Override</h3>
          <button
            type="button"
            className="dp-modal-close"
            aria-label="Close"
            onClick={() => { if (!busy) onCancel?.(); }}
          >
            ×
          </button>
        </header>

        <div className="dp-modal-body">
          <p className="dp-confirm-question" id="lo-override-message">
            Current auto-aggregated output from operators is{' '}
            <strong>{fmt(autoValue)} pcs</strong>. Are you sure you want to override
            this value to <strong>{fmt(newValue)} pcs</strong>?
          </p>

          <div className="dp-confirm-meta lo-override-figures">
            <span>
              <em>Auto-aggregated</em>
              <strong>{fmt(autoValue)} pcs</strong>
            </span>
            <span>
              <em>New manual value</em>
              <strong>{fmt(newValue)} pcs</strong>
            </span>
            <span>
              <em>Difference</em>
              <strong className={delta === 0 ? '' : (delta > 0 ? 'dp-good' : 'dp-bad')}>
                {delta === 0 ? 'No change' : `${delta > 0 ? '+' : ''}${fmt(delta)} pcs`}
              </strong>
            </span>
          </div>

          <p className="dp-confirm-meta">
            {processName
              ? <>Line output process: <strong>{processName}</strong>. </>
              : 'No line output process is set for this style. '}
            {date ? <>Date: <strong>{date}</strong>. </> : null}
            The manual value is saved for this day and marked as an override; the
            aggregated figure stays visible beside it.
          </p>
        </div>

        <footer className="dp-modal-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => onCancel?.()}
            disabled={busy}
          >
            NO
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={confirm}
            disabled={busy}
          >
            YES
          </button>
        </footer>
      </div>
    </div>
  );
}
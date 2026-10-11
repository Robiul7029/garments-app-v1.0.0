import React from 'react';
import { LEVEL_DOT } from '../../utils/erpCalculations';

/**
 * 🟢 🟠 🔴 status indicator.
 *
 * The dot is never colour alone — the level word is always present as text, so
 * the indicator survives a colour-blind reader and a cheap factory monitor.
 */
export function SeverityDot({ level = 'good', label }) {
  const map = { good: 'good', warning: 'warning', critical: 'critical', info: 'info' };
  const key = map[level] || 'good';
  const dot = key === 'info' ? '🔵' : LEVEL_DOT[key];
  return (
    <span className={`erp-severity erp-severity-${key}`}>
      <span aria-hidden="true">{dot}</span>{' '}
      <span className="erp-severity-text">{label || key}</span>
    </span>
  );
}

/** Small pill for a record status (Order, Shipment, QC result …). */
export function StatusBadge({ status = '', tone }) {
  const text = String(status || '').trim();
  if (!text) return <span className="erp-badge erp-badge-empty">—</span>;
  const inferred = tone || toneFor(text);
  return <span className={`erp-badge erp-badge-${inferred}`}>{text}</span>;
}

function toneFor(text) {
  const t = text.toLowerCase();
  if (/(cancel|delayed|overdue|critical|reject|fail|breakdown|under repair)/.test(t)) return 'danger';
  if (/(partial|warning|pending|in progress|production|hold)/.test(t)) return 'warning';
  if (/(shipped|completed|approved|active|pass|ready|good|paid|confirmed)/.test(t)) return 'success';
  if (/(new|planned|opening|info)/.test(t)) return 'info';
  return 'neutral';
}

/** KPI card. `level` colours the value and prefixes it with the status dot. */
export function StatCard({ label, value, unit, level, hint, onClick, icon }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`erp-stat${onClick ? ' erp-stat-clickable' : ''}`}
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
      {hint && <div className="erp-stat-hint">{hint}</div>}
    </Tag>
  );
}

/** Loading skeleton. Never a blank page — always says what is loading. */
export function LoadingState({ label = 'Loading…', rows = 3 }) {
  return (
    <div className="erp-state erp-state-loading" role="status" aria-live="polite">
      <div className="erp-spinner" aria-hidden="true" />
      <p>{label}</p>
      <div className="erp-skeleton" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => <div key={i} className="erp-skeleton-row" />)}
      </div>
    </div>
  );
}

/** Empty state that suggests the next action rather than just saying "no data". */
export function EmptyState({ icon = '📭', title = 'Nothing here yet', message, action }) {
  return (
    <div className="erp-state erp-state-empty">
      <div className="erp-state-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

/** Error state. Always offers the one action that helps: try again. */
export function ErrorState({ message = 'Something went wrong.', onRetry, retryLabel = 'Try again' }) {
  return (
    <div className="erp-state erp-state-error" role="alert">
      <div className="erp-state-icon" aria-hidden="true">⚠️</div>
      <h3>Could not load this</h3>
      <p>{message}</p>
      {onRetry && <button className="btn btn-outline" onClick={onRetry}>{retryLabel}</button>}
    </div>
  );
}

/** Permission denied. Deliberately not an error page — it is a normal state. */
export function DeniedState({ moduleLabel = 'this module' }) {
  return (
    <div className="erp-state erp-state-denied" role="alert">
      <div className="erp-state-icon" aria-hidden="true">🔒</div>
      <h3>Access restricted</h3>
      <p>Your role does not include {moduleLabel}. Ask an administrator if you need access.</p>
    </div>
  );
}

/** Transient success / error banner after a write. */
export function Notice({ kind = 'success', children, onDismiss }) {
  if (!children) return null;
  const icon = kind === 'success' ? '✅' : kind === 'error' ? '⛔' : 'ℹ️';
  return (
    <div className={`erp-notice erp-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{icon}</span>
      <span>{children}</span>
      {onDismiss && <button className="erp-notice-close" onClick={onDismiss} aria-label="Dismiss">×</button>}
    </div>
  );
}

/**
 * Lists per-field validation messages returned by validationService.
 * Anchored under the form rather than only in a toast, so the user can see which
 * field to fix.
 */
export function ValidationSummary({ errors }) {
  const entries = Object.entries(errors || {});
  if (entries.length === 0) return null;
  return (
    <div className="erp-validation-summary" role="alert">
      <strong>Please fix {entries.length} {entries.length === 1 ? 'field' : 'fields'}:</strong>
      <ul>
        {entries.map(([field, message]) => <li key={field}>{message}</li>)}
      </ul>
    </div>
  );
}

/**
 * Confirmation dialog for destructive or irreversible actions.
 * The action is only reached through an explicit click on the confirm button —
 * there is no Enter-to-confirm shortcut, so a stray keypress cannot delete data.
 */
export function ConfirmDialog({ open, title = 'Are you sure?', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, busy = false, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="erp-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="erp-confirm-title" onClick={onCancel}>
      <div className="erp-modal erp-modal-small" onClick={(e) => e.stopPropagation()}>
        <h3 id="erp-confirm-title">{danger ? '⚠️ ' : ''}{title}</h3>
        {message && <p>{message}</p>}
        <div className="erp-modal-actions">
          <button className="btn btn-outline" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
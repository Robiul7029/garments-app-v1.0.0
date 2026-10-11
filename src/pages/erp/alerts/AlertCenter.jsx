import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MODULE } from '../../../config/erpRoles';
import { C, SEVERITY } from '../../../config/erpSchema';
import { usePermissions } from '../../../context/PermissionContext';
import { useErpData } from '../../../context/ErpDataContext';
import { acknowledgeAlert, summariseAlerts, THRESHOLDS, ALERT_RULE } from '../../../services/alertService';
import { ErpPage } from '../../../components/erp/ErpPage';
import { StatCard, EmptyState, Notice, StatusBadge } from '../../../components/erp/Primitives';

/**
 * ROBIUL GARMENTS ERP — Alert Center.
 *
 * One list of everything the business rules have flagged, most severe first.
 * Each alert links to the module that raised it, so a manager goes from
 * "🔴 Line 03 — Production Below Target" to the line's own data in one click.
 *
 * Alerts are never typed by hand: they are written by alertService from the
 * operational data, and they clear themselves when the underlying problem is
 * fixed. The only thing a person does here is acknowledge one, so the list
 * becomes a work queue rather than a wall of noise.
 */
export default function AlertCenter() {
  const permissions = usePermissions();
  const erp = useErpData();
  const [filter, setFilter] = useState('active');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  const canAcknowledge = permissions.can(MODULE.ALERTS, 'approve');

  const visible = useMemo(() => {
    const all = Array.isArray(erp.rows('alerts')) ? erp.rows('alerts') : [];
    return all
      .filter((a) => (filter === 'active' ? a.active !== false : filter === 'resolved' ? a.active === false : true))
      .filter((a) => severityFilter === 'all' || a.severity === severityFilter)
      .sort((a, b) => rank(a.severity) - rank(b.severity) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [erp.rows, filter, severityFilter]);

  const summary = useMemo(() => summariseAlerts(erp.rows('alerts')), [erp.rows]);

  async function acknowledge(alert) {
    setBusyId(alert.id);
    const ok = await acknowledgeAlert(alert.id, permissions.actorName);
    setBusyId(null);
    setNotice(ok
      ? { kind: 'success', message: 'Alert acknowledged.' }
      : { kind: 'error', message: 'Could not acknowledge this alert.' });
  }

  return (
    <ErpPage
      module={MODULE.ALERTS}
      title="Alert Center"
      icon="🔔"
      description="Every alert here is generated automatically from a business rule — none are typed in by hand."
      collection={C.ALERTS}
      pageSize={300}
    >
      {() => (
        <>
          {notice && <Notice kind={notice.kind} onDismiss={() => setNotice(null)}>{notice.message}</Notice>}

          <div className="erp-stat-grid">
            <StatCard label="Active alerts" value={summary.total} icon="🔔" level={summary.total > 0 ? 'warning' : 'good'} />
            <StatCard label="Critical" value={summary.critical} icon="🔴" level={summary.critical > 0 ? 'critical' : 'good'} />
            <StatCard label="Warning" value={summary.warning} icon="🟠" level={summary.warning > 0 ? 'warning' : 'good'} />
            <StatCard label="Unacknowledged" value={summary.unacknowledged} icon="👀" level={summary.unacknowledged > 0 ? 'warning' : 'good'} />
          </div>

          <div className="erp-filter-bar">
            <div className="erp-segmented" role="tablist" aria-label="Alert status">
              {[['active', 'Active'], ['resolved', 'Resolved'], ['all', 'All']].map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={filter === key}
                  className={`erp-segment${filter === key ? ' active' : ''}`}
                  onClick={() => setFilter(key)}
                >{label}</button>
              ))}
            </div>
            <select className="erp-select" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Filter by severity">
              <option value="all">All severities</option>
              <option value={SEVERITY.CRITICAL}>🔴 Critical</option>
              <option value={SEVERITY.WARNING}>🟠 Warning</option>
              <option value={SEVERITY.INFO}>🔵 Info</option>
            </select>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon="✅"
              title={filter === 'active' ? 'No active alerts' : 'Nothing matches this filter'}
              message={filter === 'active'
                ? 'Every rule is currently satisfied. Alerts appear here automatically when production falls behind, QC rejects rise, stock runs low, a machine breaks down, or a shipment is at risk.'
                : 'Try a different filter.'}
            />
          ) : (
            <ul className="erp-alert-list erp-alert-list-full">
              {visible.map((alert) => (
                <li key={alert.id} className={`erp-alert erp-alert-${alert.severity}${alert.active === false ? ' erp-alert-resolved' : ''}`}>
                  <div className="erp-alert-head">
                    <span className="erp-alert-title">{alert.title}</span>
                    <StatusBadge status={alert.active === false ? 'Resolved' : alert.severity === SEVERITY.CRITICAL ? 'Critical' : 'Warning'} />
                  </div>
                  <p className="erp-alert-message">{alert.message}</p>
                  <div className="erp-alert-meta">
                    <span className="erp-chip">{ruleLabel(alert.rule)}</span>
                    {alert.raisedAt && <span className="erp-chip">Raised {formatWhen(alert.raisedAt)}</span>}
                    {alert.acknowledged && <span className="erp-chip erp-chip-success">✓ Acknowledged{alert.acknowledgedBy ? ` by ${alert.acknowledgedBy}` : ''}</span>}
                    {alert.active !== false && alert.target && <Link className="erp-chip erp-chip-link" to={alert.target}>Open source →</Link>}
                  </div>
                  {alert.active !== false && !alert.acknowledged && (
                    canAcknowledge ? (
                      <button className="btn btn-outline btn-sm" disabled={busyId === alert.id} onClick={() => acknowledge(alert)}>
                        {busyId === alert.id ? 'Saving…' : 'Acknowledge'}
                      </button>
                    ) : (
                      <span className="erp-hint">Acknowledge is available to management roles.</span>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}

          <details className="erp-thresholds">
            <summary>Alert thresholds in use</summary>
            <ul>
              <li>Line production: 🔴 below {THRESHOLDS.lineCriticalPercent}%, 🟠 below {THRESHOLDS.lineWarningPercent}% of target</li>
              <li>QC reject: 🟠 above {THRESHOLDS.qcRejectLimitPercent}% of inspected units</li>
              <li>Shipment: 🟠 due within {THRESHOLDS.shipmentRiskDays} days and not fully shipped</li>
              <li>TNA: 🟠 more than {THRESHOLDS.tnaDelayDays} days past the planned date</li>
              <li>Stock: 🔴 at or below minimum, 🟠 within half of maximum</li>
            </ul>
          </details>
        </>
      )}
    </ErpPage>
  );
}

function rank(severity) {
  return severity === SEVERITY.CRITICAL ? 0 : severity === SEVERITY.WARNING ? 1 : 2;
}

const RULE_LABELS = {
  [ALERT_RULE.LINE_BELOW_TARGET]: 'Production below target',
  [ALERT_RULE.QC_REJECT_ABOVE_LIMIT]: 'QC reject above limit',
  [ALERT_RULE.FABRIC_STOCK_LOW]: 'Stock low',
  [ALERT_RULE.MACHINE_BREAKDOWN]: 'Machine breakdown',
  [ALERT_RULE.PO_SHIPMENT_DELAY_RISK]: 'Shipment delay risk',
  [ALERT_RULE.ORDER_TNA_DELAY]: 'TNA delay',
};

function ruleLabel(rule) {
  return RULE_LABELS[rule] || rule || 'Rule';
}

function formatWhen(value) {
  const d = typeof value === 'string' ? new Date(value) : (value?.toDate?.() || null);
  if (!d || Number.isNaN(d.getTime())) return 'recently';
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
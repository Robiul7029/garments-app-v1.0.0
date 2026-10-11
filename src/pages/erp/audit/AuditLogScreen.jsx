import React, { useEffect, useMemo, useState } from 'react';
import { MODULE } from '../../../config/erpRoles';
import { C } from '../../../config/erpSchema';
import { usePermissions } from '../../../context/PermissionContext';
import { useErpData } from '../../../context/ErpDataContext';
import { AUDIT_ACTION, collectionLabel } from '../../../services/auditService';
import { ErpPage } from '../../../components/erp/ErpPage';
import { EmptyState, StatusBadge, Notice } from '../../../components/erp/Primitives';
import { downloadCSV } from '../../../utils/csv';

/**
 * ROBIUL GARMENTS ERP — Audit Log.
 *
 * Who did what, to which record, when, and what the value was before and after.
 * This screen is strictly read-only by design: firestore.rules denies update and
 * delete on `auditLogs` outright, so there is no button anywhere that could alter
 * history — not even for a super admin.
 *
 * Example row:
 *   Supervisor Rahim · update · Purchase Order · PO-105 · "actual: 420 → 470" · 10:42
 */
const ACTION_FILTERS = [
  ['', 'All actions'],
  [AUDIT_ACTION.CREATE, 'Create'],
  [AUDIT_ACTION.UPDATE, 'Update'],
  [AUDIT_ACTION.DELETE, 'Delete'],
  [AUDIT_ACTION.APPROVE, 'Approve'],
  [AUDIT_ACTION.REJECT, 'Reject'],
  [AUDIT_ACTION.LOGIN, 'Login'],
  [AUDIT_ACTION.LOGOUT, 'Logout'],
  [AUDIT_ACTION.SYNC, 'Sync'],
];

export default function AuditLogScreen() {
  const permissions = usePermissions();
  const erp = useErpData();
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState(null);

  const all = erp.rows('audit');

  // The actor filter's options come from the log itself, so a user can filter by
  // anyone who has actually acted rather than by a stale user list.
  const actors = useMemo(() => {
    const set = new Set();
    (all || []).forEach((row) => row.actor && set.add(row.actor));
    return [...set].sort();
  }, [all]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (all || [])
      .filter((row) => !actionFilter || row.action === actionFilter)
      .filter((row) => !actorFilter || row.actor === actorFilter)
      .filter((row) => {
        if (!term) return true;
        return [row.actor, row.label, row.summary, collectionLabel(row.collection), row.action]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(term));
      })
      .sort((a, b) => String(b.createdAt || b.clientTime || '').localeCompare(String(a.createdAt || a.clientTime || '')));
  }, [all, actionFilter, actorFilter, search]);

  function exportCsv() {
    const columns = [
      { name: 'When', label: 'When' },
      { name: 'Actor', label: 'Actor' },
      { name: 'Action', label: 'Action' },
      { name: 'Collection', label: 'Record Type' },
      { name: 'Label', label: 'Record' },
      { name: 'Summary', label: 'Change' },
    ];
    const rows = visible.map((row) => ({
      When: formatStamp(row.createdAt || row.clientTime),
      Actor: row.actor || '',
      Action: row.action || '',
      Collection: collectionLabel(row.collection),
      Label: row.label || row.recordId || '',
      Summary: row.summary || '',
    }));
    downloadCSV(`audit-log-${formatStamp(new Date()).replace(/[^\d]/g, '')}.csv`, rows, columns);
    setNotice({ kind: 'success', message: `Exported ${rows.length} audit entries.` });
  }

  return (
    <ErpPage
      module={MODULE.AUDIT}
      title="Audit Log"
      icon="🗂️"
      description="Append-only record of every change. Entries cannot be edited or deleted by anyone, including administrators."
      collection={C.AUDIT_LOGS}
      pageSize={300}
      actions={
        permissions.can(MODULE.AUDIT, 'export')
          ? <button className="btn btn-outline" onClick={exportCsv}>⬇ Export CSV</button>
          : null
      }
    >
      {() => (
        <>
          {notice && <Notice kind={notice.kind} onDismiss={() => setNotice(null)}>{notice.message}</Notice>}

          <div className="erp-filter-bar">
            <input
              className="erp-input"
              type="search"
              placeholder="Search user, PO, record or change…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search the audit log"
            />
            <select className="erp-select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} aria-label="Filter by action">
              {ACTION_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="erp-select" value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} aria-label="Filter by user">
              <option value="">All users</option>
              {actors.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <span className="erp-chip">{visible.length} entries</span>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon="🗂️"
              title="No audit entries match"
              message="Entries are written automatically whenever a record is created, changed, approved, rejected, or a user signs in or out."
            />
          ) : (
            <div className="erp-table-wrap">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Record</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id}>
                      <td className="erp-mono erp-nowrap">{formatStamp(row.createdAt || row.clientTime)}</td>
                      <td className="erp-strong">{row.actor || 'System'}</td>
                      <td><StatusBadge status={actionLabel(row.action)} /></td>
                      <td>
                        <div className="erp-strong">{row.label || '—'}</div>
                        <div className="erp-subtle">{collectionLabel(row.collection)}</div>
                      </td>
                      <td className="erp-change">{row.summary || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ErpPage>
  );
}

function actionLabel(action) {
  const map = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    approve: 'Approved',
    reject: 'Rejected',
    login: 'Signed in',
    logout: 'Signed out',
    view: 'Viewed',
    export: 'Exported',
    sync: 'Synced',
  };
  return map[action] || action || '—';
}

function formatStamp(value) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : (value?.toDate?.() || null);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}
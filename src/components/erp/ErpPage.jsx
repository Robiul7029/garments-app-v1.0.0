import React, { useEffect, useState } from 'react';
import { MODULE_LABELS } from '../../config/erpRoles';
import { usePermissions } from '../../context/PermissionContext';
import { useErpData } from '../../context/ErpDataContext';
import { ErrorState, LoadingState, Notice, EmptyState } from './Primitives';

/**
 * ROBIUL GARMENTS ERP — screen shell.
 *
 * Wraps every ERP screen with the things that must be identical everywhere, so
 * no individual screen can forget them:
 *
 *   - a live-data subscription with loading / error / empty states
 *   - a page header with a title, description and actions slot
 *
 * A screen below this only renders its own content, which is why the ERP screens
 * stay short and consistent.
 *
 * There is no permission wall: a signed-in account may READ every module, so a
 * screen is never replaced by an "Access restricted" page. `requires` still
 * names the action the screen's own actions slot needs, so a caller that passes
 * buttons for a write-only action can pass `requires="create"` and the slot is
 * dropped for a View-Only user while the table below stays visible.
 */
export function ErpPage({
  module,
  title,
  icon,
  description,
  // Collection to subscribe to. Omit for a screen that manages its own data.
  collection,
  query,
  pageSize = 100,
  // The action the header controls need. Read access is always granted; this
  // only decides whether the `actions` slot is shown at all.
  requires,
  actions,
  children,
}) {
  const permissions = usePermissions();
  const erp = useErpData();
  const [rows, setRows] = useState([]);
  const [notice, setNotice] = useState(null);

  const label = MODULE_LABELS[module] || module;
  // Read access is the View-Only baseline, so the subscription only waits for
  // the permission record to resolve — never for a role grant.
  const ready = !permissions.loading;
  // The action buttons are hidden from a role that cannot perform `requires`.
  // No `requires` means the slot carries read-only controls (filters, exports a
  // role may always use), so it is shown.
  const canUseActions = !requires || permissions.can(module, requires);

  // Subscribe once the permission record is in. Opening the listener before the
  // role read has finished would fire reads the security rules may reject,
  // producing a console error that looks like a bug rather than a delay.
  useEffect(() => {
    if (!ready || !collection) return undefined;
    return erp.subscribe('page', {
      collection,
      where: query?.where,
      orderBy: query?.orderBy,
      pageSize,
    });
  }, [ready, collection, query, pageSize, erp.subscribe]);

  useEffect(() => {
    if (collection) setRows(erp.rows('page'));
  }, [collection, erp.rows]);

  if (permissions.loading) return <LoadingState label="Checking your access…" />;

  const loading = erp.isLoading('page');
  const error = erp.errorFor('page');

  return (
    <div className="erp-page">
      <header className="erp-page-header">
        <div>
          <h1 className="erp-page-title">
            {icon && <span aria-hidden="true">{icon}</span>} {title || label}
          </h1>
          {description && <p className="erp-page-description">{description}</p>}
        </div>
        {actions && canUseActions && <div className="erp-page-actions">{actions}</div>}
      </header>

      {notice && <Notice kind={notice.kind} onDismiss={() => setNotice(null)}>{notice.message}</Notice>}

      {error && <ErrorState message={error} />}

      {loading && rows.length === 0
        ? <LoadingState label={`Loading ${label.toLowerCase()}…`} />
        : children({ rows, loading, error, setNotice, erp, permissions })}
    </div>
  );
}

/** Convenience wrapper for a screen whose whole content is one table. */
export function ErpTablePage({ module, title, icon, description, collection, query, pageSize, columns, emptyTitle, emptyMessage, rowKey = 'id', actions, requires }) {
  return (
    <ErpPage module={module} title={title} icon={icon} description={description} collection={collection} query={query} pageSize={pageSize} actions={actions} requires={requires}>
      {({ rows, loading }) => {
        if (!loading && rows.length === 0) {
          return <EmptyState title={emptyTitle || 'No records yet'} message={emptyMessage} />;
        }
        return (
          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead>
                <tr>{columns.map((c) => <th key={c.key} style={c.align ? { textAlign: c.align } : undefined}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row[rowKey]}>
                    {columns.map((c) => (
                      <td key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                        {c.render ? c.render(row) : formatCell(row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }}
    </ErpPage>
  );
}

function formatCell(value) {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export { MODULE_LABELS };
import React, { useEffect, useState } from 'react';
import { MODULE_LABELS } from '../../config/erpRoles';
import { usePermissions } from '../../context/PermissionContext';
import { useErpData } from '../../context/ErpDataContext';
import { DeniedState, ErrorState, LoadingState, Notice, EmptyState } from './Primitives';

/**
 * ROBIUL GARMENTS ERP — screen shell.
 *
 * Wraps every ERP screen with the things that must be identical everywhere, so
 * no individual screen can forget them:
 *
 *   - a permission gate, so a module is never rendered to a role that lacks it
 *   - a live-data subscription with loading / error / empty states
 *   - a page header with a title, description and actions slot
 *
 * A screen below this only renders its own content, which is why the ERP screens
 * stay short and consistent.
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
  requires = 'view',
  actions,
  children,
}) {
  const permissions = usePermissions();
  const erp = useErpData();
  const [rows, setRows] = useState([]);
  const [notice, setNotice] = useState(null);

  const allowed = permissions.can(module, requires);
  const label = MODULE_LABELS[module] || module;

  // Subscribe only once the screen is allowed to exist. Without the `allowed`
  // check in the dependency, a denied user's effect would still open a listener
  // — which the security rules would reject, producing a console error that looks
  // like a bug rather than a correct denial.
  useEffect(() => {
    if (!allowed || !collection) return undefined;
    return erp.subscribe('page', {
      collection,
      where: query?.where,
      orderBy: query?.orderBy,
      pageSize,
    });
  }, [allowed, collection, query, pageSize, erp.subscribe]);

  useEffect(() => {
    if (collection) setRows(erp.rows('page'));
  }, [collection, erp.rows]);

  if (permissions.loading) return <LoadingState label="Checking your access…" />;
  if (!allowed) return <DeniedState moduleLabel={label} />;

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
        {actions && <div className="erp-page-actions">{actions}</div>}
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
export function ErpTablePage({ module, title, icon, description, collection, query, pageSize, columns, emptyTitle, emptyMessage, rowKey = 'id', actions }) {
  return (
    <ErpPage module={module} title={title} icon={icon} description={description} collection={collection} query={query} pageSize={pageSize} actions={actions}>
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
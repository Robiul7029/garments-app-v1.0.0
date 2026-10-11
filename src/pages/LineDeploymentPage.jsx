import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadCSV } from '../utils/csv';
import {
  DIRECTORY_COLLECTION,
  EMPLOYEE_NAMES_KEY,
  EMPLOYEE_SEQ_KEY,
  ATTENDANCE_WORKERS,
  STATUS,
  STATUS_LABEL,
  directoryList,
  buildEmployeeRecord,
  nextEmployeeId,
  bumpSequence,
  findByName,
  isSelectable,
  isArchived,
  isInactive,
  buildDirectorySync,
  workersToSync,
} from '../config/employeeDirectory';
import { renameWorkerAndAttendance, syncDirectoryToWorkers } from '../utils/attendance';

/**
 * Manpower Management → Line Deployment.
 *
 * This is the EMPLOYEE DIRECTORY: the one screen where a person is created, and
 * the single source every other form in the app selects employees from — Daily
 * Production, Operator Performance, Quality Control and the Supervisor field all
 * read the list this screen produces.
 *
 * It is deliberately small. A name is typed, an Employee ID is generated, and the
 * person appears in the table below. The earlier date/line/shift/manpower grid
 * was removed: it recorded a daily head-count, which is not what a directory is
 * for, and it left the rest of the app with no list of people to choose from.
 *
 * TWO WRITES PER EMPLOYEE, and both matter:
 *   `employee-directory`  the full record, carrying the generated Employee ID
 *   `employees`           the plain name list the other screens already read
 * See config/employeeDirectory.js for why both exist rather than one replacing
 * the other.
 */
export default function LineDeploymentPage({ category, item }) {
  const { getData, setRaw } = useData();
  const { isAdmin } = useRole();

  const directory = getData(DIRECTORY_COLLECTION);
  const previousNames = getData(EMPLOYEE_NAMES_KEY);
  // The high-water mark of issued IDs. Kept even when a record is deleted, so a
  // retired ID is never handed to a different person (see employeeDirectory.js).
  const sequence = getData(EMPLOYEE_SEQ_KEY);
  const sequenceValue = Array.isArray(sequence) ? sequence[0] || 0 : sequence || 0;

  const employees = useMemo(() => directoryList(directory), [directory]);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  // Set when the local save succeeded but the Firestore mirror could not be
  // written. Kept separate from `error` because the edit itself DID land.
  const [syncWarning, setSyncWarning] = useState('');
  const [query, setQuery] = useState('');
  // The employee awaiting delete confirmation. `null` means the dialog is closed.
  // Holding the whole record rather than just an id means the dialog can name the
  // person without a second lookup, and that a delete can never fire against a row
  // that has since changed underneath it.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  // The dialog's checkbox: false = inactive (reversible), true = archive.
  const [purge, setPurge] = useState(false);
  // Which records the table shows. The default is the active roster, because that
  // is what the floor needs; dormant people are one click away rather than gone.
  const [showDormant, setShowDormant] = useState(false);

  // The ID the next submission will receive, shown before it is used so the
  // person entering data can see the sequence is live.
  const pendingId = useMemo(
    () => nextEmployeeId(employees, sequenceValue),
    [employees, sequenceValue],
  );

  const activeCount = useMemo(() => employees.filter(isSelectable).length, [employees]);
  const inactiveCount = useMemo(() => employees.filter(isInactive).length, [employees]);
  const archivedCount = useMemo(() => employees.filter(isArchived).length, [employees]);

  const filtered = useMemo(() => {
    // The status filter runs first: an inactive person must not appear in the
    // active list even if the search matches them.
    const scoped = showDormant ? employees.filter((e) => !isSelectable(e)) : employees.filter(isSelectable);
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (e) => e.name.toLowerCase().includes(q) || String(e.employeeId).toLowerCase().includes(q),
    );
  }, [employees, query, showDormant]);

  /**
   * Persists a changed directory.
   *
   * `employees` is re-derived from the directory on every write and merged with
   * any name it already held, so a legacy name is never dropped by saving here.
   */
  /**
   * Persists the directory and mirrors it into Smart Attendance.
   *
   * Three writes, and each one is load-bearing:
   *   `employee-directory`  the master record, carrying the Employee ID
   *   `workers`             Smart Attendance's own store, so the person can be
   *                         clocked in without being entered a second time
   *   `employees`           the plain name list every other dropdown reads
   *
   * The attendance mirror is written for the WHOLE directory on every save rather
   * than only the changed row: it is cheap at factory scale, and it means a status
   * change (deactivating somebody) reaches the attendance screen, which filters on
   * `active`, without a separate code path that could be forgotten.
   */
  function saveDirectory(nextDirectory) {
    setRaw(DIRECTORY_COLLECTION, nextDirectory);
    // The shared name list and the local worker mirror, computed in one place so a
    // test can assert exactly what a save writes (see buildDirectorySync). The
    // CURRENT directory is passed too, so a rename retires the old spelling rather
    // than letting it reappear on the dropdowns on the next save.
    const { names, workers } = buildDirectorySync(nextDirectory, previousNames, directory);
    setRaw(EMPLOYEE_NAMES_KEY, names);
    setRaw(ATTENDANCE_WORKERS, workers);

    // Push the SAME roster into the Firestore `workers` collection Smart Attendance
    // actually reads. The local writes above are what every dropdown in this app sees;
    // this is what the attendance screen (a separate Firestore-backed module) sees.
    //
    // Deliberately not awaited: the in-app write must land even if the network is
    // down, so the directory stays usable offline. A failure is reported, not thrown,
    // because losing the local edit would be worse than a delayed cloud sync.
    syncDirectoryToWorkers(workersToSync(nextDirectory)).catch((syncError) => {
      // eslint-disable-next-line no-console
      console.error('[LineDeployment] Smart Attendance sync failed', syncError);
      setSyncWarning('Saved locally, but the Smart Attendance sync did not complete. It will retry on the next save.');
    });
  }

  function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSyncWarning('');

    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) {
      setError('Enter the employee’s full name.');
      return;
    }

    // A duplicate name is REFUSED, not merely flagged.
    //
    // This reverses the earlier behaviour, and the reason is worth stating: the
    // directory is what every other form selects a person from, and those forms
    // store the NAME, not the Employee ID. Two rows sharing a name are therefore
    // indistinguishable downstream — a production entry could not say which
    // Salma it meant, and payroll would pay the wrong one. The name has to be
    // unique for the rest of the app to work, so it is enforced here.
    const existing = findByName(employees, clean);
    if (existing) {
      setError(
        `“${existing.name}” is already in the directory as ${existing.employeeId}. `
        + 'Employee names must be unique — edit that record instead of adding it again.',
      );
      return;
    }

    let record;
    try {
      record = buildEmployeeRecord(clean, employees, undefined, sequenceValue);
    } catch (err) {
      setError(err.message);
      return;
    }

    saveDirectory([...directory, record]);
    // Move the mark forward so this ID can never be issued again, even if the
    // record is deleted later.
    setRaw(EMPLOYEE_SEQ_KEY, [bumpSequence(sequenceValue, record.employeeId)]);
    setName('');
    // `record.employeeId`'s numeric tail is the Smart Attendance workerId, which
    // is what makes the new person immediately clockable there.
    setNotice(
      `Added ${record.name} as ${record.employeeId}, linked to Smart Attendance as worker `
      + `${Number(record.employeeId.replace(/\\D/g, '')) || ''}. They are now selectable on every form.`,
    );
  }

  function startEdit(employee) {
    setEditingId(employee.id);
    setEditName(employee.name);
    setNotice('');
    setError('');
  }

  function commitEdit(employee) {
    setError('');
    const clean = editName.trim().replace(/\s+/g, ' ');
    if (!clean) {
      setError('A name cannot be empty.');
      return;
    }

    // The same uniqueness rule applies to a rename. Its own row is excluded, so
    // saving a record without touching its name is not read as a clash with
    // itself.
    const clash = findByName(employees.filter((e) => e.id !== employee.id), clean);
    if (clash) {
      setError(`“${clash.name}” is already in the directory as ${clash.employeeId}. Choose a different name.`);
      return;
    }

    // The record is replaced in place, so the Employee ID it already holds is
    // preserved — renaming must never reissue an ID that attendance rows,
    // payroll and printed rosters already refer to.
    const next = directory.map((r) => (r.id === employee.id ? { ...r, name: clean } : r));
    saveDirectory(next);

    // A rename also has to reach the attendance rows that already name the person,
    // or Smart Attendance would show the old spelling beside the new one. The rows
    // are matched by workerId, so they update regardless of the previous name.
    const workerId = employee.workerId ?? Number(String(employee.employeeId).replace(/\D/g, ''));
    if (workerId) {
      renameWorkerAndAttendance({ workerId, name: clean }).catch((syncError) => {
        // eslint-disable-next-line no-console
        console.error('[LineDeployment] Attendance rename sync failed', syncError);
        setSyncWarning('Renamed locally, but existing attendance rows could not be updated in the cloud.');
      });
    }

    setEditingId(null);
    setEditName('');
    setNotice(`${employee.employeeId} renamed to ${clean}. The change is reflected in Smart Attendance and every dropdown.`);
  }

  /** Opens the confirmation dialog. Nothing changes until it is confirmed. */
  function requestRemove(employee) {
    setPendingDelete(employee);
    setPurge(false);
    setError('');
  }

  /**
   * Applies the change the dialog asked about.
   *
   * Two distinct outcomes, and getting them the wrong way round is what loses a
   * payroll history, so both are spelled out:
   *
   *   UNCHECKED (default) — the record is set to `inactive`. The person drops out
   *     of every active dropdown but the directory keeps them, their Employee ID,
   *     and their attendance history. This is reversible from this screen.
   *
   *   CHECKED — the record is `archived`: removed from every active list across
   *     the app and kept only for the Admin Panel's inactive section. Still not a
   *     hard delete, because attendance and production rows reference this person
   *     by workerId and would be orphaned by removing the document.
   *
   * A hard delete is deliberately not offered. There is no undo for it, and the
   * cost of getting it wrong is a broken historical report.
   */
  function confirmRemove() {
    const employee = pendingDelete;
    if (!employee) return;
    setBusy(true);
    try {
      const nextStatus = purge ? STATUS.ARCHIVED : STATUS.INACTIVE;

      // The record stays in the collection and is updated in place, so its
      // Employee ID and workerId are preserved. Archiving a person must never
      // free their ID for somebody else — attendance rows already point at it.
      const next = directory.map((r) => (
        r.id === employee.id
          ? {
            ...r,
            status: nextStatus,
            archived: nextStatus === STATUS.ARCHIVED,
            // Kept for the older readers that only understand a boolean.
            active: false,
            statusChangedAt: new Date().toISOString().slice(0, 10),
          }
          : r
      ));

      // A status change IS a directory change, so the same save path is used: the
      // attendance mirror is rewritten with `active: false`, which is how Smart
      // Attendance stops offering them for a clock-in.
      saveDirectory(next);

      setNotice(
        purge
          ? `${employee.name} (${employee.employeeId}) archived. They are hidden from every active list and remain visible only in the Admin Panel's inactive section.`
          : `${employee.name} (${employee.employeeId}) marked inactive. They are hidden from the production dropdowns but kept in the directory — use Reactivate to bring them back.`,
      );
    } finally {
      setBusy(false);
      setPendingDelete(null);
      setPurge(false);
    }
  }

  /**
   * Brings an inactive or archived person back onto the active lists.
   * Restoring is non-destructive, so it needs no confirmation, but the record and
   * the attendance mirror are both rewritten so Smart Attendance offers them again.
   */
  function reactivate(employee) {
    const next = directory.map((r) => (
      r.id === employee.id
        ? { ...r, status: STATUS.ACTIVE, archived: false, active: true, statusChangedAt: undefined }
        : r
    ));
    saveDirectory(next);
    setNotice(`${employee.name} (${employee.employeeId}) reactivated and selectable again.`);
  }

  return (
    <div className="module">
      <div className="module-header">
        <div className="breadcrumb">{category.icon} {category.label}</div>
        <h2 style={{ margin: 0 }}>{item.icon} {item.label}</h2>
        <p className="hint" style={{ maxWidth: '80ch' }}>
          The employee directory. Add a name and an Employee ID is issued automatically. Everyone listed
          here becomes selectable in Daily Production, Operator Performance, Quality Control and every
          other employee dropdown in the app.
        </p>
      </div>

      {notice && <div className="erp-notice erp-notice-success dp-notice">{notice}</div>}
      {syncWarning && (
        <div className="erp-notice erp-notice-warning dp-notice" role="status">
          <span aria-hidden="true">⚠️</span>
          <span>{syncWarning}</span>
        </div>
      )}
      {error && (
        <div className="erp-notice erp-notice-error dp-notice" role="alert">
          <span aria-hidden="true">⛔</span>
          <span>{error}</span>
        </div>
      )}

      {isAdmin ? (
        <form className="dp-entry-card" onSubmit={submit}>
          <h3 className="dp-recent-title">Add employee</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="form-field" style={{ flex: '1 1 280px', maxWidth: 420 }}>
              <span>Full Name <em className="req-star">*</em></span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Salma Khatun"
                autoComplete="off"
              />
            </label>
            <label className="form-field" style={{ flex: '0 0 160px' }}>
              <span>Employee ID <em className="auto-note">(auto)</em></span>
              <input value={pendingId} disabled readOnly />
            </label>
            <button type="submit" className="btn btn-primary" style={{ marginBottom: 1 }}>Submit</button>
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            The Employee ID is generated automatically and never reused, so it stays valid on attendance,
            payroll and printed rosters.
          </p>
        </form>
      ) : (
        <div className="erp-notice erp-notice-info dp-notice">
          <span aria-hidden="true">🔒</span>
          <span>View only — your role can see the directory but not change it.</span>
        </div>
      )}

      <div className="dp-recent-head" style={{ marginTop: 22 }}>
        <h3 className="dp-recent-title">
          Employee directory ({activeCount})
          {inactiveCount > 0 && <span className="erp-chip erp-count-chip">{inactiveCount} inactive</span>}
          {archivedCount > 0 && <span className="erp-chip erp-count-chip">{archivedCount} archived</span>}
        </h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* The active roster is the default view. Dormant people are still here,
              one click away, rather than hidden with no way to get them back. */}
          {(inactiveCount > 0 || archivedCount > 0) && (
            <button
              type="button"
              className={`btn btn-sm ${showDormant ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setShowDormant((v) => !v)}
              aria-pressed={showDormant}
            >
              {showDormant ? '← Back to active' : `Show inactive (${inactiveCount + archivedCount})`}
            </button>
          )}
          <input
            className="dp-remark-input"
            style={{ width: 220 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or ID…"
            aria-label="Search the employee directory"
          />
          {employees.length > 0 && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => downloadCSV('employee-directory.csv', employees, [
                { name: 'employeeId', label: 'Employee ID' },
                { name: 'name', label: 'Full Name' },
              ])}
            >
              ⬇ Export
            </button>
          )}
        </div>
      </div>

      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="dp-table">
          <thead>
            <tr>
              <th style={{ width: 140 }}>Employee ID</th>
              <th>Full Name</th>
              <th style={{ width: 110 }}>Status</th>
              {isAdmin && <th style={{ width: 190 }}>Action</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 4 : 3} className="empty-row">
                  {employees.length === 0
                    ? 'No employees yet — add a name above and the Employee ID is issued automatically.'
                    : 'No employee matches that search.'}
                </td>
              </tr>
            )}
            {filtered.map((employee) => {
              const isEditing = editingId === employee.id;
              return (
                <tr key={employee.id} className={isEditing ? 'dp-row-editing' : undefined}>
                  <td className="mono-cell dp-strong">{employee.employeeId}</td>
                  <td>
                    {isEditing ? (
                      <input
                        className="dp-remark-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitEdit(employee); }
                          if (e.key === 'Escape') { setEditingId(null); setEditName(''); }
                        }}
                        autoFocus
                        aria-label={`Rename ${employee.name}`}
                      />
                    ) : employee.name}
                  </td>
                  <td>
                    <span className={`erp-badge erp-badge-${
                      isArchived(employee) ? 'danger' : isInactive(employee) ? 'warning' : 'success'
                    }`}>
                      {STATUS_LABEL[employee.status] || STATUS_LABEL[STATUS.ACTIVE]}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="row-actions">
                      {isEditing ? (
                        <>
                          <button className="btn btn-outline btn-sm" onClick={() => commitEdit(employee)}>Save</button>
                          <button className="btn btn-outline btn-sm" onClick={() => { setEditingId(null); setEditName(''); }}>Cancel</button>
                        </>
                      ) : !isSelectable(employee) ? (
                        /* A dormant record gets ONE action: put them back. Renaming
                           or re-removing somebody already removed is not useful, and
                           a second delete on an archived record would be confusing. */
                        <>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => reactivate(employee)}
                            title={`Return ${employee.name} to the active roster`}
                          >
                            ♻️ Reactivate
                          </button>
                          <span className="hint" style={{ margin: 0 }}>
                            {isArchived(employee) ? 'Archived — admin only' : 'Inactive'}
                          </span>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-outline btn-sm" onClick={() => startEdit(employee)}>Edit</button>
                          <button
                            className="btn-icon"
                            title={`Remove ${employee.name}`}
                            aria-label={`Remove ${employee.name}`}
                            onClick={() => requestRemove(employee)}
                          >
                            🗑️
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Deletion confirmation.

          A real dialog rather than window.confirm(). The browser popup blocks
          the whole tab, cannot be styled, is suppressed entirely in some
          embedded and mobile webviews (which would delete without asking), and
          gives no room to say what actually happens.

          The checkbox is the whole point of this version: the everyday action is
          to take somebody off the active lists, and that is reversible. Removing
          them from the entire site is the unusual, harder-to-undo case, so it is
          deliberately the one that needs an extra, explicit tick. */}
      {pendingDelete && (
        <div
          className="dp-modal-backdrop"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setPendingDelete(null); }}
        >
          <div
            className="dp-modal dp-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ld-confirm-title"
            aria-describedby="ld-confirm-body"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !busy) setPendingDelete(null);
              if (e.key === 'Enter' && !busy) confirmRemove();
            }}
          >
            <header className="dp-modal-head">
              <h3 id="ld-confirm-title">Remove employee?</h3>
              <button
                type="button"
                className="dp-modal-close"
                aria-label="Close"
                disabled={busy}
                onClick={() => setPendingDelete(null)}
              >×</button>
            </header>

            <div className="dp-modal-body">
              <p className="dp-confirm-question">
                Are you sure you want to remove <strong>{pendingDelete.name}</strong>?
              </p>
              <p className="dp-confirm-meta">
                Employee ID <span className="mono-cell dp-strong">{pendingDelete.employeeId}</span>
              </p>

              {/* What will actually happen, stated before the tick rather than
                  after — this is the choice the dialog exists to make clear. */}
              <div className={`dp-confirm-outcome${purge ? ' dp-confirm-outcome-strong' : ''}`}>
                {purge ? (
                  <>
                    <strong>Archived.</strong> Removed from <em>all</em> active lists across the app.
                    Visible only in the Admin Panel's inactive section.
                  </>
                ) : (
                  <>
                    <strong>Set to Inactive.</strong> Hidden from the active production dropdowns, but
                    kept in this directory with their Employee ID and attendance history. You can
                    reactivate them at any time.
                  </>
                )}
              </div>

              <label className="dp-confirm-check">
                <input
                  type="checkbox"
                  checked={purge}
                  disabled={busy}
                  onChange={(e) => setPurge(e.target.checked)}
                />
                <span>Permanently remove from all site dropdowns / entire site?</span>
              </label>

              <p className="hint">
                Nothing is hard-deleted either way. Attendance and production entries that already
                name this person are kept, because they reference the Employee ID — removing the
                record outright would orphan that history.
              </p>
            </div>

            <div className="dp-modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setPendingDelete(null)}
                disabled={busy}
                autoFocus
              >
                No
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmRemove}
                disabled={busy}
              >
                {busy ? 'Working…' : (purge ? 'Yes, archive' : 'Yes, delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

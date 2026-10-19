import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  CUSTOM_DESIGNATION,
  CUSTOM_DESIGNATION_LABEL,
  DESIGNATION_OPTIONS_KEY,
  designationOptionsFor,
  addDesignationOption,
  matchingDesignation,
  cleanDesignation,
  normalizeDesignation,
  directoryList,
  buildEmployeeRecord,
  validateEmployee,
  resolveDesignation,
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
  // The designations the user ADDED by hand with the form's "+ Add" button. Kept in
  // their own store so an added grade survives before any employee carries it — the
  // directory alone only knows a custom value once a record holds it.
  const storedDesignationOptions = getData(DESIGNATION_OPTIONS_KEY);
  /**
   * The designations the form and the table offer.
   *
   * The preset grades, plus any custom value the directory already carries, plus any
   * value added by hand — so a post recorded once, or added with "+ Add", is selectable
   * for the next person in it rather than having to be retyped.
   */
  const designationOptions = useMemo(
    () => designationOptionsFor(directory, storedDesignationOptions),
    [directory, storedDesignationOptions],
  );
  const [name, setName] = useState('');
  // The grade chosen in the form. Part of the record, and the field the Supervisor
  // Name dropdown on Total Line Output filters on. `CUSTOM_DESIGNATION` means "the
  // value in `customDesignation`" — see `resolveDesignation`.
  const [designation, setDesignation] = useState('');
  const [customDesignation, setCustomDesignation] = useState('');
  // Whether the custom Designation menu is open. The "+ Add" box lives INSIDE this
  // menu rather than beside the control, so the whole choice — pick an existing grade
  // or name a new one — happens in one place.
  const [designationOpen, setDesignationOpen] = useState(false);
  // The menu and its trigger, so a click anywhere else can close it.
  const designationRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  // The designation being edited INLINE in the table's row, so a grade can be
  // corrected without opening the name editor.
  const [editDesignation, setEditDesignation] = useState('');
  const [notice, setNotice] = useState('');
  // Field-level validation: which box is wrong and what to say under it. There is
  // deliberately no form-level banner — the brief asks for the message beneath the
  // field it belongs to, and this form has only two fields to get wrong.
  const [fieldErrors, setFieldErrors] = useState({});
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

  /**
   * The "+ Add" row INSIDE the Designation menu.
   *
   * Does two things at once, which is the whole point of the button:
   *
   *   1. INSTANTLY selects the typed value in the Designation field, so the choice is
   *      made without a second trip to the menu;
   *   2. PERSISTS it into the active options list, so the grade is selectable for the
   *      next person rather than having to be retyped.
   *
   * A value that is already on the list (in any casing) is not added a second time —
   * the existing spelling is selected instead, so the menu keeps one canonical
   * entry per grade. A blank box is a no-op with a message under the field rather than
   * a silent failure.
   */
  function addCustomDesignation() {
    const typed = cleanDesignation(customDesignation);
    if (!typed) {
      setFieldErrors((prev) => ({ ...prev, customDesignation: 'Type the new designation to add it.' }));
      return;
    }

    // The store is only written when the value is genuinely new. `null` means the list
    // already carries it, so nothing is persisted — just selected.
    const nextStored = addDesignationOption(storedDesignationOptions, typed, designationOptions);
    if (nextStored) setRaw(DESIGNATION_OPTIONS_KEY, nextStored);

    // Select the list's own spelling when it already exists, otherwise the typed value.
    setDesignation(matchingDesignation(designationOptions, typed));
    setCustomDesignation('');
    // The choice is made, so the menu closes — the field now shows the new grade.
    setDesignationOpen(false);
    setFieldErrors((prev) => ({ ...prev, designation: '', customDesignation: '' }));
    setNotice(
      nextStored
        ? `\u201c${typed}\u201d added to the designation list and selected.`
        : `\u201c${matchingDesignation(designationOptions, typed)}\u201d is already on the list and has been selected.`,
    );
  }

  /** Picks a grade from the menu and closes it. */
  function chooseDesignation(value) {
    setDesignation(value);
    // Leaving the custom route drops whatever was typed, so a value half-typed then
    // abandoned cannot be saved onto a record.
    if (value !== CUSTOM_DESIGNATION) setCustomDesignation('');
    setDesignationOpen(false);
    setFieldErrors((prev) => ({ ...prev, designation: '', customDesignation: '' }));
  }

  // A click anywhere outside the Designation control closes its menu, which is what a
  // native <select> does for free and a custom menu has to do itself.
  useEffect(() => {
    if (!designationOpen) return undefined;
    function onPointerDown(event) {
      if (designationRef.current && !designationRef.current.contains(event.target)) {
        setDesignationOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [designationOpen]);

  function submit(e) {
    e.preventDefault();
    setNotice('');
    setSyncWarning('');

    // Field-by-field validation, so each message appears under its own box. The
    // unique-name rule lives in `validateEmployee` beside the directory helpers, so
    // the form and its tests share one definition of what is wrong.
    const errors = validateEmployee(
      { name, designation, customDesignation },
      employees,
      { designationOptions },
    );
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const clean = name.trim().replace(/\s+/g, ' ');
    // The custom route resolves to the typed value; every other route is the
    // chosen grade. `resolveDesignation` owns that branch so the form and its tests
    // cannot disagree about what the sentinel means.
    const chosen = resolveDesignation({ designation, customDesignation });

    let record;
    try {
      record = buildEmployeeRecord(clean, employees, undefined, sequenceValue, chosen);
    } catch (err) {
      setFieldErrors({ name: err.message });
      return;
    }

    saveDirectory([...directory, record]);
    // Move the mark forward so this ID can never be issued again, even if the
    // record is deleted later.
    setRaw(EMPLOYEE_SEQ_KEY, [bumpSequence(sequenceValue, record.employeeId)]);
    setName('');
    setDesignation('');
    setCustomDesignation('');
    setFieldErrors({});
    // `record.employeeId`'s numeric tail is the Smart Attendance workerId, which
    // is what makes the new person immediately clockable there.
    setNotice(
      `Added ${record.name} as ${record.employeeId}`
      + `${record.designation ? ` (${record.designation})` : ''}, linked to Smart Attendance as worker `
      + `${Number(record.employeeId.replace(/\\D/g, '')) || ''}. They are now selectable on every form.`,
    );
  }

  function startEdit(employee) {
    setEditingId(employee.id);
    setEditName(employee.name);
    setEditDesignation(employee.designation || '');
    setNotice('');
    setFieldErrors({});
  }

  /**
   * Saves a row's name AND designation together.
   *
   * Both are written in one pass because the editor holds both: saving the name
   * alone would silently discard a grade the user had just changed in the same row.
   */
  function commitEdit(employee) {
    const clean = editName.trim().replace(/\s+/g, ' ');
    if (!clean) {
      setFieldErrors({ editName: 'A name cannot be empty.' });
      return;
    }

    // The same uniqueness rule applies to a rename. Its own row is excluded, so
    // saving a record without touching its name is not read as a clash with
    // itself.
    const clash = findByName(employees.filter((e) => e.id !== employee.id), clean);
    if (clash) {
      setFieldErrors({
        editName: `“${clash.name}” is already in the directory as ${clash.employeeId}. Choose a different name.`,
      });
      return;
    }
    setFieldErrors({});

    // The record is replaced in place, so the Employee ID it already holds is
    // preserved — renaming must never reissue an ID that attendance rows,
    // payroll and printed rosters already refer to.
    const next = directory.map((r) => (
      r.id === employee.id ? { ...r, name: clean, designation: normalizeDesignation(editDesignation) } : r
    ));
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
    setEditDesignation('');
    setNotice(`${employee.employeeId} renamed to ${clean}. The change is reflected in Smart Attendance and every dropdown.`);
  }

  /** Opens the confirmation dialog. Nothing changes until it is confirmed. */
  function requestRemove(employee) {
    setPendingDelete(employee);
    setPurge(false);
    setFieldErrors({});
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
      {/* The form-level error banner that used to sit here is gone: every failure
          on this form belongs to a FIELD, so the message is rendered under that
          field instead. A banner made the reader work out which box it meant. */}

      {isAdmin ? (
        <form className="dp-entry-card" onSubmit={submit} noValidate>
          <h3 className="dp-recent-title">Add employee</h3>
          <div className="ld-add-grid">
            <label className={`form-field ld-add-name${fieldErrors.name ? ' field-invalid' : ''}`}>
              <span>Full Name <em className="req-star">*</em></span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  // The box just changed — drop its message so the form stops
                  // accusing a field the user is already fixing.
                  setFieldErrors((prev) => (prev.name ? { ...prev, name: '' } : prev));
                }}
                placeholder="e.g. Salma Khatun"
                autoComplete="off"
                aria-label="Employee full name"
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? 'ld-name-error' : undefined}
              />
              {fieldErrors.name && (
                <span className="field-error-tip" id="ld-name-error" role="alert">{fieldErrors.name}</span>
              )}
            </label>

            <div className={`form-field ld-add-designation${fieldErrors.designation ? ' field-invalid' : ''}`}>
              <span id="ld-designation-label">Designation <em className="req-star">*</em></span>
              {/* A CUSTOM menu rather than a native <select>, because the "+ Add" row has
                  to live INSIDE the open menu. A <select> can only hold <option>s, so the
                  box and its button had to sit outside it — here the whole choice (pick an
                  existing grade, or name a new one) happens in one panel. */}
              <div className="ld-select" ref={designationRef}>
                <button
                  type="button"
                  className={`ld-select-control${designationOpen ? ' ld-select-open' : ''}${fieldErrors.designation ? ' field-invalid' : ''}`}
                  onClick={() => setDesignationOpen((open) => !open)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setDesignationOpen(false); }}
                  aria-haspopup="listbox"
                  aria-expanded={designationOpen}
                  aria-labelledby="ld-designation-label"
                  aria-label="Employee designation"
                  aria-invalid={Boolean(fieldErrors.designation)}
                  aria-describedby={fieldErrors.designation ? 'ld-designation-error' : undefined}
                >
                  <span className={designation ? '' : 'ld-select-placeholder'}>
                    {designation === CUSTOM_DESIGNATION
                      ? CUSTOM_DESIGNATION_LABEL
                      : (designation || 'Select designation')}
                  </span>
                  <span className="ld-select-caret" aria-hidden="true">▾</span>
                </button>

                {designationOpen && (
                  <div className="ld-select-menu" role="listbox" aria-label="Designation options">
                    <ul className="ld-select-list">
                      {designationOptions.map((d) => (
                        <li key={d}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={designation === d}
                            className={`ld-select-option${designation === d ? ' ld-select-option-on' : ''}`}
                            onClick={() => chooseDesignation(d)}
                          >
                            {d}
                          </button>
                        </li>
                      ))}
                    </ul>

                    {/* THE "+ ADD" ROW — pinned to the foot of the open menu, so a grade
                        the list does not carry is created without leaving the dropdown.
                        Enter in the box does the same as clicking the button. */}
                    <div className="ld-select-add">
                      <input
                        className={`ld-select-add-input${fieldErrors.customDesignation ? ' field-invalid' : ''}`}
                        value={customDesignation}
                        onChange={(e) => {
                          setCustomDesignation(e.target.value);
                          setFieldErrors((prev) => (prev.customDesignation ? { ...prev, customDesignation: '' } : prev));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); addCustomDesignation(); }
                        }}
                        placeholder="Add new designation"
                        aria-label="New designation to add"
                        aria-invalid={Boolean(fieldErrors.customDesignation)}
                        aria-describedby={fieldErrors.customDesignation ? 'ld-custom-designation-error' : undefined}
                      />
                      <button
                        type="button"
                        className="ld-select-add-btn"
                        onClick={addCustomDesignation}
                      >
                        + Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {fieldErrors.designation && (
                <span className="field-error-tip" id="ld-designation-error" role="alert">{fieldErrors.designation}</span>
              )}
              {fieldErrors.customDesignation && (
                <span className="field-error-tip" id="ld-custom-designation-error" role="alert">
                  {fieldErrors.customDesignation}
                </span>
              )}
            </div>

            <label className="form-field ld-add-id">
              <span>Employee ID <em className="auto-note">(auto)</em></span>
              {/* Auto-issued and never typed: the ID is what attendance, payroll
                  and printed rosters already reference, so it must not be edited
                  into a collision. `readOnly` AND `disabled` — the first keeps a
                  screen reader from offering it as a field, the second makes the
                  lock visible. */}
              <input value={pendingId} disabled readOnly aria-label="Employee ID, generated automatically" />
            </label>

            <button type="submit" className="btn btn-primary ld-add-submit">Submit</button>
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            The Employee ID is generated automatically and never reused, so it stays valid on attendance,
            payroll and printed rosters. The designation is what the Supervisor Name dropdown on
            Total Line Output selects from.
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

      {/* A bounded, scrollable box with a FROZEN header row: a long roster scrolls
          under the column titles instead of taking them out of sight. `ld-table-wrap`
          supplies the max-height and the sticky anchoring; the `sticky top-0 z-10
          bg-surface` on the header row is what pins it. */}
      <div className="table-wrap ld-table-wrap" style={{ marginTop: 10 }}>
        <table className="dp-table ld-table">
          <thead>
            <tr className="ld-thead-row sticky top-0 z-10 bg-surface">
              <th style={{ width: 140 }}>Employee ID</th>
              <th>Full Name</th>
              <th style={{ width: 140 }}>Designation</th>
              <th style={{ width: 110 }}>Status</th>
              {isAdmin && <th style={{ width: 190 }}>Action</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className="empty-row">
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
                      <>
                        <input
                          className="dp-remark-input"
                          value={editName}
                          onChange={(e) => {
                            setEditName(e.target.value);
                            setFieldErrors((prev) => (prev.editName ? { ...prev, editName: '' } : prev));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitEdit(employee); }
                            if (e.key === 'Escape') { setEditingId(null); setEditName(''); setEditDesignation(''); setFieldErrors({}); }
                          }}
                          autoFocus
                          aria-label={`Rename ${employee.name}`}
                          aria-invalid={Boolean(fieldErrors.editName)}
                        />
                        {/* The rename's own validation, under the box it is about. */}
                        {fieldErrors.editName && (
                          <span className="field-error-tip" role="alert">{fieldErrors.editName}</span>
                        )}
                      </>
                    ) : employee.name}
                  </td>
                  {/* The Designation cell is EDITABLE in place: a grade is corrected
                      where it is read, without opening the name editor. The list is
                      the presets plus any custom value already in use, so a post
                      recorded once is selectable for the next person in it. */}
                  <td>
                    {isEditing ? (
                      <select
                        className="dp-remark-input"
                        value={editDesignation}
                        onChange={(e) => setEditDesignation(e.target.value)}
                        aria-label={`Designation for ${employee.name}`}
                      >
                        {designationOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    ) : (
                      <span className="erp-badge erp-badge-neutral">{employee.designation}</span>
                    )}
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
                          <button className="btn btn-outline btn-sm" onClick={() => { setEditingId(null); setEditName(''); setEditDesignation(''); setFieldErrors({}); }}>Cancel</button>
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

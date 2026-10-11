import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import {
  DEPARTMENTS,
  approveEmployeeRequest,
  createEmployeeDirectly,
  deleteEmployee,
  formatEmployeeId,
  rejectEmployeeRequest,
  setEmployeeActive,
  subscribeToEmployees,
  subscribeToPendingEmployees,
  syncEmployeeIdentity,
  updateEmployee,
} from '../utils/employees';
import { ROLE_OPTIONS, roleLabel, writeAccountRole } from '../utils/userRoles';

const EMPTY_FORM = {
  fullName: '',
  email: '',
  username: '',
  department: '',
  designation: '',
  joiningDate: '',
  role: 'employee',
};

export default function EmployeeManagement() {
  const { isAdmin } = useRole();
  // currentUser.id is stamped onto a new request as `requestedBy`, because the
  // employeeRequests rule enforces ownership against the caller's uid.
  const { user: currentUser } = useAuth() || {};
  const [tab, setTab] = useState('list');
  const [employees, setEmployees] = useState([]);
  const [pending, setPending] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  // The full row being edited, so the Role write can find the linked account (uid/e-mail)
  // — an employeeId alone does not identify a login.
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // A pending destructive action — { employee, kind } where kind is 'delete' | 'inactive'.
  // The action only touches Firestore once the modal's Yes button is pressed.
  const [pendingAction, setPendingAction] = useState(null);

  useEffect(() => {
    const handleError = (loadError) => {
      const message = String(loadError?.message || '');
      // A bare permission-denied usually means the Firestore rules do not yet cover the
      // `employees` collection, so the read falls through to the catch-all deny.
      setError(message.includes('permission')
        ? 'Missing or insufficient permissions. Deploy the updated firestore.rules (firebase deploy --only firestore:rules), then reload.'
        : (loadError?.message || 'Unable to load employees.'));
    };
    const unsubscribeEmployees = subscribeToEmployees(setEmployees, handleError);
    const unsubscribePending = subscribeToPendingEmployees(setPending, handleError);
    return () => { unsubscribeEmployees(); unsubscribePending(); };
  }, []);

  // Keep the roster row for the signed-in account in step with its profile. When someone
  // updates their e-mail / username after logging in, this copies it onto their employee
  // record, so the Email / Username column refreshes on its own.
  useEffect(() => {
    if (!currentUser || employees.length === 0) return;
    syncEmployeeIdentity(
      { uid: currentUser.id, email: currentUser.email, username: currentUser.username },
      employees,
    ).catch(() => {
      // A sync the rules refuse is not worth an error banner: the roster row simply keeps
      // whatever identity it already had. The admin can still set it from the form.
    });
    // Only the identity fields and the loaded list matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.email, currentUser?.username, employees.length]);

  const activeCount = employees.filter((employee) => employee.active).length;
  const nextIdHint = `Next ID: ${formatEmployeeId(
    employees.reduce((max, employee) => Math.max(max, Number(String(employee.employeeId).replace(/\D/g, '')) || 0), 0) + 1,
  )}`;

  const visibleEmployees = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return employees.filter((employee) => {
      if (!showInactive && !employee.active) return false;
      if (!term) return true;
      return String(employee.employeeId).toLowerCase().includes(term)
        || employee.name.toLowerCase().includes(term)
        || employee.department.toLowerCase().includes(term)
        || String(employee.designation).toLowerCase().includes(term)
        || String(employee.role || '').toLowerCase().includes(term);
    });
  }, [employees, search, showInactive]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setEditing(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!form.fullName.trim()) {
      setError('Full Name is required.');
      return;
    }
    if (!form.department) {
      setError('Please select a Department.');
      return;
    }
    if (!editingId && !form.joiningDate) {
      setError('Joining Date is required for a new employee.');
      return;
    }
    setBusyId(editingId || 'new');
    try {
      if (editingId) {
        // Step 1: the roster fields. This is the write that used to fail with
        // "Missing or insufficient permissions" — the rules now allow it for an
        // approved manager/admin, and it merges so a legacy workers-only record is
        // created in `employees` on first edit instead of erroring on a missing doc.
        await updateEmployee(editingId, {
          name: form.fullName.trim(),
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          username: form.username.trim(),
          department: form.department,
          designation: form.designation.trim() || '-',
          joiningDate: form.joiningDate,
          role: form.role,
        });

        // Step 2: apply the chosen Role to the linked account. Skip it when the
        // employee has no account, so saving details never fails over a missing login.
        let roleNotice = '';
        try {
          await writeAccountRole(
            {
              uid: editing.uid || '',
              email: form.email.trim() || editing.email || '',
              username: form.username.trim() || editing.username || '',
            },
            form.role,
          );
          roleNotice = ` Role set to ${roleLabel(form.role)}.`;
        } catch (roleError) {
          roleNotice = ` (Role not applied: ${roleError.message})`;
        }
        setMessage(`Employee ${editingId} updated.${roleNotice}`);
      } else {
        // Direct save: the employee is written straight to `employees` + `workers` and
        // appears in the list immediately. There is no approval queue step, so an ID is
        // issued on the spot and nothing waits on a manager.
        const employeeId = await createEmployeeDirectly({
          fullName: form.fullName.trim(),
          name: form.fullName.trim(),
          email: form.email.trim(),
          username: form.username.trim(),
          department: form.department,
          designation: form.designation.trim() || '-',
          joiningDate: form.joiningDate,
          role: form.role,
        }, employees);

        // Apply the chosen Role to the linked account, when one exists. A brand-new
        // employee usually has no account yet, so this is best-effort and never blocks
        // the save.
        let roleNotice = '';
        try {
          await writeAccountRole(
            { email: form.email.trim(), username: form.username.trim() },
            form.role,
          );
          roleNotice = ` Role set to ${roleLabel(form.role)}.`;
        } catch (roleError) {
          roleNotice = ` (Role not applied: ${roleError.message})`;
        }
        setMessage(`Employee ${form.fullName.trim()} saved with ID ${employeeId}.${roleNotice}`);
      }
      resetForm();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusyId('');
    }
  }

  function startEdit(employee) {
    setEditingId(employee.employeeId);
    // Keep the whole row: the Role write needs the linked uid / e-mail, which the
    // employeeId does not carry.
    setEditing(employee);
    // The form lives on the Add tab, so open it there.
    setTab('add');
    setForm({
      fullName: employee.name,
      email: employee.email || '',
      username: employee.username || '',
      department: employee.department,
      designation: employee.designation === '-' ? '' : employee.designation,
      joiningDate: employee.joiningDate,
      role: employee.role || 'employee',
    });
    setMessage('');
    setError('');
  }

  async function handleApprove(request) {
    setBusyId(request.id);
    setError('');
    setMessage('');
    try {
      const employeeId = await approveEmployeeRequest(request, employees);
      // The request carries the role the filer chose, so approving applies it to the
      // linked account instead of leaving the admin to set it by hand.
      let roleNotice = '';
      try {
        await writeAccountRole({ uid: request.uid || '', email: request.email || '' }, request.role);
        roleNotice = ` Role set to ${roleLabel(request.role)}.`;
      } catch (roleError) {
        roleNotice = ` (Role not applied: ${roleError.message})`;
      }
      setMessage(`${request.name} approved with Employee ID ${employeeId}.${roleNotice}`);
    } catch (approveError) {
      setError(approveError.message);
    } finally {
      setBusyId('');
    }
  }

  async function handleReject(request) {
    if (!window.confirm(`Reject the registration request for ${request.name}?`)) return;
    setBusyId(request.id);
    setError('');
    setMessage('');
    try {
      await rejectEmployeeRequest(request);
      setMessage(`${request.name}'s request was rejected.`);
    } catch (rejectError) {
      setError(rejectError.message);
    } finally {
      setBusyId('');
    }
  }

  // Asking to toggle opens the modal; the Firestore write happens in runToggle once the
  // user confirms. Reactivating is non-destructive and needs no prompt.
  function requestToggleActive(employee) {
    if (!employee.active) {
      runToggleActive(employee);
      return;
    }
    setPendingAction({ kind: 'inactive', employee });
  }

  async function runToggleActive(employee) {
    const nextActive = !employee.active;
    setBusyId(employee.employeeId);
    setError('');
    setMessage('');
    try {
      await setEmployeeActive(employee.employeeId, nextActive);
      setMessage(`${employee.name} ${nextActive ? 'reactivated' : 'marked inactive'}.`);
    } catch (toggleError) {
      setError(toggleError.message);
    } finally {
      setBusyId('');
    }
  }

  // Delete is destructive, so it only ever runs after the modal's Yes button.
  async function runDelete(employee) {
    setBusyId(employee.employeeId);
    setError('');
    setMessage('');
    try {
      await deleteEmployee(employee.employeeId);
      setMessage(`${employee.name} deleted.`);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusyId('');
    }
  }

  function handleConfirmYes() {
    const pending = pendingAction;
    setPendingAction(null);
    if (!pending) return;
    if (pending.kind === 'delete') runDelete(pending.employee);
    else runToggleActive(pending.employee);
  }

  if (!isAdmin) {
    return <div className="module"><div className="module-header"><h2>👥 Employee Management</h2></div><div className="restricted-card"><h3 className="section-sub" style={{ marginTop: 0 }}>Admin access required</h3><p className="hint">Only approved admins can add, approve or deactivate employees.</p></div></div>;
  }

  return (
    <div className="module employee-management">
      <div className="module-header">
        <h2>👥 Employee Management</h2>
        <p className="hint">{activeCount} active · {employees.length - activeCount} inactive · {nextIdHint}</p>
      </div>

      <div className="attendance-tabs" role="tablist">
        <button className={`attendance-tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>📂 Employee List</button>
        <button className={`attendance-tab ${tab === 'add' ? 'active' : ''}`} onClick={() => setTab('add')}>{editingId ? '✏️ Edit Employee' : '➕ Add New Employee'}</button>
        <button className={`attendance-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
          ⏳ Pending Approval{pending.length > 0 ? ` (${pending.length})` : ''}
        </button>
      </div>

      {message && <p className="settings-success">{message}</p>}
      {error && <p className="auth-error">{error}</p>}

      {tab === 'add' && (
        <form className="attendance-entry-form" onSubmit={handleSubmit}>
          <label className="form-field"><span>Full Name <span className="req-star">*</span></span><input type="text" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>
          <label className="form-field"><span>Email</span><input type="email" value={form.email} placeholder="name@example.com" onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label className="form-field"><span>Username</span><input type="text" value={form.username} placeholder="Login / User ID" onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
          <label className="form-field"><span>Department <span className="req-star">*</span></span><select value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} required><option value="">Select department</option>{DEPARTMENTS.map((department) => <option key={department}>{department}</option>)}</select></label>
          <label className="form-field"><span>Designation</span><input type="text" value={form.designation} placeholder="e.g. Operator" onChange={(event) => setForm({ ...form, designation: event.target.value })} /></label>
          <label className="form-field"><span>Joining Date <span className="req-star">*</span></span><input type="date" value={form.joiningDate} onChange={(event) => setForm({ ...form, joiningDate: event.target.value })} required /></label>
          <label className="form-field"><span>Role <span className="req-star">*</span></span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <div className="attendance-entry-actions">
            <span className="hint">{editingId ? `Editing ${editingId}` : nextIdHint}</span>
            <button className="btn btn-primary" type="submit" disabled={busyId === editingId || busyId === 'new'}>{editingId ? 'Save Changes' : 'Save Employee'}</button>
            {editingId && <button className="btn btn-outline" type="button" onClick={resetForm}>Cancel</button>}
          </div>
        </form>
      )}

      {tab === 'pending' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Requested Name</th><th>Department</th><th>Designation</th><th>Joining Date</th><th>Requested By</th><th>Action</th></tr></thead>
            <tbody>
              {pending.map((request) => (
                <tr key={request.id}>
                  <td>{request.name}</td>
                  <td>{request.department}</td>
                  <td>{request.designation}</td>
                  <td>{request.joiningDate || '-'}</td>
                  <td>{request.requestedBy || 'admin'}</td>
                  <td className="attendance-actions">
                    <button className="btn btn-primary attendance-view-btn" disabled={busyId === request.id} onClick={() => handleApprove(request)}>{busyId === request.id ? 'Working...' : 'Approve'}</button>
                    <button className="btn btn-outline attendance-view-btn" disabled={busyId === request.id} onClick={() => handleReject(request)}>Reject</button>
                  </td>
                </tr>
              ))}
              {pending.length === 0 && <tr><td colSpan="6" className="empty-row">No pending requests.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'list' && (
        <>
          <div className="attendance-toolbar">
            <label className="form-field att-search-field"><span>🔎 Search</span><input type="search" value={search} placeholder="Name, ID, Department, Email" onChange={(event) => setSearch(event.target.value)} /></label>
            <label className="form-field checkbox-field"><span>Show inactive</span><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /></label>
            {/* Start a clean, empty form so a new employee can be added straight from the
                list, without first switching tabs. resetForm() clears whatever employee
                may still be loaded for editing. */}
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => { resetForm(); setTab('add'); }}
            >
              ➕ Add New Employee
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Employee ID</th><th>Full Name</th><th>Email / Username</th><th>Department</th><th>Designation</th><th>Joining Date</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {visibleEmployees.map((employee, index) => (
                  <tr key={employee.employeeId}>
                    <td className="att-serial">{index + 1}</td>
                    <td><span className="att-id">{employee.employeeId}</span></td>
                    <td>{employee.name}</td>
                    <td>
                      {employee.email || employee.username
                        ? (<><div>{employee.email || '-'}</div><div className="hint" style={{ marginTop: 0 }}>{employee.username || '-'}</div></>)
                        : (<span className="hint" style={{ marginTop: 0 }}>—</span>)}
                    </td>
                    <td>{employee.department}</td>
                    <td>{employee.designation}</td>
                    <td>{employee.joiningDate || '-'}</td>
                    <td>{roleLabel(employee.role)}</td>
                    {/* Three states, not two. An ARCHIVED record was removed from
                        every active list by the Employee Directory (the
                        "permanently remove from the entire site" option), and is
                        kept here for payroll history and audit. Showing it as
                        merely "Inactive" would hide that distinction from the one
                        screen where it matters. */}
                    <td>
                      {employee.archived === true || String(employee.status || '').toLowerCase() === 'archived' ? (
                        <span className="badge badge-red" title="Removed from all active lists; kept for history">Archived</span>
                      ) : (
                        <span className={`badge ${employee.active ? 'badge-green' : 'badge-amber'}`}>
                          {employee.active ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </td>
                    <td className="attendance-actions">
                      <button className="btn btn-outline attendance-view-btn" onClick={() => startEdit(employee)}>Edit</button>
                      <button className="btn btn-outline attendance-view-btn" disabled={busyId === employee.employeeId} onClick={() => requestToggleActive(employee)}>{employee.active ? 'Mark Inactive' : 'Mark Active'}</button>
                      <button className="btn attendance-delete-btn attendance-view-btn" disabled={busyId === employee.employeeId} onClick={() => setPendingAction({ kind: 'delete', employee })}>Delete</button>
                    </td>
                  </tr>
                ))}
                {visibleEmployees.length === 0 && <tr><td colSpan="10" className="empty-row">No employees found.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pendingAction && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setPendingAction(null)}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="employee-confirm-title" className="section-sub" style={{ marginTop: 0 }}>
              {pendingAction.kind === 'delete' ? 'Delete employee' : 'Mark employee inactive'}
            </h3>
            <p className="hint">
              {pendingAction.kind === 'delete'
                ? 'Are you sure you want to delete this employee?'
                : 'Are you sure you want to mark this employee as inactive?'}
            </p>
            <p className="hint">
              {pendingAction.employee.name} ({pendingAction.employee.employeeId})
            </p>
            <div className="modal-actions">
              <button className="btn btn-outline" type="button" onClick={() => setPendingAction(null)}>
                No
              </button>
              <button
                className={pendingAction.kind === 'delete' ? 'btn attendance-delete-btn' : 'btn btn-primary'}
                type="button"
                autoFocus
                onClick={handleConfirmYes}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { useRole } from '../context/RoleContext';
import {
  DEPARTMENTS,
  approveEmployeeRequest,
  deleteEmployee,
  rejectEmployeeRequest,
  setEmployeeActive,
  submitEmployeeRequest,
  subscribeToEmployees,
  subscribeToPendingEmployees,
  updateEmployee,
} from '../utils/employees';

const EMPTY_FORM = { fullName: '', department: '', designation: '', joiningDate: '' };

export default function EmployeeManagement() {
  const { isAdmin } = useRole();
  const [tab, setTab] = useState('list');
  const [employees, setEmployees] = useState([]);
  const [pending, setPending] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const handleError = (loadError) => setError(loadError.message || 'Unable to load employees.');
    const unsubscribeEmployees = subscribeToEmployees(setEmployees, handleError);
    const unsubscribePending = subscribeToPendingEmployees(setPending, handleError);
    return () => { unsubscribeEmployees(); unsubscribePending(); };
  }, []);

  const activeCount = employees.filter((employee) => employee.active).length;
  const nextIdHint = employees.length
    ? `Next ID: EMP-${employees.reduce((max, employee) => Math.max(max, Number(String(employee.employeeId).replace(/\D/g, '')) || 0), 100) + 1}`
    : 'Next ID: EMP-101';

  const visibleEmployees = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return employees.filter((employee) => {
      if (!showInactive && !employee.active) return false;
      if (!term) return true;
      return String(employee.employeeId).toLowerCase().includes(term)
        || employee.name.toLowerCase().includes(term)
        || employee.department.toLowerCase().includes(term)
        || String(employee.designation).toLowerCase().includes(term);
    });
  }, [employees, search, showInactive]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
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
    try {
      if (editingId) {
        await updateEmployee(editingId, {
          name: form.fullName.trim(),
          fullName: form.fullName.trim(),
          department: form.department,
          designation: form.designation.trim() || '-',
          joiningDate: form.joiningDate,
        });
        setMessage(`Employee ${editingId} updated.`);
      } else {
        // New entries go through the approval queue so an ID is only issued on approval.
        await submitEmployeeRequest({ ...form, requestedBy: 'admin' });
        setMessage(`Request submitted for ${form.fullName.trim()} — waiting for approval.`);
      }
      resetForm();
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  function startEdit(employee) {
    setEditingId(employee.employeeId);
    setTab('list');
    setForm({
      fullName: employee.name,
      department: employee.department,
      designation: employee.designation === '-' ? '' : employee.designation,
      joiningDate: employee.joiningDate,
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
      setMessage(`${request.name} approved with Employee ID ${employeeId}.`);
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

  async function handleToggleActive(employee) {
    const nextActive = !employee.active;
    if (!nextActive && !window.confirm(`Deactivate ${employee.name}? They will disappear from the attendance dropdown but keep their past records.`)) return;
    setBusyId(employee.employeeId);
    setError('');
    setMessage('');
    try {
      await setEmployeeActive(employee.employeeId, nextActive);
      setMessage(`${employee.name} ${nextActive ? 'reactivated' : 'deactivated'}.`);
    } catch (toggleError) {
      setError(toggleError.message);
    } finally {
      setBusyId('');
    }
  }

  async function handleDelete(employee) {
    if (!window.confirm(`Permanently delete ${employee.name} (${employee.employeeId})? Their historical attendance records stay in the database.`)) return;
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
        <button className={`attendance-tab ${tab === 'add' ? 'active' : ''}`} onClick={() => setTab('add')}>➕ Add New Employee</button>
        <button className={`attendance-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
          ⏳ Pending Approval{pending.length > 0 ? ` (${pending.length})` : ''}
        </button>
      </div>

      {message && <p className="settings-success">{message}</p>}
      {error && <p className="auth-error">{error}</p>}

      {tab === 'add' && (
        <form className="attendance-entry-form" onSubmit={handleSubmit}>
          <label className="form-field"><span>Full Name</span><input type="text" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>
          <label className="form-field"><span>Department</span><select value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} required><option value="">Select department</option>{DEPARTMENTS.map((department) => <option key={department}>{department}</option>)}</select></label>
          <label className="form-field"><span>Designation</span><input type="text" value={form.designation} placeholder="e.g. Operator" onChange={(event) => setForm({ ...form, designation: event.target.value })} /></label>
          <label className="form-field"><span>Joining Date</span><input type="date" value={form.joiningDate} onChange={(event) => setForm({ ...form, joiningDate: event.target.value })} required /></label>
          <div className="attendance-entry-actions">
            <span className="hint">{editingId ? `Editing ${editingId}` : nextIdHint}</span>
            <button className="btn btn-primary" type="submit">{editingId ? 'Save Changes' : 'Submit for Approval'}</button>
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
            <label className="form-field att-search-field"><span>🔎 Search</span><input type="search" value={search} placeholder="Name, ID, Department" onChange={(event) => setSearch(event.target.value)} /></label>
            <label className="form-field checkbox-field"><span>Show inactive</span><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /></label>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee ID</th><th>Full Name</th><th>Department</th><th>Designation</th><th>Joining Date</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {visibleEmployees.map((employee) => (
                  <tr key={employee.employeeId}>
                    <td><span className="att-id">{employee.employeeId}</span></td>
                    <td>{employee.name}</td>
                    <td>{employee.department}</td>
                    <td>{employee.designation}</td>
                    <td>{employee.joiningDate || '-'}</td>
                    <td><span className={`badge ${employee.active ? 'badge-green' : 'badge-amber'}`}>{employee.active ? 'Active' : 'Inactive'}</span></td>
                    <td className="attendance-actions">
                      <button className="btn btn-outline attendance-view-btn" onClick={() => startEdit(employee)}>Edit</button>
                      <button className="btn btn-outline attendance-view-btn" disabled={busyId === employee.employeeId} onClick={() => handleToggleActive(employee)}>{employee.active ? 'Deactivate' : 'Reactivate'}</button>
                      <button className="btn attendance-delete-btn attendance-view-btn" disabled={busyId === employee.employeeId} onClick={() => handleDelete(employee)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {visibleEmployees.length === 0 && <tr><td colSpan="7" className="empty-row">No employees found.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

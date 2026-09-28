import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useRole } from '../context/RoleContext';
import { subscribeToAttendance, subscribeToWorkers } from '../utils/attendance';
import { formatPayrollCurrency, workingDaysInMonth } from '../utils/payroll';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function Payroll() {
  const { isAdmin } = useRole();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [settings, setSettings] = useState({ standardShiftHours: 8, lateThreshold: 3, lateDayDeduction: 1, otMultiplier: 2, workingDays: '' });
  const [workers, setWorkers] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [draftBonus, setDraftBonus] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [year, month] = selectedMonth.split('-').map(Number);

  useEffect(() => {
    const onError = (loadError) => {
      setError(loadError.message || 'Unable to load payroll data.');
      setLoading(false);
    };
    const unsubscribeWorkers = subscribeToWorkers((rows) => { setWorkers(rows); setLoading(false); }, onError);
    const unsubscribeAttendance = subscribeToAttendance(setAttendance, onError);
    return () => { unsubscribeWorkers(); unsubscribeAttendance(); };
  }, []);

  const rows = useMemo(() => {
    const monthPrefix = selectedMonth;
    const monthAttendance = attendance.filter((record) => String(record.date || '').startsWith(monthPrefix));
    const totalWorkingDays = Number(settings.workingDays) || workingDaysInMonth(year, month - 1);
    const shiftHours = Number(settings.standardShiftHours) || 8;
    const lateThreshold = Number(settings.lateThreshold) || 3;
    const otMultiplier = Number(settings.otMultiplier) || 2;

    return workers.map((worker) => {
      const workerRows = monthAttendance.filter((record) => String(record.workerId || record.userId) === String(worker.workerId));
      const present = workerRows.filter((record) => ['present', 'late'].includes(String(record.status || '').toLowerCase())).length;
      const absent = workerRows.filter((record) => ['absent', 'unapproved absent'].includes(String(record.status || '').toLowerCase())).length;
      const late = workerRows.filter((record) => String(record.status || '').toLowerCase() === 'late').length;
      const otHours = workerRows.reduce((total, record) => total + Number(record.overtimeHours || record.ot_hours || record.otHours || 0), 0);
      const basicSalary = Number(worker.basicSalary || worker.basic_salary || 0);
      const dailyRate = totalWorkingDays ? basicSalary / totalWorkingDays : 0;
      const otAmount = otHours * ((basicSalary / 104) * otMultiplier);
      const latePenaltyAmount = Math.floor(late / lateThreshold) * dailyRate * (Number(settings.lateDayDeduction) || 1);
      const absentDeduction = dailyRate * absent;
      const totalDeductions = latePenaltyAmount + absentDeduction;
      return {
        ...worker,
        present,
        absent,
        late,
        otHours,
        totalWorkingDays,
        basicSalary,
        otAmount,
        latePenaltyAmount,
        totalDeductions,
        netSalary: basicSalary + otAmount - totalDeductions,
        bonusEligible: worker.honorsEligible === true || worker.bonusEligible === true,
      };
    });
  }, [attendance, selectedMonth, settings, workers, year, month]);

  if (!isAdmin) {
    return <div className="module"><div className="module-header"><h2>🧾 Payroll Worksheet</h2></div><div className="restricted-card"><h3 className="section-sub" style={{ marginTop: 0 }}>Payroll is restricted</h3><p className="hint">Only approved managers can view salary calculations.</p></div></div>;
  }

  function setSetting(event) {
    const { name, value } = event.target;
    setSettings((current) => ({ ...current, [name]: value }));
  }

  async function saveBonusEligibility(workerId) {
    setError('');
    try {
      await updateDoc(doc(db, 'workers', String(workerId)), {
        honorsEligible: draftBonus,
        bonusEligible: draftBonus,
      });
      setEditingId(null);
      setMessage('Honors eligibility saved.');
    } catch (saveError) {
      setError(saveError.message || 'Unable to save honors eligibility.');
    }
  }

  function startBonusEdit(row) {
    setEditingId(row.id);
    setDraftBonus(row.bonusEligible);
    setError('');
    setMessage('');
  }

  function downloadWorksheet() {
    const exportRows = rows.map((row) => ({
      'Worker ID': row.workerId,
      'Worker Name': row.name,
      'Total Working Days': row.totalWorkingDays,
      'Days Present': row.daysPresent,
      'Days Absent': row.daysAbsent,
      'Late Count': row.lateCount,
      'Total OT Hours': row.otHours,
      'Honors Eligible': row.bonusEligible ? 'Yes' : 'No',
      'Basic Salary': Number(row.basicSalary.toFixed(2)),
      'OT Amount': Number(row.otAmount.toFixed(2)),
      'Late Penalty': Number(row.latePenaltyAmount.toFixed(2)),
      'Absent Deduction': Number((row.totalDeductions - row.latePenaltyAmount).toFixed(2)),
      'Total Deductions': Number(row.totalDeductions.toFixed(2)),
      'Net Salary Payable': Number(row.netSalary.toFixed(2)),
      'Status': row.highAbsence ? 'High Absence' : row.fullAttendanceBonusEligible ? 'Full Attendance Bonus Eligible' : 'Regular',
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet['!cols'] = Object.keys(exportRows[0] || {}).map(() => ({ wch: 20 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Payroll');
    XLSX.writeFile(workbook, `payroll-${selectedMonth}.xlsx`);
    setMessage('Salary worksheet downloaded.');
  }

  return (
    <div className="module payroll-page">
      <div className="module-header"><h2>🧾 Payroll Worksheet</h2><p className="hint">Monthly salary calculated from attendance, late entries, absence, and overtime.</p></div>
      <div className="payroll-controls">
        <label className="form-field"><span>Month & Year</span><input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></label>
        <label className="form-field"><span>Working Days Override</span><input name="workingDays" type="number" min="1" placeholder={String(workingDaysInMonth(year, month - 1))} value={settings.workingDays} onChange={setSetting} /></label>
        <label className="form-field"><span>Shift Hours</span><input name="standardShiftHours" type="number" min="1" value={settings.standardShiftHours} onChange={setSetting} /></label>
        <label className="form-field"><span>Late Entries / Day Deduction</span><input name="lateThreshold" type="number" min="1" value={settings.lateThreshold} onChange={setSetting} /></label>
        <label className="form-field"><span>OT Multiplier</span><input name="otMultiplier" type="number" min="0" step="0.1" value={settings.otMultiplier} onChange={setSetting} /></label>
      </div>
      {loading && <p className="hint">Loading workers and Smart Attendance data...</p>}
      {error && <p className="auth-error">{error}</p>}
      {message && <p className="settings-success">{message}</p>}
      <div className="module-actions"><button className="btn btn-primary" onClick={downloadWorksheet}>⬇ Download Salary Worksheet (.xlsx)</button></div>
      <div className="table-wrap payroll-table-wrap">
        <table>
          <thead><tr><th>Worker ID</th><th>Employee Name</th><th>Working Days</th><th>Present</th><th>Absent</th><th>Late</th><th>OT Hours</th><th>Honors / Bonus Eligible</th><th>Basic</th><th>OT Amount</th><th>Late Penalty</th><th>Net Payable</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.id || row.workerId}>
              <td>{row.workerId}</td><td>{row.name}</td><td>{row.totalWorkingDays}</td><td>{row.present}</td><td>{row.absent}</td><td>{row.late}</td><td>{row.otHours.toFixed(2)}</td>
              <td>{editingId === row.id ? <><label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={draftBonus} onChange={(event) => setDraftBonus(event.target.checked)} /> Eligible</label><button className="btn btn-primary" style={{ marginLeft: 8 }} onClick={() => saveBonusEligibility(row.id || row.workerId)}>Save</button></> : <><span className={`badge ${row.bonusEligible ? 'badge-green' : 'badge-amber'}`}>{row.bonusEligible ? 'Eligible' : 'Not Eligible'}</span><button className="btn-icon" style={{ marginLeft: 8 }} onClick={() => startBonusEdit(row)}>✏️ Edit</button></>}</td>
              <td>{formatPayrollCurrency(row.basicSalary)}</td><td>{formatPayrollCurrency(row.otAmount)}</td><td>{formatPayrollCurrency(row.latePenaltyAmount)}</td><td>{formatPayrollCurrency(row.netSalary)}</td>
            </tr>)}
            {!loading && rows.length === 0 && <tr><td colSpan="12" className="empty-row">No workers found in Firestore.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { calculatePayroll, formatPayrollCurrency, workingDaysInMonth } from '../utils/payroll';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function Payroll() {
  const { getData } = useData();
  const { isAdmin } = useRole();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [settings, setSettings] = useState({ standardShiftHours: 8, lateThreshold: 3, lateDayDeduction: 1, otMultiplier: 2, workingDays: '' });
  const [message, setMessage] = useState('');
  const [year, month] = selectedMonth.split('-').map(Number);

  const rows = useMemo(() => calculatePayroll({
    employees: getData('employees'),
    salaryRows: getData('salary'),
    attendanceRows: getData('daily-attendance'),
    lateRows: getData('late'),
    overtimeRows: [...getData('overtime'), ...getData('overtime-hours')],
    year,
    month: month - 1,
    settings,
  }), [selectedMonth, settings, getData]);

  if (!isAdmin) {
    return <div className="module"><div className="module-header"><h2>🧾 Payroll Worksheet</h2></div><div className="restricted-card"><h3 className="section-sub" style={{ marginTop: 0 }}>Payroll is restricted</h3><p className="hint">Only approved managers can view salary calculations.</p></div></div>;
  }

  function setSetting(event) {
    const { name, value } = event.target;
    setSettings((current) => ({ ...current, [name]: value }));
  }

  function downloadWorksheet() {
    const exportRows = rows.map((row) => ({
      'Worker ID': row.workerId,
      'Worker Name': row.name,
      'Total Working Days': row.totalWorkingDays,
      'Days Present': row.daysPresent,
      'Days Absent': row.daysAbsent,
      'Late Count': row.lateCount,
      'Total OT Hours': row.totalOtHours,
      'Basic Salary': Number(row.basicSalary.toFixed(2)),
      'OT Amount': Number(row.otAmount.toFixed(2)),
      'Late Penalty': Number(row.latePenaltyAmount.toFixed(2)),
      'Absent Deduction': Number(row.absentDeduction.toFixed(2)),
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
      <div className="module-actions"><button className="btn btn-primary" onClick={downloadWorksheet}>⬇ Download Salary Worksheet (.xlsx)</button>{message && <span className="settings-success">{message}</span>}</div>
      <div className="table-wrap payroll-table-wrap">
        <table>
          <thead><tr><th>Worker ID</th><th>Name</th><th>Working Days</th><th>Present</th><th>Absent</th><th>Late</th><th>OT Hours</th><th>Basic</th><th>OT Amount</th><th>Late Penalty</th><th>Net Payable</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={`${row.workerId}-${row.name}`}><td>{row.workerId}</td><td>{row.name}</td><td>{row.totalWorkingDays}</td><td>{row.daysPresent}</td><td>{row.daysAbsent}</td><td>{row.lateCount}</td><td>{row.totalOtHours}</td><td>{formatPayrollCurrency(row.basicSalary)}</td><td>{formatPayrollCurrency(row.otAmount)}</td><td>{formatPayrollCurrency(row.latePenaltyAmount)}</td><td>{formatPayrollCurrency(row.netSalary)}</td><td><span className={`badge ${row.highAbsence ? 'badge-red' : row.fullAttendanceBonusEligible ? 'badge-green' : 'badge-amber'}`}>{row.highAbsence ? 'High Absence' : row.fullAttendanceBonusEligible ? 'Bonus Eligible' : 'Regular'}</span></td></tr>)}
            {rows.length === 0 && <tr><td colSpan="12" className="empty-row">No salary employees found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

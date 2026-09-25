const numberValue = (value) => Number(value || 0);

function recordDate(record) {
  return record.date || record.attendance_date || record.work_date || '';
}

function belongsToMonth(record, year, month) {
  const value = recordDate(record);
  if (!value) return true;
  const date = new Date(`${value}T00:00:00`);
  return date.getFullYear() === year && date.getMonth() === month;
}

function employeeName(record) {
  return String(record.employee || record.name || record.worker || '').trim();
}

function attendanceState(record) {
  const status = String(record.status || '').trim().toLowerCase();
  if (status) return status;
  if (!record.in_time) return 'absent';
  const [hours, minutes] = String(record.in_time).split(':').map(Number);
  return hours * 60 + minutes > 480 ? 'late' : 'present';
}

export function workingDaysInMonth(year, month) {
  const days = new Date(year, month + 1, 0).getDate();
  let workingDays = 0;
  for (let day = 1; day <= days; day += 1) {
    const weekday = new Date(year, month, day).getDay();
    if (weekday !== 0 && weekday !== 6) workingDays += 1;
  }
  return workingDays;
}

export function calculatePayroll({ employees, salaryRows, attendanceRows, lateRows, overtimeRows, year, month, settings }) {
  const totalWorkingDays = settings.workingDays || workingDaysInMonth(year, month);
  const standardShiftHours = numberValue(settings.standardShiftHours) || 8;
  const lateThreshold = numberValue(settings.lateThreshold) || 3;
  const lateDayDeduction = numberValue(settings.lateDayDeduction) || 1;
  const otMultiplier = numberValue(settings.otMultiplier) || 2;
  const names = employees.length ? employees : salaryRows.map(employeeName).filter(Boolean);

  return names.map((name, index) => {
    const salary = salaryRows.find((row) => employeeName(row).toLowerCase() === name.toLowerCase()) || {};
    const attendance = attendanceRows.filter((row) => employeeName(row).toLowerCase() === name.toLowerCase() && belongsToMonth(row, year, month));
    const lateEntries = lateRows.filter((row) => employeeName(row).toLowerCase() === name.toLowerCase() && belongsToMonth(row, year, month));
    const overtime = overtimeRows.filter((row) => employeeName(row).toLowerCase() === name.toLowerCase() && belongsToMonth(row, year, month));
    const basicSalary = numberValue(salary.base_salary ?? salary.basic_salary ?? salary.basicSalary);
    const dailyRate = totalWorkingDays ? basicSalary / totalWorkingDays : 0;
    const hourlyRate = standardShiftHours ? dailyRate / standardShiftHours : 0;
    const daysPresent = attendance.filter((row) => ['present', 'late'].includes(attendanceState(row))).length;
    const daysAbsent = attendance.filter((row) => ['absent', 'unapproved absent'].includes(attendanceState(row))).length;
    const attendanceLateCount = attendance.filter((row) => attendanceState(row) === 'late').length;
    const lateCount = lateEntries.length || attendanceLateCount;
    const totalOtHours = overtime.reduce((total, row) => total + numberValue(row.ot_hours ?? row.overtime_hours ?? row.otHours ?? row.hours), 0);
    const otRate = (basicSalary / 104) * otMultiplier;
    const otAmount = totalOtHours * otRate;
    const latePenaltyAmount = Math.floor(lateCount / lateThreshold) * dailyRate * lateDayDeduction;
    const absentDeduction = dailyRate * daysAbsent;
    const totalDeductions = latePenaltyAmount + absentDeduction;
    const netSalary = basicSalary + otAmount - totalDeductions;
    const fullAttendanceBonusEligible = daysAbsent === 0 && lateCount === 0;

    return {
      workerId: salary.employee_id || salary.worker_id || salary.id || `EMP-${String(index + 1).padStart(3, '0')}`,
      name,
      totalWorkingDays,
      daysPresent,
      daysAbsent,
      lateCount,
      totalOtHours,
      basicSalary,
      dailyRate,
      hourlyRate,
      otRate,
      otAmount,
      latePenaltyAmount,
      absentDeduction,
      totalDeductions,
      netSalary,
      fullAttendanceBonusEligible,
      highAbsence: daysAbsent >= Math.max(3, Math.ceil(totalWorkingDays * 0.1)),
    };
  });
}

export function formatPayrollCurrency(value) {
  return numberValue(value).toFixed(2);
}

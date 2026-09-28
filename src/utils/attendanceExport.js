import * as XLSX from 'xlsx';
import { calculateDutyHours, calculateLateMinutes, calculateOvertimeHours } from './attendance';

function recordsForWorker(records, worker, year, monthIndex) {
  return records
    .filter((record) => String(record.workerId) === String(worker.workerId))
    .filter((record) => {
      const date = new Date(`${record.date}T00:00:00`);
      return date.getFullYear() === year && date.getMonth() === monthIndex;
    });
}

export function buildMonthlyRegister(workers, records, year, monthIndex) {
  return workers.map((worker) => {
    const workerRecords = recordsForWorker(records, worker, year, monthIndex);
    const days = Object.fromEntries(workerRecords.map((record) => [Number(record.date.slice(-2)), record.status || '']));
    const department = workerRecords.find((record) => record.department)?.department || worker.department || '';
    const presentCount = workerRecords.filter((record) => ['Present', 'Late'].includes(record.status)).length;
    const lateCount = workerRecords.filter((record) => record.status === 'Late').length;
    const absentCount = workerRecords.filter((record) => record.status === 'Absent').length;
    const overtime = workerRecords.reduce((total, record) => total + calculateOvertimeHours(record.inTime, record.outTime), 0);

    return {
      'Worker ID': worker.workerId,
      'Worker Name': worker.name,
      Department: department,
      ...Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`Day ${index + 1}`, days[index + 1] || '']),),
      'Total Present': presentCount,
      'Total Late': lateCount,
      'Total Absent': absentCount,
      'Total OT Hours': Number(overtime.toFixed(2)),
    };
  });
}

export function buildDetailedTimeLogs(records, year, monthIndex) {
  return records
    .filter((record) => {
      const date = new Date(`${record.date}T00:00:00`);
      return date.getFullYear() === year && date.getMonth() === monthIndex;
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((record) => ({
      'Worker ID': record.workerId,
      'Worker Name': record.userName,
      Date: record.date,
      'Entry Time': record.inTime || '',
      'Exit Time': record.outTime || '',
      Status: record.status || '',
      'Late (Mins)': Number(record.lateMinutes ?? calculateLateMinutes(record.inTime)),
      'Total Duty Hours': calculateDutyHours(record.inTime, record.outTime),
      'Overtime Hours': calculateOvertimeHours(record.inTime, record.outTime),
    }));
}

export function downloadMonthlyAttendanceWorkbook(workers, records, selectedMonth) {
  const [year, month] = selectedMonth.split('-').map(Number);
  const workbook = XLSX.utils.book_new();
  const registerRows = buildMonthlyRegister(workers, records, year, month - 1);
  const detailedRows = buildDetailedTimeLogs(records, year, month - 1);
  const registerSheet = XLSX.utils.json_to_sheet(registerRows);
  const detailedSheet = XLSX.utils.json_to_sheet(detailedRows);
  registerSheet['!cols'] = Object.keys(registerRows[0] || {}).map((key) => ({ wch: key.startsWith('Day ') ? 10 : 20 }));
  detailedSheet['!cols'] = Object.keys(detailedRows[0] || {}).map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(workbook, registerSheet, 'Monthly Register');
  XLSX.utils.book_append_sheet(workbook, detailedSheet, 'Detailed Time Logs');
  XLSX.writeFile(workbook, `attendance-monthly-register-${selectedMonth}.xlsx`);
}

function inDateRange(date, startDate, endDate) {
  return Boolean(date && (!startDate || date >= startDate) && (!endDate || date <= endDate));
}

export function buildDateRangeReport(workers, records, startDate, endDate) {
  const selectedRecords = records.filter((record) => inDateRange(record.date, startDate, endDate));
  const detailedRows = selectedRecords.map((record) => ({
    'Worker ID': record.workerId,
    'Worker Name': record.userName,
    Department: record.department || '',
    Date: record.date,
    'In-Time': record.inTime || '',
    'Out-Time': record.outTime || '',
    Status: record.status || '',
    'Late Minutes': Number(record.lateMinutes ?? calculateLateMinutes(record.inTime)),
    'OT Hours': calculateOvertimeHours(record.inTime, record.outTime),
  }));
  const summaryRows = workers.map((worker) => {
    const workerRecords = selectedRecords.filter((record) => String(record.workerId) === String(worker.workerId));
    return {
      'Worker ID': worker.workerId,
      'Worker Name': worker.name,
      // Falls back to the worker's profile when no record in range names a department.
      Department: workerRecords.find((record) => record.department)?.department || worker.department || '-',
      'Total Present': workerRecords.filter((record) => ['Present', 'Late'].includes(record.status)).length,
      'Total Late': workerRecords.filter((record) => record.status === 'Late').length,
      'Total Absent': workerRecords.filter((record) => record.status === 'Absent').length,
      Leave: workerRecords.filter((record) => record.status === 'Leave').length,
      'Total OT Hours': Number(workerRecords.reduce((total, record) => total + calculateOvertimeHours(record.inTime, record.outTime), 0).toFixed(2)),
    };
  });
  return { detailedRows, summaryRows };
}

export function downloadDateRangeAttendanceReport(workers, records, startDate, endDate) {
  const { detailedRows, summaryRows } = buildDateRangeReport(workers, records, startDate, endDate);
  const workbook = XLSX.utils.book_new();
  const detailedSheet = XLSX.utils.json_to_sheet(detailedRows);
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  detailedSheet['!cols'] = Object.keys(detailedRows[0] || {}).map(() => ({ wch: 18 }));
  summarySheet['!cols'] = Object.keys(summaryRows[0] || {}).map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(workbook, detailedSheet, 'Detailed Daily Logs');
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Worker Summary');
  XLSX.writeFile(workbook, `attendance-report-${startDate}-to-${endDate}.xlsx`);
}

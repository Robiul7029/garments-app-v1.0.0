import { PROCESS_TARGETS, DEFAULT_TARGET } from '../config/menuConfig';

// Attendance: 08:00 is the shift start. On time or early -> Present.
// After 08:00 -> Late, with minutes_late computed from the difference.
export function attendanceStatus(inTime) {
  if (!inTime) return { status: 'Absent', minutesLate: 0 };
  const [h, m] = inTime.split(':').map(Number);
  const inMinutes = h * 60 + m;
  const shiftStart = 8 * 60;
  if (inMinutes <= shiftStart) return { status: 'Present', minutesLate: 0 };
  return { status: 'Late', minutesLate: inMinutes - shiftStart };
}

// Production/cutting/finishing entries: look up the standard target
// for the selected process, and compute how far the entry is from it.
export function targetForProcess(process) {
  return PROCESS_TARGETS[process] || DEFAULT_TARGET;
}

export function dueLabel(target, achieved) {
  const diff = target - achieved;
  if (diff <= 0) return { label: diff === 0 ? 'On Target' : `+${Math.abs(diff)} Extra`, ok: true };
  return { label: `${diff} Due`, ok: false };
}

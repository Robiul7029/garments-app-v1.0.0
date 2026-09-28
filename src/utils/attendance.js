import { collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';

export const STANDARD_WORKERS = [
  'Md Robiul Islam', 'Md M U Sumon', 'Md Mojibor Rahman', 'Md Zakirul Islam', 'Mst Sarjina Akter',
  'Mst Najma Aktar', 'Md Anowar Hossain', 'Md Murad Hossain', 'Md Sajjad Islam', 'Md Nijam',
  'Moloy Sikdar', 'Md Kobir Mia', 'Md Sikandar', 'Nurul Hoque', 'Md Srabon', 'Md Sahalom',
  'Md Arshab', 'Md Al-Amin', 'Md Fojlu', 'Md Faruk Mia', 'Md Roshidul Islam', 'Md Motaleb',
  'Alim', 'Sorowar', 'Noyon', 'Raju Mia', 'Mirza Kobir', 'Badsha', 'Md Rubel Mia',
  'Md Mirza Rahaman', 'Md Moyful Islam', 'Md Bashar', 'Md Delowar Hossain', 'Md Iqbal',
  'Md Mehedi', 'Md Badol', 'Md Siraj Mia', 'Md Monir Hossen', 'Md Rohidul', 'Md Najmul',
  'Md Sohidul', 'Md Hafijur', 'Masum', 'Md Olil', 'Md Saddam', 'Md Hossain Howlader',
  'Md Mintu', 'Md Taijul', 'Md Rasel', 'Md Rasel (Suvo)',
].map((name, index) => ({
  workerId: index + 1,
  name,
  basicSalary: 0,
  designation: '',
  active: true,
}));

export async function seedWorkersToFirestore() {
  const snapshot = await getDocs(collection(db, 'workers'));
  if (!snapshot.empty) return { seeded: false, count: snapshot.size };

  await Promise.all(STANDARD_WORKERS.map((worker) => setDoc(
    doc(db, 'workers', String(worker.workerId)),
    worker
  )));
  return { seeded: true, count: STANDARD_WORKERS.length };
}

export async function getWorkersFromFirestore() {
  const snapshot = await getDocs(collection(db, 'workers'));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((worker) => worker.active !== false)
    .sort((a, b) => Number(a.workerId) - Number(b.workerId));
}

export function calculateOvertimeHours(inTime, outTime, standardShiftHours = 8) {
  if (!outTime) return 0;
  const [outHour, outMinute] = String(outTime).split(':').map(Number);
  const overtimeMinutes = (outHour * 60 + outMinute) - (18 * 60 + 30);
  return Math.max(0, Number((overtimeMinutes / 60).toFixed(2)));
}

export function calculateDutyHours(inTime, outTime) {
  if (!inTime || !outTime) return 0;
  const [inHour, inMinute] = String(inTime).split(':').map(Number);
  const [outHour, outMinute] = String(outTime).split(':').map(Number);
  const elapsedHours = ((outHour * 60 + outMinute) - (inHour * 60 + inMinute)) / 60;
  return Math.max(0, Number((elapsedHours - 0.5).toFixed(2)));
}

export function calculateLateMinutes(inTime) {
  if (!inTime) return 0;
  const [hours, minutes] = String(inTime).split(':').map(Number);
  return Math.max(0, (hours * 60 + minutes) - (8 * 60));
}

/**
 * Deterministic document ID for an attendance day, e.g. "5_2026-09-28".
 * Using workerId_date means Firestore itself can never hold two records for the same
 * worker on the same day — a second write would target the same document.
 */
export function attendanceDocId(workerId, date) {
  return `${workerId}_${date}`;
}

/**
 * Looks for an existing attendance record for this worker on this date. Records created
 * before deterministic IDs existed use auto-generated IDs, so the query is by field
 * rather than by document ID.
 */
export async function findAttendanceForWorkerDate(workerId, date) {
  if (!workerId || !date) return null;
  const snapshot = await getDocs(query(
    collection(db, 'attendance'),
    where('workerId', '==', Number(workerId)),
    where('date', '==', date)
  ));
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

export async function saveAttendanceRecord({ worker, department, date, inTime, outTime, status }) {
  return setDoc(doc(db, 'attendance', attendanceDocId(worker.workerId, date)), {
    userId: String(worker.workerId),
    workerId: Number(worker.workerId),
    userName: worker.name,
    department: department || '',
    date,
    inTime: inTime || '',
    outTime: outTime || '',
    status,
    lateMinutes: calculateLateMinutes(inTime),
    overtimeHours: calculateOvertimeHours(inTime, outTime),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateAttendanceRecord(recordId, { date, inTime, outTime, status, department }) {
  return updateDoc(doc(db, 'attendance', recordId), {
    date,
    inTime: inTime || '',
    outTime: outTime || '',
    status,
    department: department || '',
    lateMinutes: calculateLateMinutes(inTime),
    overtimeHours: calculateOvertimeHours(inTime, outTime),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteAttendanceRecord(recordId) {
  return deleteDoc(doc(db, 'attendance', recordId));
}

/**
 * Writes one Leave record per calendar day of an advance multi-day leave, so a
 * From/To entry shows up day by day on this page and in Smart Attendance. Days
 * that already hold a record are skipped rather than overwritten — attendance
 * already entered for that day always wins over an advance request.
 */
export async function saveLeaveRange({ worker, department, fromDate, toDate, leaveType, comment }) {
  if (!worker || !fromDate) throw new Error('Worker and a start date are required.');
  if (toDate && toDate < fromDate) throw new Error('The end date cannot be before the start date.');

  // Cap the expansion so a typo'd year cannot spin thousands of writes.
  const MAX_DAYS = 60;
  const created = [];
  const skipped = [];
  const cursor = new Date(`${fromDate}T00:00:00`);
  const end = toDate ? new Date(`${toDate}T00:00:00`) : cursor;

  while (cursor <= end && created.length + skipped.length < MAX_DAYS) {
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const existing = await findAttendanceForWorkerDate(worker.workerId, date);
    if (existing) {
      skipped.push(date);
    } else {
      await saveAttendanceRecord({
        worker,
        department,
        date,
        inTime: '',
        outTime: '',
        status: 'Leave',
      });
      created.push(date);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // The span and the reason only exist on the first day, so the row reads as one
  // multi-day request instead of N unrelated single days.
  if (created.length) {
    const first = created[0];
    await updateDoc(doc(db, 'attendance', attendanceDocId(worker.workerId, first)), {
      leaveType: leaveType || 'Leave',
      comment: comment || '',
      fromDate,
      toDate: toDate || fromDate,
      updatedAt: serverTimestamp(),
    });
  }

  return { created, skipped };
}

export async function getAttendanceFromFirestore() {
  const snapshot = await getDocs(collection(db, 'attendance'));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export function subscribeToAttendance(onData, onError) {
  return onSnapshot(collection(db, 'attendance'), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
  }, onError);
}

export function subscribeToWorkers(onData, onError) {
  return onSnapshot(collection(db, 'workers'), (snapshot) => {
    onData(snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((worker) => worker.active !== false)
      .sort((a, b) => Number(a.workerId) - Number(b.workerId)));
  }, onError);
}

export function isInMonth(dateValue, year, monthIndex) {
  if (!dateValue) return false;
  const date = new Date(`${dateValue}T00:00:00`);
  return date.getFullYear() === year && date.getMonth() === monthIndex;
}

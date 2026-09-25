import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
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

export async function saveAttendanceRecord({ worker, department, date, inTime, outTime, status }) {
  return addDoc(collection(db, 'attendance'), {
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
  });
}

export async function deleteAttendanceRecord(recordId) {
  return deleteDoc(doc(db, 'attendance', recordId));
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

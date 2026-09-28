import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { useActivity } from './ActivityContext';

export const DataContext = createContext(null);

// Employee master list — feeds every "Employee Name" dropdown across the app.
// Add/remove people here (or later connect this to a real employees table).
const EMPLOYEES = ['Salma', 'Rina', 'Karim', 'Jasmin', 'Rahim', 'Nasrin', 'Zakir'];

// Sample starter data so the app isn't empty on first run.
// Replace with real API calls when you connect a backend.
const seed = {
  employees: EMPLOYEES,

  'daily-production': [
    { id: 1, date: '2026-08-19', employee: 'Salma', style: 'STY-1001', department: 'Sewing', process: 'Collar Attach', quantity: 8 },
    { id: 2, date: '2026-08-19', employee: 'Rina', style: 'STY-1001', department: 'Sewing', process: 'Sleeve Join', quantity: 11 },
    { id: 3, date: '2026-08-19', employee: 'Karim', style: 'STY-1002', department: 'Sewing', process: 'Overlock', quantity: 15 },
  ],
  'worker-production': [
    { id: 1, employee: 'Salma', line: 'Line-1', date: '2026-08-19', output: 62 },
  ],
  'quality-control': [
    { id: 1, date: '2026-08-19', line: 'Line-1', process: 'Collar Attach', checked: 300, defect_qty: 14 },
    { id: 2, date: '2026-08-19', line: 'Line-1', process: 'Collar Attach', checked: 280, defect_qty: 18 },
  ],
  'order-model': [
    { id: 1, buyer: 'H&M', style: 'STY-1001', qty: 5000, start_date: '2026-08-10', ship_date: '2026-09-20' },
    { id: 2, buyer: 'Zara', style: 'STY-1002', qty: 1500, start_date: '2026-08-05', ship_date: '2026-08-30' },
  ],
  'cutting-plan': [
    { id: 1, style: 'STY-1001', start_date: '2026-08-10', colors: 3, daily_qty: 800, note: 'Cut Parma before Tilo — Parma ships first' },
  ],
  'cutting-production': [
    { id: 1, date: '2026-08-19', employee: 'Zakir', style: 'STY-1001', color: 'Black', lay_qty: 100, quantity: 800 },
  ],
  'fabric-material': [
    { id: 1, fabric: 'Cotton Twill', lot_no: 'LOT-22', received_qty: 2000, issued_qty: 1200 },
  ],
  'daily-attendance': [
    { id: 1, employee: 'Salma', department: 'Sewing', in_time: '07:58' },
    { id: 2, employee: 'Karim', department: 'Cutting', in_time: '08:12' },
    { id: 3, employee: 'Jasmin', department: 'Finishing', in_time: '08:01' },
  ],
  late: [
    { id: 1, name: 'Karim', scheduled_time: '08:00', actual_time: '08:12', minutes_late: 12 },
  ],
  'attendance-leave': [
    { id: 1, employee: 'Rina', leave_type: 'Sick', from_date: '2026-08-19', to_date: '2026-08-20', comment: 'Fever, resting at home' },
  ],
  'finishing-production': [
    { id: 1, date: '2026-08-19', employee: 'Jasmin', style: 'STY-1001', department: 'Finishing', process: 'Thread Cutting', quantity: 26 },
  ],
  'quality-check': [
    { id: 1, date: '2026-08-19', hour_slot: '10:00-11:00', target: 120, checked: 100, altered: 6, final: 94, faulty: 6 },
  ],
  'washing-plan': [
    { id: 1, style: 'STY-1001', washable: 'Yes', ready_qty: 400, pending_qty: 120 },
  ],
  'send-to-washing': [
    { id: 1, date: '2026-08-19', style: 'STY-1001', color: 'Black', qty_sent: 400 },
  ],
  'received-from-washing': [
    { id: 1, date: '2026-08-18', style: 'STY-1000', color: 'Navy', qty_received: 350 },
  ],
  'washing-status': [
    { id: 1, style: 'STY-1001', color: 'Black', status: 'In Process' },
    { id: 2, style: 'STY-1000', color: 'Navy', status: 'Approved' },
  ],
  'delivery-plan': [
    { id: 1, style: 'STY-1001', qty: 5000, ship_date: '2026-09-20', urgency: 'Normal' },
  ],
  'ready-for-delivery': [
    { id: 1, style: 'STY-1000', qty: 3000, date_ready: '2026-08-18' },
  ],
  delivered: [
    { id: 1, style: 'STY-0999', qty: 4500, delivery_date: '2026-08-15', carrier: 'DHL' },
  ],
  'pending-delivery': [
    { id: 1, style: 'STY-1001', qty: 5000, status: 'In Process' },
  ],
  'leave-requests': [
    { id: 1, employee: 'Rina', leave_type: 'Sick', from_date: '2026-08-19', to_date: '2026-08-20', status: 'Pending', comment: 'Fever, resting at home' },
  ],
  salary: [
    { id: 1, name: 'Salma', department: 'Sewing', base_salary: 15000, bonus: 1000, status: 'Processing' },
    { id: 2, name: 'Karim', department: 'Cutting', base_salary: 18000, bonus: 1500, status: 'Paid' },
  ],
  'hourly-timesheet-rows': [
    { id: 1, employee: 'Salma', process: 'Collar Attach', hours: { '08': 9, '09': 10 } },
  ],
};

let nextId = 1000;
const DATA_KEY = 'garments_app_data';

function loadData() {
  try {
    const stored = JSON.parse(localStorage.getItem(DATA_KEY));
    if (stored && typeof stored === 'object') return { ...seed, ...stored };
  } catch { /* use the starter data */ }
  return seed;
}

// A one-line summary of what was typed, so the bell notification says something useful
// instead of just "new entry added".
function summarize(action, key, entry) {
  const values = Object.entries(entry || {})
    .filter(([field, value]) => field !== 'id' && value !== '' && value !== null && value !== undefined)
    .slice(0, 4)
    .map(([field, value]) => `${field.replace(/_/g, ' ')}: ${value}`);
  const verb = { create: 'added', update: 'updated', delete: 'deleted' }[action] || 'saved';
  return values.length ? `${verb} — ${values.join(', ')}` : `${verb} an entry`;
}

export function DataProvider({ children }) {
  const [data, setData] = useState(loadData);
  // Every write is logged so the bell page and History have something real to show.
  const { user } = useAuth();
  const { record } = useActivity();
  const actor = user?.username || user?.email || 'Unknown user';

  // A readable one-liner travels with the notification (bell item + email) so neither has
  // to rebuild it from the raw entry.
  const activitySummary = (action, key, entry) => summarize(action, key, entry || {});

  useEffect(() => {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  }, [data]);

  function getData(key) {
    return data[key] || [];
  }

  function addEntry(key, entry) {
    const row = { id: ++nextId, ...entry };
    setData((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), row],
    }));
    record('create', { key, entry: row, actor, summary: activitySummary('create', key, row), actionRequired: 'Review the new entry' });
    return row;
  }

  function updateEntry(key, id, updated) {
    setData((prev) => ({
      ...prev,
      [key]: (prev[key] || []).map((row) => (row.id === id ? { ...row, ...updated } : row)),
    }));
    record('update', { key, entry: { ...updated, id }, actor, summary: activitySummary('update', key, updated), actionRequired: 'Confirm the change is correct' });
  }

  function deleteEntry(key, id) {
    const previous = (data[key] || []).find((row) => row.id === id) || { id };
    setData((prev) => ({
      ...prev,
      [key]: (prev[key] || []).filter((row) => row.id !== id),
    }));
    record('delete', { key, entry: previous, actor, summary: activitySummary('delete', key, previous), actionRequired: 'Confirm the removal is intended' });
  }

  function setRaw(key, value) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <DataContext.Provider value={{ getData, addEntry, updateEntry, deleteEntry, setRaw, summarize }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}

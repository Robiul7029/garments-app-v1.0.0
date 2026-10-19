/**
 * QA PREVIEW — temporary. Mounts Hourly Production and Worker Production over
 * ONE shared store, so the hourly daily totals can be seen landing on the Worker
 * Production page — the sync the brief asks for.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DataContext } from './context/DataContext';
import { AuthContext } from './context/AuthContext';
import { RoleProvider } from './context/RoleContext';
import HourlyTimesheet from './components/HourlyTimesheet';
import WorkerProductionPage from './pages/WorkerProductionPage';

export default function QaWorkerSyncPreview() {
  const today = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState({
    employees: ['Md Robiul Islam', 'Mst Sarjina Akter'],
    'order-model': [
      { id: 1, style: 'STY-1001', order_no: 'PO-105', buyer: 'H&M', item: 'Tee', qty: 5000, color: 'Navy', size_range: 'M', order_date: `${today.slice(0, 7)}-05` },
    ],
    'process-breakdown': [
      {
        id: 10, style: 'STY-1001', order_no: 'PO-105', fileName: 'sheet.xlsx', uploadedAt: today, totalSmv: 4.5,
        operations: [
          { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
          { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
        ],
      },
    ],
    'process-capacity': [],
    'daily-production': [],
    'hourly-timesheet-rows': [
      { id: 1, date: today, employee: 'Md Robiul Islam', process: 'Collar Attach', hours: { '08': 40, '09': 44 } },
      { id: 2, date: today, employee: 'Md Robiul Islam', process: 'Sleeve Join', hours: { '10': 30 } },
      { id: 3, date: today, employee: 'Mst Sarjina Akter', process: 'Side Seam', hours: { '08': 30, '09': 33 } },
    ],
  });

  const getData = useCallback((key) => data[key] || [], [data]);
  const addEntry = useCallback((key, entry) => {
    setData((prev) => ({ ...prev, [key]: [...(prev[key] || []), { id: Date.now(), ...entry }] }));
  }, []);
  const updateEntry = useCallback((key, id, updated) => {
    setData((prev) => ({ ...prev, [key]: (prev[key] || []).map((r) => (r.id === id ? { ...r, ...updated } : r)) }));
  }, []);
  const deleteEntry = useCallback((key, id) => {
    setData((prev) => ({ ...prev, [key]: (prev[key] || []).filter((r) => r.id !== id) }));
  }, []);
  const setRaw = useCallback(() => {}, []);

  const value = useMemo(
    () => ({ getData, addEntry, updateEntry, deleteEntry, setRaw }),
    [getData, addEntry, updateEntry, deleteEntry, setRaw],
  );
  const auth = useMemo(() => ({
    user: { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true },
    loading: false, authReady: true, usersVersion: 0, getLiveStatus: () => 'approved',
  }), []);

  return (
    <BrowserRouter>
      <AuthContext.Provider value={auth}>
        <DataContext.Provider value={value}>
          <RoleProvider>
            <div className="app-content" style={{ padding: 20, background: '#0b0f14', minHeight: '100vh' }}>
              <section id="qa-hourly"><HourlyTimesheet /></section>
              <section id="qa-worker" style={{ marginTop: 40 }}>
                <WorkerProductionPage
                  category={{ key: 'production', label: 'Sewing Department', icon: '🧵' }}
                  item={{ key: 'worker-production', label: 'Worker Production', icon: '👥' }}
                />
              </section>
            </div>
          </RoleProvider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </BrowserRouter>
  );
}

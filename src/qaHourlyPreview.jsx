/**
 * QA PREVIEW — temporary. Mounts the real Hourly Production screen over a
 * seeded store (an order, an uploaded process sheet, and a few hourly rows) so
 * the process dropdown and the daily totals can be exercised in the browser.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DataContext } from './context/DataContext';
import { AuthContext } from './context/AuthContext';
import { RoleProvider } from './context/RoleContext';
import HourlyTimesheet from './components/HourlyTimesheet';

export default function QaHourlyPreview() {
  const today = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState({
    employees: ['Md Robiul Islam', 'Mst Sarjina Akter', 'Md Sumon'],
    'order-model': [
      {
        id: 1, style: 'STY-1001', order_no: 'PO-105', buyer: 'H&M', item: 'Basic Tee',
        qty: 5000, color: 'Navy', size_range: 'M, L', order_date: `${today.slice(0, 7)}-05`,
      },
      // A second order, so typing a digit into the Order No box can be seen to
      // filter the list rather than just picking the only entry there is.
      {
        id: 2, style: 'STY-2044', order_no: 'PO-131', buyer: 'Zara', item: 'Polo',
        qty: 1800, color: 'White', size_range: 'S, M, L', order_date: `${today.slice(0, 7)}-08`,
      },
    ],
    'process-breakdown': [
      // Keyed to the ORDER NUMBER, which is what the form now selects first.
      {
        id: 10, style: 'STY-1001', order_no: 'PO-105', fileName: 'breakdown.xlsx',
        uploadedAt: today, totalSmv: 4.5,
        operations: [
          { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
          { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
          { operation: 'Side Seam', machine: 'Flatlock', smv: 1.8, section: 'Body' },
          { operation: 'Bottom Hem', machine: 'Flatlock', smv: 1.4, section: 'Bottom' },
        ],
      },
    ],
    'process-capacity': [],
    'hourly-timesheet-rows': [
      { id: 1, date: today, employee: 'Md Robiul Islam', order_no: 'PO-105', style: 'STY-1001', process: 'Collar Attach', hours: { '08': 40, '09': 44, '10': 38 } },
      { id: 2, date: today, employee: 'Md Robiul Islam', order_no: 'PO-105', style: 'STY-1001', process: 'Sleeve Join', hours: { '11': 50, '12': 35 } },
      { id: 3, date: today, employee: 'Mst Sarjina Akter', order_no: 'PO-105', style: 'STY-1001', process: 'Side Seam', hours: { '08': 30, '09': 33 } },
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
  // Functional so the "Add Other Process" write to the master process sheet is
  // visible in the preview, exactly as it behaves against the real store.
  const setRaw = useCallback((key, raw) => {
    setData((prev) => ({ ...prev, [key]: raw }));
  }, []);

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
              <HourlyTimesheet />
            </div>
          </RoleProvider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </BrowserRouter>
  );
}

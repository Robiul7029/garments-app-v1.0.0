/** QA PREVIEW — temporary. Mounts the real Process Sheet Upload screen. */
import React, { useCallback, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DataContext } from './context/DataContext';
import { AuthContext } from './context/AuthContext';
import { RoleProvider } from './context/RoleContext';
import ProcessUploadPage from './pages/ProcessUploadPage';

export default function QaProcessUploadPreview() {
  const month = new Date().toISOString().slice(0, 7);
  const [data, setData] = useState({
    employees: [],
    'order-model': [
      {
        id: 1, buyer: 'H&M', order_no: 'PO-105', style: 'STY-1001', item: 'Basic Tee',
        color: 'Navy', size_range: 'M, L', qty: 5000, order_date: `${month}-05`,
      },
    ],
    'process-breakdown': [
      {
        id: 10, style: 'STY-1001', order_no: 'PO-105', fileName: 'breakdown.xlsx',
        uploadedAt: `${month}-05`, totalSmv: 6.5,
        operations: [
          { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
          { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
          { operation: 'Side Seam', machine: 'Flatlock', smv: 2.1, section: 'Body' },
          { operation: 'Hemming', machine: 'Flatlock', smv: 1.7, section: 'Bottom' },
        ],
      },
    ],
    'process-capacity': [
      {
        id: 'STY-1001', style: 'STY-1001', order_no: 'PO-105',
        manpower: 25, workingHours: 8, efficiency: 70,
        totalSmv: 6.5, lineDailyTarget: 1292, lineHourlyTarget: 161,
        savedAt: `${month}-05`,
      },
    ],
  });

  const getData = useCallback((key) => data[key] || [], [data]);
  const addEntry = useCallback((key, entry) => {
    setData((prev) => ({ ...prev, [key]: [...(prev[key] || []), { id: Date.now(), ...entry }] }));
  }, []);
  // These two MUST actually write: the Uploaded Sheets actions go through
  // `updateEntry` and `deleteEntry`, and a no-op stub would make the dialogs look
  // like they worked while the table never changed.
  const updateEntry = useCallback((key, id, updated) => {
    setData((prev) => ({
      ...prev,
      [key]: (prev[key] || []).map((r) => (r.id === id ? { ...r, ...updated } : r)),
    }));
  }, []);
  const deleteEntry = useCallback((key, id) => {
    setData((prev) => ({ ...prev, [key]: (prev[key] || []).filter((r) => r.id !== id) }));
  }, []);
  const setRaw = useCallback((key, value) => {
    setData((prev) => ({ ...prev, [key]: value }));
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
              <ProcessUploadPage
                category={{ key: 'orders', label: 'Order Management', icon: '📑' }}
                item={{ key: 'process-breakdown', label: 'Process Sheet Upload', icon: '📤' }}
              />
            </div>
          </RoleProvider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </BrowserRouter>
  );
}

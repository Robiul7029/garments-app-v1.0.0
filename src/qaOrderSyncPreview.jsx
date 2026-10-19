/**
 * QA PREVIEW — temporary. Mounts the Order Input tab and the Order List tab
 * side by side over ONE shared data store, so an edit or delete on the input
 * side can be seen landing on the list side — which is the sync the brief asks
 * for. This mirrors how the real app wires both tabs.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DataContext } from './context/DataContext';
import { AuthContext } from './context/AuthContext';
import { RoleProvider } from './context/RoleContext';
import OrderInputPage from './pages/OrderInputPage';
import OrderListTable from './components/OrderListTable';

export default function QaOrderSyncPreview() {
  const monthKey = (offset) => {
    const d = new Date();
    d.setMonth(d.getMonth() + offset);
    return d.toISOString().slice(0, 7);
  };
  const [data, setData] = useState({
    employees: [],
    'order-model': [
      { id: 1, buyer: 'H&M', order_no: 'PO-105', style: 'STY-1001', item: 'Basic Tee', qty: 5000, color: 'Navy', size_range: 'M', order_date: `${monthKey(0)}-05`, ship_date: `${monthKey(0)}-20` },
      { id: 2, buyer: 'Zara', order_no: 'PO-106', style: 'STY-1000', item: 'Hoodie', qty: 1500, color: 'Black', size_range: 'L', order_date: `${monthKey(-1)}-12`, ship_date: `${monthKey(-1)}-28` },
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
              <section id="qa-input">
                <OrderInputPage
                  category={{ key: 'orders', label: 'Order Management', icon: '📑' }}
                  item={{ key: 'order-input', label: 'Order Input', icon: '📝' }}
                />
              </section>
              <section id="qa-list" style={{ marginTop: 40 }}>
                <h2 style={{ color: '#e6e9ed' }}>Order List</h2>
                <OrderListTable />
              </section>
            </div>
          </RoleProvider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </BrowserRouter>
  );
}

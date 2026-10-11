/** QA PREVIEW — temporary. Mounts the real Order Input form. */
import React, { useCallback, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DataContext } from './context/DataContext';
import { AuthContext } from './context/AuthContext';
import { RoleProvider } from './context/RoleContext';
import OrderInputPage from './pages/OrderInputPage';

export default function QaOrderInputPreview() {
  const [data, setData] = useState({
    employees: ['Salma Khatun', 'Rina Akter'],
    'order-model': [
      {
        id: 1, buyer: 'H&M', order_no: 'PO-105', style: 'STY-1001', item: 'Basic Tee',
        color: 'Navy, Black, White', size_range: 'XS, S, M, L, XL, XXL, 3XL, 4XL',
        qty: 5000, floor: 'Floor-2', line_no: 'Line-03', shift: 'Morning',
        supervisor: 'Salma Khatun', ship_date: '2026-09-20',
      },
      // A legacy single-colour row, to prove it still renders unchanged.
      { id: 2, buyer: 'Zara', order_no: 'PO-106', style: 'STY-1000', color: 'Navy', size_range: 'S-M-L', qty: 1500 },
    ],
  });

  const getData = useCallback((key) => data[key] || [], [data]);
  const addEntry = useCallback((key, entry) => {
    setData((prev) => ({ ...prev, [key]: [...(prev[key] || []), { id: Date.now(), ...entry }] }));
  }, []);
  const updateEntry = useCallback(() => { }, []);
  const deleteEntry = useCallback(() => { }, []);
  const setRaw = useCallback(() => { }, []);

  const value = useMemo(
    () => ({ getData, addEntry, updateEntry, deleteEntry, setRaw }),
    [getData, addEntry, updateEntry, deleteEntry, setRaw],
  );
  const auth = useMemo(() => ({
    user: { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true },
    loading: false, authReady: true, usersVersion: 0, getLiveStatus: () => 'approved',
  }), []);

  const stateRef = React.useRef(data);
  stateRef.current = data;
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, '__ORDER_STATE__', { configurable: true, get: () => stateRef.current });
  }

  return (
    <BrowserRouter>
      <AuthContext.Provider value={auth}>
        <DataContext.Provider value={value}>
          <RoleProvider>
            <div className="app-content" style={{ padding: 20, background: '#0b0f14', minHeight: '100vh' }}>
              <OrderInputPage
                category={{ key: 'orders', label: 'Order Management', icon: '📑' }}
                item={{ key: 'order-input', label: 'Order Input', icon: '📝' }}
              />
            </div>
          </RoleProvider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </BrowserRouter>
  );
}

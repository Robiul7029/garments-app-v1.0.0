/** QA PREVIEW — temporary. Mounts the real Order Input form. */
import React, { useCallback, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DataContext } from './context/DataContext';
import { AuthContext } from './context/AuthContext';
import { RoleProvider } from './context/RoleContext';
import OrderInputPage from './pages/OrderInputPage';

export default function QaOrderInputPreview() {
  // Dates across the recent-months window, plus one older row that must NOT show.
  const monthKey = (offset) => {
    const d = new Date();
    d.setMonth(d.getMonth() + offset);
    return d.toISOString().slice(0, 7);
  };
  const [data, setData] = useState({
    employees: ['Salma Khatun', 'Rina Akter'],
    'order-model': [
      {
        id: 1, buyer: 'H&M', order_no: 'PO-105', style: 'STY-1001', item: 'Basic Tee',
        color: 'Navy, Black, White', size_range: 'XS, S, M, L, XL, XXL, 3XL, 4XL',
        qty: 5000, floor: 'Floor-2', line_no: 'Line-03', shift: 'Morning',
        supervisor: 'Salma Khatun', order_date: `${monthKey(0)}-05`, ship_date: `${monthKey(0)}-20`,
      },
      // A legacy single-colour row, from LAST month.
      {
        id: 2, buyer: 'Zara', order_no: 'PO-106', style: 'STY-1000', color: 'Navy',
        size_range: 'S-M-L', qty: 1500, order_date: `${monthKey(-1)}-12`, ship_date: `${monthKey(-1)}-28`,
      },
      // A row from TWO months back, still inside the window.
      {
        id: 3, buyer: 'Uniqlo', order_no: 'PO-090', style: 'STY-0900', color: 'Olive',
        size_range: 'M, L', qty: 800, order_date: `${monthKey(-2)}-08`, ship_date: `${monthKey(-2)}-25`,
      },
      // FIVE months back — OUTSIDE the window, must not appear.
      {
        id: 4, buyer: 'Zara', order_no: 'PO-050', style: 'STY-OLD', color: 'Red',
        size_range: 'S', qty: 100, order_date: `${monthKey(-5)}-01`, ship_date: `${monthKey(-5)}-15`,
      },
    ],
  });

  const getData = useCallback((key) => data[key] || [], [data]);
  const addEntry = useCallback((key, entry) => {
    setData((prev) => ({ ...prev, [key]: [...(prev[key] || []), { id: Date.now(), ...entry }] }));
  }, []);
  // Real mutations, so Edit and Delete can be driven end-to-end in the browser.
  const updateEntry = useCallback((key, id, updated) => {
    setData((prev) => ({
      ...prev,
      [key]: (prev[key] || []).map((row) => (row.id === id ? { ...row, ...updated } : row)),
    }));
  }, []);
  const deleteEntry = useCallback((key, id) => {
    setData((prev) => ({ ...prev, [key]: (prev[key] || []).filter((row) => row.id !== id) }));
  }, []);
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

/** QA PREVIEW — temporary. Mounts the real Order List table. */
import React, { useCallback, useMemo, useState } from 'react';
import { DataContext } from './context/DataContext';
import OrderListTable from './components/OrderListTable';

export default function QaOrderListPreview() {
  const [data] = useState({
    'order-model': [
      { id: 1, buyer: 'H&M', order_no: 'PO-105', style: 'STY-1001', item: 'Basic Tee', qty: 5000, color: 'Navy, Black', size_range: 'M, L', order_date: `${new Date().getFullYear()}-03-15`, ship_date: `${new Date().getFullYear()}-03-28` },
      { id: 2, buyer: 'Zara', order_no: 'PO-106', style: 'STY-1000', item: 'Hoodie', qty: 1500, color: 'Black', size_range: 'S, M', order_date: `${new Date().getFullYear()}-07-02`, ship_date: `${new Date().getFullYear()}-08-10` },
    ],
  });

  const getData = useCallback((key) => data[key] || [], [data]);
  const value = useMemo(() => ({
    getData,
    addEntry: () => { }, updateEntry: () => { }, deleteEntry: () => { }, setRaw: () => { },
  }), [getData]);

  return (
    <DataContext.Provider value={value}>
      <div className="app-content" style={{ padding: 20, background: '#0b0f14', minHeight: '100vh' }}>
        <OrderListTable />
      </div>
    </DataContext.Provider>
  );
}

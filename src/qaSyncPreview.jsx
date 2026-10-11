/** QA PREVIEW — temporary. Mounts the real directory with the Smart Attendance seed. */
import React, { useCallback, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DataContext } from './context/DataContext';
import { AuthContext } from './context/AuthContext';
import { RoleProvider } from './context/RoleContext';
import LineDeploymentPage from './pages/LineDeploymentPage';
import { STANDARD_WORKERS } from './utils/attendance';

// The same seed DataContext now builds from the Smart Attendance roster.
const DIRECTORY = STANDARD_WORKERS.map((w) => ({
  id: `emp-seed-${w.workerId}`,
  employeeId: `EMP-${String(w.workerId).padStart(3, '0')}`,
  workerId: w.workerId,
  name: w.name,
  status: 'active',
  archived: false,
  createdAt: '2026-08-01',
  active: true,
}));

export default function QaSyncPreview() {
  const [data, setData] = useState({
    employees: STANDARD_WORKERS.map((w) => w.name),
    'employee-directory': DIRECTORY,
    'employee-sequence': [DIRECTORY.length],
    workers: STANDARD_WORKERS.map((w) => ({ ...w, id: String(w.workerId) })),
  });

  const getData = useCallback((key) => data[key] || [], [data]);
  const setRaw = useCallback((key, value) => setData((prev) => ({ ...prev, [key]: value })), []);
  const addEntry = useCallback(() => { }, []);
  const updateEntry = useCallback(() => { }, []);
  const deleteEntry = useCallback(() => { }, []);

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
    Object.defineProperty(window, '__SYNC_STATE__', { configurable: true, get: () => stateRef.current });
  }

  return (
    <BrowserRouter>
      <AuthContext.Provider value={auth}>
        <DataContext.Provider value={value}>
          <RoleProvider>
            <div className="app-content" style={{ padding: 20, background: '#0b0f14', minHeight: '100vh' }}>
              <LineDeploymentPage
                category={{ key: 'manpower', label: 'Manpower Management', icon: '🧑‍🏭' }}
                item={{ key: 'manpower-deployment', label: 'Line Deployment', icon: '👥' }}
              />
            </div>
          </RoleProvider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </BrowserRouter>
  );
}

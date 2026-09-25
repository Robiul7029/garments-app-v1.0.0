import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RoleProvider, useRole } from './context/RoleContext';
import { DataProvider } from './context/DataContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import Salary from './pages/Salary';
import Payroll from './pages/Payroll';
import SmartAttendance from './pages/SmartAttendance';
import AttendanceReport from './pages/AttendanceReport';
import AuthScreen from './pages/AuthScreen';
import DataModule from './components/DataModule';
import Settings from './pages/Settings';
import { menu } from './config/menuConfig';

function PendingApprovalBanner() {
  const { user } = useAuth();
  const { pendingApproval } = useRole();
  if (!user || user.role !== 'admin' || user.isSuperAdmin || !pendingApproval) return null;
  return (
    <div className="pending-banner">
      Your manager access is pending approval — you're seeing the standard view for now.
    </div>
  );
}

function WelcomeSplash({ name }) {
  return (
    <div className="welcome-splash">
      <div className="welcome-splash-text">Welcome{name ? `, ${name}` : ''}!</div>
    </div>
  );
}

function AppShell() {
  const { user } = useAuth();
  const [showWelcome, setShowWelcome] = useState(false);
  const wasLoggedIn = useRef(false);

  useEffect(() => {
    if (user && !wasLoggedIn.current) {
      setShowWelcome(true);
      const t = setTimeout(() => setShowWelcome(false), 900);
      wasLoggedIn.current = true;
      return () => clearTimeout(t);
    }
    if (!user) wasLoggedIn.current = false;
  }, [user]);

  if (!user) return <AuthScreen />;

  return (
    <RoleProvider>
      <DataProvider>
        {showWelcome && <WelcomeSplash name={user.username || user.email} />}
        <div className="app-shell">
          <Header />
          <PendingApprovalBanner />
          <div className="app-body">
            <Sidebar />
            <main className="app-content">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/salary" element={<Salary />} />
                <Route path="/payroll" element={<Payroll />} />
                <Route path="/attendance-sheet" element={<SmartAttendance />} />
                <Route path="/attendance/export" element={<AttendanceReport />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/privacy" element={<Settings section="privacy" />} />
                <Route path="/history" element={<Settings section="history" />} />
                {menu.map((cat) =>
                  cat.items.map((item) => (
                    <Route
                      key={item.key}
                      path={`/${cat.key}/${item.key}`}
                      element={<DataModule category={cat} item={item} />}
                    />
                  ))
                )}
              </Routes>
            </main>
          </div>
        </div>
      </DataProvider>
    </RoleProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}

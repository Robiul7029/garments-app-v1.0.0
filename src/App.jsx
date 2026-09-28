import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SecurityProvider, useSecurity } from './context/SecurityContext';
import { RoleProvider, useRole } from './context/RoleContext';
import { DataProvider } from './context/DataContext';
import { ActivityProvider } from './context/ActivityContext';
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
import History from './pages/History';
import AdminDashboard from './components/AdminDashboard';
import EmployeeManagement from './components/EmployeeManagement';
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

// Admin area guard. Both signals are accepted: the explicit `role: 'admin'`
// claim and the `isSuperAdmin` flag, so an approver account whose document
// carries a different role string is not locked out. Everyone else is sent home.
function AdminRoute({ children }) {
  const { user } = useAuth();
  const allowed = Boolean(user) && (user.isSuperAdmin || user.role === 'admin');
  if (!allowed) return <Navigate to="/" replace />;
  return children;
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
  // Loaded here so the login screen can offer PIN / fingerprint, and the settings page can
  // read the user's security preferences.
  const { clearSessionVault } = useSecurity();
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

  // No vault material is kept between sessions, so this only matters for a clean handover.
  useEffect(() => { if (!user) clearSessionVault(); }, [user, clearSessionVault]);

  if (!user) return <AuthScreen />;

  return (
    <RoleProvider>
      <ActivityProvider>
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
                <Route path="/settings" element={<Settings section="privacy" />} />
                <Route path="/privacy" element={<Settings section="privacy" />} />
                <Route path="/settings/security" element={<Settings section="security" />} />
                <Route path="/history" element={<History />} />
                <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
                {/* Friendly aliases so the admin area can be reached from either word. */}
                <Route path="/admin/workers" element={<AdminRoute><EmployeeManagement /></AdminRoute>} />
                <Route path="/admin/approvals" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
                <Route path="/admin/employee-management" element={<AdminRoute><EmployeeManagement /></AdminRoute>} />
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
      </ActivityProvider>
    </RoleProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SecurityProvider>
          <AppShell />
        </SecurityProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

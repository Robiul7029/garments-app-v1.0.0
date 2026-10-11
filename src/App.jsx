import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SecurityProvider, useSecurity } from './context/SecurityContext';
import { RoleProvider } from './context/RoleContext';
import { AdminAccessProvider, useAdminAccess } from './context/AdminAccessContext';
import { DataProvider } from './context/DataContext';
import { ActivityProvider } from './context/ActivityContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Salary from './pages/Salary';
import Payroll from './pages/Payroll';
import SmartAttendance from './pages/SmartAttendance';
import AttendanceExport from './pages/AttendanceExport';
import AuthScreen from './pages/AuthScreen';
import DataModule from './components/DataModule';
import Settings from './pages/Settings';
import History from './pages/History';
import AdminDashboard from './components/AdminDashboard';
import EmployeeManagement from './components/EmployeeManagement';
import AdminLogin from './pages/AdminLogin';
import VerifyEmail from './pages/VerifyEmail';
import ProtectedRoute, { AuthLoadingScreen } from './components/ProtectedRoute';
import AdminProtectedRoute, { clearAdminSession } from './components/AdminProtectedRoute';
import { LOGIN_ENTRY_KEY, LOGIN_ENTRY_ADMIN } from './context/AuthContext';
import { navigableTargets } from './config/menuConfig';

// ---- ROBIUL GARMENTS ERP (Phase 1) ---------------------------------------
// Everything below is additive. The legacy menu, the login pages, the admin
// panel and the attendance screens are untouched: the ERP is a separate,
// self-contained section that only appears for users holding an ERP role.
import { PermissionProvider, usePermissions } from './context/PermissionContext';
import { ErpDataProvider } from './context/ErpDataContext';
import { erpRoutes } from './config/erpMenu';
import ErpHome from './pages/erp/dashboard/ErpHome';
import { MODULE, MODULE_LABELS } from './config/erpRoles';
import ErpNavGroup, { ErpAlertWatcher } from './components/erp/ErpNavGroup';
import { DeniedState, LoadingState } from './components/erp/Primitives';

function PendingApprovalBanner() {
  const { user, usersVersion } = useAuth();
  // Re-read on every approval anywhere in the app, so a manager approved in another tab
  // sees the banner disappear without signing out and back in.
  void usersVersion;
  const { record } = useAdminAccess();
  if (!user || !record) return null;
  if (record.isSuperAdmin === true) return null;
  const role = String(record.role || '').trim().toLowerCase();
  const roles = Array.isArray(record.roles) ? record.roles : [];
  const isManagerAccount = role === 'admin' || role === 'manager'
    || roles.some((value) => String(value || '').trim().toLowerCase() === 'manager');
  if (!isManagerAccount) return null;
  const status = String(record.managerStatus || record.status || '').trim().toLowerCase();
  if (status === 'approved') return null;

}

/*
 * Standard sign-in at /login. It is the general/manager entry point. A signed-in visitor
 * is sent to `/`, where the entry point they used decides their landing: a standard
 * sign-in stays on the Manager Dashboard even if the account holds admin rights, and only
 * an `/admin/login` session is carried on to the admin area. Kept as its own route so it
 * renders even with no session, which is why it lives outside AppShell.
 */
function LoginRoute() {
  const { user, loading, authReady } = useAuth();
  const location = useLocation();
  // Firebase Auth has not answered yet: a spinner, not the login form. Rendering the form
  // now would flash it at someone who is in fact already signed in.
  if (loading || !authReady) return <AuthLoadingScreen />;
  if (!user) return <AuthScreen />;
  // This route sits above the app shell, so AdminAccessProvider is not mounted here and
  // there is nothing to read a Firestore verdict from. A signed-in visitor therefore goes
  // to the Overview page; the admin area is reached through its own sign-in, which is the
  // only deliberate route into it anyway.
  return <Navigate to="/" replace state={{ from: location.pathname }} />;
}

/**
 * True when this tab signed in through the dedicated `/admin/login` screen.
 *
 * This is the visitor's stated INTENT, and it is deliberately separate from whether the
 * account holds admin rights: an approver may legitimately sign in at the standard `/`
 * screen to work as a manager, and must stay on the Manager Dashboard when they do.
 */
export function isAdminEntry() {
  try {
    return sessionStorage.getItem(LOGIN_ENTRY_KEY) === LOGIN_ENTRY_ADMIN;
  } catch {
    return false;
  }
}

/**
 * Route guard for the production modules.
 *
 * Redirects to the admin area ONLY when the tab signed in through `/admin/login` (see
 * `isAdminEntry`). Holding admin rights is not on its own a reason to leave these pages:
 * the earlier rule bounced every elevated account off `/` and onto `/admin/workers`, which
 * silently overrode a standard sign-in and stranded an approver who wanted the manager view.
 *
 * It must also not key off the session `isAdmin`, because a manager's session role is
 * `admin` too (that is what grants them data entry on these very pages).
 */
function ProductionRoute({ children }) {
  const { elevated } = useAdminAccess();
  // The entry point decides, not the role: a standard sign-in keeps the production pages
  // even for an admin account, and only an admin sign-in is sent to the admin area.
  if (!elevated || !isAdminEntry()) return children;
  return <Navigate to={landingPathFor(null, elevated)} replace />;
}

/**
 * The dashboard a signed-in account lands on for its role.
 *
 * The three audiences have three different homes:
 *   - Admin (the approver account)           -> /admin/workers, the admin workers page.
 *   - Manager / Line Incharge / Supervisor / Employee -> the production Overview at /,
 *     which is the screen the operational roles actually work from (targets, output,
 *     attendance). An Employee sees the same Overview but read-only.
 *
 * Only the admin split is a real branch today: every operational role shares the Overview,
 * so the helper stays a single expression rather than pretending to route somewhere it does
 * not. It exists so the landing rule lives in one named place instead of being inferred at
 * each call site.
 */
export function landingPathFor(_permissions, elevated, adminEntry = isAdminEntry()) {
  return elevated && adminEntry ? '/admin/workers' : '/';
}

/**
 * Sends every non-admin session to the Overview page. Mounted once above the routes so
 * it also covers a deep link like /sewing/daily-production being opened directly: the
 * rule is "general users and managers always land on Overview first", not "only on
 * sign-in". Admin sessions are left alone so they keep their own landing route.
 */
function DefaultLanding() {
  const { user } = useAuth();
  // Firestore-backed, not the session role: a manager is a production user and must still
  // land on the Overview page, while a true admin keeps their own landing route.
  const { elevated } = useAdminAccess();
  const navigate = useNavigate();
  const location = useLocation();
  // A single-shot flag: it is raised when a signed-in user first appears and is cleared
  // again the moment it has been acted on. It used to stay true for the rest of the
  // session, so every later `location.pathname` change (i.e. every sidebar sub-button
  // click) still passed the guard below and was immediately navigated back to '/'. The
  // visitor therefore saw the URL change and the page snap straight back to the Dashboard.
  const justLoggedIn = useRef(false);
  const wasLoggedIn = useRef(false);

  useEffect(() => {
    if (user && !wasLoggedIn.current) justLoggedIn.current = true;
    if (!user) {
      wasLoggedIn.current = false;
      justLoggedIn.current = false;
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // An admin-entry session is left to ProductionRoute / AdminProtectedRoute, which own the
    // jump into the admin area. A standard-entry session — even one whose account holds
    // admin rights — is treated like any other and settled onto its dashboard here.
    const home = landingPathFor(null, elevated);
    if (home !== '/') return;
    // Only the landing-after-login transition, or the very first render of a session
    // that was restored by a page reload. Ordinary in-app navigation is left alone.
    const isLandingMoment = justLoggedIn.current || !wasLoggedIn.current;
    if (!isLandingMoment) return;
    // Consume the one-shot: from now on this effect only tracks the pathname.
    justLoggedIn.current = false;
    if (location.pathname !== home) navigate(home, { replace: true });
    wasLoggedIn.current = true;
  }, [user, elevated, location.pathname, navigate]);

  return null;
}

function WelcomeSplash({ name }) {
  return (
    <div className="welcome-splash">
      <div className="welcome-splash-text">Welcome{name ? `, ${name}` : ''}!</div>
    </div>
  );
}

/**
 * Route guard and host for every ERP screen.
 *
 * The permission check happens here, before any ERP component mounts, so a user
 * without the role never has an ERP screen's Firestore listener opened. That is
 * what keeps a denial a clean page rather than a console full of
 * `permission-denied` errors that look like a broken deployment.
 */
function ErpRoute({ module, children }) {
  const permissions = usePermissions();
  if (permissions.loading) return <LoadingState label="Checking your access…" />;
  if (!permissions.canView(module)) return <DeniedState moduleLabel={MODULE_LABELS[module] || module} />;
  return children;
}

function AppShell() {
  const { user, loading, authReady } = useAuth();
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
  useEffect(() => { if (!user) { clearSessionVault(); clearAdminSession(); } }, [user, clearSessionVault]);

  // The app shell itself is behind ProtectedRoute, so no dashboard, header or sidebar is
  // ever mounted for a signed-out visitor: the guard shows a spinner while Firebase Auth
  // resolves and redirects to /login once it reports no user.
  //
  // `authReady` adds a second gate on top of it. Firebase can answer the listener with a
  // signed-in user before the Firestore role read has finished, and a Sidebar mounted in
  // that window would render the general menu and wire its click handlers to routes the
  // user may not have access to — the click then appeared to do nothing until a manual
  // refresh. Nothing interactive is mounted until the role is actually known.
  if (loading || !authReady) return <AuthLoadingScreen />;

  // A signed-out visitor must NOT be shown the spinner here: `loading`/`authReady` only
  // describe the FIRST auth resolution and stay true afterwards, so a null `user` on a
  // protected URL would render "Checking your session…" forever. That is exactly what
  // stranded a direct visit to `/` until this was fixed — the spinner below short-circuited
  // the tree, so ProtectedRoute (the component that owns the redirect) never mounted.
  //
  // Nothing below dereferences `user` without optional chaining, so the tree can render for
  // a null session; ProtectedRoute then performs the redirect to /login on this same pass.
  return (
    <ProtectedRoute>
      <AdminAccessProvider>
      <RoleProvider>
        <ActivityProvider>
        <DataProvider>
        {/* ERP providers wrap everything below, including the legacy screens, but
            none of them change how a legacy screen behaves: a user with no ERP
            role simply gets empty role lists and no ERP navigation. */}
        <PermissionProvider>
        <ErpDataProvider>
        {showWelcome && <WelcomeSplash name={user?.username || user?.email || ''} />}
        <ErpAlertWatcher />
        <DefaultLanding />
        <div className="app-shell">
          <Header />
          <PendingApprovalBanner />
          <div className="app-body">
            <Sidebar />
            <main className="app-content">
              <Routes>
                {/* A true admin (approver account) is confined to the employee-management
                    area; ProductionRoute sends them to /admin/workers. A manager passes
                    straight through to every operational page. */}
                {/* The home route is the new ERP Overview for every signed-in account.
                    It is not wrapped in ErpRoute: that guard renders a DeniedState wall,
                    and the ERP dashboard already degrades per-collection for a role that
                    may not read it, so a permission gate here would only turn a usable
                    home page into a refusal. ProductionRoute is kept, because it still
                    owns the admin-entry redirect. */}
                <Route path="/" element={<ProductionRoute><ErpHome /></ProductionRoute>} />
                <Route path="/salary" element={<ProductionRoute><Salary /></ProductionRoute>} />
                <Route path="/payroll" element={<ProductionRoute><Payroll /></ProductionRoute>} />
                <Route path="/attendance-sheet" element={<ProductionRoute><SmartAttendance /></ProductionRoute>} />
                {/* The Excel register is reachable both from the Attendance sub-menu
                    (`/attendance/monthly-export`, generated from the menu config below) and
                    from this short alias, so an old bookmark or a deep link still opens it
                    instead of falling through to the catch-all. */}
                <Route path="/attendance/export" element={<ProductionRoute><AttendanceExport /></ProductionRoute>} />
                <Route path="/settings" element={<ProductionRoute><Settings section="privacy" /></ProductionRoute>} />
                <Route path="/privacy" element={<ProductionRoute><Settings section="privacy" /></ProductionRoute>} />
                <Route path="/settings/security" element={<ProductionRoute><Settings section="security" /></ProductionRoute>} />
                <Route path="/history" element={<ProductionRoute><History /></ProductionRoute>} />
                {/* Canonical landing target for an admin bounced off a protected route.
                    Kept outside the /admin section, so it is wrapped with the guard's
                    children form rather than mounted as a layout route. */}
                <Route path="/employee-management" element={<AdminProtectedRoute showDenied><EmployeeManagement /></AdminProtectedRoute>} />
                {/* The admin area is one guarded section. AdminProtectedRoute is the
                    layout route, so every child below it — present and future — inherits
                    the check. It reads the role from users/{uid} in Firestore and never
                    mounts an admin screen before that verdict is in, so a manager who
                    types /admin, /admin/workers or /admin/approvals is redirected to
                    /admin/login without ever seeing the dashboard. `showDenied` would
                    render the "Access Denied" panel here instead; the redirect is kept
                    because it leads the user to the dedicated admin sign-in. */}
                <Route path="/admin" element={<AdminProtectedRoute />}>
                  <Route index element={<Navigate to="/admin/workers" replace />} />
                  <Route path="workers" element={<EmployeeManagement />} />
                  <Route path="employee-management" element={<EmployeeManagement />} />
                  <Route path="approvals" element={<AdminDashboard />} />
                </Route>
                {/* One route per menu entry, generated from the same config the sidebar renders, so a
                    path can never exist in the drawer but be missing from the router (that
                    mismatch was what sent a sub-button click to the catch-all and back to
                    the Dashboard). The key is `category/item` because item keys alone are
                    only unique per category. */}
                {/* `navigableTargets()` flattens the menu — including nested children —
                    into the exact path set the sidebar can produce, so a link can never
                    exist in the drawer without a matching route. `parentItem` is carried
                    through for a nested page to breadcrumb back to its parent. */}
                {navigableTargets().map(({ path, category, item, parentItem }) => (
                  <Route
                    key={path}
                    path={path}
                    element={(
                      <ProductionRoute>
                        <DataModule category={category} item={item} parentItem={parentItem} />
                      </ProductionRoute>
                    )}
                  />
                ))}
                {/* ---- ROBIUL GARMENTS ERP ----
                    One route per entry in erpMenu.js, generated from the same array
                    the sidebar renders, so a module can never be listed in the
                    drawer without a matching route. Each route is additionally
                    gated by its module permission in ErpRoute. */}
                {erpRoutes().map((r) => (
                  <Route
                    key={r.path}
                    path={r.path}
                    element={
                      <ErpRoute module={r.moduleKey}>
                        <r.component />
                      </ErpRoute>
                    }
                  />
                ))}
                {/* Unknown URLs go home rather than rendering a blank page. */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
        </div>
        </ErpDataProvider>
        </PermissionProvider>
        </DataProvider>
        </ActivityProvider>
      </RoleProvider>
      </AdminAccessProvider>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SecurityProvider>
          {/* The two login routes are declared out here, above AppShell, because
              AppShell assumes a signed-in user. The catch-all is inside AppShell so a
              signed-in visitor keeps the app chrome while being redirected. */}
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            {/* Landing page for the short link in the verification email. Declared out
                here, above AppShell, because the visitor is not signed in yet. */}
            <Route path="/verify-email" element={<VerifyEmail />} />
            {/* The admin sign-in sits above the app shell, so AdminAccessProvider — which
                lives inside that shell — is not mounted here. The screen reads the raw
                Firestore record itself for that reason.

                Three paths reach it, so a direct visit, a bookmark or an old link all
                open the admin form instead of the catch-all app shell:
                  /admin/login  — canonical, used by the guard's redirects
                  /admin        — bare section root; AdminProtectedRoute also owns /admin/*
                                  for signed-in users, but with no user it sends them here
                  /admin-login  — legacy / convenience alias
                All three render the same AdminLogin component. */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin-login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminLogin />} />
            <Route path="*" element={<AppShell />} />
          </Routes>
        </SecurityProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

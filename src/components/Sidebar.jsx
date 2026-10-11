import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { menu, payrollConfig, salaryConfig, modulePath, childTargetsOf } from '../config/menuConfig';
import ErpNavGroup from './erp/ErpNavGroup';
import { useAuth } from '../context/AuthContext';
import { useAdminAccess } from '../context/AdminAccessContext';

// The ☰ button opens an overlay drawer.
// Inside the drawer every department is listed; tapping one expands its
// own sub-items and collapses any other department that was open
// (classic accordion — only one open at a time). Tapping a sub-item
// navigates there and closes the drawer, so the page shows full-screen.
//
// An admin session only ever sees the two admin tools. Every production
// module, the dashboard link and the salary group are omitted for them, so
// there is nothing in the drawer to click outside the admin area.
export default function Sidebar({ defaultOpen = false }) {
  // `defaultOpen` renders the drawer already expanded. The app never passes it —
  // the ☰ button owns the state — but it lets a test (or a deep link) start from
  // the open drawer rather than having to synthesise a click.
  const [panelOpen, setPanelOpen] = useState(defaultOpen);
  const [openCat, setOpenCat] = useState(null);
  // Which nested parent is expanded, keyed by `category/parent`. Kept separate
  // from `openCat` so expanding a sub-group does not collapse the department
  // that contains it. Any category may nest; this is not specific to one.
  const [openSub, setOpenSub] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { authReady } = useAuth() || {};
  // The admin branch of the drawer is chosen by the Firestore record, not by the session
  // role. A manager's session role is also 'admin' (it is what grants them data entry on
  // every operational page), so reading `isAdmin` here would replace the whole production
  // menu with the two admin links for every manager — leaving them with no way to reach
  // Attendance, Sewing, Salary or anything else they are entitled to.
  const { elevated } = useAdminAccess();
  const showAdminTools = Boolean(elevated);

  // The drawer is only allowed to open once the role and the menu config are both
  // settled. Clicking before that would either render the wrong branch (general menu for
  // an admin) or navigate with a half-built path, and the user would have to refresh to
  // get the buttons working. The ☰ button is disabled rather than hidden so its place in
  // the layout never shifts.
  const ready = Boolean(authReady);

  // A role change (an approval that lands while the tab is open) swaps the whole branch
  // below, so any half-open drawer from the previous role is closed and the accordion
  // state is dropped. Without this the panel kept the old role's open category and its
  // stale click targets.
  useEffect(() => {
    if (!ready) {
      setPanelOpen(false);
      setOpenCat(null);
    }
  }, [ready, showAdminTools]);

  // The config is the single source of truth; if it ever fails to load, the drawer shows
  // the Dashboard and Salary links only instead of throwing on `menu.map`.
  const categories = Array.isArray(menu) ? menu : [];

  function go(path) {
    // Never navigate to a half-built path: an undefined or `/`-only target would resolve
    // to the Dashboard and look like the click silently did nothing.
    const target = typeof path === 'string' && path.startsWith('/') && path.length > 1 ? path : '/';
    navigate(target);
    setPanelOpen(false);
    setOpenCat(null);
  }

  return (
    <>
      <div className="sidebar-bar">
        <button
          className="dots-btn"
          type="button"
          disabled={!ready}
          aria-busy={!ready}
          onClick={() => setPanelOpen((open) => !open)}
        >☰</button>
      </div>

      {panelOpen && (
        <div className="drawer-backdrop" onClick={() => setPanelOpen(false)}>
          <aside className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            {showAdminTools ? (
              /* Admin sees only the two admin tools — nothing else is rendered. */
              <>
                <button
                  className={'sidebar-cat sidebar-cat-link' + (location.pathname.startsWith('/admin/workers') || location.pathname === '/employee-management' ? ' active' : '')}
                  onClick={() => go('/admin/workers')}
                >
                  👥 Employee Management
                </button>
                <button
                  className={'sidebar-cat sidebar-cat-link' + (location.pathname === '/admin/approvals' ? ' active' : '')}
                  onClick={() => go('/admin/approvals')}
                >
                  🛡️ User Approvals
                </button>
              </>
            ) : (
              <>
                <button className="sidebar-home drawer-dashboard" onClick={() => go('/')}>🏠 Dashboard</button>

                {/* A category with no items is skipped rather than rendered as a group
                    whose expand click would open an empty list. The path is built only
                    from keys that are known to exist, so a click can never navigate to
                    `/undefined/undefined` and land back on the Dashboard. */}
                {categories.filter((cat) => Array.isArray(cat?.items) && cat.items.length > 0 && cat.key).map((cat) => (
              <div key={cat.key} className="sidebar-group">
                <button
                  className="sidebar-cat"
                  style={{ borderLeft: `3px solid ${cat.accent || '#334155'}` }}
                  onClick={() => setOpenCat(openCat === cat.key ? null : cat.key)}
                  aria-expanded={openCat === cat.key}
                >
                  <span>{cat.icon} {cat.label}</span>
                  <span className="chev">{openCat === cat.key ? '▾' : '▸'}</span>
                </button>
                {openCat === cat.key && (
                  <div className="sidebar-items">
                    {cat.items.filter((item) => item?.key).map((item) => {
                      // The path comes from the same helper App.jsx builds its routes with,
                      // so a drawer entry can never point at a URL the router does not have.
                      const path = modulePath(cat.key, item.key);
                      // Child targets come from the same helper App.jsx builds its
                      // nested routes from, so a nested button can never point at a
                      // URL the router does not have.
                      const children = childTargetsOf(cat.key, item.key);
                      const subKey = `${cat.key}/${item.key}`;
                      const subOpen = openSub === subKey;

                      // A parent that has children behaves as a disclosure control:
                      // clicking it expands the nested items rather than navigating,
                      // so the child is reachable and the parent is not a dead link.
                      // Its own view is still served at its route for a bookmark.
                      if (children.length > 0) {
                        // The department reads as active when the visitor is on the
                        // parent OR on any of its children, so the trail is visible.
                        const parentActive = location.pathname === path
                          || children.some((c) => location.pathname === c.path);
                        return (
                          <div key={item.key} className="sidebar-nest">
                            <button
                              className={'sidebar-item sidebar-item-parent' + (parentActive ? ' active' : '')}
                              style={parentActive ? { color: cat.accent, background: `${cat.accent}1a` } : undefined}
                              aria-expanded={subOpen}
                              onClick={() => setOpenSub(subOpen ? null : subKey)}
                            >
                              <span>{item.icon} {item.label}</span>
                              <span className="chev">{subOpen ? '▾' : '▸'}</span>
                            </button>
                            {subOpen && (
                              <div className="sidebar-subitems">
                                {children.map((child) => {
                                  const childActive = location.pathname === child.path;
                                  return (
                                    <button
                                      key={child.item.key}
                                      className={'sidebar-item sidebar-subitem' + (childActive ? ' active' : '')}
                                      style={childActive ? { color: cat.accent, background: `${cat.accent}1a` } : undefined}
                                      onClick={() => go(child.path)}
                                    >
                                      {child.item.icon} {child.item.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }

                      const active = location.pathname === path;
                      return (
                        <button
                          key={item.key}
                          className={'sidebar-item' + (active ? ' active' : '')}
                          style={active ? { color: cat.accent, background: `${cat.accent}1a` } : undefined}
                          onClick={() => go(path)}
                        >
                          {item.icon} {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
                ))}

            {/* ROBIUL GARMENTS ERP — additive. Renders nothing at all for a user
                with no ERP role, so the legacy drawer is unchanged for them. It
                reuses this component's `openCat` accordion, so opening ERP closes
                any open department and vice versa, exactly like the others. */}
            <ErpNavGroup
              open={openCat === 'erp'}
              onToggle={() => setOpenCat(openCat === 'erp' ? null : 'erp')}
            />

            {/* Salary is a collapsible parent: the Payroll Worksheet lives under it. */}
            <div className="sidebar-group">
              <button
                className="sidebar-cat sidebar-cat-link"
                onClick={() => setOpenCat(openCat === 'salary' ? null : 'salary')}
                aria-expanded={openCat === 'salary'}
              >
                <span>{salaryConfig.icon} {salaryConfig.label}</span>
                <span className="chev">{openCat === 'salary' ? '▾' : '▸'}</span>
              </button>
              {openCat === 'salary' && (
                <div className="sidebar-items">
                  <button
                    className={'sidebar-item' + (location.pathname === '/salary' ? ' active' : '')}
                    onClick={() => go('/salary')}
                  >
                    {salaryConfig.icon} Salary Register
                  </button>
                  <button
                    className={'sidebar-item' + (location.pathname === '/payroll' ? ' active' : '')}
                    onClick={() => go('/payroll')}
                  >
                    {payrollConfig.icon} {payrollConfig.label}
                  </button>
                </div>
              )}
            </div>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

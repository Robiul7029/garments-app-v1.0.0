import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { menu, payrollConfig, salaryConfig } from '../config/menuConfig';
import { useAuth } from '../context/AuthContext';

// The ☰ button opens an overlay drawer.
// Inside the drawer every department is listed; tapping one expands its
// own sub-items and collapses any other department that was open
// (classic accordion — only one open at a time). Tapping a sub-item
// navigates there and closes the drawer, so the page shows full-screen.
export default function Sidebar() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [openCat, setOpenCat] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  // Admin area links accept either signal: role 'admin' or the isSuperAdmin flag.
  const isAdminUser = Boolean(user) && (user.isSuperAdmin || user.role === 'admin');

  function go(path) {
    navigate(path);
    setPanelOpen(false);
  }

  return (
    <>
      <div className="sidebar-bar">
        <button className="dots-btn" onClick={() => setPanelOpen(!panelOpen)}>☰</button>
      </div>

      {panelOpen && (
        <div className="drawer-backdrop" onClick={() => setPanelOpen(false)}>
          <aside className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <button className="sidebar-home drawer-dashboard" onClick={() => go('/')}>🏠 Dashboard</button>

            {menu.map((cat) => (
              <div key={cat.key} className="sidebar-group">
                <button
                  className="sidebar-cat"
                  style={{ borderLeft: `3px solid ${cat.accent}` }}
                  onClick={() => setOpenCat(openCat === cat.key ? null : cat.key)}
                >
                  <span>{cat.icon} {cat.label}</span>
                  <span className="chev">{openCat === cat.key ? '▾' : '▸'}</span>
                </button>
                {openCat === cat.key && (
                  <div className="sidebar-items">
                    {cat.items.map((item) => {
                      const active = location.pathname === `/${cat.key}/${item.key}`;
                      return (
                        <button
                          key={item.key}
                          className={'sidebar-item' + (active ? ' active' : '')}
                          style={active ? { color: cat.accent, background: `${cat.accent}1a` } : undefined}
                          onClick={() => go(`/${cat.key}/${item.key}`)}
                        >
                          {item.icon} {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

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
            {isAdminUser && (
              <button className="sidebar-cat sidebar-cat-link" onClick={() => go('/admin/workers')}>
                👥 Employee Management
              </button>
            )}
            {isAdminUser && (
              <button className="sidebar-cat sidebar-cat-link" onClick={() => go('/admin/approvals')}>
                🛡️ Admin Approvals
              </button>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

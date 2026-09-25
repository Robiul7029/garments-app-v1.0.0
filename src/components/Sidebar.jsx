import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { attendanceExportConfig, attendanceSheetConfig, menu, payrollConfig, salaryConfig } from '../config/menuConfig';

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

            <button className="sidebar-cat sidebar-cat-link" onClick={() => go('/salary')}>
              {salaryConfig.icon} {salaryConfig.label}
            </button>
            <button className="sidebar-cat sidebar-cat-link" onClick={() => go('/payroll')}>
              {payrollConfig.icon} {payrollConfig.label}
            </button>
            <button className="sidebar-cat sidebar-cat-link" onClick={() => go('/attendance-sheet')}>
              {attendanceSheetConfig.icon} {attendanceSheetConfig.label}
            </button>
            <button className="sidebar-cat sidebar-cat-link" onClick={() => go('/attendance/export')}>
              {attendanceExportConfig.icon} {attendanceExportConfig.label}
            </button>
          </aside>
        </div>
      )}
    </>
  );
}
